import { useEffect, useMemo, useState } from 'react'
import './App.css'
import { fetchMarketSnapshot } from './api'

const formatCurrency = (value) =>
  new Intl.NumberFormat('en-US', {
    style: 'currency',
    currency: 'USD',
    maximumFractionDigits: 0,
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
const STAKED_SSV_BASELINE = 50

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
    maximumFractionDigits: 2,
  }).format(value)} ${symbol}`
}

function App() {
  const [snapshot, setSnapshot] = useState(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState(null)

  const [ethAprPercent, setEthAprPercent] = useState(null)
  const [ethPriceBaseline, setEthPriceBaseline] = useState(null)
  const [ssvPriceBaseline, setSsvPriceBaseline] = useState(null)
  const [stakedEthBaseline, setStakedEthBaseline] = useState(null)
  const [ssvTotalSupply, setSsvTotalSupply] = useState(null)

  const [ethPriceDeltaPct, setEthPriceDeltaPct] = useState(0)
  const [ssvPriceDeltaPct, setSsvPriceDeltaPct] = useState(0)
  const [stakedEthDeltaPct, setStakedEthDeltaPct] = useState(0)
  const [networkFeeDeltaPct, setNetworkFeeDeltaPct] = useState(0)
  const [stakedSsvPercent, setStakedSsvPercent] = useState(STAKED_SSV_BASELINE)

  useEffect(() => {
    let isMounted = true

    const loadSnapshot = async () => {
      try {
        setLoading(true)
        const data = await fetchMarketSnapshot()
        if (!isMounted) return

        setSnapshot(data)

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
        if (isMounted) {
          setLoading(false)
        }
      }
    }

    loadSnapshot()

    return () => {
      isMounted = false
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

  return (
    <div className="app-shell">
      <header className="topbar">
        <div className="brand">
          <span className="brand-logo">EA</span>
          <span className="brand-name">ETH Accrual Asset</span>
        </div>
        <nav className="top-nav">
          <a href="#" className="active">
            Dashboard
          </a>
          <a href="#">Metrics</a>
          <a href="#">Sources</a>
        </nav>
      </header>

      <main className="main">
      <section className="summary-section">
        <article className="metric-card highlight summary-card">
          <div className="summary-values">
            <div className="summary-value">
              <span className="metric-label">Overall Yearly Fees</span>
              <span className="metric-value">{formattedOverallFees}</span>
              <span className="metric-subtitle">USD</span>
              <p className="summary-description">
                The yearly fees the entire SSV Network accumulates under the assumptions you configure below.
              </p>
            </div>
            <div className="summary-divider" aria-hidden="true" />
            <div className="summary-value">
              <span className="metric-label">SSV APR</span>
              <span className="metric-value">{formattedSsvApr}</span>
              <span className="metric-subtitle">percent</span>
              <p className="summary-description">
                The resulting APR, paid in ETH, for staking SSV with those same inputs.
              </p>
            </div>
          </div>
          <p className="summary-note">
            Both values update instantly as you adjust the assumptions below.
          </p>
        </article>
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
      </section>

        <section className="controls-section">
          <div className="section-header">
            <h2>Adjust Assumptions</h2>
            <p>
              Tune the inputs below to explore how the ETH Accrual Asset reacts
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
              min={-25}
              max={100}
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
              minLabel="-25%"
              maxLabel="+100%"
              hint={
                stakedEthBaseline !== null
                  ? `Baseline ${formatEthAmount(
                      stakedEthBaseline
                    )} · adjust from -25% to +100%`
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
              min={-100}
              max={100}
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
              minLabel="-100%"
              maxLabel="+100%"
              hint={
                ethPriceBaseline !== null
                  ? `Baseline ${formatCurrency(ethPriceBaseline)} · adjust ±100%`
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
              min={-100}
              max={1000}
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
              minLabel="-100%"
              maxLabel="+1000%"
              hint={
                ssvPriceBaseline !== null
                  ? `Baseline ${formatCurrency(
                      ssvPriceBaseline
                    )} · adjust from -100% to +1,000%`
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
      </main>
    </div>
  )
}

export default App
