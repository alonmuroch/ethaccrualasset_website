const resolveApiBaseUrl = () => {
  const raw = import.meta.env.VITE_API_BASE_URL?.trim()
  const fallback = import.meta.env.PROD
    ? 'https://api.ethaccrualtoken.com'
    : 'http://localhost:4000'

  if (!raw) return fallback
  if (/^https?:\/\//i.test(raw)) return raw
  return `https://${raw}`
}

const API_BASE_URL = resolveApiBaseUrl()

async function fetchJson(path) {
  const url = `${API_BASE_URL}${path}`
  const response = await fetch(url)
  if (!response.ok) {
    const body = await response.text()
    throw new Error(`Request failed: ${response.status} ${response.statusText} - ${body}`)
  }
  return response.json()
}

export async function fetchMarketSnapshot() {
  const payload = await fetchJson('/api/prices')
  return payload
}

export async function fetchHealth() {
  return fetchJson('/health')
}
