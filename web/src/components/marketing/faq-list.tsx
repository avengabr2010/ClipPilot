import { ChevronDown } from "lucide-react";
import { FAQ } from "@/lib/faq";

export function FaqList({ limit }: { limit?: number }) {
  return (
    <div className="divide-y rounded-2xl border bg-card">
      {FAQ.slice(0, limit).map((item) => (
        <details key={item.q} className="group p-5 [&_summary::-webkit-details-marker]:hidden">
          <summary className="flex cursor-pointer list-none items-center justify-between gap-4 font-medium">
            {item.q}
            <ChevronDown className="size-4 shrink-0 text-muted-foreground transition-transform group-open:rotate-180" />
          </summary>
          <p className="mt-3 text-sm leading-relaxed text-muted-foreground">{item.a}</p>
        </details>
      ))}
    </div>
  );
}
