import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import path from 'path'

// https://vite.dev/config/
export default defineConfig({
  plugins: [react()],
  resolve: {
    alias: {
      // Shared API contract types — single source of truth between backend and frontend.
      // Adding a field to src/api-contracts.ts causes TS errors here if the UI doesn't handle it.
      '@api': path.resolve(__dirname, '../src/api-contracts.ts'),
    },
  },
  build: {
    outDir: 'dist',
    sourcemap: true,
  },
  server: {
    port: 3000,
  },
})
