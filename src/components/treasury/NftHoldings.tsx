"use client";

import { useEffect, useRef, useState } from "react";
import { useLocale, useTranslations } from "next-intl";
import { useRouter } from "next/navigation";
import { GnarCard } from "@/components/auctions/GnarCard";
import { LoadingGridSkeleton } from "@/components/skeletons/loading-grid-skeleton";
import { Card, CardContent } from "@/components/ui/card";
import { DAO_ADDRESSES } from "@/lib/config";
import { toIntlLocale } from "@/lib/i18n/format";
import { subgraphQuery } from "@/lib/subgraph";

interface NftHoldingsProps {
  treasuryAddress: string;
}

type TreasuryTokensQuery = {
  tokens: Array<{
    tokenId: string;
    image?: string | null;
    mintedAt?: string | null;
    auction?: {
      endTime: string;
      settled: boolean;
      highestBid?: { amount: string; bidder: string } | null;
      winningBid?: { amount: string; bidder: string } | null;
    } | null;
  }>;
};

const TREASURY_TOKENS_GQL = /* GraphQL */ `
  query TreasuryTokens($dao: ID!, $owner: Bytes!, $first: Int!, $skip: Int!) {
    tokens(
      where: { dao: $dao, owner: $owner }
      orderBy: tokenId
      orderDirection: asc
      first: $first
      skip: $skip
    ) {
      tokenId
      image
      mintedAt
      auction {
        endTime
        settled
        highestBid {
          amount
          bidder
        }
        winningBid {
          amount
          bidder
        }
      }
    }
  }
`;

export function NftHoldings({ treasuryAddress }: NftHoldingsProps) {
  const t = useTranslations("treasury");
  const locale = useLocale();
  const intlLocale = toIntlLocale(locale);
  const router = useRouter();
  const PAGE_SIZE = 20;
  const [tokens, setTokens] = useState<
    Array<{
      id: number;
      imageUrl?: string;
      dateLabel?: string;
      finalBidEth?: string | null;
      winnerAddress?: string | null;
    }>
  >([]);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [visibleCount, setVisibleCount] = useState(PAGE_SIZE);
  const sentinelRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    let ignore = false;
    async function load() {
      try {
        setIsLoading(true);
        setError(null);
        const dao = DAO_ADDRESSES.token.toLowerCase();
        const owner = treasuryAddress.toLowerCase();

        const BATCH_SIZE = 1000;
        let allTokens: TreasuryTokensQuery["tokens"] = [];
        let skip = 0;
        let hasMore = true;

        while (hasMore && !ignore) {
          const data = await subgraphQuery<TreasuryTokensQuery>(TREASURY_TOKENS_GQL, {
            dao,
            owner,
            first: BATCH_SIZE,
            skip,
          });

          if (ignore) return;

          const batch = data.tokens || [];
          allTokens = [...allTokens, ...batch];

          hasMore = batch.length === BATCH_SIZE;
          skip += BATCH_SIZE;
        }

        if (ignore) return;

        const mapped = allTokens.map((token) => {
          const endTime = token.auction?.endTime ? Number(token.auction.endTime) : undefined;
          const mintedAt = token.mintedAt ? Number(token.mintedAt) : undefined;
          const dateLabel = endTime
            ? new Date(endTime * 1000).toLocaleDateString(intlLocale)
            : mintedAt
              ? new Date(mintedAt * 1000).toLocaleDateString(intlLocale)
              : undefined;
          const finalBidWei =
            token.auction?.winningBid?.amount ?? token.auction?.highestBid?.amount;
          const finalBidEth = finalBidWei
            ? (() => {
                try {
                  const eth = Number(finalBidWei) / 1e18;
                  return eth.toFixed(3).replace(/\.0+$/, "");
                } catch {
                  return null;
                }
              })()
            : null;
          const winner = token.auction?.winningBid?.bidder ?? null;
          return {
            id: Number(token.tokenId),
            imageUrl: token.image ?? undefined,
            dateLabel,
            finalBidEth,
            winnerAddress: finalBidEth ? winner : null,
          };
        });
        setTokens(mapped);
      } catch (err) {
        console.error("Error fetching treasury NFTs:", err);
        setError(err instanceof Error ? err.message : "Failed to fetch NFT holdings");
      } finally {
        if (!ignore) setIsLoading(false);
      }
    }
    load();
    return () => {
      ignore = true;
    };
  }, [treasuryAddress, intlLocale]);

  // Reset visible count when tokens change
  useEffect(() => {
    if (!tokens) return;
    setVisibleCount((prev) => Math.min(Math.max(PAGE_SIZE, prev), tokens.length));
  }, [tokens, PAGE_SIZE]);

  // IntersectionObserver to load more on scroll
  useEffect(() => {
    if (!sentinelRef.current || isLoading) return;
    const el = sentinelRef.current;
    const observer = new IntersectionObserver(
      (entries) => {
        const [entry] = entries;
        if (!entry?.isIntersecting) return;
        setVisibleCount((prev) => prev + PAGE_SIZE);
      },
      { rootMargin: "200px" },
    );
    observer.observe(el);
    return () => {
      observer.unobserve(el);
      observer.disconnect();
    };
  }, [tokens, isLoading, PAGE_SIZE]);

  const handleNftClick = (token: { id: number; imageUrl?: string }) => {
    const params = new URLSearchParams({
      action: "send-nfts",
      contract: DAO_ADDRESSES.token,
      from: treasuryAddress,
      tokenId: String(token.id),
    });
    if (token.imageUrl) params.set("image", token.imageUrl);
    router.push(`/${locale}/propose?${params.toString()}`);
  };

  if (isLoading) {
    return <LoadingGridSkeleton items={8} />;
  }

  if (error) {
    return (
      <Card>
        <CardContent className="pt-6">
          <div className="text-center text-destructive">{t("nfts.errorLoading", { error })}</div>
        </CardContent>
      </Card>
    );
  }

  if (tokens.length === 0) {
    return (
      <Card>
        <CardContent className="pt-6">
          <div className="text-center text-muted-foreground py-12">
            <div className="text-lg font-medium mb-2">{t("nfts.empty")}</div>
            <div className="text-sm">{t("nfts.emptyDescription")}</div>
          </div>
        </CardContent>
      </Card>
    );
  }

  return (
    <div className="space-y-4">
      <div className="flex justify-between items-center">
        <div>
          <h3 className="text-lg font-semibold">{t("nfts.title")}</h3>
          <p className="text-sm text-muted-foreground">
            {t("nfts.count", { count: tokens.length })}
          </p>
        </div>
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-4">
        {tokens.slice(0, visibleCount).map((token) => (
          <button
            key={`gnar-${token.id}`}
            type="button"
            onClick={() => handleNftClick(token)}
            className="text-left cursor-pointer focus:outline-none focus-visible:ring-2 focus-visible:ring-ring rounded-xl group"
            title={t("nfts.proposeTransfer")}
          >
            <GnarCard
              tokenId={token.id}
              imageUrl={token.imageUrl}
              dateLabel={token.dateLabel}
              finalBidEth={token.finalBidEth ?? null}
              winnerAddress={token.winnerAddress ?? null}
              className="group-hover:shadow-lg group-hover:ring-2 group-hover:ring-primary/40 transition-all"
            />
          </button>
        ))}
      </div>
      {visibleCount < tokens.length && <div ref={sentinelRef} className="h-10" />}
    </div>
  );
}
