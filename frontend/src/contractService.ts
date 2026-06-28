import { createClient, createAccount } from "genlayer-js";
import { studionet } from "genlayer-js/chains";
import { TransactionStatus } from "genlayer-js/types";
import { CONTRACT_ADDRESS } from "./chain";

type Hex = `0x${string}`;
const TIMEOUT_MS = 300_000;

// ──────────────────────────────────────────────────────────────────────
// Domain types mirroring the MevFairCourt views.
// ──────────────────────────────────────────────────────────────────────
export type Band =
  | "FAIR"
  | "BORDERLINE"
  | "EXTRACTIVE"
  | "PREDATORY"
  | "PENDING"
  | "";

export interface BundleView {
  bundleId: string;
  solver: string;
  blockNo: number;
  bundleHash: string;
  fairAttestation: string;
  extractedBps: number;
  band: Band;
  solverBond: string;
  submittedAtSeq: number;
  scoredAtSeq: number;
  disbursedAtSeq: number;
}

export interface ComplaintView {
  complaintId: string;
  bundleId: string;
  complainant: string;
  victimTx: string;
  allegedKind: string;
  harmClaimBps: number;
  complainantBond: string;
  awardedBps: number;
  awardedValue: string;
  postedAtSeq: number;
}

export type BandCounts = Record<Exclude<Band, "">, number>;

// ──────────────────────────────────────────────────────────────────────
// Client plumbing
// ──────────────────────────────────────────────────────────────────────
// Reads use an ephemeral read-only client. Writes use the wallet-backed
// genlayer-js client produced by useWriteClient() (signs via the connected
// wallet's EIP-1193 provider — the page never holds a private key).
function readClient() {
  return createClient({ chain: studionet, account: createAccount() });
}

function requireClient(client: any): any {
  if (!client) throw new Error("Connect a wallet on studionet first.");
  return client;
}

async function waitAccepted(client: any, hash: Hex) {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(() => reject(new Error("Transaction timed out")), TIMEOUT_MS);
  });
  try {
    await Promise.race([
      client.waitForTransactionReceipt({
        hash: hash as never,
        status: TransactionStatus.ACCEPTED,
        interval: 5000,
        retries: 60,
      }),
      timeout,
    ]);
  } finally {
    if (timer) clearTimeout(timer);
  }
}

function pick(obj: any, key: string, idx: number): any {
  if (obj == null) return undefined;
  if (Array.isArray(obj)) return obj[idx];
  if (typeof obj === "object" && key in obj) return obj[key];
  return undefined;
}

