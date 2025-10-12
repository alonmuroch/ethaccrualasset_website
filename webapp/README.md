# ETH Accrual Asset Webapp

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

The app fetches current market data on load. ETH APR is read-only (sourced from the backend). Staked ETH, ETH price, and SSV price sliders apply relative adjustments to their live baselines:

- `Staked ETH`: -25% to +100%
- `ETH Price`: -100% to +100%
- `SSV Price`: -100% to +1,000%
