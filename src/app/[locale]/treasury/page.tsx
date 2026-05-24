import { Suspense } from "react";
import type { Metadata } from "next";
import { getTranslations, setRequestLocale } from "next-intl/server";
import { type DonutSlice, TreasuryDonut } from "@/components/dao/TreasuryDonut";
import { TokenLogo } from "@/components/dao/TokenLogo";
import { NftHoldings } from "@/components/treasury/NftHoldings";
import { NftGridSkeleton } from "@/components/skeletons/treasury-skeletons";
import { DAO_ADDRESSES } from "@/lib/config";
import { loadTreasuryPageData } from "@/services/treasury";

export async function generateMetadata({
  params,
}: {
  params: Promise<{ locale: string }>;
}): Promise<Metadata> {
  const { locale } = await params;
  const t = await getTranslations({ locale, namespace: "metadata.treasury" });
  const path = "/treasury";
  const canonical = locale === "en" ? path : `/pt-br${path}`;
  return {
    title: t("title"),
    description: t("description"),
    alternates: {
      canonical,
      languages: {
        en: path,
        "pt-br": `/pt-br${path}`,
        "x-default": path,
      },
    },
    openGraph: {
      title: t("title"),
      description: t("description"),
      locale: locale === "pt-br" ? "pt_BR" : "en_US",
      type: "website",
    },
    twitter: {
      card: "summary_large_image",
      title: t("title"),
      description: t("description"),
    },
  };
}

export const revalidate = 60;

const STABLE_SYMBOLS = new Set(["USDC", "USDT", "DAI", "FRAX", "LUSD"]);
const WETH_SYMBOLS = new Set(["WETH", "CBETH", "STETH", "RETH"]);

const TOKEN_COLORS: Record<string, string> = {
  ETH: "var(--accent-color)",
  WETH: "#9a9aa2",
  USDC: "#5fd28a",
  USDT: "#5fd28a",
  DAI: "#f9a825",
  SENDIT: "#f472b6",
};
const FALLBACK_COLORS = ["#ffb347", "#60a5fa", "#c084fc", "#f472b6", "#34d399"];

function tokenColor(symbol: string, idx: number) {
  return TOKEN_COLORS[symbol.toUpperCase()] ?? FALLBACK_COLORS[idx % FALLBACK_COLORS.length];
}

function fmtUSD(n: number) {
  if (n >= 1_000_000) return `$${(n / 1_000_000).toFixed(2)}M`;
  if (n >= 1_000) return `$${(n / 1_000).toFixed(1)}k`;
  return `$${n.toLocaleString("en-US", { maximumFractionDigits: 0 })}`;
}

function trimDecimals(v: string, max: number) {
  if (!v?.includes(".")) return v;
  const [i, d] = v.split(".");
  return `${i}.${(d ?? "").slice(0, max).replace(/0+$/, "") || "0"}`;
}

const EXPLORER = {
  name: "Basescan",
  base: "https://basescan.org",
};

