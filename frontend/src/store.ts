// The MevFairCourt has no "list all bundles" view, so the UI remembers the
// bundle_ids it has seen (locally) to re-read them on refresh.
const KEY = "mevfair.bundles.v1";

export interface TrackedBundle {
  bundleId: string;
  blockNo: number;
  bundleHash: string;
  label: string;
  addedAt: number;
  swapsBlob?: string;
  oracleUrl?: string;
}

export function loadTracked(): TrackedBundle[] {
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return [];
    const arr = JSON.parse(raw);
    return Array.isArray(arr) ? arr : [];
  } catch {
    return [];
  }
}

export function trackBundle(b: TrackedBundle): TrackedBundle[] {
  const cur = loadTracked().filter((x) => x.bundleId !== b.bundleId);
  cur.unshift(b);
  const next = cur.slice(0, 60);
  try {
    localStorage.setItem(KEY, JSON.stringify(next));
  } catch {
    /* ignore quota */
  }
  return next;
}
