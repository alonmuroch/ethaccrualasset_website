const express = require('express')
const cors = require('cors')
const axios = require('axios')
const dotenv = require('dotenv')

dotenv.config()

const DEFAULT_REFRESH_INTERVAL_MS = 5 * 60 * 1000
const DEFAULT_SYMBOLS = ['ETH', 'SSV']
const API_URL =
  process.env.CMC_API_URL ||
  'https://pro-api.coinmarketcap.com/v1/cryptocurrency/quotes/latest'
const ETHSTORE_API_URL = (
  process.env.ETHSTORE_API_URL || 'https://beaconcha.in/api/v1/ethstore'
).replace(/\/$/, '')
const ETHSTORE_DAY = process.env.ETHSTORE_DAY || 'latest'

const app = express()

app.use(cors())

app.use((req, res, next) => {
  console.info('[server] Incoming request', req.method, req.path)
  next()
})

const refreshIntervalMs = (() => {
  const value = Number(process.env.PRICE_REFRESH_INTERVAL_MS)
  return Number.isFinite(value) && value > 0 ? value : DEFAULT_REFRESH_INTERVAL_MS
})()

const symbols =
  process.env.CMC_SYMBOLS?.split(',').map((symbol) => symbol.trim().toUpperCase()) ||
  DEFAULT_SYMBOLS

const cmcApiKey = process.env.CMC_API_KEY

const ethStoreApiKey = process.env.ETHSTORE_API_KEY

const dataState = {
  prices: null,
  stakingApr: null,
  lastUpdated: null,
  pricesUpdatedAt: null,
  stakingAprUpdatedAt: null,
  lastFetchError: {
    prices: null,
    stakingApr: null,
  },
}

async function fetchLatestPrices() {
  if (!cmcApiKey) {
    if (!dataState.lastFetchError.prices || dataState.lastFetchError.prices.code !== 'MISSING_API_KEY') {
      dataState.lastFetchError.prices = {
        code: 'MISSING_API_KEY',
        message: 'CoinMarketCap API key is not configured.',
        timestamp: new Date().toISOString(),
      }
      console.warn('[price-poller] Missing CMC_API_KEY; skipping fetch.')
    }
    return false
  }

  try {
    console.info(
      '[price-poller] Fetching prices from CoinMarketCap for symbols:',
      symbols.join(', ')
    )

    const response = await axios.get(API_URL, {
      params: {
        symbol: symbols.join(','),
        convert: 'USD',
      },
      headers: {
        'X-CMC_PRO_API_KEY': cmcApiKey,
      },
      timeout: 10_000,
    })

    const payload = response.data?.data || {}

    const prices = symbols.reduce((acc, symbol) => {
      const asset = payload[symbol]
      const usdQuote = asset?.quote?.USD

      acc[symbol] = {
        symbol,
        priceUsd: typeof usdQuote?.price === 'number' ? usdQuote.price : null,
        sourceLastUpdated: usdQuote?.last_updated || null,
      }

      return acc
    }, {})

    const timestamp = new Date().toISOString()

    dataState.prices = prices
    dataState.lastFetchError.prices = null
    dataState.pricesUpdatedAt = timestamp

    const priceSummary = symbols
      .map((symbol) => {
        const priceUsd = prices[symbol]?.priceUsd
        if (typeof priceUsd === 'number' && Number.isFinite(priceUsd)) {
          return `${symbol}: $${priceUsd.toFixed(2)}`
        }
        return `${symbol}: n/a`
    })
      .join(', ')

    console.info(
      '[price-poller] Updated prices at',
      timestamp,
      '-',
      priceSummary
    )

    return true
  } catch (error) {
    const message = error.response?.data || error.message

    dataState.lastFetchError.prices = {
      code: 'FETCH_FAILED',
      message: typeof message === 'string' ? message : JSON.stringify(message),
      timestamp: new Date().toISOString(),
    }

    console.error(
      '[price-poller] Failed to fetch prices:',
      dataState.lastFetchError.prices.message
    )

    return false
  }
}