export default async function TreasuryPage({ params }: { params: Promise<{ locale: string }> }) {
  const { locale } = await params;
  setRequestLocale(locale);
  const t = await getTranslations("treasury");

  const data = await loadTreasuryPageData(DAO_ADDRESSES.treasury);

  const ethBal = parseFloat(data.ethBalance);
  const ethUsd = ethBal * data.ethUsdPrice;

  const tokenAssets = data.tokenHoldings.map((tok, i) => {
    const sym = tok.symbol.toUpperCase();
    let usd = 0;
    if (STABLE_SYMBOLS.has(sym)) {
      usd = Number(tok.balance.replace(/,/g, ""));
    } else if (WETH_SYMBOLS.has(sym)) {
      usd = Number(tok.balance.replace(/,/g, "")) * data.ethUsdPrice;
    }
    return { ...tok, usd, color: tokenColor(tok.symbol, i) };
  });

  const totalUsd = ethUsd + tokenAssets.reduce((s, t) => s + t.usd, 0);
  const hasUsd = totalUsd > 0;

  const slices: DonutSlice[] = [
    ...(ethUsd > 0 ? [{ name: "ETH", color: "var(--accent-color)", value: ethUsd }] : []),
    ...tokenAssets.filter((t) => t.usd > 0).map((t) => ({ name: t.symbol, color: t.color, value: t.usd })),
  ];

  return (
    <div className="py-8 flex flex-col gap-7">
      {/* Header */}
      <div>
        <p className="mb-3 text-[11.5px] font-semibold uppercase tracking-wider text-[var(--accent-color)]">
          {t("page.header.label")}
        </p>
        <h1 className="text-[clamp(36px,5vw,56px)] font-extrabold leading-[1.05] tracking-tight">
          {t("page.title")}
        </h1>
        <p className="mt-2 max-w-xl text-[15px] text-muted-foreground">
          {hasUsd
            ? t("page.header.subtitleWithUsd", { total: fmtUSD(totalUsd) })
            : t("page.header.subtitleNoUsd")}
        </p>
      </div>

      {/* Two-column grid */}
      <div className="grid grid-cols-1 items-start gap-7 lg:grid-cols-[380px_1fr]">
        {/* Left: donut */}
        <div className="rounded-[14px] border bg-card px-6 py-7 text-center">
          {hasUsd ? (
            <TreasuryDonut slices={slices} totalUsd={totalUsd} />
          ) : (
            <div className="py-10 text-sm text-muted-foreground">
              {t("page.donut.noUsd")}
            </div>
          )}
        </div>

        {/* Right: asset rows + recent txs */}
        <div className="flex flex-col gap-4">
          {/* ETH row */}
          <AssetRow
            logo={<TokenLogo symbol="ETH" chainId={8453} size={36} />}
            name="Ether"
            sub={t("page.assets.nativeAsset")}
            color="var(--accent-color)"
            bal={`${trimDecimals(String(ethBal.toFixed(4)), 4)} ETH`}
            usd={ethUsd}
            pct={totalUsd > 0 ? ethUsd / totalUsd : 0}
            showUsd={hasUsd}
          />

          {/* ERC-20 rows */}
          {tokenAssets.map((tok) => {
            const sym = tok.symbol.toUpperCase();
            const sub = STABLE_SYMBOLS.has(sym)
              ? t("page.assets.stableReserve")
              : WETH_SYMBOLS.has(sym)
                ? t("page.assets.wrapped")
                : t("page.assets.erc20");
            return (
              <AssetRow
                key={tok.address}
                logo={<TokenLogo address={tok.address} symbol={tok.symbol} chainId={8453} size={36} />}
                name={tok.symbol}
                sub={sub}
                color={tok.color}
                bal={`${tok.balance} ${tok.symbol}`}
                usd={tok.usd}
                pct={totalUsd > 0 ? tok.usd / totalUsd : 0}
                showUsd={hasUsd}
              />
            );
          })}

          {/* Recent txs */}
          <TxCard
            txs={data.recentTxs}
            explorer={EXPLORER}
            treasuryAddress={data.treasuryAddress}
            emptyLabel={t("page.txCard.empty")}
            title={t("page.txCard.title")}
            subtitle={t("page.txCard.subtitle")}
            viewAllLabel={t("page.txCard.viewAll", { explorer: EXPLORER.name })}
          />
        </div>
      </div>

      {/* NFT Holdings */}
      <div className="space-y-4">
        <div className="space-y-1">
          <h2 className="text-xl font-semibold">{t("page.nftSection.title")}</h2>
          <p className="text-sm text-muted-foreground">{t("page.nftSection.description")}</p>
        </div>
        <Suspense fallback={<NftGridSkeleton />}>
          <NftHoldings treasuryAddress={DAO_ADDRESSES.treasury} />
        </Suspense>
      </div>
    </div>
  );
}

