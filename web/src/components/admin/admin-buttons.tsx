"use client";
import { useState } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { RotateCcw } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Switch } from "@/components/ui/switch";
import { apiFetch } from "@/lib/api-client";

export function RetryJobButton({ id }: { id: string }) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  return (
    <Button size="sm" variant="outline" loading={busy} onClick={async () => {
      setBusy(true);
      try {
        await apiFetch(`/api/admin/jobs/${id}/retry`, { method: "POST" });
        toast.success("Tâche relancée");
        router.refresh();
      } catch (e) {
        toast.error((e as Error).message);
      } finally {
        setBusy(false);
      }
    }}><RotateCcw /> Relancer</Button>
  );
}

export function FlagSwitch({ flagKey, enabled }: { flagKey: string; enabled: boolean }) {
  const router = useRouter();
  const [value, setValue] = useState(enabled);
  const [busy, setBusy] = useState(false);
  return (
    <Switch checked={value} disabled={busy} aria-label={flagKey} onCheckedChange={async (v) => {
      setBusy(true);
      try {
        await apiFetch(`/api/admin/flags/${flagKey}`, { method: "PUT", json: { enabled: v } });
        setValue(v);
        toast.success("Configuration mise à jour");
        router.refresh();
      } catch (e) {
        toast.error((e as Error).message);
      } finally {
        setBusy(false);
      }
    }} />
  );
}
