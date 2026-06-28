import { defineChain } from "viem";
import { GENLAYER_CHAIN_ID, GENLAYER_RPC_URL } from "./chain";

// GenLayer Studionet wallet chain. The chain id and RPC come from ./chain
// (env-driven with committed fallbacks). The MevFairCourt contract is deployed
// on hosted studionet (see backend/deployment.json).
export const studionet = defineChain({
  id: GENLAYER_CHAIN_ID,
  name: "GenLayer Studionet",
  network: "studionet",
  nativeCurrency: { name: "GEN", symbol: "GEN", decimals: 18 },
  rpcUrls: {
    default: { http: [GENLAYER_RPC_URL] },
    public: { http: [GENLAYER_RPC_URL] },
  },
  testnet: true,
});
