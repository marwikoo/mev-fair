import { connectorsForWallets } from "@rainbow-me/rainbowkit";
import { injectedWallet } from "@rainbow-me/rainbowkit/wallets";
import { createConfig, http } from "wagmi";
import { studionet } from "./chains";

// Injected-only connector (MetaMask, Rabby, any browser wallet). We do NOT
// use WalletConnect â€” it pulls third-party cookies, logs console errors on a
// placeholder projectId, and bloats the bundle. injectedWallet covers the
// browser-extension wallets this dapp targets.
const connectors = connectorsForWallets(
  [{ groupName: "Wallets", wallets: [injectedWallet] }],
  { appName: "TIMEÂ·MACHINE â€” MEV-Fair", projectId: "GENLAYER_LOCAL" }
);

export const wagmiConfig = createConfig({
  chains: [studionet],
  connectors,
  transports: { [studionet.id]: http() },
  ssr: false,
});
