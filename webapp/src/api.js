const API_BASE_URL = import.meta.env.VITE_API_BASE_URL || 'http://localhost:4000'

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
