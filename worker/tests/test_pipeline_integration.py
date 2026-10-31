"""End-to-end pipeline test against the REAL schema & SQL functions.

- PostgreSQL: the migrations applied to a local database (scripts/db-test-setup.sh)
- FFmpeg / OpenCV: real
- Storage: a local directory
- Whisper: replaced by a fixed transcript (models cannot be downloaded in CI)

Skipped automatically when the test database is not reachable.
"""
from __future__ import annotations

import json
import os
import re
import shutil
import subprocess
import uuid
from pathlib import Path

import pytest

psycopg = pytest.importorskip("psycopg")
from psycopg.types.json import Jsonb  # noqa: E402

from clippilot_worker import pipeline  # noqa: E402
from clippilot_worker.config import PACKAGE_DIR, Config  # noqa: E402
from clippilot_worker.supabase_client import SupabaseError  # noqa: E402
from clippilot_worker.transcribe import Segment, Transcript  # noqa: E402

from .conftest import FR_SCRIPT, make_words  # noqa: E402

DSN = os.environ.get("TEST_DATABASE_URL", "postgresql://postgres:postgres@localhost:5432/clippilot_test")


def _connect():
    try:
        return psycopg.connect(DSN, autocommit=True)
    except Exception:  # noqa: BLE001
        pytest.skip("test database not available (run scripts/db-test-setup.sh)")


class PgSupabase:
    """Implements the Supabase client surface used by the worker on top of psycopg."""

    OPS = {"eq": "=", "neq": "<>", "lt": "<", "gt": ">", "lte": "<=", "gte": ">="}

    def __init__(self, conn, storage: Path):
        self.conn, self.storage = conn, storage

    def _where(self, query: str):
        clauses, params, limit = [], [], None
        for part in filter(None, query.split("&")):
            key, _, val = part.partition("=")
            if key == "select" or key == "order":
                continue
            if key == "limit":
                limit = int(val)
                continue
            op, _, arg = val.partition(".")
            if op == "in":
                items = arg.strip("()").split(",")
                clauses.append(f'"{key}"::text = any(%s)')
                params.append(items)
            else:
                clauses.append(f'"{key}" {self.OPS[op]} %s')
                params.append(None if arg == "null" else arg)
        sql = (" where " + " and ".join(clauses)) if clauses else ""
        return sql + (f" limit {limit}" if limit else ""), params

    @staticmethod
    def _val(v):
        if isinstance(v, float):
            return str(v)  # untyped literal, like JSON numbers through PostgREST
        return Jsonb(v) if isinstance(v, (dict, list)) else v

    def rpc(self, fn, args=None):
        args = args or {}
        names = ", ".join(f"{k} => %s" for k in args)
        try:
            cur = self.conn.execute(f"select to_jsonb(r) from public.{fn}({names}) r", [self._val(v) for v in args.values()])
        except psycopg.Error as e:
            raise SupabaseError(400, str(e)) from e
        rows = [r[0] for r in cur.fetchall()]
        return rows[0] if len(rows) == 1 and fn != "claim_next_job" else rows

    def select(self, table, query):
        where, params = self._where(query)
        return [r[0] for r in self.conn.execute(f"select to_jsonb(t) from public.{table} t{where}", params).fetchall()]

    def select_one(self, table, query):
        rows = self.select(table, query + "&limit=1")
        return rows[0] if rows else None

    def insert(self, table, rows, *, upsert=False):
        rows = rows if isinstance(rows, list) else [rows]
        out = []
        for row in rows:
            cols = list(row)
            conflict = ""
            if upsert:
                pk = {"transcripts": "video_id", "clip_edits": "clip_id"}.get(table, "id")
                sets = ", ".join(f'"{c}" = excluded."{c}"' for c in cols if c != pk)
                conflict = f" on conflict ({pk}) do update set {sets}"
            sql = (f"insert into public.{table} ({', '.join(chr(34) + c + chr(34) for c in cols)}) values "
                   f"({', '.join(['%s'] * len(cols))}){conflict} returning to_jsonb({table}.*)")
            out.append(self.conn.execute(sql, [self._val(row[c]) for c in cols]).fetchone()[0])
        return out

    def update(self, table, query, values):
        where, params = self._where(query)
        sets = ", ".join(f'"{k}" = %s' for k in values)
        sql = f"update public.{table} set {sets}{where} returning to_jsonb({table}.*)"
        return [r[0] for r in self.conn.execute(sql, [self._val(v) for v in values.values()] + params).fetchall()]

    def delete(self, table, query):
        where, params = self._where(query)
        self.conn.execute(f"delete from public.{table}{where}", params)

    def download(self, bucket, path, dest):
        shutil.copy(self.storage / bucket / path, dest)
        return dest.stat().st_size

    def upload(self, bucket, path, src, content_type):
        target = self.storage / bucket / path
        target.parent.mkdir(parents=True, exist_ok=True)
        shutil.copy(src, target)

    def remove(self, bucket, paths):
        for p in paths:
            (self.storage / bucket / p).unlink(missing_ok=True)


