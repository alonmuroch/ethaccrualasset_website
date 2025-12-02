const express = require('express')
const cors = require('cors')
const axios = require('axios')
const dotenv = require('dotenv')
const { ethers } = require('ethers')

dotenv.config()

const DEFAULT_REFRESH_INTERVAL_MS = 5 * 60 * 1000
const DEFAULT_SYMBOLS = ['ETH', 'SSV']
const API_URL =
  process.env.CMC_API_URL ||
  'https://pro-api.coinmarketcap.com/v1/cryptocurrency/quotes/latest'
const CMC_OHLCV_URL =
  process.env.CMC_OHLCV_API_URL ||
  'https://pro-api.coinmarketcap.com/v2/cryptocurrency/ohlcv/historical'
const ETHSTORE_API_URL = (
  process.env.ETHSTORE_API_URL || 'https://beaconcha.in/api/v1/ethstore'
).replace(/\/$/, '')
const ETHSTORE_DAY = process.env.ETHSTORE_DAY || 'latest'
const STAKED_ETH_API_URL =
  process.env.STAKED_ETH_API_URL ||
  'https://api.ssv.network/api/v4/mainnet/validators/totalEffectiveBalance'
const MAINNET_RPC_URL =
  process.env.MAINNET_RPC_URL ||
  process.env.ETHEREUM_RPC_URL ||
  process.env.ETH_RPC_URL ||
  process.env.RPC_URL ||
  'https://mainnet.infura.io/v3/'
const INFURA_PROJECT_SECRET = process.env.INFURA_PROJECT_SECRET || process.env.INFURA_API_SECRET || null
const MAINNET_NETWORK = { name: 'homestead', chainId: 1 }
const ETH_BLOCK_TIME_SEC = 12
const BLOCKS_PER_YEAR = Math.round((365 * 24 * 60 * 60) / ETH_BLOCK_TIME_SEC)
const PRICE_HISTORY_WINDOW_MS = 30 * 24 * 60 * 60 * 1000 // 30 days
const NETWORK_FEE_PERCENT_V1 =
  process.env.NETWORK_FEE_PERCENT_V1 !== undefined
    ? Number(process.env.NETWORK_FEE_PERCENT_V1)
    : 0.01

const SSV_NETWORK_CONTRACT_ADDRESS = '0xafE830B6Ee262ba11cce5F32fDCd760FFE6a66e4'
const SSV_NETWORK_ABI_SINGLE = ['function getNetworkFee() view returns (uint256)']
const SSV_NETWORK_ABI_TUPLE = ['function getNetworkFee() view returns (uint256 networkFee, uint256 blockNumber)']

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
  stakedEth: null,
  networkFee: null,
  lastUpdated: null,
  pricesUpdatedAt: null,
  stakingAprUpdatedAt: null,
  stakedEthUpdatedAt: null,
  networkFeeUpdatedAt: null,
  lastCmcTimestamp: null,
  assetIds: {},
  priceHistory: {
    ETH: [],
    SSV: [],
  },
  nextMonthFeeProjection: null,
  lastFetchError: {
    prices: null,
    stakingApr: null,
    stakedEth: null,
    networkFee: null,
  },
}

let mainnetProvider = null
let hasSeededHistory = false

const resolveMainnetProvider = () => {
  if (MAINNET_RPC_URL) {
    const isInfura = /infura\.io/i.test(MAINNET_RPC_URL)
    let rpcUrl = MAINNET_RPC_URL

    if (isInfura && INFURA_PROJECT_SECRET) {
      const needsProjectId = /\/v3\/?$/.test(rpcUrl)
      if (needsProjectId) {
        rpcUrl = `${rpcUrl.replace(/\/+$/, '')}/${INFURA_PROJECT_SECRET}`
        console.info('[ssv] Using Infura RPC with provided secret as project id')
        return new ethers.providers.JsonRpcProvider(rpcUrl)
      }
    }

    console.info('[ssv] Using MAINNET_RPC_URL for network fee reads')
    return new ethers.providers.StaticJsonRpcProvider(rpcUrl, MAINNET_NETWORK)
  }

  return null
}