// The contract derives bundle_id = sha256(f"{block_no}|{bundle_hash}").
export async function computeBundleId(blockNo: number, bundleHash: string): Promise<string> {
  const msg = `${Math.trunc(blockNo)}|${bundleHash}`;
  const bytes = new TextEncoder().encode(msg);
  const digest = await crypto.subtle.digest("SHA-256", bytes);
  return Array.from(new Uint8Array(digest))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

// ──────────────────────────────────────────────────────────────────────
// WRITES — `client` is the wallet-backed genlayer-js client.
// ──────────────────────────────────────────────────────────────────────
export async function submitBundle(
  client: any,
  blockNo: number,
  bundleHash: string,
  swapsBlob: string,
  fairAttestation: string,
  bondWei: bigint
): Promise<string> {
  if (bondWei <= 0n) throw new Error("Solver bond must be > 0");
  const wc = requireClient(client);
  const h = (await wc.writeContract({
    address: CONTRACT_ADDRESS as Hex,
    functionName: "submit_bundle",
    args: [BigInt(Math.trunc(blockNo)), bundleHash.trim(), swapsBlob, fairAttestation.trim()],
    value: bondWei,
  })) as Hex;
  await waitAccepted(wc, h);
  return computeBundleId(blockNo, bundleHash.trim());
}

export async function fileComplaint(
  client: any,
  bundleId: string,
  victimTx: string,
  allegedKind: string,
  harmClaimBps: number,
  bondWei: bigint
): Promise<void> {
  if (bondWei <= 0n) throw new Error("Complaint bond must be > 0");
  const wc = requireClient(client);
  const h = (await wc.writeContract({
    address: CONTRACT_ADDRESS as Hex,
    functionName: "file_complaint",
    args: [bundleId, victimTx.trim(), allegedKind.trim().toLowerCase(), Math.trunc(harmClaimBps)],
    value: bondWei,
  })) as Hex;
  await waitAccepted(wc, h);
}

export async function attachCounterfactual(client: any, bundleId: string, oracleUrl: string): Promise<void> {
  const wc = requireClient(client);
  const h = (await wc.writeContract({
    address: CONTRACT_ADDRESS as Hex,
    functionName: "attach_counterfactual",
    args: [bundleId, oracleUrl.trim()],
    value: 0n,
  })) as Hex;
  await waitAccepted(wc, h);
}

export async function score(client: any, bundleId: string): Promise<void> {
  const wc = requireClient(client);
  const h = (await wc.writeContract({
    address: CONTRACT_ADDRESS as Hex,
    functionName: "score",
    args: [bundleId],
    value: 0n,
  })) as Hex;
  await waitAccepted(wc, h);
}

export async function disburseRebate(client: any, bundleId: string): Promise<void> {
  const wc = requireClient(client);
  const h = (await wc.writeContract({
    address: CONTRACT_ADDRESS as Hex,
    functionName: "disburse_rebate",
    args: [bundleId],
    value: 0n,
  })) as Hex;
  await waitAccepted(wc, h);
}

export async function withdrawCredit(client: any): Promise<void> {
  const wc = requireClient(client);
  const h = (await wc.writeContract({
    address: CONTRACT_ADDRESS as Hex,
    functionName: "withdraw_credit",
    args: [],
    value: 0n,
  })) as Hex;
  await waitAccepted(wc, h);
}

export async function appeal(
  client: any,
  bundleId: string,
  newOracleUrl: string,
  bondWei: bigint
): Promise<void> {
  if (bondWei <= 0n) throw new Error("Appeal bond must be > 0");
  const wc = requireClient(client);
  const h = (await wc.writeContract({
    address: CONTRACT_ADDRESS as Hex,
    functionName: "appeal",
    args: [bundleId, newOracleUrl.trim()],
    value: bondWei,
  })) as Hex;
  await waitAccepted(wc, h);
}

export async function slashSolver(client: any, bundleId: string): Promise<void> {
  const wc = requireClient(client);
  const h = (await wc.writeContract({
    address: CONTRACT_ADDRESS as Hex,
    functionName: "slash_solver",
    args: [bundleId],
    value: 0n,
  })) as Hex;
  await waitAccepted(wc, h);
}

// ──────────────────────────────────────────────────────────────────────
// VIEWS
// ──────────────────────────────────────────────────────────────────────
export async function getBundle(bundleId: string): Promise<BundleView | null> {
  try {
    const r: any = await readClient().readContract({
      address: CONTRACT_ADDRESS as Hex,
      functionName: "bundle",
      args: [bundleId],
    });
    return {
      bundleId: String(pick(r, "bundle_id", 0) ?? bundleId),
      solver: String(pick(r, "solver", 1) ?? ""),
      blockNo: Number(pick(r, "block_no", 2) ?? 0),
      bundleHash: String(pick(r, "bundle_hash", 3) ?? ""),
      fairAttestation: String(pick(r, "fair_attestation", 4) ?? ""),
      extractedBps: Number(pick(r, "extracted_bps", 5) ?? 0),
      band: String(pick(r, "band", 6) ?? "") as Band,
      solverBond: String(pick(r, "solver_bond", 7) ?? "0"),
      submittedAtSeq: Number(pick(r, "submitted_at_seq", 8) ?? 0),
      scoredAtSeq: Number(pick(r, "scored_at_seq", 9) ?? 0),
      disbursedAtSeq: Number(pick(r, "disbursed_at_seq", 10) ?? 0),
    };
  } catch {
    return null;
  }
}

export async function getStageLog(bundleId: string): Promise<string[]> {
  try {
    const r: any = await readClient().readContract({
      address: CONTRACT_ADDRESS as Hex,
      functionName: "bundle_stage_log",
      args: [bundleId],
    });
    return Array.isArray(r) ? r.map((x) => String(x)) : [];
  } catch {
    return [];
  }
}

export async function getComplaints(bundleId: string): Promise<ComplaintView[]> {
  try {
    const r: any = await readClient().readContract({
      address: CONTRACT_ADDRESS as Hex,
      functionName: "complaints_of",
      args: [bundleId],
    });
    if (!Array.isArray(r)) return [];
    return r.map((c: any) => ({
      complaintId: String(pick(c, "complaint_id", 0) ?? ""),
      bundleId: String(pick(c, "bundle_id", 1) ?? bundleId),
      complainant: String(pick(c, "complainant", 2) ?? ""),
      victimTx: String(pick(c, "victim_tx", 3) ?? ""),
      allegedKind: String(pick(c, "alleged_kind", 4) ?? ""),
      harmClaimBps: Number(pick(c, "harm_claim_bps", 5) ?? 0),
      complainantBond: String(pick(c, "complainant_bond", 6) ?? "0"),
      awardedBps: Number(pick(c, "awarded_bps", 7) ?? 0),
      awardedValue: String(pick(c, "awarded_value", 8) ?? "0"),
      postedAtSeq: Number(pick(c, "posted_at_seq", 9) ?? 0),
    }));
  } catch {
    return [];
  }
}

export async function getPendingCredit(addr: string): Promise<string> {
  try {
    const r: any = await readClient().readContract({
      address: CONTRACT_ADDRESS as Hex,
      functionName: "pending_credit",
      args: [addr],
    });
    return String(r ?? "0");
  } catch {
    return "0";
  }
}

export async function getBand(bundleId: string): Promise<Band> {
  try {
    const r: any = await readClient().readContract({
      address: CONTRACT_ADDRESS as Hex,
      functionName: "band",
      args: [bundleId],
    });
    return String(r ?? "") as Band;
  } catch {
    return "";
  }
}

export async function getCountByBand(): Promise<BandCounts> {
  const empty: BandCounts = { FAIR: 0, BORDERLINE: 0, EXTRACTIVE: 0, PREDATORY: 0, PENDING: 0 };
  try {
    const r: any = await readClient().readContract({
      address: CONTRACT_ADDRESS as Hex,
      functionName: "count_by_band",
      args: [],
    });
    if (r && typeof r === "object") {
      return {
        FAIR: Number(r.FAIR ?? 0),
        BORDERLINE: Number(r.BORDERLINE ?? 0),
        EXTRACTIVE: Number(r.EXTRACTIVE ?? 0),
        PREDATORY: Number(r.PREDATORY ?? 0),
        PENDING: Number(r.PENDING ?? 0),
      };
    }
    return empty;
  } catch {
    return empty;
  }
}

export interface SolverRecordView {
  addr: string;
  bundlesSubmitted: number;
  bundlesPredatory: number;
  totalSlashed: string;
}

export async function getSolverRecord(addr: string): Promise<SolverRecordView | null> {
  try {
    const r: any = await readClient().readContract({
      address: CONTRACT_ADDRESS as Hex,
      functionName: "solver_record",
      args: [addr],
    });
    return {
      addr: String(pick(r, "addr", 0) ?? addr),
      bundlesSubmitted: Number(pick(r, "bundles_submitted", 1) ?? 0),
      bundlesPredatory: Number(pick(r, "bundles_predatory", 2) ?? 0),
      totalSlashed: String(pick(r, "total_slashed", 3) ?? "0"),
    };
  } catch {
    return null;
  }
}
