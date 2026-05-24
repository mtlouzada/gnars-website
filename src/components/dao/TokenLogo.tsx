'use client'
import { getAddress } from 'viem'

const TW_CHAIN: Record<number, string> = {
  1: 'ethereum',
  10: 'optimism',
  8453: 'base',
  7777777: 'zora',
}
const ETH_LOGO =
  'https://raw.githubusercontent.com/trustwallet/assets/master/blockchains/ethereum/info/logo.png'

function trustWalletUrl(chainId: number, address: string): string | null {
  const chain = TW_CHAIN[chainId]
  if (!chain) return null
  try {
    return `https://raw.githubusercontent.com/trustwallet/assets/master/blockchains/${chain}/assets/${getAddress(address)}/logo.png`
  } catch {
    return null
  }
}

export function TokenLogo({
  address,
  symbol,
  chainId,
  size = 24,
  className = '',
  fallbackSrc,
}: {
  address?: string
  symbol: string
  chainId: number
  size?: number
  className?: string
  fallbackSrc?: string
}) {
  const src = address ? trustWalletUrl(chainId, address) : ETH_LOGO
  const fallback = symbol.slice(0, 1).toUpperCase()

  if (!src) {
    return (
      <span
        className={`inline-flex shrink-0 items-center justify-center rounded-full bg-[var(--surface-3)] text-xs font-bold ${className}`}
        style={{ width: size, height: size }}
      >
        {fallback}
      </span>
    )
  }

  return (
    <span
      className={`relative inline-flex shrink-0 items-center justify-center overflow-hidden rounded-full bg-[var(--surface-3)] ${className}`}
      style={{ width: size, height: size }}
    >
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img
        src={src}
        alt={symbol}
        width={size}
        height={size}
        className="h-full w-full object-cover"
        onError={(e) => {
          const img = e.currentTarget
          if (fallbackSrc && img.src !== fallbackSrc) {
            img.src = fallbackSrc
            return
          }
          img.style.display = 'none'
          const p = img.parentElement
          if (p) {
            p.textContent = fallback
            p.classList.add('text-xs', 'font-bold')
          }
        }}
      />
    </span>
  )
}
