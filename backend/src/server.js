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
  priceHistory: {
    ETH: [],
    SSV: [],
  },
  lastFetchError: {
    prices: null,
    stakingApr: null,
    stakedEth: null,
    networkFee: null,
  },
}

let mainnetProvider = null

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

    const prices = symbols.reduce((acc, symbol) => {
      const asset = payload[symbol]
      const usdQuote = asset?.quote?.USD

      acc[symbol] = {
        symbol,
        priceUsd: typeof usdQuote?.price === 'number' ? usdQuote.price : null,
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
  })
}

function calculateMovingAverage(symbol) {
  const entries = dataState.priceHistory?.[symbol] || []
  if (!entries.length) return null
  const sum = entries.reduce((acc, entry) => acc + entry.priceUsd, 0)
  const avg = sum / entries.length
  return Number.isFinite(avg) && avg > 0 ? avg : null
}

function logProjectedNextMonthFee() {
  const avgEthPrice = calculateMovingAverage('ETH')
  const avgSsvPrice = calculateMovingAverage('SSV')
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

  const perValidatorEthYieldUsd = 32 * avgEthPrice * stakingAprDecimal
  if (!Number.isFinite(perValidatorEthYieldUsd) || perValidatorEthYieldUsd <= 0) {
    return
  }

  const perYearSsv =
    (perValidatorEthYieldUsd * networkFeePercentDecimal) / avgSsvPrice

  if (Number.isFinite(perYearSsv) && perYearSsv > 0) {
    console.info(
      '[fee-projection] Next-month projected fee (30d MA) ≈',
      `${perYearSsv.toFixed(4)} SSV/yr`,
      `(ETH avg $${avgEthPrice.toFixed(2)}, SSV avg $${avgSsvPrice.toFixed(2)}, APR ${(stakingAprDecimal * 100).toFixed(2)}%, V1 fee ${(networkFeePercentDecimal * 100).toFixed(2)}%)`
    )
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
