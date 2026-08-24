import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import { TanStackRouterVite } from '@tanstack/router-plugin/vite'
import { resolve } from 'path'
import { readBackendPort } from './backend-port'

// Single source of truth: the backend port comes from config/default.yaml.
const backendPort = readBackendPort(resolve(__dirname, '../../config/default.yaml'))

export default defineConfig({
  plugins: [TanStackRouterVite({ routesDirectory: './src/routes', generatedRouteTree: './src/routes/routeTree.gen.ts' }), react()],
  resolve: {
    alias: {
      '@': resolve(__dirname, 'src'),
      '@shared': resolve(__dirname, '../modules'),
      // Product docs help-map (SSOT: packages/docs/help-map.json)
      '@eyas-docs': resolve(__dirname, '../../packages/docs'),
    },
  },
  server: {
    port: 5173, // Vite's own dev server — unrelated to the backend port.
    fs: {
      // Allow importing help-map.json from packages/docs
      allow: [resolve(__dirname, '../..')],
    },
    proxy: {
      '/api': { target: `http://localhost:${backendPort}`, changeOrigin: true },
      '/ws': { target: `ws://localhost:${backendPort}`, ws: true },
      // Product docs are served by the EYAS backend at /docs/*
      '/docs': { target: `http://localhost:${backendPort}`, changeOrigin: true },
    },
  },
})
