import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';
import { VitePWA } from 'vite-plugin-pwa';
import { fileURLToPath, URL } from 'node:url';

// VITE_BASE is '/manpower-control/' for GitHub Pages (set in CI); '/' everywhere else.
export default defineConfig({
  base: process.env.VITE_BASE || '/',
  plugins: [
    react(),
    tailwindcss(),
    VitePWA({
      // 'prompt': a new build waits until the person taps Update (src/app/UpdatePrompt.tsx), which registers the worker.
      registerType: 'prompt',
      injectRegister: false,
      includeAssets: ['icon.svg', 'favicon-32.png', 'apple-touch-icon.png', 'brand/mark.svg'],
      manifest: {
        name: 'ARDS Operations · Manpower Control',
        short_name: 'ARDS Ops',
        description: 'ARDS Operations · Area 4 · Unit 12: manpower planning and control (KNPC Mina Abdullah Refinery, internal use)',
        theme_color: '#0e2a63',
        background_color: '#ffffff',
        display: 'standalone',
        start_url: '.',
        scope: '.',
        icons: [
          { src: 'icon.svg', sizes: 'any', type: 'image/svg+xml', purpose: 'any' },
          { src: 'icon-192.png', sizes: '192x192', type: 'image/png', purpose: 'any' },
          { src: 'icon-512.png', sizes: '512x512', type: 'image/png', purpose: 'any' },
          { src: 'icon-maskable-512.png', sizes: '512x512', type: 'image/png', purpose: 'maskable' }
        ]
      },
      // fonts and brand images are cached with the app so it looks the same offline
      workbox: { navigateFallbackDenylist: [/^\/api/], globPatterns: ['**/*.{js,css,html,svg,png,woff2}'] }
    })
  ],
  resolve: { alias: { '@': fileURLToPath(new URL('./src', import.meta.url)) } },
  server: { port: 5173, host: true },
  test: { environment: 'node', include: ['src/**/*.test.ts'] }
} as any);
