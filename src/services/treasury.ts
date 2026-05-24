import { cache } from "react";
import { formatEther, formatUnits } from "viem";
import { BASE_URL, CHAIN, TREASURY_TOKEN_ADDRESSES, TREASURY_TOKEN_ALLOWLIST } from "@/lib/config";
import { fetchTotalAuctionSalesWei } from "@/services/dao";

interface TokenBalance {
  contractAddress?: string;
  tokenBalance: string;
  decimals?: number;
}

interface AlchemyTokenResponse {
  result?: {
    tokenBalances?: TokenBalance[];
  };
}

interface PriceResponse {
  prices?: Record<string, { usd?: number }>;
}

interface EthPriceResponse {
  usd: number;
  error?: string;
}

export interface TreasurySnapshot {
  usdTotal: number;
  ethBalance: number;
  totalAuctionSales: number;
}

export interface TokenHolding {
  address: string;
  symbol: string;
  name: string;
  balance: string;
  balanceRaw: string;
  decimals: number;
  logoUrl?: string;
}

export interface RecentTx {
  who: string;
  addr: string;
  tag: string;
  dir: "in" | "out";
  amount: string;
  symbol: string;
  relativeTime: string;
  hash: string;
}

export interface TreasuryPageData {
  ethBalance: string;
  ethUsdPrice: number;
  tokenHoldings: TokenHolding[];
  nftHoldingsCount: number;
  recentTxs: RecentTx[];
  treasuryAddress: string;
  chainId: number;
  usdTotal: number;
  totalAuctionSales: number;
}

function getBaseUrl() {
  return BASE_URL;
}

async function fetchJson<T>(url: string, init: RequestInit): Promise<T> {
  const response = await fetch(url, {
    ...init,
    headers: {
      "Content-Type": "application/json",
      ...(init.headers || {}),
    },
    next: { revalidate: 60 },
  });

  if (!response.ok) {
    throw new Error(`Request failed: ${response.status}`);
  }

  return (await response.json()) as T;
}

const SYMBOL_MAP: Record<string, { symbol: string; name: string; decimals: number }> = {
  [String(TREASURY_TOKEN_ALLOWLIST.USDC).toLowerCase()]: { symbol: "USDC", name: "USD Coin", decimals: 6 },
  [String(TREASURY_TOKEN_ALLOWLIST.WETH).toLowerCase()]: { symbol: "WETH", name: "Wrapped Ether", decimals: 18 },
  [String(TREASURY_TOKEN_ALLOWLIST.SENDIT).toLowerCase()]: { symbol: "SENDIT", name: "Sendit", decimals: 18 },
};

function relativeTime(ts: number): string {
  const diff = Date.now() / 1000 - ts;
  if (diff < 60) return "just now";
  if (diff < 3600) return `${Math.floor(diff / 60)}m ago`;
  if (diff < 86400) return `${Math.floor(diff / 3600)}h ago`;
  return `${Math.floor(diff / 86400)}d ago`;
}

function shortAddr(addr: string): string {
  return `${addr.slice(0, 6)}…${addr.slice(-4)}`;
}

async function fetchRecentTxs(
  baseUrl: string,
  treasuryAddress: string,
): Promise<RecentTx[]> {
  const thirtyDaysAgo = Math.floor(Date.now() / 1000) - 30 * 86400;
  const hexFrom = `0x${thirtyDaysAgo.toString(16)}`;

  try {
    const [inRes, outRes] = await Promise.all([
      fetchJson<{ result?: { transfers?: AlchemyTransfer[] } }>(
        `${baseUrl}/api/alchemy`,
        {
          method: "POST",
          body: JSON.stringify({
            method: "alchemy_getAssetTransfers",
            params: [
              {
                toAddress: treasuryAddress,
                fromBlock: hexFrom,
                category: ["external", "erc20"],
                withMetadata: true,
                maxCount: "0x19",
              },
            ],
          }),
        },
      ).catch(() => ({ result: { transfers: [] } })),
      fetchJson<{ result?: { transfers?: AlchemyTransfer[] } }>(
        `${baseUrl}/api/alchemy`,
        {
          method: "POST",
          body: JSON.stringify({
            method: "alchemy_getAssetTransfers",
            params: [
              {
                fromAddress: treasuryAddress,
                fromBlock: hexFrom,
                category: ["external", "erc20"],
                withMetadata: true,
                maxCount: "0x19",
              },
            ],
          }),
        },
      ).catch(() => ({ result: { transfers: [] } })),
    ]);

    const inTxs = (inRes.result?.transfers ?? []).map((t) => mapTransfer(t, "in"));
    const outTxs = (outRes.result?.transfers ?? []).map((t) => mapTransfer(t, "out"));

    return [...inTxs, ...outTxs]
      .sort((a, b) => {
        const ta = (a as { _ts?: number })._ts ?? 0;
        const tb = (b as { _ts?: number })._ts ?? 0;
        return tb - ta;
      })
      .slice(0, 20) as RecentTx[];
  } catch {
    return [];
  }
}