@pytest.fixture
def env(tmp_path, sample_video, monkeypatch):
    conn = _connect()
    user = str(uuid.uuid4())
    email = f"pipeline-{user[:8]}@example.com"
    conn.execute("insert into auth.users (id, email, email_confirmed_at) values (%s, %s, now())", [user, email])
    project = conn.execute("insert into public.projects (user_id, name) values (%s, 'Test') returning id", [user]).fetchone()[0]
    video = str(uuid.uuid4())
    storage = tmp_path / "storage"
    src_path = f"{user}/{video}/source.mp4"
    (storage / "sources" / user / video).mkdir(parents=True)
    shutil.copy(sample_video, storage / "sources" / src_path)
    settings = {"duration": "15-30", "clipCount": 2, "aspect": "9:16", "resolution": 720, "language": "fr",
                "style": "dynamic", "subtitlePreset": "classic", "subtitlesEnabled": True, "smartCrop": True,
                "hookDetector": False, "viralityScore": False, "watermark": True}
    conn.execute(
        "insert into public.videos (id, user_id, project_id, original_filename, storage_path, mime_type, size_bytes, status, settings)"
        " values (%s, %s, %s, 'sample.mp4', %s, 'video/mp4', %s, 'uploaded', %s)",
        [video, user, project, src_path, (storage / "sources" / src_path).stat().st_size, Jsonb(settings)],
    )
    job = conn.execute(
        "insert into public.video_jobs (user_id, video_id, type) values (%s, %s, 'process_video') returning to_jsonb(video_jobs.*)",
        [user, video]).fetchone()[0]
    worker = "test-worker"
    job = conn.execute("select to_jsonb(r) from public.claim_next_job(%s, null) r", [worker]).fetchone()[0]

    words = make_words(FR_SCRIPT, wps=2.6)  # ~60s of speech
    fake = Transcript(language="fr", words=words, segments=[Segment(words[0].start, words[-1].end, FR_SCRIPT)], model="fixture")
    monkeypatch.setattr(pipeline, "transcribe", lambda *a, **k: fake)

    cfg = Config(supabase_url="http://unused", service_role_key="x" * 30, worker_id=worker, concurrency=1, poll_interval=1,
                 job_timeout_seconds=600, tmp_dir=tmp_path / "work", whisper_model="fixture", whisper_device="cpu",
                 whisper_compute_type="int8", whisper_model_dir=None, anthropic_api_key=None, anthropic_model="none",
                 source_retention_days=7, export_retention_days=30, fonts_dir=PACKAGE_DIR.parent / "fonts", ffmpeg_threads=0)
    db = PgSupabase(conn, storage)
    yield dict(conn=conn, db=db, cfg=cfg, job=job, user=user, video=video, storage=storage)
    conn.execute("delete from auth.users where id = %s", [user])


