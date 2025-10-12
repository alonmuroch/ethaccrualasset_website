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

The app will fetch current market data on load. ETH APR is read-only (sourced from the backend). ETH and SSV price sliders allow relative adjustments around the live price (-100%/+100% and -100%/+10,000%, respectively).