interface AlchemyTransfer {
  hash: string;
  from: string;
  to: string;
  value?: number | null;
  asset?: string | null;
  metadata?: { blockTimestamp?: string };
  category?: string;
}

function mapTransfer(
  t: AlchemyTransfer,
  dir: "in" | "out",
): RecentTx & { _ts: number } {
  const ts = t.metadata?.blockTimestamp
    ? Math.floor(new Date(t.metadata.blockTimestamp).getTime() / 1000)
    : 0;
  const counterpart = dir === "in" ? t.from : (t.to ?? "");
  const symbol = t.asset ?? "ETH";
  const amount = t.value != null ? String(Number(t.value).toFixed(4)).replace(/\.?0+$/, "") : "?";
  return {
    who: shortAddr(counterpart),
    addr: counterpart,
    tag: "",
    dir,
    amount,
    symbol,
    relativeTime: relativeTime(ts),
    hash: t.hash,
    _ts: ts,
  };
}

/**
 * Loads a full treasury snapshot including ETH balance, token balances, and auction sales.
 * Deduplicated within a single React render pass via `react.cache()`.
 */
export const loadTreasurySnapshot = cache(
  async (treasuryAddress: string): Promise<TreasurySnapshot> => {
    const baseUrl = getBaseUrl();

    const [ethRes, tokenRes, priceRes, ethPriceRes, auctionSalesWei] = await Promise.all([
      fetchJson<{ result?: string }>(`${baseUrl}/api/alchemy`, {
        method: "POST",
        body: JSON.stringify({
          method: "eth_getBalance",
          params: [treasuryAddress, "latest"],
        }),
      }),
      fetchJson<AlchemyTokenResponse>(`${baseUrl}/api/alchemy`, {
        method: "POST",
        body: JSON.stringify({
          method: "alchemy_getTokenBalances",
          params: [treasuryAddress, TREASURY_TOKEN_ADDRESSES.filter(Boolean)],
        }),
      }),
      fetchJson<PriceResponse>(`${baseUrl}/api/prices`, {
        method: "POST",
        body: JSON.stringify({
          addresses: TREASURY_TOKEN_ADDRESSES.map((a) => String(a).toLowerCase()),
        }),
      }).catch(() => ({ prices: {} })),
      fetchJson<EthPriceResponse>(`${baseUrl}/api/eth-price`, {
        method: "GET",
      }).catch(() => ({ usd: 0 })),
      fetchTotalAuctionSalesWei().catch(() => BigInt(0)),
    ]);

    const ethBalanceWei = BigInt(ethRes.result ?? "0x0");
    const ethBalance = Number(formatEther(ethBalanceWei));
    const ethPrice = ethPriceRes?.usd ?? 0;

    const tokenBalances = (tokenRes.result?.tokenBalances ?? []).filter((token) => {
      const balance = token.tokenBalance?.toLowerCase();
      return balance && balance !== "0" && balance !== "0x0";
    });

    const prices: Record<string, { usd: number }> = priceRes.prices ?? {};
    const wethAddress = String(TREASURY_TOKEN_ALLOWLIST.WETH).toLowerCase();

    const priceLookup = Object.fromEntries(
      Object.entries(prices).map(([address, value]) => [
        address.toLowerCase(),
        address.toLowerCase() === wethAddress ? ethPrice : Number(value?.usd ?? 0) || 0,
      ]),
    );
    priceLookup[wethAddress] = ethPrice;

    const DECIMALS: Record<string, number> = {
      [String(TREASURY_TOKEN_ALLOWLIST.USDC).toLowerCase()]: 6,
      [String(TREASURY_TOKEN_ALLOWLIST.WETH).toLowerCase()]: 18,
      [String(TREASURY_TOKEN_ALLOWLIST.SENDIT).toLowerCase()]: 18,
    };

    const tokensUsd = tokenBalances.reduce((sum, token) => {
      const address = token.contractAddress ? String(token.contractAddress).toLowerCase() : null;
      if (!address) return sum;
      const decimals = DECIMALS[address] ?? 18;
      const raw = token.tokenBalance ?? "0x0";
      const parsed = BigInt(raw);
      const balance = Number(formatUnits(parsed, decimals));
      const price = priceLookup[address] ?? 0;
      return sum + balance * price;
    }, 0);

    const nativeEthUsd = ethBalance * ethPrice;
    const usdTotal = tokensUsd + nativeEthUsd;
    const totalAuctionSales = Number(formatEther(auctionSalesWei));

    return {
      usdTotal,
      ethBalance,
      totalAuctionSales,
    };
  },
);

