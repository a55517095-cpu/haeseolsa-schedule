import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import { VitePWA } from 'vite-plugin-pwa'

export default defineConfig({
  plugins: [
    react(),
    VitePWA({
      registerType: 'autoUpdate',
      includeAssets: ['icons/icon-192.png', 'icons/icon-512.png', 'icons/apple-touch-icon.png'],
      manifest: {
        name: '해설사 근무편성표',
        short_name: '근무표',
        description: '해설사 근무편성표 확인 및 근무 교대',
        lang: 'ko',
        start_url: '/',
        display: 'standalone',
        background_color: '#ffffff',
        theme_color: '#1d4ed8',
        orientation: 'portrait',
        icons: [
          { src: 'icons/icon-192.png', sizes: '192x192', type: 'image/png' },
          { src: 'icons/icon-512.png', sizes: '512x512', type: 'image/png' },
          { src: 'icons/icon-512.png', sizes: '512x512', type: 'image/png', purpose: 'maskable' },
        ],
      },
      workbox: {
        // 근무표는 항상 최신이어야 하므로 API 응답은 캐시하지 않는다.
        globPatterns: ['**/*.{js,css,html,png,svg,woff2}'],
        // 엑셀 라이브러리는 관리자만 쓰므로 미리 받아두지 않는다 (500KB 절약)
        globIgnores: ['**/xlsx-*.js'],
        navigateFallbackDenylist: [/^\/rest\//, /^\/auth\//, /^\/functions\//],
      },
    }),
  ],
})