try {
  mainnetProvider = resolveMainnetProvider()
} catch (providerError) {
  console.error('[ssv] Failed to configure mainnet provider:', providerError.message)
}

if (!mainnetProvider) {
  console.warn(
    '[ssv] MAINNET_RPC_URL/ETHEREUM_RPC_URL or INFURA_PROJECT_ID not configured; network fee will not be fetched.'
  )
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
    const cmcTimestamp = response.data?.status?.timestamp
    if (cmcTimestamp) {
      dataState.lastCmcTimestamp = cmcTimestamp
    }

    const prices = symbols.reduce((acc, symbol) => {
      const asset = payload[symbol]
      const usdQuote = asset?.quote?.USD
      const closePrice =
        typeof usdQuote?.close === 'number' && Number.isFinite(usdQuote.close)
          ? usdQuote.close
          : null

      acc[symbol] = {
        symbol,
        id: asset?.id ?? null,
        priceUsd:
          closePrice !== null
            ? closePrice
            : typeof usdQuote?.price === 'number'
            ? usdQuote.price
            : null,
        totalSupply:
          typeof asset?.total_supply === 'number' ? asset.total_supply : null,
        circulatingSupply:
          typeof asset?.circulating_supply === 'number'
            ? asset.circulating_supply
            : null,
        maxSupply:
          typeof asset?.max_supply === 'number' ? asset.max_supply : null,
        sourceLastUpdated: usdQuote?.last_updated || null,
      }

      if (asset?.id) {
        dataState.assetIds[symbol] = asset.id
      }

      return acc
    }, {})

    const timestamp = new Date().toISOString()

    dataState.prices = prices
    dataState.lastFetchError.prices = null
    dataState.pricesUpdatedAt = timestamp
    addPriceHistory(prices)

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

async function fetchTotalStakedEth() {
  try {
    console.info('[ssv] Fetching total effective balance from SSV network...')

    const response = await axios.get(STAKED_ETH_API_URL, {
      timeout: 10_000,
    })

    const payload = response.data
    const rawValue =
      payload?.total_effective_balance ??
      payload?.totalEffectiveBalance ??
      (typeof payload === 'number' || typeof payload === 'string' ? payload : null)

    let valueEth = null
    if (rawValue !== null) {
      const numeric =
        typeof rawValue === 'string' ? Number(rawValue) : Number(rawValue)

      if (Number.isFinite(numeric)) {
        valueEth = numeric / 1_000_000_000
      }
    }

    const timestamp = new Date().toISOString()

    dataState.stakedEth = {
      value: valueEth,
      raw: payload ?? null,
      sourceUnit: 'gwei',
    }
    dataState.lastFetchError.stakedEth = null
    dataState.stakedEthUpdatedAt = timestamp

    const displayValue =
      typeof valueEth === 'number' && Number.isFinite(valueEth)
        ? `${valueEth.toLocaleString(undefined, {
            maximumFractionDigits: 0,
          })} ETH`
        : 'n/a'

    console.info('[ssv] Updated total staked ETH at', timestamp, '-', displayValue)

    return true
  } catch (error) {
    const message = error.response?.data || error.message

    dataState.lastFetchError.stakedEth = {
      code: 'FETCH_FAILED',
      message: typeof message === 'string' ? message : JSON.stringify(message),
      timestamp: new Date().toISOString(),
    }

    console.error('[ssv] Failed to fetch staked ETH:', dataState.lastFetchError.stakedEth.message)

    return false
  }
}

function normalizeNetworkFeeDecimal(rawFeeBigNumber) {
  if (!rawFeeBigNumber) {
    return { percentDecimal: null, scale: null }
  }

  const feeBigInt = ethers.BigNumber.from(rawFeeBigNumber)
  const rawNumber = Number(feeBigInt.toString())
  const perBlockSsv = Number(ethers.utils.formatUnits(feeBigInt, 18))
  const perYearSsv = Number.isFinite(perBlockSsv) ? perBlockSsv * BLOCKS_PER_YEAR : null

  // Prefer treating small integers as basis points: 1 = 0.01%
  if (Number.isFinite(rawNumber) && rawNumber > 0) {
    if (rawNumber <= 10_000_000) {
      const bpsDecimal = rawNumber / 10_000
      if (bpsDecimal > 0 && bpsDecimal < 1) {
        return { percentDecimal: bpsDecimal, scale: 'basis-points', perBlockSsv, perYearSsv }
      }
    }
    if (rawNumber <= 100) {
      return { percentDecimal: rawNumber / 100, scale: 'percent-integer', perBlockSsv, perYearSsv }
    }
  }

  const candidates = [
    { label: '18-decimals', value: Number(ethers.utils.formatUnits(feeBigInt, 18)) },
    { label: '8-decimals', value: Number(ethers.utils.formatUnits(feeBigInt, 8)) },
    { label: '6-decimals', value: Number(ethers.utils.formatUnits(feeBigInt, 6)) },
    { label: '4-decimals', value: Number(ethers.utils.formatUnits(feeBigInt, 4)) },
    { label: 'raw', value: Number(feeBigInt.toString()) },
  ]

  for (const candidate of candidates) {
    if (Number.isFinite(candidate.value) && candidate.value > 0 && candidate.value < 1) {
      return { percentDecimal: candidate.value, scale: candidate.label, perBlockSsv, perYearSsv }
    }
  }

  for (const candidate of candidates) {
    if (Number.isFinite(candidate.value) && candidate.value >= 1 && candidate.value <= 100) {
      return { percentDecimal: candidate.value / 100, scale: `${candidate.label}-percent`, perBlockSsv, perYearSsv }
    }
  }

  return { percentDecimal: null, scale: null, perBlockSsv, perYearSsv }
}

function normalizePercentDecimal(rawPercent) {
  if (typeof rawPercent !== 'number' || !Number.isFinite(rawPercent) || rawPercent <= 0) {
    return null
  }
  return rawPercent > 1 ? rawPercent / 100 : rawPercent
}

function addPriceHistory(prices) {
  if (!prices) return
  const now = Date.now()
  const cutoff = now - PRICE_HISTORY_WINDOW_MS
  const symbolsList = ['ETH', 'SSV']
  symbolsList.forEach((symbol) => {
    const priceUsd = prices?.[symbol]?.priceUsd
    if (typeof priceUsd === 'number' && Number.isFinite(priceUsd) && priceUsd > 0) {
      dataState.priceHistory[symbol].push({ timestamp: now, priceUsd })
    }
    dataState.priceHistory[symbol] = dataState.priceHistory[symbol].filter(
      (entry) => entry && typeof entry.timestamp === 'number' && entry.timestamp >= cutoff
    )
    const count = dataState.priceHistory[symbol].length
    const firstTs = count ? new Date(dataState.priceHistory[symbol][0].timestamp).toISOString() : 'n/a'
    console.info(`[price-history] ${symbol} stored entries: ${count} (oldest ${firstTs})`)
  })
}

function calculateMovingAverage(symbol) {
  const entries = dataState.priceHistory?.[symbol] || []
  if (!entries.length) return null
  const sum = entries.reduce((acc, entry) => acc + entry.priceUsd, 0)
  const avg = sum / entries.length
  console.info(
    `[price-history] ${symbol} avg (30d) from ${entries.length} points: ${avg.toFixed(4)}`
  )
  return Number.isFinite(avg) && avg > 0 ? avg : null
}

function calculate30dClosingWindow(symbol) {
  const entries = (dataState.priceHistory?.[symbol] || []).slice().sort((a, b) => a.timestamp - b.timestamp)
  if (!entries.length) {
    console.warn(`[price-history] ${symbol} has no entries for 30d closing window`)
    return null
  }

  // Use the last day of the previous calendar month in UTC, and the 29 days before it (30 days total).
  const refSource = dataState.lastCmcTimestamp || Date.now()
  const refMs = typeof refSource === 'string' || typeof refSource === 'number' ? new Date(refSource).getTime() : Date.now()
  const refValid = Number.isFinite(refMs)
  const effectiveRef = refValid ? refMs : Date.now()
  const msPerDay = 24 * 60 * 60 * 1000
  const refDate = new Date(effectiveRef)
  const endDateUtc = Date.UTC(refDate.getUTCFullYear(), refDate.getUTCMonth(), 0) // last day prev month at 00:00 UTC
  const startDateUtc = endDateUtc - 29 * msPerDay
  const endExclusive = endDateUtc + msPerDay // include the entire end day

  const windowEntries = entries.filter(
    (entry) => entry.timestamp >= startDateUtc && entry.timestamp < endExclusive
  )

  if (windowEntries.length < 30) {
    console.warn(
      `[price-history] ${symbol} insufficient closing data for 30d window: ${windowEntries.length} (need 30) between ${new Date(
        startDateUtc
      )
        .toISOString()
        .slice(0, 10)} and ${new Date(endDateUtc).toISOString().slice(0, 10)}`
    )
    return null
  }

  const avg =
    windowEntries.reduce((acc, entry) => acc + entry.priceUsd, 0) / windowEntries.length

  const hasGap = windowEntries.some((entry, idx) => {
    if (idx === 0) return false
    const gap = entry.timestamp - windowEntries[idx - 1].timestamp
    return gap > msPerDay * 1.5
  })

  console.info(
    `[price-history] ${symbol} window ${new Date(startDateUtc).toISOString().slice(0, 10)} -> ${new Date(
      endDateUtc
    )
      .toISOString()
      .slice(0, 10)} (${windowEntries.length} points)`
  )

  return {
    avg: Number.isFinite(avg) ? avg : null,
    count: windowEntries.length,
    start: new Date(startDateUtc).toISOString().slice(0, 10),
    end: new Date(endDateUtc).toISOString().slice(0, 10),
    daysSpan: (endDateUtc - startDateUtc) / msPerDay,
    hasGap,
  }
}

function backfillWithCurrentPrices() {
  const symbolsList = ['ETH', 'SSV']
  const now = Date.now()
  const dayMs = 24 * 60 * 60 * 1000
  let added = false

  symbolsList.forEach((symbol) => {
    const priceUsd = dataState.prices?.[symbol]?.priceUsd
    if (typeof priceUsd === 'number' && Number.isFinite(priceUsd) && priceUsd > 0) {
      const entries = []
      for (let i = 29; i >= 0; i -= 1) {
        entries.push({ timestamp: now - i * dayMs, priceUsd })
      }
      dataState.priceHistory[symbol] = entries
      added = true
      console.warn(
        `[price-history] Backfilled ${entries.length} synthetic entries for ${symbol} using latest price $${priceUsd.toFixed(
          4
        )}`
      )
    }
  })

  return added
}

async function seedHistoricalPricesIfNeeded() {
  if (hasSeededHistory) return

  const ethCount = dataState.priceHistory.ETH?.length || 0
  const ssvCount = dataState.priceHistory.SSV?.length || 0
  const needsSeed = ethCount < 10 || ssvCount < 10
  if (!needsSeed) {
    hasSeededHistory = true
    return
  }

  const paramsBase = {
    convert: 'USD',
    interval: 'daily',
    count: 90, // fetch a broader range so we always have last month's closes
  }

  if (!cmcApiKey) {
    console.warn('[price-history] Cannot seed historical prices: missing CMC_API_KEY')
    return
  }

  try {
    console.info('[price-history] Seeding 30d close prices from CMC OHLCV...')
    const symbolsToFetch = ['ETH', 'SSV']
    let addedAny = false
    for (const symbol of symbolsToFetch) {
      const id = dataState.assetIds?.[symbol]
      const params = {
        ...paramsBase,
      }
      if (id) {
        params.id = id
      } else {
        params.symbol = symbol
      }
      const response = await axios.get(CMC_OHLCV_URL, {
        params,
        headers: {
          'X-CMC_PRO_API_KEY': cmcApiKey,
        },
        timeout: 10_000,
      })
      let quotes = response.data?.data?.quotes
      if (!Array.isArray(quotes) || quotes.length === 0) {
        console.warn(`[price-history] No historical quotes for ${symbol} via count; trying time window fallback`)
        const fallbackParams = { ...params }
        const fallbackResponse = await axios.get(CMC_OHLCV_URL, {
          params: fallbackParams,
          headers: { 'X-CMC_PRO_API_KEY': cmcApiKey },
          timeout: 10_000,
        })
        quotes = fallbackResponse.data?.data?.quotes
      }
      if (!Array.isArray(quotes) || quotes.length === 0) {
        console.warn(`[price-history] No historical quotes for ${symbol} after fallback`)
        continue
      }
      quotes.forEach((quote) => {
        const close = quote?.quote?.USD?.close
        const timeClose = quote?.time_close || quote?.timestamp || quote?.quote?.USD?.timestamp
        if (typeof close === 'number' && Number.isFinite(close) && close > 0 && timeClose) {
          const ts = new Date(timeClose).getTime()
          if (Number.isFinite(ts)) {
            dataState.priceHistory[symbol].push({ timestamp: ts, priceUsd: close })
            addedAny = true
          }
        } else {
          console.warn(
            `[price-history] Skipped quote for ${symbol}: close=${close}, time=${timeClose}`
          )
        }
      })
      // ensure we only keep the 30d window and sort
      dataState.priceHistory[symbol] = (dataState.priceHistory[symbol] || [])
        .filter((entry) => entry && Number.isFinite(entry.timestamp))
        .sort((a, b) => a.timestamp - b.timestamp)
    }
    if (addedAny) {
      hasSeededHistory = true
      console.info(
        '[price-history] Seeded entries -> ETH:',
        dataState.priceHistory.ETH.length,
        'SSV:',
        dataState.priceHistory.SSV.length
      )
    } else {
      const backfilled = backfillWithCurrentPrices()
      if (backfilled) {
        hasSeededHistory = true
      }
      console.warn('[price-history] Seeding completed but no entries were added; backfilled from latest prices.')
    }
  } catch (error) {
    const code = error?.response?.data?.status?.error_code
    if (code === 1006) {
      console.warn(
        '[price-history] CMC plan does not support OHLCV endpoint; will rely on live polling only.'
      )
      hasSeededHistory = true
      return
    }
    console.error(
      '[price-history] Failed to seed historical prices:',
      error.response?.data || error.message
    )
  }
}

function logProjectedNextMonthFee() {
  const ethWindow = calculate30dClosingWindow('ETH')
  const ssvWindow = calculate30dClosingWindow('SSV')
  const avgEthPrice = ethWindow?.avg
  const avgSsvPrice = ssvWindow?.avg
  const stakingAprDecimal = dataState.stakingApr?.value
  const networkFeePercentDecimal = normalizePercentDecimal(NETWORK_FEE_PERCENT_V1)

  if (
    avgEthPrice === null ||
    avgSsvPrice === null ||
    typeof stakingAprDecimal !== 'number' ||
    !Number.isFinite(stakingAprDecimal) ||
    stakingAprDecimal <= 0 ||
    !networkFeePercentDecimal
  ) {
    return
  }

  const windowOk =
    ethWindow &&
    ssvWindow &&
    ethWindow.count >= 30 &&
    ssvWindow.count >= 30 &&
    !ethWindow.hasGap &&
    !ssvWindow.hasGap &&
    ethWindow.daysSpan >= 29 &&
    ssvWindow.daysSpan >= 29

  if (!windowOk) {
    console.warn(
      '[fee-projection] Skipping projection due to incomplete windows',
      JSON.stringify({ ethWindow, ssvWindow })
    )
    dataState.nextMonthFeeProjection = null
    return
  }

  const perValidatorEthYieldUsd = 32 * avgEthPrice * stakingAprDecimal
  if (!Number.isFinite(perValidatorEthYieldUsd) || perValidatorEthYieldUsd <= 0) {
    return
  }

  const perYearSsv =
    (perValidatorEthYieldUsd * networkFeePercentDecimal) / avgSsvPrice

  if (Number.isFinite(perYearSsv) && perYearSsv > 0) {
    dataState.nextMonthFeeProjection = {
      perYearSsv,
      avgEthPrice,
      avgSsvPrice,
      stakingApr: stakingAprDecimal,
      networkFeePercent: networkFeePercentDecimal,
      computedAt: new Date().toISOString(),
      ethWindow,
      ssvWindow,
    }
    console.info(
      '[fee-projection] Next-month projected fee (30d MA) ≈',
      `${perYearSsv.toFixed(4)} SSV/yr`,
      `(ETH avg $${avgEthPrice.toFixed(2)}, SSV avg $${avgSsvPrice.toFixed(2)}, APR ${(stakingAprDecimal * 100).toFixed(2)}%, V1 fee ${(networkFeePercentDecimal * 100).toFixed(2)}%, window ETH ${ethWindow?.start}→${ethWindow?.end}, SSV ${ssvWindow?.start}→${ssvWindow?.end})`
    )
  } else {
    dataState.nextMonthFeeProjection = null
    console.warn('[fee-projection] Unable to derive projected fee (perYearSsv invalid)')
  }
}

async function fetchNetworkFee() {
  if (!mainnetProvider) {
    if (
      !dataState.lastFetchError.networkFee ||
      dataState.lastFetchError.networkFee.code !== 'MISSING_PROVIDER'
    ) {
      dataState.lastFetchError.networkFee = {
        code: 'MISSING_PROVIDER',
        message: 'Mainnet RPC URL not configured; cannot fetch network fee.',
        timestamp: new Date().toISOString(),
      }
    }
    return false
  }

  try {
    console.info('[ssv] Fetching network fee from contract...')
    const ifaceSingle = new ethers.utils.Interface(SSV_NETWORK_ABI_SINGLE)
    const ifaceTuple = new ethers.utils.Interface(SSV_NETWORK_ABI_TUPLE)
    const callData = ifaceSingle.encodeFunctionData('getNetworkFee')
    const rawReturn = await mainnetProvider.call({
      to: SSV_NETWORK_CONTRACT_ADDRESS,
      data: callData,
    })

    let rawFee = null
    let blockNumber = null

    try {
      const decodedSingle = ifaceSingle.decodeFunctionResult('getNetworkFee', rawReturn)
      rawFee = decodedSingle?.[0] ?? null
    } catch (singleError) {
      try {
        const decodedTuple = ifaceTuple.decodeFunctionResult('getNetworkFee', rawReturn)
        rawFee = decodedTuple?.[0] ?? null
        blockNumber = decodedTuple?.[1] ?? null
      } catch (tupleError) {
        console.warn(
          '[ssv] Failed to decode getNetworkFee response with default ABIs:',
          singleError.message,
          tupleError.message
        )
      }
    }

    if (!rawFee && typeof rawReturn === 'string' && rawReturn.startsWith('0x') && rawReturn.length >= 66) {
      // Fallback: grab the first 32 bytes as the fee value even if the ABI didn't match.
      const feeWord = `0x${rawReturn.slice(2, 66)}`
      rawFee = ethers.BigNumber.from(feeWord)
      if (!blockNumber && rawReturn.length >= 130) {
        const blockWord = `0x${rawReturn.slice(66, 130)}`
        blockNumber = ethers.BigNumber.from(blockWord)
      }
    }

    if (!rawFee) {
      throw new Error('Missing network fee value in contract response')
    }

    const rawBigNumber = ethers.BigNumber.from(rawFee)
    const { percentDecimal, scale, perBlockSsv, perYearSsv } = normalizeNetworkFeeDecimal(rawBigNumber)

    const timestamp = new Date().toISOString()

    dataState.networkFee = {
      percentDecimal,
      raw: rawBigNumber.toString(),
      decodedScale: scale,
      blockNumber: blockNumber ? Number(blockNumber) : null,
      perBlockSsv,
      perYearSsv,
    }
    dataState.networkFeeUpdatedAt = timestamp
    dataState.lastFetchError.networkFee = null

    const displayPercent =
      typeof percentDecimal === 'number' && Number.isFinite(percentDecimal)
        ? `${(percentDecimal * 100).toFixed(3)}%`
        : 'n/a'
    const displayPerYear =
      typeof perYearSsv === 'number' && Number.isFinite(perYearSsv)
        ? `${perYearSsv.toFixed(4)} SSV/yr`
        : 'n/a'

    console.info('[ssv] Updated network fee at', timestamp, '-', displayPercent, displayPerYear, `(scale: ${scale ?? 'unknown'})`)

    return true
  } catch (error) {
    const message = error.response?.data || error.message

    dataState.lastFetchError.networkFee = {
      code: 'FETCH_FAILED',
      message: typeof message === 'string' ? message : JSON.stringify(message),
      timestamp: new Date().toISOString(),
    }

    console.error('[ssv] Failed to fetch network fee:', dataState.lastFetchError.networkFee.message)
    return false
  }
}

async function fetchAllData() {
  const [pricesUpdated, aprUpdated, stakedEthUpdated, networkFeeUpdated] = await Promise.all([
    fetchLatestPrices(),
    fetchEthStakingApr(),
    fetchTotalStakedEth(),
    fetchNetworkFee(),
  ])
  await seedHistoricalPricesIfNeeded()

  if (pricesUpdated || aprUpdated || stakedEthUpdated || networkFeeUpdated) {
    dataState.lastUpdated = new Date().toISOString()
  }

  logProjectedNextMonthFee()
}

async function startPolling() {
  await fetchAllData()
  setInterval(fetchAllData, refreshIntervalMs).unref()
}

app.get('/api/prices', (req, res) => {
  if (!dataState.prices && !dataState.stakingApr && !dataState.stakedEth) {
    return res.status(503).json({
      message: 'Market data not available yet.',
      lastFetchError: dataState.lastFetchError,
    })
  }

  res.json({
    data: {
      prices: dataState.prices,
      stakingApr: dataState.stakingApr,
      stakedEth: dataState.stakedEth,
      networkFeePercent: Number.isFinite(NETWORK_FEE_PERCENT_V1)
        ? NETWORK_FEE_PERCENT_V1
        : dataState.networkFee?.percentDecimal ?? null,
      networkFeeYearlySsv: dataState.networkFee?.perYearSsv ?? null,
      currentContractFee: dataState.networkFee?.perYearSsv ?? null,
      nextMonthNetworkFeeYearlySsv: dataState.nextMonthFeeProjection?.perYearSsv ?? null,
      networkFee: dataState.networkFee,
    },
    lastUpdated: dataState.lastUpdated,
    refreshIntervalMs,
    sources: {
      prices: 'coinmarketcap',
      stakingApr: 'beaconcha.in ETH.Store',
      stakedEth: 'ssv.network totalEffectiveBalance',
      networkFee: `ssv ${SSV_NETWORK_CONTRACT_ADDRESS} getNetworkFee`,
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
    networkFeeConfigured: Boolean(mainnetProvider),
    stakedEthAvailable: Boolean(dataState.stakedEth),
    refreshIntervalMs,
  })
})

const port = Number(process.env.PORT) || 4000

app.listen(port, () => {
  console.log(`[server] listening on port ${port}`)
  startPolling()
})
