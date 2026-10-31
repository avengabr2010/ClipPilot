import Link from "next/link";
import { Logo } from "@/components/logo";

const COLS = [
  { title: "Produit", links: [["Fonctionnalités", "/features"], ["Tarifs", "/pricing"], ["FAQ", "/faq"]] },
  { title: "Compte", links: [["Connexion", "/login"], ["Inscription", "/signup"], ["Mot de passe oublié", "/forgot-password"]] },
  { title: "Légal", links: [["Conditions d'utilisation", "/legal/terms"], ["Confidentialité", "/legal/privacy"]] },
];

export function SiteFooter() {
  return (
    <footer className="border-t border-border/60">
      <div className="container grid gap-10 py-12 md:grid-cols-[1.5fr_repeat(3,1fr)]">
        <div className="space-y-3">
          <Logo />
          <p className="max-w-xs text-sm text-muted-foreground">Une longue vidéo. Plusieurs clips. Zéro montage.</p>
        </div>
        {COLS.map((c) => (
          <div key={c.title}>
            <h4 className="mb-3 text-sm font-semibold">{c.title}</h4>
            <ul className="space-y-2">
              {c.links.map(([label, href]) => (
                <li key={href}>
                  <Link href={href} className="text-sm text-muted-foreground hover:text-foreground">
                    {label}
                  </Link>
                </li>
              ))}
            </ul>
          </div>
        ))}
      </div>
      <div className="container flex flex-col gap-2 border-t border-border/60 py-6 text-xs text-muted-foreground sm:flex-row sm:justify-between">
        <p>© {new Date().getFullYear()} ClipPilot. Tous droits réservés.</p>
        <p>TikTok, Instagram et YouTube sont des marques de leurs propriétaires respectifs.</p>
      </div>
    </footer>
  );
}
