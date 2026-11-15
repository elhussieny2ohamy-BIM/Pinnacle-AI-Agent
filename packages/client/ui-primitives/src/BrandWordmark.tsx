import type { IconProps } from './icons/props.ts'
import { TBYAAN_WORDMARK_DATA_URI, TBYAAN_WORDMARK_DIMENSIONS } from './tbyaan-assets.ts'

/** Display options for the official brand wordmark. */
export interface BrandWordmarkProps extends IconProps {
  /** Whether to include the leading brand mark; defaults to true. */
  includeMark?: boolean | undefined
}

/**
 * Render the full Pinnacle brand wordmark.
 * @param props.size - height in px (default 24; width follows the selected artwork).
 * @param props.className - extra class for layout placement.
 * @param props.includeMark - whether to include the leading mark.
 * @returns the wordmark svg (aria-hidden decorative brand art).
 */
export function BrandWordmark({ size = 24, className }: BrandWordmarkProps) {
  const aspect = TBYAAN_WORDMARK_DIMENSIONS.width / TBYAAN_WORDMARK_DIMENSIONS.height
  const width = size * aspect
  return (
    <svg
      width={width}
      height={size}
      className={className}
      viewBox={`0 0 ${TBYAAN_WORDMARK_DIMENSIONS.width} ${TBYAAN_WORDMARK_DIMENSIONS.height}`}
      fill="none"
      aria-hidden="true"
    >
      <image
        width={TBYAAN_WORDMARK_DIMENSIONS.width}
        height={TBYAAN_WORDMARK_DIMENSIONS.height}
        href={TBYAAN_WORDMARK_DATA_URI}
      />
    </svg>
  )
}
