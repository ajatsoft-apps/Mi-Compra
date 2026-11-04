import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import { VitePWA } from 'vite-plugin-pwa'

const base = process.env.GITHUB_ACTIONS === 'true' ? '/Mi-Compra/' : '/'

export default defineConfig({
  base,
  plugins: [
    react(),
    VitePWA({
      registerType: 'autoUpdate',
      includeAssets: ['favicon.svg', 'apple-touch-icon.png'],
      manifest: {
        name: 'Mi Compra',
        short_name: 'Mi Compra',
        description: 'Tu compra familiar, organizada e inteligente.',
        lang: 'es',
        theme_color: '#f7f8f4',
        background_color: '#f7f8f4',
        display: 'standalone',
        start_url: './',
        scope: './',
        icons: [
          { src: 'pwa-icon.svg', sizes: 'any', type: 'image/svg+xml', purpose: 'any' },
          { src: 'apple-touch-icon.png', sizes: '180x180', type: 'image/png', purpose: 'any' },
        ],
      },
    }),
  ],
})
