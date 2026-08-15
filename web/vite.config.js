import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

/**
 * Dev server config.
 *
 * The dashboard talks to the API with same-origin relative paths (`/api/...`)
 * so that the production build can be served from the API host with no
 * rebuild and no baked-in origin. In dev, the proxy below bridges the gap.
 *
 * `ws:false` is deliberate: the only long-lived connection is `/api/events`,
 * which is Server-Sent Events over plain HTTP, not a WebSocket. Leaving `ws`
 * on makes the proxy attempt an HTTP upgrade dance it will never need.
 *
 * SSE itself needs nothing extra here -- the API already sends
 * `Cache-Control: no-transform` and `X-Accel-Buffering: no`, and Vite's proxy
 * streams the response body through without buffering.
 */
export default defineConfig({
  plugins: [react()],
  server: {
    port: 5173,
    proxy: {
      '/api': {
        target: 'http://localhost:4000',
        changeOrigin: true,
        ws: false,
      },
    },
  },
});
