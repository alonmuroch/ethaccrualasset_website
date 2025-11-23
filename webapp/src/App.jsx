import { useCallback, useEffect, useMemo, useState } from 'react'
import ReactMarkdown from 'react-markdown'
import remarkGfm from 'remark-gfm'
import './App.css'
import { fetchMarketSnapshot } from './api'
import FullLogoWhite from './assets/full_logo_white.svg'
import faqMarkdown from '../../faq.md?raw'

const TWITTER_SHARE_PAGE_URL =
  'https://your-deployed-domain.example/ssv-apr-share.html'

const resolveClientRefreshInterval = () => {
  const fallback = 5 * 60 * 1000
  const rawValue = import.meta.env.VITE_API_REFRESH_INTERVAL_MS
  const parsed = Number(rawValue)
  if (Number.isFinite(parsed) && parsed >= 0) {
    return parsed
  }
  return fallback
}

const MARKET_REFRESH_INTERVAL_MS = resolveClientRefreshInterval()

const formatCurrency = (value, { minimumFractionDigits = 0, maximumFractionDigits = 0 } = {}) =>
  new Intl.NumberFormat('en-US', {
    style: 'currency',
    currency: 'USD',
    minimumFractionDigits,
    maximumFractionDigits,
  }).format(value)

const formatNumber = (value) =>
  new Intl.NumberFormat('en-US', {
    maximumFractionDigits: 0,
  }).format(value)

const formatPercent = (value) =>
  `${value.toLocaleString(undefined, {
    minimumFractionDigits: 1,
    maximumFractionDigits: 1,
  })}%`

const DEFAULT_SLIDER_DELTA_RANGES = Object.freeze({
  ethPrice: { min: -100, max: 200 },
  ssvPrice: { min: -100, max: 2000 },
  stakedEth: { min: -25, max: 200 },
})

const readEnvNumber = (key) => {
  const raw = import.meta.env?.[key]
  if (raw === undefined || raw === null || raw === '') return null
  const numeric = Number(raw)
  return Number.isFinite(numeric) ? numeric : null
}

const normalizeRange = (range, defaults) => {
  const fallback = { ...defaults }
  if (!range || typeof range !== 'object') {
    return fallback
  }

  const minCandidate =
    typeof range.min === 'number' && Number.isFinite(range.min)
      ? range.min
      : fallback.min
  const maxCandidate =
    typeof range.max === 'number' && Number.isFinite(range.max)
      ? range.max
      : fallback.max

  if (minCandidate > maxCandidate) {
    return fallback
  }

  return { min: minCandidate, max: maxCandidate }
}

const resolveInitialRange = (defaults, minKey, maxKey) => {
  const min = readEnvNumber(minKey)
  const max = readEnvNumber(maxKey)
  return normalizeRange(
    {
      min,
      max,
    },
    defaults
  )
}

const INITIAL_SLIDER_DELTA_RANGES = {
  ethPrice: resolveInitialRange(
    DEFAULT_SLIDER_DELTA_RANGES.ethPrice,
    'VITE_ETH_PRICE_DELTA_MIN',
    'VITE_ETH_PRICE_DELTA_MAX'
  ),
  ssvPrice: resolveInitialRange(
    DEFAULT_SLIDER_DELTA_RANGES.ssvPrice,
    'VITE_SSV_PRICE_DELTA_MIN',
    'VITE_SSV_PRICE_DELTA_MAX'
  ),
  stakedEth: resolveInitialRange(
    DEFAULT_SLIDER_DELTA_RANGES.stakedEth,
    'VITE_STAKED_ETH_DELTA_MIN',
    'VITE_STAKED_ETH_DELTA_MAX'
  ),
}

const cloneRangeSet = (ranges) => ({
  ethPrice: { ...ranges.ethPrice },
  ssvPrice: { ...ranges.ssvPrice },
  stakedEth: { ...ranges.stakedEth },
})

const SliderControl = ({
  label,
  value,
  onChange,
  min,
  max,
  step,
  formatter,
  hint,
  disabled = false,
  valueLabel,
  minLabel,
  maxLabel,
  onReset,
  canReset = true,
}) => (
  <div className="control-card">
    <div className="control-header">
      <div className="control-meta">
        <span className="control-label">{label}</span>
        <span className="control-value">
          {valueLabel ??
            (formatter && value !== undefined ? formatter(value) : value)}
        </span>
      </div>
      {onReset ? (
        <button
          type="button"
          className="control-reset"
          onClick={onReset}
          disabled={!canReset}
        >
          Reset
        </button>
      ) : null}
    </div>
    {hint ? <p className="control-hint">{hint}</p> : null}
    <input
      type="range"
      min={min}
      max={max}
      step={step}
      value={value}
      onChange={(event) => {
        if (onChange) {
          onChange(Number(event.target.value))
        }
      }}
      aria-label={label}
      disabled={disabled}
      className={disabled ? 'disabled' : undefined}
    />
    <div className="control-range">
      <span>
        {minLabel ??
          (formatter && min !== undefined ? formatter(min) : String(min))}
      </span>
      <span>
        {maxLabel ??
          (formatter && max !== undefined ? formatter(max) : String(max))}
      </span>
    </div>
  </div>
)

