"use client";
import { useEffect, useState } from "react";
import { toast } from "sonner";
import { ExternalLink } from "lucide-react";
import { Button } from "@/components/ui/button";
import { apiFetch } from "@/lib/api-client";

export function CheckoutButton({ planId, label, autoStart, variant = "default" }: { planId: string; label: string; autoStart?: boolean; variant?: "default" | "secondary" }) {
  const [busy, setBusy] = useState(false);
  const go = async () => {
    setBusy(true);
    try {
      const { url } = await apiFetch<{ url: string }>("/api/billing/checkout", { method: "POST", json: { planId } });
      window.location.assign(url);
    } catch (e) {
      toast.error((e as Error).message);
      setBusy(false);
    }
  };
  useEffect(() => {
    if (autoStart) void go();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [autoStart]);
  return <Button className="w-full" variant={variant} loading={busy} onClick={go}>{label}</Button>;
}

export function PortalButton({ label = "Gérer mon abonnement" }: { label?: string }) {
  const [busy, setBusy] = useState(false);
  return (
    <Button variant="outline" loading={busy} onClick={async () => {
      setBusy(true);
      try {
        const { url } = await apiFetch<{ url: string }>("/api/billing/portal", { method: "POST" });
        window.location.assign(url);
      } catch (e) {
        toast.error((e as Error).message);
        setBusy(false);
      }
    }}>
      <ExternalLink /> {label}
    </Button>
  );
}

export function CheckoutResultToast({ result }: { result?: string }) {
  useEffect(() => {
    if (result === "success") toast.success("Merci ! Votre abonnement sera actif dans quelques secondes.");
    if (result === "cancelled") toast("Paiement annulé, aucun montant n'a été débité.");
  }, [result]);
  return null;
}
