import { useEffect, useState } from "react";
import { useAccount } from "wagmi";
import { createClient } from "genlayer-js";
import { studionet } from "genlayer-js/chains";

type Hex = `0x${string}`;
export const STUDIONET_CHAIN_ID = 61999;

export interface WriteCtx {
  client: any | null; // genlayer-js client signing through the wallet
  address: Hex | null;
  isConnected: boolean;
  wrongChain: boolean;
}

/**
 * Builds a genlayer-js client that signs through the connected wallet's
 * EIP-1193 provider (MetaMask, Rabby, …). No private key is ever held by the
 * page — genlayer-js's `provider` config delegates signing to the wallet.
 */
export function useWriteClient(): WriteCtx {
  const { address, connector, isConnected, chainId } = useAccount();
  const [client, setClient] = useState<any | null>(null);
  const wrongChain = isConnected && chainId !== STUDIONET_CHAIN_ID;

  useEffect(() => {
    let active = true;
    (async () => {
      if (!isConnected || !address || !connector || wrongChain) {
        setClient(null);
        return;
      }
      try {
        const provider = await connector.getProvider();
        if (!active) return;
        setClient(
          createClient({
            chain: studionet,
            account: address as Hex,
            provider: provider as any,
          })
        );
      } catch {
        if (active) setClient(null);
      }
    })();
    return () => {
      active = false;
    };
  }, [address, connector, isConnected, chainId, wrongChain]);

  return { client, address: (address as Hex) ?? null, isConnected, wrongChain };
}
