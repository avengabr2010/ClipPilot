"use client";
import { useEffect, useState } from "react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { Search } from "lucide-react";
import { Input, NativeSelect } from "@/components/ui/input";

export function LibraryFilters({ projects }: { projects: { id: string; name: string }[] }) {
  const router = useRouter();
  const pathname = usePathname();
  const params = useSearchParams();
  const [q, setQ] = useState(params.get("q") ?? "");

  const update = (key: string, value: string) => {
    const next = new URLSearchParams(params.toString());
    if (value) next.set(key, value);
    else next.delete(key);
    router.replace(`${pathname}?${next.toString()}`, { scroll: false });
  };

  useEffect(() => {
    const t = setTimeout(() => {
      if ((params.get("q") ?? "") !== q) update("q", q);
    }, 300);
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [q]);

  return (
    <div className="mb-5 grid gap-2 sm:grid-cols-[1fr_auto_auto_auto]">
      <div className="relative">
        <Search className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
        <Input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Rechercher un clip…" className="pl-9" aria-label="Rechercher" />
      </div>
      <NativeSelect value={params.get("project") ?? ""} onChange={(e) => update("project", e.target.value)} aria-label="Projet" className="sm:w-48">
        <option value="">Tous les projets</option>
        {projects.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
      </NativeSelect>
      <NativeSelect value={params.get("status") ?? ""} onChange={(e) => update("status", e.target.value)} aria-label="Statut" className="sm:w-40">
        <option value="">Tous les statuts</option>
        <option value="ready">Prêts</option>
        <option value="rendering">En rendu</option>
        <option value="failed">En échec</option>
      </NativeSelect>
      <NativeSelect value={params.get("sort") ?? "date"} onChange={(e) => update("sort", e.target.value)} aria-label="Trier" className="sm:w-44">
        <option value="date">Plus récents</option>
        <option value="date_asc">Plus anciens</option>
        <option value="duration">Plus longs</option>
        <option value="duration_asc">Plus courts</option>
        <option value="score">Meilleur score</option>
      </NativeSelect>
    </div>
  );
}
