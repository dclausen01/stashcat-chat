import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'
import { VitePWA } from 'vite-plugin-pwa'

export default defineConfig({
  plugins: [
    react(),
    tailwindcss(),
    VitePWA({
      registerType: 'autoUpdate',
      includeAssets: ['bbz-logo-neu.png', 'icon.png'],
      manifest: {
        name: 'BBZ Chat',
        short_name: 'BBZ Chat',
        description: 'BBZ Rendsburg-Eckernförde — Chat-Client für Stashcat / schul.cloud',
        theme_color: '#3a6ab5',
        background_color: '#ffffff',
        display: 'standalone',
        orientation: 'any',
        lang: 'de',
        start_url: '/',
        scope: '/',
        icons: [
          {
            src: 'icon.png',
            sizes: '512x512',
            type: 'image/png',
            purpose: 'any',
          },
          {
            src: 'icon.png',
            sizes: '512x512',
            type: 'image/png',
            purpose: 'maskable',
          },
        ],
      },
      workbox: {
        globPatterns: ['**/*.{js,css,html,ico,png,svg}'],
        // SPA fallback so navigation in standalone mode doesn't 404
        navigateFallback: '/index.html',
        // Never cache backend API requests — they need fresh data + auth
        navigateFallbackDenylist: [/^\/backend\//, /^\/api\//],
        runtimeCaching: [
          {
            // API requests: always go to network, never cache
            urlPattern: ({ url }) => url.pathname.startsWith('/backend/') || url.pathname.startsWith('/api/'),
            handler: 'NetworkOnly',
          },
        ],
        cleanupOutdatedCaches: true,
        maximumFileSizeToCacheInBytes: 5 * 1024 * 1024, // 5 MB
      },
    }),
  ],
  build: {
    chunkSizeWarningLimit: 2000,
  },
  server: {
    proxy: {
      '/backend': {
        target: 'http://localhost:3001',
        changeOrigin: true,
        rewrite: (path) => path.replace(/^\/backend/, ''),
      },
    },
  },
})
