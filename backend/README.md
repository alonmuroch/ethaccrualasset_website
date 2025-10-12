# Backend Service

Minimal Express service that periodically pulls ETH and SSV prices from the CoinMarketCap API and exposes them for the dashboard.

## Setup

1. Copy `.env.example` to `.env` and populate:
   - `CMC_API_KEY` with your CoinMarketCap Pro key.
   - `ETHSTORE_API_KEY` with your beaconcha.in API key (ETH.Store access).
   - Optionally adjust `PRICE_REFRESH_INTERVAL_MS`, `ETHSTORE_DAY`, or API URLs.
2. Install dependencies:
   ```bash
   npm install
   ```

## Usage

```bash
# Run with hot-reload (requires Node 18+)
npm run dev

# Production mode
npm start
```

The service listens on `PORT` (default `4000`) and refreshes data every `PRICE_REFRESH_INTERVAL_MS` milliseconds (default 5 minutes). Data is available at:

- `GET /api/prices` – latest cached market prices (ETH, SSV) and ETH staking APR data (uses `avgapr31d` from ETH.Store when available).
- `GET /health` – polling status details.

> **Note:** The service stores data in memory only. Restarting the process clears the cache until the next successful fetch.