const StaticControl = ({ label, value, hint }) => (
  <div className="control-card read-only">
    <div className="control-header">
      <span className="control-label">{label}</span>
      <span className="control-value">{value}</span>
    </div>
    {hint ? <p className="control-hint">{hint}</p> : null}
  </div>
)

const computeAdjustedValue = (baseline, deltaPct) => {
  if (typeof baseline !== 'number') return null
  return baseline * (1 + deltaPct / 100)
}

const NETWORK_FEE_BASELINE = 0.01

const clamp = (value, min, max) => Math.min(Math.max(value, min), max)

const resolveStakedSsvBaselinePercent = () => {
  const fallback = 25
  const envValue = readEnvNumber('VITE_STAKED_SSV_BASELINE_PERCENT')
  if (envValue === null) return fallback
  const rounded = Math.round(envValue)
  return clamp(rounded, 0, 100)
}

const STAKED_SSV_BASELINE = resolveStakedSsvBaselinePercent()

const resolveImpMaxInflationPercent = () => {
  const fallback = 15
  const envValue = readEnvNumber('VITE_IMP_MAX_INFLATION_PERCENT')
  if (envValue === null) return fallback
  if (!Number.isFinite(envValue)) return fallback
  return clamp(envValue, 0, 100)
}

const IMP_MAX_INFLATION_PERCENT = resolveImpMaxInflationPercent()

const SUMMARY_TABS = Object.freeze([
  { id: 'calculator', label: 'Calculator' },
  { id: 'imp', label: 'IMP' },
  { id: 'impTier', label: 'IMP Tier' },
])

const IMP_TIER_TABLE = Object.freeze([
  {
    id: 'tier1',
    validatorsMin: 100_001,
    validatorsMax: 125_000,
    ethMin: 3_200_032,
    ethMax: 4_000_000,
    aprBoost: 0.075,
  },
  {
    id: 'tier2',
    validatorsMin: 125_001,
    validatorsMax: 150_000,
    ethMin: 4_000_032,
    ethMax: 4_800_000,
    aprBoost: 0.06,
  },
  {
    id: 'tier3',
    validatorsMin: 150_001,
    validatorsMax: 175_000,
    ethMin: 4_800_032,
    ethMax: 5_600_000,
    aprBoost: 0.05,
  },
  {
    id: 'tier4',
    validatorsMin: 175_001,
    validatorsMax: 200_000,
    ethMin: 5_600_032,
    ethMax: 6_400_000,
    aprBoost: 0.0425,
  },
  {
    id: 'tier5',
    validatorsMin: 200_001,
    validatorsMax: 225_000,
    ethMin: 6_400_032,
    ethMax: 7_200_000,
    aprBoost: 0.035,
  },
  {
    id: 'tier6',
    validatorsMin: 225_001,
    validatorsMax: 250_000,
    ethMin: 7_200_032,
    ethMax: 8_000_000,
    aprBoost: 0.03,
  },
  {
    id: 'tier7',
    validatorsMin: 250_001,
    validatorsMax: 300_000,
    ethMin: 8_000_032,
    ethMax: 9_600_000,
    aprBoost: 0.025,
  },
])

const formatDeltaLabel = (value) => {
  if (typeof value !== 'number' || !Number.isFinite(value)) return '—'
  const formatted = value.toLocaleString(undefined, {
    minimumFractionDigits: 0,
    maximumFractionDigits: 2,
  })
  const sign = value > 0 ? '+' : ''
  return `${sign}${formatted}%`
}

const formatValueWithDelta = (value, deltaPct, formatter) => {
  if (typeof value !== 'number' || !Number.isFinite(value)) {
    return null
  }

  const format = formatter ?? ((input) => input)
  const formattedValue = format(value)

  if (typeof deltaPct !== 'number' || !Number.isFinite(deltaPct) || deltaPct === 0) {
    return formattedValue
  }

  const sign = deltaPct > 0 ? '+' : ''
  return `${formattedValue} (${sign}${deltaPct.toFixed(0)}%)`
}

const formatEthAmount = (value) => `${formatNumber(Math.round(value))} ETH`
const formatTokenAmount = (value, symbol) => {
  if (typeof value !== 'number' || !Number.isFinite(value)) {
    return `— ${symbol}`
  }

  return `${new Intl.NumberFormat('en-US', {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  }).format(value)} ${symbol}`
}