async function fetchEthStakingApr() {
  if (!ethStoreApiKey) {
    if (
      !dataState.lastFetchError.stakingApr ||
      dataState.lastFetchError.stakingApr.code !== 'MISSING_API_KEY'
    ) {
      dataState.lastFetchError.stakingApr = {
        code: 'MISSING_API_KEY',
        message: 'ETH.Store API key is not configured.',
        timestamp: new Date().toISOString(),
      }
      console.warn('[ethstore] Missing ETHSTORE_API_KEY; skipping fetch.')
    }
    return false
  }

  try {
    console.info('[ethstore] Fetching ETH staking APR (day=%s)...', ETHSTORE_DAY)

    const response = await axios.get(`${ETHSTORE_API_URL}/${ETHSTORE_DAY}`, {
      headers: {
        accept: 'application/json',
        'api-key': ethStoreApiKey,
      },
      timeout: 10_000,
    })

    const payload = response.data?.data

    let aprValue = null
    let sourceField = null
    if (typeof payload === 'number') {
      aprValue = payload
      sourceField = 'numeric_payload'
    } else if (typeof payload?.avgapr31d === 'number') {
      aprValue = payload.avgapr31d
      sourceField = 'avgapr31d'
    } else if (typeof payload?.apr === 'number') {
      aprValue = payload.apr
      sourceField = 'apr'
    } else if (typeof payload?.apr_today === 'number') {
      aprValue = payload.apr_today
      sourceField = 'apr_today'
    }

    const timestamp = new Date().toISOString()

    dataState.stakingApr = {
      value: aprValue,
      sourceField,
      raw: payload ?? null,
    }
    dataState.lastFetchError.stakingApr = null
    dataState.stakingAprUpdatedAt = timestamp

    const aprDisplay =
      typeof aprValue === 'number' && Number.isFinite(aprValue)
        ? `${(aprValue * 100).toFixed(2)}%`
        : 'n/a'

    console.info(
      '[ethstore] Updated staking APR at',
      timestamp,
      '-',
      aprDisplay,
      `(field: ${sourceField ?? 'unknown'})`
    )

    return true
  } catch (error) {
    const message = error.response?.data || error.message

    dataState.lastFetchError.stakingApr = {
      code: 'FETCH_FAILED',
      message: typeof message === 'string' ? message : JSON.stringify(message),
      timestamp: new Date().toISOString(),
    }

    console.error('[ethstore] Failed to fetch staking APR:', dataState.lastFetchError.stakingApr.message)

    return false
  }
}

async function fetchAllData() {
  const [pricesUpdated, aprUpdated] = await Promise.all([
    fetchLatestPrices(),
    fetchEthStakingApr(),
  ])

  if (pricesUpdated || aprUpdated) {
    dataState.lastUpdated = new Date().toISOString()
  }
}

async function startPolling() {
  await fetchAllData()
  setInterval(fetchAllData, refreshIntervalMs).unref()
}

app.get('/api/prices', (req, res) => {
  if (!dataState.prices && !dataState.stakingApr) {
    return res.status(503).json({
      message: 'Market data not available yet.',
      lastFetchError: dataState.lastFetchError,
    })
  }

  res.json({
    data: {
      prices: dataState.prices,
      stakingApr: dataState.stakingApr,
    },
    lastUpdated: dataState.lastUpdated,
    refreshIntervalMs,
    sources: {
      prices: 'coinmarketcap',
      stakingApr: 'beaconcha.in ETH.Store',
    },
    lastFetchError: dataState.lastFetchError,
  })
})

app.get('/health', (req, res) => {
  res.json({
    status: 'ok',
    lastUpdated: dataState.lastUpdated,
    lastFetchError: dataState.lastFetchError,
    symbols,
    stakingAprConfigured: Boolean(ethStoreApiKey),
    refreshIntervalMs,
  })
})

const port = Number(process.env.PORT) || 4000

app.listen(port, () => {
  console.log(`[server] listening on port ${port}`)
  startPolling()
})
