import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { VitePWA } from 'vite-plugin-pwa';

// https://vitejs.dev/config/
export default defineConfig({
  plugins: [
    react(),
    VitePWA({
      // 'prompt' instead of 'autoUpdate': this app emits real invoices against ARCA, so we
      // don't want a stale tab silently swapping the app under the user's feet mid-flow.
      // The registered SW just precaches the app shell (JS/CSS/HTML) for fast loads — it does
      // NOT provide offline invoice emission, since that always needs a live connection to the
      // API and, transitively, to ARCA. Full offline support is out of scope for this scaffold.
      registerType: 'prompt',
      includeAssets: ['favicon.svg', 'apple-touch-icon.png'],
      manifest: {
        id: '/',
        name: 'Facturador EPSA',
        short_name: 'Facturador EPSA',
        description:
          'Emití tu factura C mensual a Envío Postal SA sin contador.',
        theme_color: '#0f172a',
        background_color: '#ffffff',
        display: 'standalone',
        start_url: '/',
        scope: '/',
        orientation: 'portrait',
        icons: [
          {
            src: 'pwa-192x192.png',
            sizes: '192x192',
            type: 'image/png',
          },
          {
            src: 'pwa-512x512.png',
            sizes: '512x512',
            type: 'image/png',
          },
          {
            src: 'pwa-512x512.png',
            sizes: '512x512',
            type: 'image/png',
            purpose: 'maskable',
          },
        ],
      },
      workbox: {
        // Precache the app shell only; no runtime caching of API responses (facturas/preview
        // are financial data with idempotency semantics that must always hit the network).
        globPatterns: ['**/*.{js,css,html,svg,png,ico}'],
      },
      devOptions: {
        // Keep the SW disabled in dev so `vite dev` behaves predictably (no stale-cache
        // debugging surprises for other branches building screens against this shell).
        enabled: false,
      },
    }),
  ],
  server: {
    port: 5173,
  },
});
