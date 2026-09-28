import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';
import { VitePWA } from 'vite-plugin-pwa';

export default defineConfig({
  resolve: {
    alias: {
      '@': new URL('./src', import.meta.url).pathname,
    },
  },
  server: {
    proxy: {
      '/api': 'http://127.0.0.1:8787',
    },
  },
  plugins: [
    react(),
    tailwindcss(),
    VitePWA({
      registerType: 'autoUpdate',
      includeAssets: ['engine/gnubg.js', 'engine/gnubg.wasm', 'engine/gnubg.data', 'icons/icon.svg'],
      workbox: {
        maximumFileSizeToCacheInBytes: 8 * 1024 * 1024,
        globPatterns: ['**/*.{js,css,html,svg,png,jpg,wasm,data}'],
        // SPA deep links (e.g. /play/:id) resolve to the app shell offline,
        // but never hijack the API.
        navigateFallback: '/index.html',
        navigateFallbackDenylist: [/^\/api\//],
        // On redeploy, activate the new service worker immediately, take over
        // open tabs, and drop stale precaches so users never run old assets.
        skipWaiting: true,
        clientsClaim: true,
        cleanupOutdatedCaches: true,
      },
      manifest: {
        name: 'Backgammon vs GNU BG',
        short_name: 'Backgammon',
        description: 'Play backgammon against GNU Backgammon with full mistake analysis',
        theme_color: '#1a1512',
        background_color: '#1a1512',
        display: 'standalone',
        orientation: 'landscape',
        icons: [
          { src: 'icons/icon.svg', sizes: 'any', type: 'image/svg+xml', purpose: 'any' },
          { src: 'icons/icon-192.png', sizes: '192x192', type: 'image/png' },
          { src: 'icons/icon-512.png', sizes: '512x512', type: 'image/png' },
        ],
      },
    }),
  ],
  test: {
    environment: 'node',
    include: ['src/**/*.test.ts'],
  },
} as Parameters<typeof defineConfig>[0]);