// ── AssetRow ──────────────────────────────────────────────────────────────────
function AssetRow({
  logo,
  name,
  sub,
  color,
  bal,
  usd,
  pct,
  showUsd,
}: {
  logo: React.ReactNode;
  name: string;
  sub: string;
  color: string;
  bal: string;
  usd: number;
  pct: number;
  showUsd: boolean;
}) {
  return (
    <div
      className="flex flex-wrap items-center gap-x-4 gap-y-2 rounded-xl border bg-card px-[18px] py-3.5 hover:bg-muted transition-colors sm:grid sm:items-center"
      style={{ gridTemplateColumns: showUsd ? "40px 1fr 1fr 1fr 1fr" : "40px 1fr 1fr" }}
    >
      <div className="shrink-0">{logo}</div>
      <div className="min-w-0 flex-1 sm:flex-none">
        <div className="font-semibold">{name}</div>
        <div className="mt-0.5 text-xs text-muted-foreground">{sub}</div>
      </div>
      <div className="ml-auto font-mono text-[13.5px] tabular-nums whitespace-nowrap sm:ml-0 sm:text-right">
        {bal}
      </div>
      {showUsd && (
        <>
          <div className="w-full text-right font-mono text-[13.5px] tabular-nums text-muted-foreground sm:w-auto">
            {fmtUSD(usd)}
          </div>
          <div className="w-full sm:w-auto">
            <div className="h-1 overflow-hidden rounded-full bg-secondary">
              <div
                className="h-full rounded-full transition-[width]"
                style={{ width: `${pct * 100}%`, background: color }}
              />
            </div>
            <div className="mt-1 text-right text-xs text-muted-foreground tabular-nums">
              {(pct * 100).toFixed(1)}%
            </div>
          </div>
        </>
      )}
    </div>
  );
}

// ── TxCard ────────────────────────────────────────────────────────────────────
function TxCard({
  txs,
  explorer,
  treasuryAddress,
  emptyLabel,
  title,
  subtitle,
  viewAllLabel,
}: {
  txs: Array<{
    who: string;
    addr: string;
    tag: string;
    dir: "in" | "out";
    amount: string;
    symbol: string;
    relativeTime: string;
    hash: string;
  }>;
  explorer: { name: string; base: string };
  treasuryAddress: string;
  emptyLabel: string;
  title: string;
  subtitle: string;
  viewAllLabel: string;
}) {
  return (
    <div className="rounded-[14px] border bg-card px-6 py-[22px]">
      <div className="mb-4 flex items-baseline justify-between gap-3">
        <h3 className="text-base font-bold">{title}</h3>
        <span className="text-[12.5px] text-muted-foreground">{subtitle}</span>
      </div>
      <div className="flex flex-col">
        {txs.length === 0 && (
          <div className="py-8 text-center text-sm text-muted-foreground">{emptyLabel}</div>
        )}
        {txs.map((tx, i) => (
          <a
            key={i}
            href={`${explorer.base}/tx/${tx.hash}`}
            target="_blank"
            rel="noreferrer"
            className="flex items-center gap-3 border-b py-3 text-[13.5px] last:border-0 hover:bg-muted/50 transition-colors sm:grid sm:gap-4 -mx-2 px-2 rounded"
            style={{ gridTemplateColumns: "28px 1fr auto auto auto" }}
          >
            <span
              className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full text-xs font-bold"
              style={{
                background:
                  tx.dir === "in"
                    ? "color-mix(in oklab, #5fd28a 22%, transparent)"
                    : "color-mix(in oklab, #f06464 22%, transparent)",
                color: tx.dir === "in" ? "#5fd28a" : "#f06464",
              }}
            >
              {tx.dir === "in" ? "↓" : "↑"}
            </span>
            <div className="min-w-0 flex-1">
              <div className="truncate font-semibold">{tx.who}</div>
              <div className="font-mono text-[11.5px] text-muted-foreground truncate">{tx.addr}</div>
            </div>
            <div className="hidden font-mono text-[11.5px] text-muted-foreground sm:block">
              {tx.tag}
            </div>
            <div
              className="shrink-0 text-right font-mono font-semibold tabular-nums"
              style={{ color: tx.dir === "in" ? "#5fd28a" : "#f06464" }}
            >
              {tx.dir === "in" ? "+" : "−"}
              {tx.amount} {tx.symbol}
            </div>
            <div className="hidden text-right font-mono text-[11.5px] text-muted-foreground sm:block">
              {tx.relativeTime}
            </div>
          </a>
        ))}
      </div>
      <div className="mt-3.5 flex justify-end">
        <a
          href={`${explorer.base}/address/${treasuryAddress}`}
          target="_blank"
          rel="noreferrer"
          className="inline-flex items-center gap-1.5 rounded-lg border bg-muted px-3 py-1.5 font-mono text-[12px] hover:bg-secondary transition-colors"
        >
          {viewAllLabel}
        </a>
      </div>
    </div>
  );
}