export const loadTreasuryPageData = cache(
  async (treasuryAddress: string): Promise<TreasuryPageData> => {
    const baseUrl = getBaseUrl();

    const [ethRes, tokenRes, priceRes, ethPriceRes, auctionSalesWei, recentTxs] = await Promise.all([
      fetchJson<{ result?: string }>(`${baseUrl}/api/alchemy`, {
        method: "POST",
        body: JSON.stringify({
          method: "eth_getBalance",
          params: [treasuryAddress, "latest"],
        }),
      }),
      fetchJson<AlchemyTokenResponse>(`${baseUrl}/api/alchemy`, {
        method: "POST",
        body: JSON.stringify({
          method: "alchemy_getTokenBalances",
          params: [treasuryAddress, TREASURY_TOKEN_ADDRESSES.filter(Boolean)],
        }),
      }).catch(() => ({ result: { tokenBalances: [] } })),
      fetchJson<PriceResponse>(`${baseUrl}/api/prices`, {
        method: "POST",
        body: JSON.stringify({
          addresses: TREASURY_TOKEN_ADDRESSES.map((a) => String(a).toLowerCase()),
        }),
      }).catch(() => ({ prices: {} })),
      fetchJson<EthPriceResponse>(`${baseUrl}/api/eth-price`, {
        method: "GET",
      }).catch(() => ({ usd: 0 })),
      fetchTotalAuctionSalesWei().catch(() => BigInt(0)),
      fetchRecentTxs(baseUrl, treasuryAddress),
    ]);

    const ethBalanceWei = BigInt(ethRes.result ?? "0x0");
    const ethBalance = Number(formatEther(ethBalanceWei));
    const ethPrice = ethPriceRes?.usd ?? 0;

    const prices: Record<string, { usd: number }> = priceRes.prices ?? {};
    const wethAddress = String(TREASURY_TOKEN_ALLOWLIST.WETH).toLowerCase();

    const priceLookup = Object.fromEntries(
      Object.entries(prices).map(([address, value]) => [
        address.toLowerCase(),
        address.toLowerCase() === wethAddress ? ethPrice : Number(value?.usd ?? 0) || 0,
      ]),
    );
    priceLookup[wethAddress] = ethPrice;

    const tokenHoldings: TokenHolding[] = [];
    for (const token of tokenRes.result?.tokenBalances ?? []) {
      const raw = token.tokenBalance ?? "0x0";
      if (raw === "0x0" || raw === "0") continue;
      const address = token.contractAddress ? String(token.contractAddress).toLowerCase() : null;
      if (!address) continue;

      const meta = SYMBOL_MAP[address];
      const decimals = meta?.decimals ?? 18;
      const symbol = meta?.symbol ?? address.slice(0, 6).toUpperCase();
      const name = meta?.name ?? symbol;

      let balanceParsed: bigint;
      try {
        balanceParsed = BigInt(raw);
      } catch {
        continue;
      }

      const balance = formatUnits(balanceParsed, decimals);
      // Trim trailing zeros for display
      const trimmed = Number(balance).toLocaleString("en-US", {
        maximumFractionDigits: 4,
        minimumFractionDigits: 0,
      });

      tokenHoldings.push({
        address,
        symbol,
        name,
        balance: trimmed,
        balanceRaw: raw,
        decimals,
      });
    }

    const tokensUsd = tokenHoldings.reduce((sum, t) => {
      const price = priceLookup[t.address] ?? 0;
      let bal: number;
      try {
        bal = Number(formatUnits(BigInt(t.balanceRaw), t.decimals));
      } catch {
        bal = 0;
      }
      return sum + bal * price;
    }, 0);

    const nativeEthUsd = ethBalance * ethPrice;
    const usdTotal = tokensUsd + nativeEthUsd;
    const totalAuctionSales = Number(formatEther(auctionSalesWei));

    return {
      ethBalance: String(ethBalance),
      ethUsdPrice: ethPrice,
      tokenHoldings,
      nftHoldingsCount: 0, // filled in page from subgraph
      recentTxs,
      treasuryAddress,
      chainId: CHAIN.id,
      usdTotal,
      totalAuctionSales,
    };
  },
);
