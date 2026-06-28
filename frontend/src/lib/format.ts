// Formatting + contract error-envelope parsing.

export function shortHash(h: string, head = 8, tail = 6): string {
  if (!h) return "—";
  return h.length > head + tail + 2 ? `${h.slice(0, head)}…${h.slice(-tail)}` : h;
}

export function shortAddr(a: string): string {
  if (!a || a === "0x") return "—";
  return a.length > 12 ? `${a.slice(0, 6)}…${a.slice(-4)}` : a;
}

const STAGE_LABEL: Record<string, string> = {
  INGEST: "Ingest",
  PARSE: "Parse",
  CFL: "Counterfactual",
  SCORE: "Score",
  JUDGE: "Judgment",
  REBATE: "Rebate",
  APPEAL: "Appeal",
  TIE: "Tie-break",
};
const SEV_LABEL: Record<string, string> = {
  HARD: "rejected",
  SOFT: "transient error",
  MODEL: "model error",
};

/**
 * Parses the contract's `<STAGE:SEVERITY:detail>` envelope into a readable
 * line, e.g. "<INGEST:HARD:bundle_already_submitted>" →
 * "Ingest rejected: bundle already submitted".
 */
export function parseEnvelope(raw: string): string {
  if (!raw) return "Something went wrong.";
  const m = raw.match(/<([A-Z]+):([A-Z]+):([^>]+)>/);
  if (!m) {
    // strip noisy prefixes from SDK/runtime errors
    const cleaned = raw.replace(/^Error:\s*/i, "").slice(0, 180);
    if (/timed out/i.test(cleaned)) return "Transaction timed out — try again.";
    if (/UNDETERMINED|MAJORITY_DISAGREE|disagree/i.test(cleaned))
      return "Validators did not reach consensus on this round — retry.";
    if (/Connect a wallet/i.test(cleaned)) return cleaned;
    return cleaned || "Something went wrong.";
  }
  const [, stage, sev, detail] = m;
  const s = STAGE_LABEL[stage] ?? stage;
  const v = SEV_LABEL[sev] ?? sev.toLowerCase();
  const d = detail.replace(/_/g, " ").replace(/:/g, " · ").trim();
  return `${s} ${v}: ${d}`;
}

// short label for a stage_log entry like "SCORE:bps=42"
export function stageLogLabel(entry: string): { stage: string; detail: string } {
  const i = entry.indexOf(":");
  if (i < 0) return { stage: entry, detail: "" };
  return { stage: entry.slice(0, i), detail: entry.slice(i + 1) };
}
