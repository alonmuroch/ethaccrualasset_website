import path from 'node:path'
import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

// https://vite.dev/config/
export default defineConfig({
  plugins: [react()],
  server: {
    fs: {
      allow: [path.resolve(__dirname, '..')],
    },
  },
  preview: {
    // Allow Render internal hostnames (e.g., ethaccrualasset-website-q95y) when running `vite preview`
    allowedHosts: true,
  },
})
