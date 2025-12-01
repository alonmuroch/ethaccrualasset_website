import { useCallback, useEffect, useMemo, useState } from 'react'
import ReactMarkdown from 'react-markdown'
import remarkGfm from 'remark-gfm'
import { Line, LineChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts'
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

const formatCurrencyWithCents = (value) =>
  formatCurrency(value, { minimumFractionDigits: 2, maximumFractionDigits: 2 })

const formatPercent = (value) =>
  `${value.toLocaleString(undefined, {
    minimumFractionDigits: 1,
    maximumFractionDigits: 1,
  })}%`

const DEFAULT_SLIDER_DELTA_RANGES = Object.freeze({
  ethPrice: { min: -100, max: 200 },
  ssvPrice: { min: -100, max: 2000 },
  stakedEth: { min: -100, max: 200 },
  networkFee: { min: -100, max: 500 },
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
  networkFee: resolveInitialRange(
    DEFAULT_SLIDER_DELTA_RANGES.networkFee,
    'VITE_NETWORK_FEE_DELTA_MIN',
    'VITE_NETWORK_FEE_DELTA_MAX'
  ),
}

const cloneRangeSet = (ranges) => ({
  ethPrice: { ...ranges.ethPrice },
  ssvPrice: { ...ranges.ssvPrice },
  stakedEth: { ...ranges.stakedEth },
  networkFee: { ...ranges.networkFee },
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
const MIN_SSV_PRICE_FLOOR_DEFAULT = 3.5

const clamp = (value, min, max) => Math.min(Math.max(value, min), max)

const YearlyImpChart = ({ data }) => {
  const hasData = Array.isArray(data) && data.length > 0
  if (!hasData) {
    return (
      <div className="imp-chart-placeholder">
        <p>Need an active IMP tier plus market prices to display the curve.</p>
      </div>
    )
  }

  return (
    <div className="imp-chart-wrapper" aria-label="Yearly IMP minted versus SSV price">
      <div className="imp-chart-title">
        <span>Yearly IMP vs. SSV Price</span>
      </div>
      <ResponsiveContainer width="100%" height={260}>
        <LineChart data={data} margin={{ top: 10, right: 24, left: 0, bottom: 10 }}>
          <XAxis
            dataKey="price"
            tickFormatter={(value) =>
              typeof value === 'number' ? `$${value.toFixed(0)}` : value
            }
          />
          <YAxis
            yAxisId="ssv"
            tickFormatter={(value) =>
              typeof value === 'number' ? `${(value / 1000).toFixed(0)}k` : value
            }
          />
          <YAxis
            yAxisId="boost"
            orientation="right"
            tickFormatter={(value) =>
              typeof value === 'number' ? `${value.toFixed(1)}%` : value
            }
          />
          <Tooltip
            formatter={(value, name, entry) => {
              const dataKey = entry?.dataKey
              if (dataKey === 'minted') {
                const mintedNumber = Number(value)
                const price = Number(entry?.payload?.price)
                const formattedSsv = Number.isFinite(mintedNumber)
                  ? `${mintedNumber.toLocaleString('en-US', {
                      minimumFractionDigits: 2,
                      maximumFractionDigits: 2,
                    })} SSV`
                  : value
                const usdValue =
                  Number.isFinite(mintedNumber) && Number.isFinite(price)
                    ? mintedNumber * price
                    : null
                const formattedUsd =
                  usdValue !== null
                    ? formatCurrency(usdValue, {
                        minimumFractionDigits: 2,
                        maximumFractionDigits: 2,
                      })
                    : null
                return [
                  formattedUsd ? `${formattedSsv} (${formattedUsd})` : formattedSsv,
                  'Yearly IMP',
                ]
              }
              if (dataKey === 'boostPercent') {
                const boostNumber = Number(value)
                return [
                  Number.isFinite(boostNumber)
                    ? `${boostNumber.toFixed(2)}%`
                    : value,
                  'IMP Actual Boost',
                ]
              }
              if (dataKey === 'networkFeePercent') {
                const feePercent = Number(value)
                return [
                  Number.isFinite(feePercent) ? `${feePercent.toFixed(2)}%` : value,
                  'Network Fee (%)',
                ]
              }
              return [value, name]
            }}
            labelFormatter={(value) =>
              typeof value === 'number' ? `$${value.toFixed(2)}` : value
            }
          />
          <Line
            type="monotone"
            dataKey="minted"
            name="Yearly IMP"
            stroke="#2563eb"
            dot={false}
            yAxisId="ssv"
          />
          <Line
            type="monotone"
            dataKey="boostPercent"
            name="IMP Actual Boost"
            stroke="#f97316"
            dot={false}
            yAxisId="boost"
          />
          <Line
            type="monotone"
            dataKey="networkFeePercent"
            name="Network Fee (%)"
            stroke="#22c55e"
            dot={false}
            yAxisId="boost"
          />
        </LineChart>
      </ResponsiveContainer>
    </div>
  )
}

const NetworkFeeChart = ({ data }) => {
  const hasData = Array.isArray(data) && data.length > 0
  if (!hasData) {
    return (
      <div className="imp-chart-placeholder">
        <p>Need market inputs to render the fee curve.</p>
      </div>
    )
  }

  return (
    <div className="imp-chart-wrapper" aria-label="Network fee percentage versus SSV price">
      <div className="imp-chart-title">
        <span>Network Fee % vs. SSV Price</span>
      </div>
      <ResponsiveContainer width="100%" height={260}>
        <LineChart data={data} margin={{ top: 10, right: 24, left: 0, bottom: 10 }}>
          <XAxis
            dataKey="price"
            tickFormatter={(value) =>
              typeof value === 'number' ? `$${value.toFixed(0)}` : value
            }
          />
          <YAxis
            domain={[
              0,
              (dataMax) => (Number.isFinite(dataMax) ? dataMax * 1.25 : dataMax),
            ]}
            tickFormatter={(value) =>
              typeof value === 'number' ? `${value.toFixed(2)}%` : value
            }
          />
          <Tooltip
            formatter={(value) =>
              typeof value === 'number' ? `${value.toFixed(2)}%` : value
            }
            labelFormatter={(value) =>
              typeof value === 'number' ? `$${value.toFixed(2)}` : value
            }
          />
          <Line
            type="monotone"
            dataKey="feePercent"
            name="Network fee (%)"
            stroke="#22c55e"
            dot={false}
          />
          <Line
            type="monotone"
            dataKey="feePercentV1"
            name="Network fee V1 (%)"
            stroke="#6366f1"
            strokeDasharray="5 3"
            dot={false}
          />
        </LineChart>
      </ResponsiveContainer>
    </div>
  )
}

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
  { id: 'calculator', label: 'SSV Staking' },
  { id: 'fee', label: 'Fees' },
  { id: 'imp', label: 'IMP' },
  { id: 'impTier', label: 'IMP Tier' },
])

const IMP_TIER_TABLE = Object.freeze([
  {
    id: 'tier1',
    validatorsMin: 1,
    validatorsMax: 125_000,
    ethMin: 32,
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
  const [networkFeeDeltaPct, setNetworkFeeDeltaPct] = useState(() =>
    clamp(
      0,
      INITIAL_SLIDER_DELTA_RANGES.networkFee.min,
      INITIAL_SLIDER_DELTA_RANGES.networkFee.max
    )
  )
  const [minSsvPriceFloor, setMinSsvPriceFloor] = useState(
    MIN_SSV_PRICE_FLOOR_DEFAULT
  )
  const [stakedSsvPercent, setStakedSsvPercent] = useState(STAKED_SSV_BASELINE)
  const [liveNetworkFeeDecimal, setLiveNetworkFeeDecimal] = useState(null)
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
            networkFee: normalizeRange(
              deltaConfig.networkFee,
              INITIAL_SLIDER_DELTA_RANGES.networkFee
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
          setNetworkFeeDeltaPct((previous) =>
            clamp(previous, nextRanges.networkFee.min, nextRanges.networkFee.max)
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

        const rawNetworkFeePercent =
          typeof data?.data?.networkFeePercent === 'number'
            ? data.data.networkFeePercent
            : typeof data?.config?.networkFeePercent === 'number'
            ? data.config.networkFeePercent
            : null
        if (
          typeof rawNetworkFeePercent === 'number' &&
          Number.isFinite(rawNetworkFeePercent)
        ) {
          const normalized =
            rawNetworkFeePercent > 1
              ? rawNetworkFeePercent / 100
              : rawNetworkFeePercent
          if (normalized > 0 && normalized < 1) {
            setLiveNetworkFeeDecimal(normalized)
          }
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

  const baselineNetworkFeeDecimal =
    typeof liveNetworkFeeDecimal === 'number' && Number.isFinite(liveNetworkFeeDecimal)
      ? liveNetworkFeeDecimal
      : NETWORK_FEE_BASELINE

  const formattedBaselineNetworkFeePercent = formatPercent(baselineNetworkFeeDecimal * 100)

  const networkFeeAdjusted = useMemo(
    () => computeAdjustedValue(baselineNetworkFeeDecimal, networkFeeDeltaPct),
    [baselineNetworkFeeDecimal, networkFeeDeltaPct]
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

  const networkFeeTargetDecimal = finalNetworkFeeDecimal

  const perValidatorEthYieldUsd =
    finalEthPrice !== null && finalEthAprDecimal !== null
      ? 32 * finalEthPrice * finalEthAprDecimal
      : null

  const netFeeUsdPerValidator =
    perValidatorEthYieldUsd !== null && finalNetworkFeeDecimal !== null
      ? perValidatorEthYieldUsd * finalNetworkFeeDecimal
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

  const sanitizedMinSsvPriceFloor =
    typeof minSsvPriceFloor === 'number' && Number.isFinite(minSsvPriceFloor)
      ? Math.max(minSsvPriceFloor, 0.01)
      : MIN_SSV_PRICE_FLOOR_DEFAULT

  const feeFloorSliderValue =
    typeof minSsvPriceFloor === 'number' && Number.isFinite(minSsvPriceFloor)
      ? minSsvPriceFloor
      : MIN_SSV_PRICE_FLOOR_DEFAULT

  const canResetMinSsvFloor =
    feeFloorSliderValue !== MIN_SSV_PRICE_FLOOR_DEFAULT

  const effectiveFeePriceDenominator =
    finalSsvPrice !== null && finalSsvPrice > 0
      ? Math.max(finalSsvPrice, sanitizedMinSsvPriceFloor)
      : sanitizedMinSsvPriceFloor

  const networkFeePerValidatorSsv =
    netFeeUsdPerValidator !== null &&
    effectiveFeePriceDenominator !== null &&
    effectiveFeePriceDenominator > 0
      ? netFeeUsdPerValidator / effectiveFeePriceDenominator
      : null

  const networkFeePercentPerYear =
    networkFeePerValidatorSsv !== null &&
    finalSsvPrice !== null &&
    finalSsvPrice > 0 &&
    perValidatorEthYieldUsd !== null &&
    perValidatorEthYieldUsd > 0
      ? (networkFeePerValidatorSsv * finalSsvPrice) / perValidatorEthYieldUsd
      : null

  const networkFeePercentPerYearValue =
    networkFeePercentPerYear !== null ? networkFeePercentPerYear * 100 : null

  const networkFeePerValidatorUsd =
    networkFeePerValidatorSsv !== null &&
    finalSsvPrice !== null &&
    finalSsvPrice > 0
      ? networkFeePerValidatorSsv * finalSsvPrice
      : null

  const formattedNetworkFeePerValidatorSsv =
    networkFeePerValidatorSsv !== null
      ? formatTokenAmount(networkFeePerValidatorSsv, 'SSV')
      : '—'

  const formattedNetworkFeePerValidatorUsd =
    networkFeePerValidatorUsd !== null
      ? formatCurrency(networkFeePerValidatorUsd, {
          minimumFractionDigits: 2,
          maximumFractionDigits: 2,
        })
      : '—'

  const formattedNetworkFeePercentPerYear =
    networkFeePercentPerYearValue !== null
      ? formatPercent(networkFeePercentPerYearValue)
      : '—'

  const v1FeePercentValue = networkFeeAdjustedPercent
  const formattedV1FeePercent =
    v1FeePercentValue !== null ? formatPercent(v1FeePercentValue) : '—'

  const v1FeePerValidatorSsv =
    perValidatorEthYieldUsd !== null &&
    perValidatorEthYieldUsd > 0 &&
    finalSsvPrice !== null &&
    finalSsvPrice > 0 &&
    finalNetworkFeeDecimal !== null
      ? (perValidatorEthYieldUsd * finalNetworkFeeDecimal) / finalSsvPrice
      : null

  const formattedV1FeePerValidatorSsv =
    v1FeePerValidatorSsv !== null
      ? formatTokenAmount(v1FeePerValidatorSsv, 'SSV')
      : '—'

  const overallFeesUsdV1 = overallFeesUsd
  const formattedOverallFeesV1 =
    overallFeesUsdV1 !== null ? formatCurrency(overallFeesUsdV1) : '—'

  const ssvAprV1 =
    overallFeesUsdV1 !== null &&
    finalStakedSsv !== null &&
    finalStakedSsv > 0 &&
    finalSsvPrice !== null &&
    finalSsvPrice > 0
      ? overallFeesUsdV1 / (finalStakedSsv * finalSsvPrice)
      : null
  const formattedSsvAprV1 =
    typeof ssvAprV1 === 'number' && Number.isFinite(ssvAprV1)
      ? formatPercent(ssvAprV1 * 100)
      : '—'

  const v2FeePercentValue =
    typeof networkFeePercentPerYear === 'number' && Number.isFinite(networkFeePercentPerYear)
      ? networkFeePercentPerYear * 100
      : null
  const formattedV2FeePercent =
    v2FeePercentValue !== null ? formatPercent(v2FeePercentValue) : '—'

  const formattedV2FeePerValidatorSsv =
    networkFeePerValidatorSsv !== null
      ? formatTokenAmount(networkFeePerValidatorSsv, 'SSV')
      : '—'

  const overallFeesUsdV2 =
    finalStakedEth !== null &&
    finalEthPrice !== null &&
    finalEthAprDecimal !== null &&
    networkFeePercentPerYear !== null
      ? finalStakedEth * finalEthPrice * finalEthAprDecimal * networkFeePercentPerYear
      : null
  const formattedOverallFeesV2 =
    overallFeesUsdV2 !== null ? formatCurrency(overallFeesUsdV2) : '—'

  const ssvAprV2 =
    overallFeesUsdV2 !== null &&
    finalStakedSsv !== null &&
    finalStakedSsv > 0 &&
    finalSsvPrice !== null &&
    finalSsvPrice > 0
      ? overallFeesUsdV2 / (finalStakedSsv * finalSsvPrice)
      : null
  const formattedSsvAprV2 =
    typeof ssvAprV2 === 'number' && Number.isFinite(ssvAprV2)
      ? formatPercent(ssvAprV2 * 100)
      : '—'

  const formattedMinSsvPriceFloor = formatCurrency(sanitizedMinSsvPriceFloor, {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  })

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

  const impTierInfo = useMemo(() => {
    if (
      typeof finalStakedEth !== 'number' ||
      !Number.isFinite(finalStakedEth) ||
      finalStakedEth <= 0
    ) {
      return null
    }

    const matchedTier = IMP_TIER_TABLE.find(
      (tier) => finalStakedEth >= tier.ethMin && finalStakedEth <= tier.ethMax
    )
    if (matchedTier) {
      return matchedTier
    }

    return null
  }, [finalStakedEth])

  const impTierBoostMultiplier =
    typeof impTierInfo?.aprBoost === 'number' ? impTierInfo.aprBoost : null

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
    finalStakedEth !== null &&
    finalStakedEth > 0 &&
    finalEthAprDecimal !== null &&
    finalEthAprDecimal > 0 &&
    finalEthPrice !== null &&
    finalEthPrice > 0 &&
    finalSsvPrice !== null &&
    finalSsvPrice > 0 &&
    impTierBoostMultiplier !== null &&
    impTierBoostMultiplier > 0
      ? (finalStakedEth *
          finalEthAprDecimal *
          finalEthPrice *
          impTierBoostMultiplier) /
        finalSsvPrice
      : null

  const impYearlySsvState = (() => {
    if (impYearlyRequirementSsv === null && impInflationCapSsv === null) {
      return { value: null, source: null }
    }
    if (impYearlyRequirementSsv === null) {
      return { value: null, source: null }
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
    finalStakedEth !== null &&
    finalStakedEth > 0 &&
    finalEthAprDecimal !== null &&
    finalEthAprDecimal > 0 &&
    finalEthPrice !== null &&
    finalEthPrice > 0 &&
    impTierBoostMultiplier !== null &&
    impTierBoostMultiplier > 0 &&
    impInflationCapSsv !== null &&
    impInflationCapSsv > 0
      ? (finalStakedEth *
          finalEthAprDecimal *
          finalEthPrice *
          impTierBoostMultiplier) /
        impInflationCapSsv
      : null

  const formattedImpBreakEvenSsvPrice =
    impBreakEvenSsvPrice !== null
      ? formatCurrency(impBreakEvenSsvPrice, {
          minimumFractionDigits: 2,
          maximumFractionDigits: 2,
        })
      : '—'

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

  const ssvPriceMinDelta =
    typeof deltaRanges?.ssvPrice?.min === 'number'
      ? deltaRanges.ssvPrice.min
      : -75
  const ssvPriceMaxDelta =
    typeof deltaRanges?.ssvPrice?.max === 'number'
      ? deltaRanges.ssvPrice.max
      : 300

  const ssvPriceGraphRange = useMemo(() => {
    const base =
      typeof ssvPriceBaseline === 'number' &&
      Number.isFinite(ssvPriceBaseline) &&
      ssvPriceBaseline > 0
        ? ssvPriceBaseline
        : typeof finalSsvPrice === 'number' &&
          Number.isFinite(finalSsvPrice) &&
          finalSsvPrice > 0
        ? finalSsvPrice
        : null

    if (base === null) {
      return null
    }

    const minCandidate = base * (1 + ssvPriceMinDelta / 100)
    const maxCandidate = base * (1 + ssvPriceMaxDelta / 100)
    let min = Number.isFinite(minCandidate) ? minCandidate : base * 0.25
    let max = Number.isFinite(maxCandidate) ? maxCandidate : base * 1.75

    if (min <= 0) {
      min = base * 0.1
    }
    if (max <= min) {
      max = min * 2
    }

    return { min, max }
  }, [ssvPriceBaseline, finalSsvPrice, ssvPriceMinDelta, ssvPriceMaxDelta])

  const impYearlyGraphPoints = useMemo(() => {
    if (
      !ssvPriceGraphRange ||
      finalStakedEth === null ||
      finalStakedEth <= 0 ||
      finalEthAprDecimal === null ||
      finalEthAprDecimal <= 0 ||
      finalEthPrice === null ||
      finalEthPrice <= 0 ||
      impTierBoostMultiplier === null ||
      impTierBoostMultiplier <= 0 ||
      totalValidators === null ||
      totalValidators <= 0 ||
      finalEthPrice === null ||
      finalEthPrice <= 0 ||
      finalEthAprDecimal === null ||
      finalEthAprDecimal <= 0
    ) {
      return []
    }

    const hasNetworkFeeCurveInputs =
      netFeeUsdPerValidator !== null &&
      perValidatorEthYieldUsd !== null &&
      perValidatorEthYieldUsd > 0 &&
      Number.isFinite(sanitizedMinSsvPriceFloor) &&
      sanitizedMinSsvPriceFloor > 0

    const baseRequirement =
      finalStakedEth *
      finalEthAprDecimal *
      finalEthPrice *
      impTierBoostMultiplier

    if (!Number.isFinite(baseRequirement) || baseRequirement <= 0) {
      return []
    }

    const steps = 40
    const points = []
    for (let step = 0; step <= steps; step += 1) {
      const t = step / steps
      const price =
        ssvPriceGraphRange.min +
        (ssvPriceGraphRange.max - ssvPriceGraphRange.min) * t
      if (!Number.isFinite(price) || price <= 0) {
        continue
      }
      const requirement = baseRequirement / price
      const minted =
        impInflationCapSsv !== null && Number.isFinite(impInflationCapSsv)
          ? Math.min(requirement, impInflationCapSsv)
          : requirement
      if (!Number.isFinite(minted) || minted < 0) {
        continue
      }
      const boost =
        ((minted / totalValidators) * price) / (32 * finalEthPrice * finalEthAprDecimal)
      const boostPercent =
        typeof boost === 'number' && Number.isFinite(boost) ? boost * 100 : null
      let networkFeePercent = null
      if (hasNetworkFeeCurveInputs) {
        const divisor = Math.max(price, sanitizedMinSsvPriceFloor)
        const feeSsv = netFeeUsdPerValidator / divisor
        const percentDecimal = (feeSsv * price) / perValidatorEthYieldUsd
        if (Number.isFinite(percentDecimal)) {
          networkFeePercent = percentDecimal * 100
        }
      }
      points.push({ price, minted, boostPercent, networkFeePercent })
    }

    return points
  }, [
    ssvPriceGraphRange,
    finalStakedEth,
    finalEthAprDecimal,
    finalEthPrice,
    impTierBoostMultiplier,
    impInflationCapSsv,
    totalValidators,
    netFeeUsdPerValidator,
    perValidatorEthYieldUsd,
    sanitizedMinSsvPriceFloor,
  ])

  const networkFeePercentGraphPoints = useMemo(() => {
    if (!ssvPriceGraphRange) {
      return []
    }

    const feePercentV1 =
      typeof networkFeeTargetDecimal === 'number' && Number.isFinite(networkFeeTargetDecimal)
        ? networkFeeTargetDecimal * 100
        : null

    if (
      netFeeUsdPerValidator === null ||
      perValidatorEthYieldUsd === null ||
      perValidatorEthYieldUsd <= 0 ||
      !Number.isFinite(sanitizedMinSsvPriceFloor) ||
      sanitizedMinSsvPriceFloor <= 0
    ) {
      // Show a flat V1 line if available even when V2 inputs are missing.
      if (feePercentV1 === null) {
        return []
      }
    }

    const minPrice = Number.isFinite(ssvPriceGraphRange.min)
      ? Math.max(0.5, ssvPriceGraphRange.min)
      : 0.5
    const maxPrice = Number.isFinite(ssvPriceGraphRange.max)
      ? Math.max(minPrice + 1, ssvPriceGraphRange.max)
      : minPrice + 1

    const steps = 50
    const points = []
    for (let step = 0; step <= steps; step += 1) {
      const t = step / steps
      const price = minPrice + (maxPrice - minPrice) * t
      if (!Number.isFinite(price) || price <= 0) {
        continue
      }
      let feePercent = null
      if (
        netFeeUsdPerValidator !== null &&
        perValidatorEthYieldUsd !== null &&
        perValidatorEthYieldUsd > 0 &&
        Number.isFinite(sanitizedMinSsvPriceFloor) &&
        sanitizedMinSsvPriceFloor > 0
      ) {
        const divisor = Math.max(price, sanitizedMinSsvPriceFloor)
        if (Number.isFinite(divisor) && divisor > 0) {
          const feeSsv = netFeeUsdPerValidator / divisor
          if (Number.isFinite(feeSsv)) {
            const percentDecimal = (feeSsv * price) / perValidatorEthYieldUsd
            if (Number.isFinite(percentDecimal)) {
              feePercent = percentDecimal * 100
            }
          }
        }
      }
      points.push({
        price,
        feePercent,
        feePercentV1,
      })
    }

    return points
  }, [
    ssvPriceGraphRange,
    netFeeUsdPerValidator,
    perValidatorEthYieldUsd,
    sanitizedMinSsvPriceFloor,
    networkFeeTargetDecimal,
  ])

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

  const handleMinSsvFloorReset = useCallback(() => {
    setMinSsvPriceFloor(MIN_SSV_PRICE_FLOOR_DEFAULT)
  }, [])

  const handleMinSsvFloorChange = useCallback((event) => {
    const nextValue = Number(event.target.value)
    setMinSsvPriceFloor(nextValue)
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
        <section className="calculator-layout">
          <div className="summary-panel">
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
                <div
                  className={`summary-content${
                    activeSummaryTab === 'imp' ? ' summary-content--imp' : ''
                  }`}
                >
                {activeSummaryTab === 'calculator' ? (
                  <>
                    <div className="summary-pull">
                <article className="metric-card highlight summary-card">
                  <span className="metric-label">Staked SSV APR (Fee V1)</span>
                  <span className="metric-value">{formattedSsvAprV1}</span>
                  <span className="metric-subtitle">percent</span>
                  <p className="summary-description">
                    Based on the Fee V1 yearly fees relative to total staked SSV.
                  </p>
                </article>
                <article className="metric-card summary-card">
                  <span className="metric-label">Staked SSV APR (Fee V2)</span>
                  <span className="metric-value">{formattedSsvAprV2}</span>
                  <span className="metric-subtitle">percent</span>
                  <p className="summary-description">
                    Based on the floor-adjusted Fee V2 yearly fees relative to total staked SSV.
                  </p>
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
          ) : activeSummaryTab === 'fee' ? (
            <>
              <div className="fee-summary-grid">
                <article className="metric-card highlight summary-card fee-card">
                  <span className="metric-label">Fee V1</span>
                  <span className="metric-value">{formattedV1FeePercent}</span>
                  <span className="metric-subtitle">percent (slider)</span>
                  <p className="metric-subvalue">{formattedV1FeePerValidatorSsv} per validator · year</p>
                  <p className="metric-subvalue metric-subvalue-strong">
                    {formattedOverallFeesV1} overall / year
                  </p>
                  <p className="summary-description">
                    Fixed percent of ETH rewards using the slider input.
                  </p>
                </article>
                <article className="metric-card summary-card fee-card">
                  <span className="metric-label">Fee V2</span>
                  <span className="metric-value">{formattedV2FeePercent}</span>
                  <span className="metric-subtitle">percent (with floor)</span>
                  <p className="metric-subvalue">{formattedV2FeePerValidatorSsv} per validator · year</p>
                  <p className="metric-subvalue metric-subvalue-strong">
                    {formattedOverallFeesV2} overall / year
                  </p>
                  <p className="summary-description">
                    Includes the minimum SSV price floor for fee-in-SSV calculations.
                  </p>
                  <div className="fee-floor-control">
                    <div className="fee-floor-control-header">
                      <span>Adjust floor</span>
                      <button
                        type="button"
                        className="fee-floor-reset"
                        onClick={handleMinSsvFloorReset}
                        disabled={!canResetMinSsvFloor}
                      >
                        Reset
                      </button>
                    </div>
                    <input
                      type="range"
                      min={1}
                      max={30}
                      step={0.5}
                      value={feeFloorSliderValue}
                      onChange={handleMinSsvFloorChange}
                      aria-label="Min SSV Price Floor"
                    />
                    <div className="fee-floor-control-range">
                      <span>$1</span>
                      <span>{formattedMinSsvPriceFloor}</span>
                      <span>$30</span>
                    </div>
                  </div>
                </article>
              </div>
              <div className="summary-text imp-graph-card">
                <NetworkFeeChart data={networkFeePercentGraphPoints} />
              </div>
            </>
          ) : activeSummaryTab === 'imp' ? (
            <>
              <div className="summary-pull imp-layout" aria-live="polite">
                <div className="metric-stack">
                  <article className="metric-card highlight summary-card">
                  <span className="metric-label">Total Validators</span>
                  <span className="metric-value">{formattedTotalValidators}</span>
                    <span className="metric-subtitle">validators</span>
                    <p className="summary-description">
                      Derived from your staked ETH assumption (32 ETH per validator).
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
                <article className="metric-card summary-card yearly-card full-height">
                  <span className="metric-label">Yearly IMP</span>
                  <span className="metric-value">{formattedImpYearlySsv}</span>
                  <span className="metric-subvalue">≈ {formattedImpYearlySsvUsd}</span>
                  <span className="metric-subvalue">
                    Break-even SSV price: {formattedImpBreakEvenSsvPrice}
                  </span>
                  <span className="metric-subtitle">SSV</span>
                  <p className="summary-description">
                    Boosted ETH need ({formattedImpYearlyRequirement}) versus the{' '}
                    {formattedImpMaxInflation ?? 'configured'} inflation cap ({formattedImpInflationCap}).
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
              </div>
              <div className="summary-text imp-graph-card">
                <YearlyImpChart data={impYearlyGraphPoints} />
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
                </div>
              </section>
            </div>
          <aside className="controls-panel">
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
                      formatCurrencyWithCents
                    ) ?? formatCurrencyWithCents(ssvPriceAdjusted)
                : loading
                ? 'Loading...'
                : '—'
              }
              minLabel={formatDeltaLabel(deltaRanges.ssvPrice.min)}
              maxLabel={formatDeltaLabel(deltaRanges.ssvPrice.max)}
              hint={
                ssvPriceBaseline !== null
                  ? `Baseline ${formatCurrencyWithCents(
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
              min={deltaRanges.networkFee.min}
              max={deltaRanges.networkFee.max}
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
              minLabel={formatDeltaLabel(deltaRanges.networkFee.min)}
              maxLabel={formatDeltaLabel(deltaRanges.networkFee.max)}
              hint={`Baseline ${formattedBaselineNetworkFeePercent} · adjust from ${formatDeltaLabel(
                deltaRanges.networkFee.min
              )} to ${formatDeltaLabel(deltaRanges.networkFee.max)}`}
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
          </aside>
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
