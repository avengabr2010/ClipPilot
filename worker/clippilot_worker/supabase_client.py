"""Minimal Supabase client (PostgREST, RPC, Storage) using the service role.

We deliberately keep this thin instead of pulling the full SDK: the worker
only needs a handful of calls, and explicit HTTP keeps retries/timeouts
under our control.
"""
from __future__ import annotations

import json
import time
from pathlib import Path
from typing import Any
from urllib.parse import quote

import httpx


class SupabaseError(RuntimeError):
    def __init__(self, status: int, message: str):
        super().__init__(f"[{status}] {message}")
        self.status = status
        self.message = message

    @property
    def transient(self) -> bool:
        return self.status >= 500 or self.status in (0, 408, 429)


class Supabase:
    def __init__(self, url: str, service_key: str, timeout: float = 60.0):
        self.url = url.rstrip("/")
        self._headers = {"apikey": service_key, "Authorization": f"Bearer {service_key}"}
        self.http = httpx.Client(timeout=httpx.Timeout(timeout, connect=10.0), headers=self._headers)

    # -- low level -----------------------------------------------------------------
    def _request(self, method: str, path: str, *, retries: int = 3, **kw: Any) -> httpx.Response:
        last: Exception | None = None
        for attempt in range(retries):
            try:
                r = self.http.request(method, f"{self.url}{path}", **kw)
            except httpx.TransportError as e:  # network hiccup
                last = SupabaseError(0, str(e))
            else:
                if r.status_code < 400:
                    return r
                last = SupabaseError(r.status_code, r.text[:500])
                if not last.transient:
                    raise last
            time.sleep(min(2**attempt, 8))
        assert last is not None
        raise last

    # -- PostgREST --------------------------------------------------------------------
    def rpc(self, fn: str, args: dict[str, Any] | None = None) -> Any:
        r = self._request("POST", f"/rest/v1/rpc/{fn}", json=args or {})
        return r.json() if r.content else None

    def select(self, table: str, query: str) -> list[dict[str, Any]]:
        return self._request("GET", f"/rest/v1/{table}?{query}").json()

    def select_one(self, table: str, query: str) -> dict[str, Any] | None:
        rows = self.select(table, query + "&limit=1")
        return rows[0] if rows else None

    def insert(self, table: str, rows: dict[str, Any] | list[dict[str, Any]], *, upsert: bool = False) -> list[dict[str, Any]]:
        prefer = "return=representation"
        if upsert:
            prefer += ",resolution=merge-duplicates"
        r = self._request("POST", f"/rest/v1/{table}", json=rows, headers={"Prefer": prefer})
        return r.json()

    def update(self, table: str, query: str, values: dict[str, Any]) -> list[dict[str, Any]]:
        r = self._request("PATCH", f"/rest/v1/{table}?{query}", json=values, headers={"Prefer": "return=representation"})
        return r.json()

    def delete(self, table: str, query: str) -> None:
        self._request("DELETE", f"/rest/v1/{table}?{query}")

    # -- Storage ----------------------------------------------------------------------
    @staticmethod
    def _obj(bucket: str, path: str) -> str:
        return f"/storage/v1/object/{bucket}/{quote(path)}"

    def download(self, bucket: str, path: str, dest: Path) -> int:
        dest.parent.mkdir(parents=True, exist_ok=True)
        for attempt in range(3):
            try:
                with self.http.stream("GET", f"{self.url}{self._obj(bucket, path)}", timeout=httpx.Timeout(600, connect=10)) as r:
                    if r.status_code >= 400:
                        raise SupabaseError(r.status_code, r.read().decode(errors="replace")[:300])
                    size = 0
                    with dest.open("wb") as f:
                        for chunk in r.iter_bytes(1024 * 1024):
                            f.write(chunk)
                            size += len(chunk)
                    return size
            except httpx.TransportError as e:
                if attempt == 2:
                    raise SupabaseError(0, str(e)) from e
                time.sleep(2**attempt)
        raise SupabaseError(0, "download failed")

    def upload(self, bucket: str, path: str, src: Path, content_type: str) -> None:
        with src.open("rb") as f:
            data = f.read()
        self._request(
            "POST",
            self._obj(bucket, path),
            content=data,
            headers={"Content-Type": content_type, "x-upsert": "true", "Cache-Control": "max-age=3600"},
            timeout=httpx.Timeout(600, connect=10),
        )

    def remove(self, bucket: str, paths: list[str]) -> None:
        if not paths:
            return
        self._request("DELETE", f"/storage/v1/object/{bucket}", content=json.dumps({"prefixes": paths}),
                      headers={"Content-Type": "application/json"})

    def list_prefix(self, bucket: str, prefix: str) -> list[str]:
        """Recursively lists object paths under prefix."""
        out: list[str] = []
        r = self._request("POST", f"/storage/v1/object/list/{bucket}", json={"prefix": prefix, "limit": 1000})
        for item in r.json():
            full = f"{prefix}/{item['name']}" if prefix else item["name"]
            if item.get("id") is None:
                out.extend(self.list_prefix(bucket, full))
            else:
                out.append(full)
        return out

    def remove_prefix(self, bucket: str, prefix: str) -> int:
        paths = self.list_prefix(bucket, prefix)
        for i in range(0, len(paths), 100):
            self.remove(bucket, paths[i : i + 100])
        return len(paths)
