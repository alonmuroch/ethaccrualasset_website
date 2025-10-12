import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import './index.css'
import App from './App.jsx'
import faviconUrl from './assets/logo.png'

const ensureFavicon = () => {
  const existing = document.querySelector("link[rel='icon']")
  if (existing) {
    existing.href = faviconUrl
    return
  }

  const link = document.createElement('link')
  link.rel = 'icon'
  link.href = faviconUrl
  document.head.appendChild(link)
}

ensureFavicon()

createRoot(document.getElementById('root')).render(
  <StrictMode>
    <App />
  </StrictMode>,
)
