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
}) => (
  <div className="control-card">
    <div className="control-header">
      <span className="control-label">{label}</span>
      <span className="control-value">
        {valueLabel ??
          (formatter && value !== undefined ? formatter(value) : value)}
      </span>
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

function App() {
  const [snapshot, setSnapshot] = useState(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState(null)

  const [ethAprPercent, setEthAprPercent] = useState(null)
  const [ethPriceBaseline, setEthPriceBaseline] = useState(null)
  const [ssvPriceBaseline, setSsvPriceBaseline] = useState(null)
  const [stakedEthBaseline, setStakedEthBaseline] = useState(null)

  const [ethPriceDeltaPct, setEthPriceDeltaPct] = useState(0)
  const [ssvPriceDeltaPct, setSsvPriceDeltaPct] = useState(0)
  const [stakedEthDeltaPct, setStakedEthDeltaPct] = useState(0)
  const [stakedSsvPercent, setStakedSsvPercent] = useState(12)

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

  // TODO: replace placeholders with real calculations once formulas are defined.
  const overallFeesUsd = 0
  const ssvAprEth = 0

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
        <section className="metrics-grid">
          <article className="metric-card highlight">
            <span className="metric-label">Overall Yearly Fees</span>
            <span className="metric-value">
              {formatCurrency(overallFeesUsd)}
            </span>
            <span className="metric-subtitle">USD</span>
          </article>

          <article className="metric-card">
            <span className="metric-label">SSV APR</span>
            <span className="metric-value">
              {ssvAprEth.toLocaleString(undefined, {
                minimumFractionDigits: 2,
                maximumFractionDigits: 2,
              })}
            </span>
            <span className="metric-subtitle">ETH</span>
          </article>
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
            />
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
            />
            <SliderControl
              label="% Staked SSV"
              value={stakedSsvPercent}
              onChange={setStakedSsvPercent}
              min={0}
              max={100}
              step={1}
              formatter={formatPercent}
              hint="Portion of supply participating in staking."
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