def test_process_video_end_to_end(env):
    db, cfg, job, conn = env["db"], env["cfg"], env["job"], env["conn"]
    with pipeline.JobContext(db, job, cfg.worker_id, 600) as ctx:
        result = pipeline.process_video(db, cfg, job, ctx)
    assert result["clips"] == 2

    video = db.select_one("videos", f"id=eq.{env['video']}")
    assert video["status"] == "ready" and float(video["duration_seconds"]) > 59

    clips = db.select("clips", f"video_id=eq.{env['video']}")
    assert len(clips) == 2
    for c in clips:
        assert c["status"] == "ready"
        assert 14 <= float(c["duration_seconds"]) <= 33
        assert c["title"] and c["reason"]
        assert c["virality_score"] is None  # Free plan: no virality score feature
        exports = db.select("exports", f"clip_id=eq.{c['id']}")
        assert len(exports) == 1 and exports[0]["watermark"] is True
        mp4 = env["storage"] / "exports" / exports[0]["storage_path"]
        assert mp4.exists() and mp4.stat().st_size > 10_000
        probe = json.loads(subprocess.run(["ffprobe", "-v", "error", "-print_format", "json", "-show_streams", str(mp4)],
                                          capture_output=True, check=True).stdout)
        v = next(s for s in probe["streams"] if s["codec_type"] == "video")
        assert (v["width"], v["height"]) == (720, 1280)
        assert db.select_one("clip_edits", f"clip_id=eq.{c['id']}") is not None

    bal = conn.execute("select minutes_used, clips_used from public.credit_balances where user_id = %s", [env["user"]]).fetchone()
    assert float(bal[0]) == 1.0  # 60 s -> 1.0 min
    assert bal[1] == 2


def test_quota_exceeded_is_rejected_and_refunded(env):
    db, cfg, job, conn = env["db"], env["cfg"], env["job"], env["conn"]
    conn.execute("update public.credit_balances set clips_used = 3 where user_id = %s", [env["user"]])  # free = 3 clips
    with pipeline.JobContext(db, job, cfg.worker_id, 600) as ctx:
        with pytest.raises(pipeline.UserFacingError, match="clips"):
            pipeline.process_video(db, cfg, job, ctx)
    used = conn.execute("select minutes_used from public.credit_balances where user_id = %s", [env["user"]]).fetchone()[0]
    assert float(used) == 0  # minutes refunded


def test_rerender_with_edits(env):
    db, cfg, job, conn = env["db"], env["cfg"], env["job"], env["conn"]
    with pipeline.JobContext(db, job, cfg.worker_id, 600) as ctx:
        pipeline.process_video(db, cfg, job, ctx)
    clip = db.select("clips", f"video_id=eq.{env['video']}")[0]
    conn.execute("update public.clip_edits set aspect_ratio = '1:1', start_seconds = 10, end_seconds = 20, "
                 "crop = '{\"mode\": \"manual\", \"x\": 0.2}' where clip_id = %s", [clip["id"]])
    conn.execute("insert into public.video_jobs (user_id, video_id, clip_id, type) values (%s, %s, %s, 'render_clip')",
                 [env["user"], env["video"], clip["id"]])
    rjob = conn.execute("select to_jsonb(r) from public.claim_next_job(%s, null) r", [cfg.worker_id]).fetchone()[0]
    with pipeline.JobContext(db, rjob, cfg.worker_id, 600) as ctx:
        res = pipeline.render_existing_clip(db, cfg, rjob, ctx)
    exports = db.select("exports", f"clip_id=eq.{clip['id']}")
    assert len(exports) == 1 and exports[0]["id"] == res["export_id"]  # old export replaced
    assert (exports[0]["width"], exports[0]["height"]) == (720, 720)
    assert abs(float(exports[0]["duration_seconds"]) - 10) < 0.6
    clips_used = conn.execute("select clips_used from public.credit_balances where user_id = %s", [env["user"]]).fetchone()[0]
    assert clips_used == 2  # re-render of an exported clip is free


def test_invalid_file_is_rejected(env):
    db, cfg, job = env["db"], env["cfg"], env["job"]
    video = db.select_one("videos", f"id=eq.{env['video']}")
    (env["storage"] / "sources" / video["storage_path"]).write_bytes(b"\x00" * 50_000)
    with pipeline.JobContext(db, job, cfg.worker_id, 600) as ctx:
        with pytest.raises(pipeline.UserFacingError, match="lisible"):
            pipeline.process_video(db, cfg, job, ctx)
    assert not (env["storage"] / "sources" / video["storage_path"]).exists()  # malicious/invalid file deleted


def test_where_translation():
    db = PgSupabase(None, Path("."))
    sql, params = db._where("status=in.(a,b)&id=eq.x&limit=1")
    assert re.search(r"any\(%s\).*limit 1", sql) and params == [["a", "b"], "x"]
