// GenLayer Studionet wiring for the MevFairCourt rebate court.
// Public configuration only — values come from the committed .env (see
// .env.example); the fallbacks keep the deployed address fixed if a build runs
// without an env file. Contract deployed 2026-06-23 — see backend/deployment.json.
export const GENLAYER_CHAIN_ID = Number(import.meta.env.VITE_CHAIN_ID ?? 61999);
export const GENLAYER_RPC_URL =
  import.meta.env.VITE_RPC_URL ?? "https://studio.genlayer.com/api";

// MevFairCourt (03-vela / mev-fair) on hosted studionet.
export const CONTRACT_ADDRESS = (import.meta.env.VITE_CONTRACT_ADDRESS ??
  "0xa8513697719790BE49dEbE812f66830094852588") as `0x${string}`;
