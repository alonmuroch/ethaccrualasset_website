import { useState } from 'react'
import './App.css'

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
}) => (
  <div className="control-card">
    <div className="control-header">
      <span className="control-label">{label}</span>
      <span className="control-value">{formatter(value)}</span>
    </div>
    {hint ? <p className="control-hint">{hint}</p> : null}
    <input
      type="range"
      min={min}
      max={max}
      step={step}
      value={value}
      onChange={(event) => onChange(Number(event.target.value))}
      aria-label={label}
    />
    <div className="control-range">
      <span>{formatter(min)}</span>
      <span>{formatter(max)}</span>
    </div>
  </div>
)

function App() {
  const [ethApr, setEthApr] = useState(4.5)
  const [stakedEth, setStakedEth] = useState(3200)
  const [ethPrice, setEthPrice] = useState(3250)
  const [ssvPrice, setSsvPrice] = useState(45)
  const [stakedSsvPercent, setStakedSsvPercent] = useState(12)

  // TODO: replace placeholders with real calculations once formulas are defined.
  const overallFeesUsd = 0
  const ssvAprEth = 0

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
            <SliderControl
              label="ETH APR"
              value={ethApr}
              onChange={setEthApr}
              min={0}
              max={20}
              step={0.1}
              formatter={formatPercent}
              hint="Assumed staking yield on ETH."
            />
            <SliderControl
              label="Staked ETH"
              value={stakedEth}
              onChange={setStakedEth}
              min={0}
              max={50000}
              step={100}
              formatter={(value) => `${formatNumber(value)} ETH`}
              hint="Total ETH contributing to accrual."
            />
            <SliderControl
              label="ETH Price"
              value={ethPrice}
              onChange={setEthPrice}
              min={500}
              max={10000}
              step={50}
              formatter={formatCurrency}
              hint="Current market price of ETH."
            />
            <SliderControl
              label="SSV Price"
              value={ssvPrice}
              onChange={setSsvPrice}
              min={5}
              max={200}
              step={1}
              formatter={formatCurrency}
              hint="Spot price of SSV token."
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
        </section>
      </main>
    </div>
  )
}

export default App
