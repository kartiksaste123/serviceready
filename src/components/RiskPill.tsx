import type { CollectionsRisk } from "@/lib/risk";

/** Deterministic collections risk badge: score · suggested reminder tone. */
export function RiskPill({ risk }: { risk: Pick<CollectionsRisk, "score" | "band" | "tone" | "factors"> | null | undefined }) {
  if (!risk) return <span className="text-xs text-muted-foreground">—</span>;
  const cls =
    risk.band === "high"
      ? "bg-danger-bg text-danger"
      : risk.band === "medium"
        ? "bg-warning-bg text-warning"
        : "bg-success-bg text-success";
  return (
    <span
      className={`inline-flex items-center gap-1 whitespace-nowrap rounded-full px-2 py-0.5 text-xs font-semibold ${cls}`}
      title={`Risk ${risk.score}/100 · ${risk.tone} reminder${risk.factors.length ? ` · ${risk.factors.join(", ")}` : ""}`}
    >
      {risk.score} · {risk.tone}
    </span>
  );
}

