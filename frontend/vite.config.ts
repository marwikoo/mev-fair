import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

// Peel the large *static* libraries into their own chunks so the entry bundle
// stays under Vite's 500 kB warning threshold. RainbowKit / WalletConnect /
// Reown keep their built-in per-wallet, per-locale dynamic splitting, so they
// are deliberately left ungrouped. wagmi is folded into the crypto group
// because it shares a cyclic import graph with viem/ox (a standalone wagmi
// chunk triggers a "Circular chunk" warning).
export default defineConfig({
  base: "/",
  cacheDir: ".vite_cache",
  plugins: [react()],
  server: { port: 5380 },
  preview: { port: 5392 },
  build: {
    rollupOptions: {
      output: {
        manualChunks(id) {
          if (!id.includes("node_modules")) return;
          if (id.includes("/react-dom/") || id.includes("/scheduler/")) return "react-dom";
          if (id.includes("/react/")) return "react";
          if (id.includes("/genlayer-js/")) return "genlayer";
          if (id.includes("/d3-") || id.includes("/d3/")) return "d3";
          if (id.includes("/konva/")) return "konva";
          if (id.includes("/gsap/")) return "gsap";
          if (
            id.includes("/viem/") ||
            id.includes("/abitype/") ||
            id.includes("/ox/") ||
            id.includes("/@noble/") ||
            id.includes("/@scure/") ||
            id.includes("/@adraffy/") ||
            id.includes("/wagmi/") ||
            id.includes("/@wagmi/")
          ) {
            return "crypto";
          }
          if (id.includes("/@tanstack/")) return "tanstack";
        },
      },
    },
  },
});
