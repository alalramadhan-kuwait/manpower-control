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
      includeAssets: ['icon.svg'],
      manifest: {
        name: 'Area 4 Manpower Control',
        short_name: 'A4 Manpower',
        description: 'KNPC MAB Area 4 / Unit 12 operations manpower planning and control',
        theme_color: '#0f3d5e',
        background_color: '#f4f6f8',
        display: 'standalone',
        start_url: '.',
        scope: '.',
        icons: [
          { src: 'icon.svg', sizes: 'any', type: 'image/svg+xml', purpose: 'any' },
          { src: 'icon-192.png', sizes: '192x192', type: 'image/png' },
          { src: 'icon-512.png', sizes: '512x512', type: 'image/png', purpose: 'any maskable' }
        ]
      },
      workbox: { navigateFallbackDenylist: [/^\/api/] }
    })
  ],
  resolve: { alias: { '@': fileURLToPath(new URL('./src', import.meta.url)) } },
  server: { port: 5173, host: true },
  test: { environment: 'node', include: ['src/**/*.test.ts'] }
} as any);
