import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';
import { VitePWA } from 'vite-plugin-pwa';
import { fileURLToPath, URL } from 'node:url';
import { execSync } from 'node:child_process';

// The version this build is: the commit (short) and the day; the built app knows it and dist/version.json says it, so an open
// app can tell whether the published one has moved on.
const sha = (() => { try { return (process.env.GITHUB_SHA ?? execSync('git rev-parse HEAD', { stdio: ['ignore', 'pipe', 'ignore'] }).toString().trim()).slice(0, 7); } catch { return 'dev'; } })();
const built = new Date().toISOString();
const versionFile = { name: 'version-file', generateBundle() { (this as any).emitFile({ type: 'asset', fileName: 'version.json', source: JSON.stringify({ version: sha, built }) }); } };

// VITE_BASE is '/manpower-control/' for GitHub Pages (set in CI); '/' everywhere else.
export default defineConfig({
  base: process.env.VITE_BASE || '/',
  define: { __APP_VERSION__: JSON.stringify(sha), __APP_BUILT__: JSON.stringify(built) },
  plugins: [
    react(),
    versionFile,
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
      // push-sw.js (public/) adds the push and notification-tap handlers for the shift alerts
      workbox: { navigateFallbackDenylist: [/^\/api/], globPatterns: ['**/*.{js,css,html,svg,png,woff2}'], importScripts: ['push-sw.js'] }
    })
  ],
  resolve: { alias: { '@': fileURLToPath(new URL('./src', import.meta.url)) } },
  server: { port: 5173, host: true },
  test: { environment: 'node', include: ['src/**/*.test.ts'] }
} as any);