function App() {
  const [snapshot, setSnapshot] = useState(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState(null)
  const [deltaRanges, setDeltaRanges] = useState(() =>
    cloneRangeSet(INITIAL_SLIDER_DELTA_RANGES)
  )

  const [ethAprPercent, setEthAprPercent] = useState(null)
  const [ethPriceBaseline, setEthPriceBaseline] = useState(null)
  const [ssvPriceBaseline, setSsvPriceBaseline] = useState(null)
  const [stakedEthBaseline, setStakedEthBaseline] = useState(null)
  const [ssvTotalSupply, setSsvTotalSupply] = useState(null)

  const [ethPriceDeltaPct, setEthPriceDeltaPct] = useState(() =>
    clamp(
      0,
      INITIAL_SLIDER_DELTA_RANGES.ethPrice.min,
      INITIAL_SLIDER_DELTA_RANGES.ethPrice.max
    )
  )
  const [ssvPriceDeltaPct, setSsvPriceDeltaPct] = useState(() =>
    clamp(
      0,
      INITIAL_SLIDER_DELTA_RANGES.ssvPrice.min,
      INITIAL_SLIDER_DELTA_RANGES.ssvPrice.max
    )
  )
  const [stakedEthDeltaPct, setStakedEthDeltaPct] = useState(() =>
    clamp(
      0,
      INITIAL_SLIDER_DELTA_RANGES.stakedEth.min,
      INITIAL_SLIDER_DELTA_RANGES.stakedEth.max
    )
  )
  const [networkFeeDeltaPct, setNetworkFeeDeltaPct] = useState(0)
  const [stakedSsvPercent, setStakedSsvPercent] = useState(STAKED_SSV_BASELINE)
  const [headerUiState, setHeaderUiState] = useState(() => ({
    isElevated: false,
    showApr: false,
  }))
  const [activeSummaryTab, setActiveSummaryTab] = useState(SUMMARY_TABS[0].id)

  useEffect(() => {
    let isMounted = true
    let fetchInProgress = false
    let intervalId

    const loadSnapshot = async ({ silent = false } = {}) => {
      if (fetchInProgress) {
        return
      }
      fetchInProgress = true

      try {
        if (!silent) {
          setLoading(true)
        }
        const data = await fetchMarketSnapshot()
        if (!isMounted) return

        setSnapshot(data)

        const deltaConfig = data?.config?.deltaRanges
        if (deltaConfig) {
          const nextRanges = {
            ethPrice: normalizeRange(
              deltaConfig.ethPrice,
              INITIAL_SLIDER_DELTA_RANGES.ethPrice
            ),
            ssvPrice: normalizeRange(
              deltaConfig.ssvPrice,
              INITIAL_SLIDER_DELTA_RANGES.ssvPrice
            ),
            stakedEth: normalizeRange(
              deltaConfig.stakedEth,
              INITIAL_SLIDER_DELTA_RANGES.stakedEth
            ),
          }

          setDeltaRanges(nextRanges)
          setEthPriceDeltaPct((previous) =>
            clamp(previous, nextRanges.ethPrice.min, nextRanges.ethPrice.max)
          )
          setSsvPriceDeltaPct((previous) =>
            clamp(previous, nextRanges.ssvPrice.min, nextRanges.ssvPrice.max)
          )
          setStakedEthDeltaPct((previous) =>
            clamp(previous, nextRanges.stakedEth.min, nextRanges.stakedEth.max)
          )
        }

        const stakingApr = data?.data?.stakingApr?.value
        if (typeof stakingApr === 'number' && Number.isFinite(stakingApr)) {
          setEthAprPercent(stakingApr * 100)
        }

        const backendEthPrice = data?.data?.prices?.ETH?.priceUsd
        if (
          typeof backendEthPrice === 'number' &&
          Number.isFinite(backendEthPrice)
        ) {
          setEthPriceBaseline(backendEthPrice)
        }

        const backendSsvPrice = data?.data?.prices?.SSV?.priceUsd
        if (
          typeof backendSsvPrice === 'number' &&
          Number.isFinite(backendSsvPrice)
        ) {
          setSsvPriceBaseline(backendSsvPrice)
        }

        const backendSsvSupply = data?.data?.prices?.SSV?.totalSupply
        if (
          typeof backendSsvSupply === 'number' &&
          Number.isFinite(backendSsvSupply)
        ) {
          setSsvTotalSupply(backendSsvSupply)
        }

        const backendStakedEth = data?.data?.stakedEth?.value
        if (
          typeof backendStakedEth === 'number' &&
          Number.isFinite(backendStakedEth)
        ) {
          setStakedEthBaseline(backendStakedEth)
        }

        setError(null)
      } catch (loadError) {
        console.error(loadError)
        if (!isMounted) return
        setError(
          loadError instanceof Error
            ? loadError.message
            : 'Failed to load market data.'
        )
      } finally {
        fetchInProgress = false
        if (isMounted) {
          setLoading(false)
        }
      }
    }

    loadSnapshot()

    if (MARKET_REFRESH_INTERVAL_MS > 0) {
      intervalId = window.setInterval(() => {
        loadSnapshot({ silent: true })
      }, MARKET_REFRESH_INTERVAL_MS)
    }

    return () => {
      isMounted = false
      if (intervalId) {
        window.clearInterval(intervalId)
      }
    }
  }, [])

  const ethPriceAdjusted = useMemo(
    () => computeAdjustedValue(ethPriceBaseline, ethPriceDeltaPct),
    [ethPriceBaseline, ethPriceDeltaPct]
  )

  const ssvPriceAdjusted = useMemo(
    () => computeAdjustedValue(ssvPriceBaseline, ssvPriceDeltaPct),
    [ssvPriceBaseline, ssvPriceDeltaPct]
  )

  const stakedEthAdjusted = useMemo(
    () => computeAdjustedValue(stakedEthBaseline, stakedEthDeltaPct),
    [stakedEthBaseline, stakedEthDeltaPct]
  )

  const networkFeeAdjusted = useMemo(
    () => computeAdjustedValue(NETWORK_FEE_BASELINE, networkFeeDeltaPct),
    [networkFeeDeltaPct]
  )

  const networkFeeAdjustedPercent =
    typeof networkFeeAdjusted === 'number' && Number.isFinite(networkFeeAdjusted)
      ? networkFeeAdjusted * 100
      : null

  const stakedSsvAmount = useMemo(() => {
    if (
      typeof ssvTotalSupply !== 'number' ||
      !Number.isFinite(ssvTotalSupply) ||
      typeof stakedSsvPercent !== 'number' ||
      !Number.isFinite(stakedSsvPercent)
    ) {
      return null
    }

    return (ssvTotalSupply * stakedSsvPercent) / 100
  }, [ssvTotalSupply, stakedSsvPercent])

  const finalStakedEth =
    stakedEthAdjusted ??
    (typeof stakedEthBaseline === 'number' && Number.isFinite(stakedEthBaseline)
      ? stakedEthBaseline
      : null)

  const finalEthPrice =
    ethPriceAdjusted ??
    (typeof ethPriceBaseline === 'number' && Number.isFinite(ethPriceBaseline)
      ? ethPriceBaseline
      : null)

  const finalEthAprDecimal =
    typeof ethAprPercent === 'number' && Number.isFinite(ethAprPercent)
      ? ethAprPercent / 100
      : null

  const finalNetworkFeeDecimal =
    typeof networkFeeAdjusted === 'number' && Number.isFinite(networkFeeAdjusted)
      ? networkFeeAdjusted
      : null

  const overallFeesUsd =
    finalStakedEth !== null &&
    finalEthPrice !== null &&
    finalEthAprDecimal !== null &&
    finalNetworkFeeDecimal !== null
      ? finalStakedEth * finalEthPrice * finalEthAprDecimal * finalNetworkFeeDecimal
      : null
  const formattedOverallFees =
    overallFeesUsd !== null ? formatCurrency(overallFeesUsd) : '—'

  const finalSsvPrice =
    ssvPriceAdjusted ??
    (typeof ssvPriceBaseline === 'number' && Number.isFinite(ssvPriceBaseline)
      ? ssvPriceBaseline
      : null)

  const finalStakedSsv =
    stakedSsvAmount ??
    (typeof ssvTotalSupply === 'number' && Number.isFinite(ssvTotalSupply)
      ? (ssvTotalSupply * STAKED_SSV_BASELINE) / 100
      : null)

  const ssvApr =
    overallFeesUsd !== null &&
    finalStakedSsv !== null &&
    finalStakedSsv > 0 &&
    finalSsvPrice !== null &&
    finalSsvPrice > 0
      ? overallFeesUsd / (finalStakedSsv * finalSsvPrice)
      : null

  const ssvAprPercentValue =
    ssvApr !== null && Number.isFinite(ssvApr) ? ssvApr * 100 : null

  const formattedSsvApr =
    ssvAprPercentValue !== null
      ? formatPercent(ssvAprPercentValue)
      : '—'

  const totalValidators =
    typeof finalStakedEth === 'number' && Number.isFinite(finalStakedEth)
      ? finalStakedEth / 32
      : null

  const impMaxInflationPercent = IMP_MAX_INFLATION_PERCENT

  const impMaxInflationDecimal =
    typeof impMaxInflationPercent === 'number'
      ? impMaxInflationPercent / 100
      : null

  const impInflationCapSsv =
    typeof ssvTotalSupply === 'number' &&
    Number.isFinite(ssvTotalSupply) &&
    impMaxInflationDecimal !== null
      ? ssvTotalSupply * impMaxInflationDecimal
      : null

  const impYearlyRequirementSsv =
    totalValidators !== null &&
    finalEthAprDecimal !== null &&
    finalEthPrice !== null &&
    finalSsvPrice !== null
      ? (totalValidators * finalEthAprDecimal * finalEthPrice) / finalSsvPrice
      : null

  const impYearlySsvState = (() => {
    if (impYearlyRequirementSsv === null && impInflationCapSsv === null) {
      return { value: null, source: null }
    }
    if (impYearlyRequirementSsv === null) {
      return { value: impInflationCapSsv, source: 'inflation' }
    }
    if (impInflationCapSsv === null) {
      return { value: impYearlyRequirementSsv, source: 'market' }
    }
    if (impYearlyRequirementSsv <= impInflationCapSsv) {
      return { value: impYearlyRequirementSsv, source: 'market' }
    }
    return { value: impInflationCapSsv, source: 'inflation' }
  })()

  const impYearlySsv = impYearlySsvState.value
  const impYearlySsvSource = impYearlySsvState.source

  const impActualBoost =
    impYearlySsv !== null &&
    totalValidators !== null &&
    totalValidators > 0 &&
    finalSsvPrice !== null &&
    finalSsvPrice > 0 &&
    finalEthPrice !== null &&
    finalEthPrice > 0 &&
    finalEthAprDecimal !== null &&
    finalEthAprDecimal > 0
      ? ((impYearlySsv / totalValidators) * finalSsvPrice) /
        (32 * finalEthPrice * finalEthAprDecimal)
      : null

  const impActualBoostPercent =
    typeof impActualBoost === 'number' && Number.isFinite(impActualBoost)
      ? impActualBoost * 100
      : null

  const formattedImpActualBoost =
    impActualBoostPercent !== null
      ? formatPercent(impActualBoostPercent)
      : '—'

  const formattedTotalValidators =
    totalValidators !== null ? formatNumber(Math.round(totalValidators)) : '—'

  const formattedImpYearlySsv =
    impYearlySsv !== null ? formatTokenAmount(impYearlySsv, 'SSV') : '—'

  const impYearlySsvUsd =
    impYearlySsv !== null && finalSsvPrice !== null && finalSsvPrice > 0
      ? impYearlySsv * finalSsvPrice
      : null

  const formattedImpYearlySsvUsd =
    impYearlySsvUsd !== null
      ? formatCurrency(impYearlySsvUsd, {
          minimumFractionDigits: 2,
          maximumFractionDigits: 2,
        })
      : '—'

  const impBreakEvenSsvPrice =
    totalValidators !== null &&
    totalValidators > 0 &&
    finalEthAprDecimal !== null &&
    finalEthAprDecimal > 0 &&
    finalEthPrice !== null &&
    finalEthPrice > 0 &&
    impInflationCapSsv !== null &&
    impInflationCapSsv > 0
      ? (totalValidators * finalEthAprDecimal * finalEthPrice) /
        impInflationCapSsv
      : null

  const formattedImpBreakEvenSsvPrice =
    impBreakEvenSsvPrice !== null
      ? formatCurrency(impBreakEvenSsvPrice, {
          minimumFractionDigits: 2,
          maximumFractionDigits: 2,
        })
      : '—'

  const impTierInfo = useMemo(() => {
    if (
      typeof finalStakedEth !== 'number' ||
      !Number.isFinite(finalStakedEth) ||
      finalStakedEth <= 0
    ) {
      return null
    }
    return (
      IMP_TIER_TABLE.find(
        (tier) => finalStakedEth >= tier.ethMin && finalStakedEth <= tier.ethMax
      ) ?? null
    )
  }, [finalStakedEth])

  const formattedImpTierBoost =
    typeof impTierInfo?.aprBoost === 'number'
      ? formatPercent(impTierInfo.aprBoost * 100)
      : '—'

  const formattedImpYearlyRequirement =
    impYearlyRequirementSsv !== null
      ? formatTokenAmount(impYearlyRequirementSsv, 'SSV')
      : '—'

  const formattedImpInflationCap =
    impInflationCapSsv !== null
      ? formatTokenAmount(impInflationCapSsv, 'SSV')
      : '—'

  const formattedImpMaxInflation =
    typeof impMaxInflationPercent === 'number'
      ? formatPercent(impMaxInflationPercent)
      : null

  const shareOnTwitter = useCallback(() => {
    const aprDisplay = formattedSsvApr !== '—' ? formattedSsvApr : 'ETH yield'
    const tweetText = `SSV is redefining ETH yield.\nIf the SSV - ETH Accrual Token 💎 was live today, SSV stakers would be earning 💰${aprDisplay} in real ETH — aligning the entire network around sustainable, ETH-based rewards. ⚖️\n\nSupport this improvement proposal!\n\n🔗 Calculate your ETH accrual potential:\n👉 https://your-deployed-domain.example/ssv-apr-share.html\n\n#SSV #ETH #Restaking #RealYield via @ssv_network`
    const shareUrl = new URL('https://twitter.com/intent/tweet')
    shareUrl.searchParams.set('text', tweetText)
    shareUrl.searchParams.set('url', TWITTER_SHARE_PAGE_URL)
    shareUrl.searchParams.set('hashtags', 'SSV,ETH,Restaking')
    shareUrl.searchParams.set('via', 'ssv_network')
    shareUrl.searchParams.set('related', 'ssv_network')
    window.open(shareUrl.toString(), '_blank', 'noopener,noreferrer')
  }, [formattedSsvApr])

  const markdownPlugins = useMemo(() => [remarkGfm], [])

  const renderStatusMessage = () => {
    if (loading && !snapshot) {
      return 'Loading market data...'
    }
    if (error) {
      return `Market data unavailable: ${error}`
    }
    if (snapshot?.lastUpdated) {
      return `Market data refreshed ${new Date(snapshot.lastUpdated).toLocaleString()}`
    }
    return null
  }

  useEffect(() => {
    const handleScroll = () => {
      const scrollY = window.scrollY ?? window.pageYOffset ?? 0
      const nextState = {
        isElevated: scrollY > 4,
        showApr: scrollY > 40,
      }

      setHeaderUiState((previous) => {
        if (
          previous.isElevated === nextState.isElevated &&
          previous.showApr === nextState.showApr
        ) {
          return previous
        }
        return nextState
      })
    }

    handleScroll()
    window.addEventListener('scroll', handleScroll, { passive: true })
    return () => {
      window.removeEventListener('scroll', handleScroll)
    }
  }, [])

  const aprAvailable = formattedSsvApr !== '—'
  const showAprInTitle = headerUiState.showApr && aprAvailable
  const topbarClassName = `topbar${headerUiState.isElevated ? ' topbar--scrolled' : ''}`

  return (
    <div className="app-shell">
      <header className={topbarClassName}>
        <img
          className="brand-logo"
          src={FullLogoWhite}
          alt="SSV Network logo"
        />
        <div className="topbar-center">
          <span
            className={`brand-name${showAprInTitle ? ' brand-name--hidden' : ''}`}
            aria-hidden={showAprInTitle}
          >
            SSV - ETH Accrual Token
          </span>
          {aprAvailable ? (
            <div
              className={`topbar-apr topbar-apr--inline${
                showAprInTitle ? ' topbar-apr--visible' : ''
              }`}
              aria-live="polite"
              aria-hidden={!showAprInTitle}
            >
              <span className="topbar-apr-label">Staked SSV APR</span>
              <span className="topbar-apr-value">{formattedSsvApr}</span>
            </div>
          ) : null}
        </div>
        <div className="topbar-actions">
          <nav className="top-nav">
            <a href="#" className="active">
              Calculator
            </a>
            <a href="#faq">FAQ</a>
          </nav>
        </div>
      </header>

      <main className="main">
        <section className="summary-section">
          <div className="summary-tabs" role="tablist" aria-label="Calculator modes">
            {SUMMARY_TABS.map((tab) => {
              const isActive = activeSummaryTab === tab.id
              return (
                <button
                  key={tab.id}
                  type="button"
                  role="tab"
                  aria-selected={isActive}
                  className={`summary-tab${isActive ? ' summary-tab--active' : ''}`}
                  onClick={() => setActiveSummaryTab(tab.id)}
                >
                  {tab.label}
                </button>
              )
            })}
          </div>
          {activeSummaryTab === 'calculator' ? (
            <>
              <div className="summary-pull">
                <article className="metric-card highlight summary-card">
                  <span className="metric-label">Network Fee (Yearly)</span>
                  <span className="metric-value">{formattedOverallFees}</span>
                  <span className="metric-subtitle">USD</span>
                  <p className="summary-description">
                    The yearly fees the entire SSV Network accumulates under the assumptions you configure below.
                  </p>
                  <p className="summary-note">
                    Updates instantly as you adjust the inputs below.
                  </p>
                </article>
                <article className="metric-card summary-card">
                  <span className="metric-label">Staked SSV APR</span>
                  <span className="metric-value">{formattedSsvApr}</span>
                  <span className="metric-subtitle">percent</span>
                  <p className="summary-description">
                    The resulting APR, paid in ETH, for staking SSV with those same inputs.
                  </p>
                  <p className="summary-note">
                    Useful for comparing ETH-denominated yields across scenarios.
                  </p>
                  <button type="button" className="share-button" onClick={shareOnTwitter}>
                    Share on X
                  </button>
                </article>
              </div>
              <div className="summary-text">
                <p className="summary-disclaimer summary-disclaimer--headline">
                  This is a calculator showcasing how SSV can become an ETH accrual token. For this proposal to happen it
                  needs the SSV DAO approval.
                </p>
                <p>
                  See how SSV can become the DVT layer that turns network activity into ETH flow. SSV aligns
                  Ethereum’s growth with its stakers — shifting from speculative tokenomics to real ETH accrual.
                  Explore how your SSV can compound ETH yield as the network scales.
                </p>
                <div className="summary-actions">
                  <a
                    className="summary-link"
                    href="https://alonmuroch-65570.medium.com/making-ssv-an-eth-accrual-token-d5e839fb24c0"
                    target="_blank"
                    rel="noreferrer"
                  >
                    📖 Making SSV an ETH Accrual Token →
                  </a>
                </div>
                <p className="summary-disclaimer">
                  * Numbers are based on the inputs you configure below and should be treated as directional estimates.
                </p>
              </div>
            </>
          ) : activeSummaryTab === 'imp' ? (
            <>
              <div className="summary-pull">
                <article className="metric-card highlight summary-card">
                  <span className="metric-label">Total Validators</span>
                  <span className="metric-value">{formattedTotalValidators}</span>
                  <span className="metric-subtitle">validators</span>
                  <p className="summary-description">
                    Derived from your staked ETH assumption (32 ETH per validator).
                  </p>
                </article>
                <article className="metric-card summary-card">
                  <span className="metric-label">Yearly IMP</span>
                  <span className="metric-value">{formattedImpYearlySsv}</span>
                  <span className="metric-subvalue">≈ {formattedImpYearlySsvUsd}</span>
                  <span className="metric-subvalue">
                    Break-even SSV price: {formattedImpBreakEvenSsvPrice}
                  </span>
                  <span className="metric-subtitle">SSV</span>
                  <p className="summary-description">
                    Lesser of ETH demand ({formattedImpYearlyRequirement}) or the {formattedImpMaxInflation ?? 'configured'}
                    {' '}inflation cap ({formattedImpInflationCap}).
                  </p>
                  <p className="summary-note">
                    {impYearlySsvSource === 'market'
                      ? 'ETH-linked need fits beneath the inflation ceiling.'
                      : impYearlySsvSource === 'inflation'
                      ? 'Inflation cap currently limits yearly IMP.'
                      : 'Awaiting live market data.'}
                    {' '}Higher SSV prices than the break-even push the effective IMP below the cap.
                  </p>
                </article>
                <article className="metric-card summary-card">
                  <span className="metric-label">IMP Actual Boost</span>
                  <span className="metric-value">{formattedImpActualBoost}</span>
                  <span className="metric-subtitle">per validator</span>
                  <p className="summary-description">
                    Shows the ETH-denominated boost per validator once yearly IMP is converted back to ETH value and normalized by the ETH APR.
                  </p>
                </article>
              </div>
              <div className="summary-text">
                <p className="summary-disclaimer summary-disclaimer--headline">
                  IMP (Incentivized Mainnet Program) uses the same live inputs as the calculator along with a hard cap of{' '}
                  {formattedImpMaxInflation ?? 'configured'} of the total SSV supply.
                </p>
                <p>
                  <strong>Total validators</strong> tracks how many operators are incentivized today.{' '}
                  <strong>Yearly IMP</strong> mints the lesser of the ETH-referenced need or the inflation cap to respect the 15% limit.{' '}
                  <strong>IMP Actual Boost</strong> contextualizes those SSV incentives versus the 32 ETH validator stake and the current ETH APR baseline.
                </p>
                <p className="summary-disclaimer">
                  The DAO still needs to authorize IMP. These projections move together with the sliders below.
                </p>
              </div>
            </>
          ) : (
            <>
              <div className="summary-pull">
                <article className="metric-card highlight summary-card">
                  <span className="metric-label">Current IMP Tier Boost</span>
                  <span className="metric-value">{formattedImpTierBoost}</span>
                  <span className="metric-subtitle">percent</span>
                  <p className="summary-description">
                    {impTierInfo
                      ? `Applies across ${formatNumber(
                          impTierInfo.validatorsMin
                        )}–${formatNumber(
                          impTierInfo.validatorsMax
                        )} validators (${formatEthAmount(
                          impTierInfo.ethMin
                        )} – ${formatEthAmount(impTierInfo.ethMax)} staked ETH).`
                      : 'Adjust the staked ETH input to see which IMP tier applies.'}
                  </p>
                </article>
                <article className="metric-card summary-card">
                  <span className="metric-label">Staked ETH Snapshot</span>
                  <span className="metric-value">
                    {finalStakedEth !== null ? formatEthAmount(finalStakedEth) : '—'}
                  </span>
                  <span className="metric-subtitle">effective balance</span>
                  <p className="summary-description">
                    {finalStakedEth !== null
                      ? `Equivalent to approximately ${formattedTotalValidators} validators.`
                      : 'Live staked ETH data not available yet.'}
                  </p>
                  <p className="summary-note">
                    Tier boosts refresh automatically as you tweak the staked ETH slider.
                  </p>
                </article>
              </div>
              <div className="summary-text">
                <p className="summary-disclaimer summary-disclaimer--headline">
                  IMP tiers scale the APR boost as more validators participate. Track how close you are to the next bracket below.
                </p>
                <table className="tier-table">
                  <thead>
                    <tr>
                      <th>Validators</th>
                      <th>Effective Balance (ETH)</th>
                      <th>APR Boost</th>
                    </tr>
                  </thead>
                  <tbody>
                    {IMP_TIER_TABLE.map((tier) => {
                      const isActive = impTierInfo?.id === tier.id
                      return (
                        <tr key={tier.id} className={isActive ? 'tier-row-active' : undefined}>
                          <td>{`${formatNumber(tier.validatorsMin)} – ${formatNumber(
                            tier.validatorsMax
                          )}`}</td>
                          <td>{`${formatEthAmount(tier.ethMin)} – ${formatEthAmount(
                            tier.ethMax
                          )}`}</td>
                          <td>{formatPercent(tier.aprBoost * 100)}</td>
                        </tr>
                      )
                    })}
                  </tbody>
                </table>
                <p className="summary-disclaimer">
                  Active tier highlighted. Ranges outside the table are considered out-of-scope for this IMP program preview.
                </p>
              </div>
            </>
          )}
        </section>

        <section className="controls-section">
          <div className="section-header">
            <h2>Adjust Assumptions</h2>
            <p>
              Tune the inputs below to explore how the ETH Accrual Token reacts
              under different market conditions.
            </p>
          </div>

          <div className="controls-grid">
            <StaticControl
              label="ETH APR"
              value={
                ethAprPercent !== null
                  ? formatPercent(ethAprPercent)
                  : loading
                  ? 'Loading...'
                  : '—'
              }
              hint="Average 31-day staking APR pulled from backend."
            />
            <SliderControl
              label="Staked ETH"
              value={stakedEthDeltaPct}
              onChange={setStakedEthDeltaPct}
              min={deltaRanges.stakedEth.min}
              max={deltaRanges.stakedEth.max}
              step={1}
              formatter={(value) => `${value.toFixed(0)}%`}
              valueLabel={
                stakedEthAdjusted !== null
                  ? formatValueWithDelta(
                      stakedEthAdjusted,
                      stakedEthDeltaPct,
                      formatEthAmount
                    ) ?? formatEthAmount(stakedEthAdjusted)
                  : loading
                  ? 'Loading...'
                  : '—'
              }
              minLabel={formatDeltaLabel(deltaRanges.stakedEth.min)}
              maxLabel={formatDeltaLabel(deltaRanges.stakedEth.max)}
              hint={
                stakedEthBaseline !== null
                  ? `Baseline ${formatEthAmount(
                      stakedEthBaseline
                    )} · adjust from ${formatDeltaLabel(
                      deltaRanges.stakedEth.min
                    )} to ${formatDeltaLabel(deltaRanges.stakedEth.max)}`
                  : 'Baseline staked ETH not available yet.'
              }
              disabled={stakedEthBaseline === null || loading}
              onReset={() => setStakedEthDeltaPct(0)}
              canReset={
                stakedEthBaseline !== null && stakedEthDeltaPct !== 0
              }
            />
            <SliderControl
              label="ETH Price"
              value={ethPriceDeltaPct}
              onChange={setEthPriceDeltaPct}
              min={deltaRanges.ethPrice.min}
              max={deltaRanges.ethPrice.max}
              step={1}
              formatter={(value) => `${value.toFixed(0)}%`}
              valueLabel={
                ethPriceAdjusted !== null
                  ? formatValueWithDelta(
                      ethPriceAdjusted,
                      ethPriceDeltaPct,
                      formatCurrency
                    ) ?? formatCurrency(ethPriceAdjusted)
                  : loading
                  ? 'Loading...'
                  : '—'
              }
              minLabel={formatDeltaLabel(deltaRanges.ethPrice.min)}
              maxLabel={formatDeltaLabel(deltaRanges.ethPrice.max)}
              hint={
                ethPriceBaseline !== null
                  ? `Baseline ${formatCurrency(
                      ethPriceBaseline
                    )} · adjust from ${formatDeltaLabel(
                      deltaRanges.ethPrice.min
                    )} to ${formatDeltaLabel(deltaRanges.ethPrice.max)}`
                  : 'Baseline price not available yet.'
              }
              disabled={ethPriceBaseline === null || loading}
              onReset={() => setEthPriceDeltaPct(0)}
              canReset={ethPriceBaseline !== null && ethPriceDeltaPct !== 0}
            />
          </div>

          <div className="controls-grid secondary">
            <SliderControl
              label="SSV Price"
              value={ssvPriceDeltaPct}
              onChange={setSsvPriceDeltaPct}
              min={deltaRanges.ssvPrice.min}
              max={deltaRanges.ssvPrice.max}
              step={5}
              formatter={(value) => `${value.toFixed(0)}%`}
              valueLabel={
                ssvPriceAdjusted !== null
                  ? formatValueWithDelta(
                      ssvPriceAdjusted,
                      ssvPriceDeltaPct,
                      formatCurrency
                    ) ?? formatCurrency(ssvPriceAdjusted)
                : loading
                ? 'Loading...'
                : '—'
              }
              minLabel={formatDeltaLabel(deltaRanges.ssvPrice.min)}
              maxLabel={formatDeltaLabel(deltaRanges.ssvPrice.max)}
              hint={
                ssvPriceBaseline !== null
                  ? `Baseline ${formatCurrency(
                      ssvPriceBaseline
                    )} · adjust from ${formatDeltaLabel(
                      deltaRanges.ssvPrice.min
                    )} to ${formatDeltaLabel(deltaRanges.ssvPrice.max)}`
                  : 'Baseline price not available yet.'
              }
              disabled={ssvPriceBaseline === null || loading}
              onReset={() => setSsvPriceDeltaPct(0)}
              canReset={ssvPriceBaseline !== null && ssvPriceDeltaPct !== 0}
            />
            <SliderControl
              label="Network Fee"
              value={networkFeeDeltaPct}
              onChange={setNetworkFeeDeltaPct}
              min={-50}
              max={150}
              step={1}
              formatter={(value) => `${value.toFixed(0)}%`}
              valueLabel={
                networkFeeAdjustedPercent !== null
                  ? formatValueWithDelta(
                      networkFeeAdjustedPercent,
                      networkFeeDeltaPct,
                      formatPercent
                    ) ?? formatPercent(networkFeeAdjustedPercent)
                  : '—'
              }
              minLabel="-50%"
              maxLabel="+150%"
              hint={`Baseline ${formatPercent(
                NETWORK_FEE_BASELINE * 100
              )} · adjust from -50% to +150%`}
              onReset={() => setNetworkFeeDeltaPct(0)}
              canReset={networkFeeDeltaPct !== 0}
            />
            <SliderControl
              label="% Staked SSV"
              value={stakedSsvPercent}
              onChange={setStakedSsvPercent}
              min={0}
              max={100}
              step={1}
              formatter={formatPercent}
              valueLabel={
                stakedSsvAmount !== null
                  ? `${formatPercent(stakedSsvPercent)} (${formatTokenAmount(
                      stakedSsvAmount,
                      'SSV'
                    )})`
                  : formatPercent(stakedSsvPercent)
              }
              hint={
                ssvTotalSupply !== null
                  ? `Portion of supply participating in staking (total supply ~ ${formatTokenAmount(
                      ssvTotalSupply,
                      'SSV'
                    )}).`
                  : 'Portion of supply participating in staking.'
              }
              onReset={() => setStakedSsvPercent(STAKED_SSV_BASELINE)}
              canReset={stakedSsvPercent !== STAKED_SSV_BASELINE}
            />
          </div>
          <div className="data-status">
            {renderStatusMessage()}
            {!loading && !error && !snapshot
              ? 'No market data received yet.'
              : null}
          </div>
        </section>
        <section className="faq-section" id="faq">
          <div className="section-header">
            <h2>Frequently Asked Questions</h2>
            <p>
              Explore the key ideas behind turning SSV into an ETH accrual token, plus details on fees, staking and this calculator.
            </p>
          </div>
          <article className="faq-content">
            <ReactMarkdown remarkPlugins={markdownPlugins}>
              {faqMarkdown}
            </ReactMarkdown>
          </article>
        </section>
      </main>

      <footer className="footer">
        <span>© {new Date().getFullYear()} SSV - ETH Accrual Token</span>
        <div className="footer-links">
          <a href="https://github.com/alonmuroch/ethaccrualasset_website" target="_blank" rel="noreferrer">
            GitHub
          </a>
          <a href="https://x.com/ssv_network" target="_blank" rel="noreferrer">
            Twitter
          </a>
        </div>
      </footer>
    </div>
  )
}

export default App
