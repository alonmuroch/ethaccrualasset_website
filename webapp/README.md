# ETH Accrual Token Webapp

Frontend dashboard built with Vite + React. It consumes the companion backend to pre-fill market assumptions (staking APR, ETH price, SSV price) and lets you explore scenarios by adjusting sliders.

## Setup

```bash
cd webapp
npm install
cp .env.example .env   # adjust API base URL if backend runs elsewhere
```

Make sure the backend is running (default `http://localhost:4000`). Then start the dev server:

```bash
npm run dev
```

The app fetches current market data on load. ETH APR is read-only (sourced from the backend). Staked ETH, ETH price, SSV price, and Network Fee sliders apply relative adjustments to their live baselines:

- `Staked ETH`: -25% to +100%
- `ETH Price`: -100% to +100%
- `SSV Price`: -100% to +1,000%
- `Network Fee`: -50% to +150% (baseline 1%)
- `% Staked SSV`: 0% to 100% (defaults to 50%; hint includes the live total supply from CoinMarketCap)

Each slider includes a **Reset** button to snap back to the baseline fetched (or defaulted) value.

Overall yearly fees are calculated as:

```
Staked ETH × ETH Price × ETH APR × Network Fee
```

SSV APR is derived from those fees:

```
Overall Yearly Fees ÷ (Staked SSV × SSV Price)
```

## IMP tab

Use the **IMP** tab to model the SSV Incentivized Mainnet Program with the same slider inputs. The tab derives:

- Total validators = `Staked ETH ÷ 32`
- Yearly IMP (SSV) = `min((Validators × ETH APR × ETH price) ÷ SSV price, Max Inflation × Total SSV)`
- IMP Actual Boost = `((Yearly IMP ÷ Validators) × SSV price) ÷ (32 × ETH price × ETH APR)`

`VITE_IMP_MAX_INFLATION_PERCENT` (default `15`) controls the max inflation cap applied to the total SSV supply.

## IMP Tier tab

Use the **IMP Tier** tab to see which incentive bracket applies to the current staked ETH input. The highlight card shows the active APR boost, while the table lists every validator/effective-balance range along with its boost percentage. Rows update automatically as you adjust the staked ETH slider.
