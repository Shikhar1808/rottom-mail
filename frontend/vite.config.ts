import fs from 'node:fs';
import tailwindcss from '@tailwindcss/vite';
import react from '@vitejs/plugin-react';
import { defineConfig } from 'vite';

// mkcert files in the repo root (see README). Slack only accepts https redirect URLs, so with them Vite serves https.
// Without them it falls back to http: then set APP_URL=http://localhost:5173 in backend/.env.
const key = new URL('../localhost-key.pem', import.meta.url);
const cert = new URL('../localhost.pem', import.meta.url);
const https = fs.existsSync(key) && fs.existsSync(cert) ? { key: fs.readFileSync(key), cert: fs.readFileSync(cert) } : undefined;

// One origin: the browser only ever talks to this server, which forwards the backend paths to the private API.
const api = 'http://127.0.0.1:4000'; // 127.0.0.1, not localhost: avoids Windows' slow IPv6 attempt
export default defineConfig({
  plugins: [react(), tailwindcss()],
  server: { port: 5173, strictPort: true, https, proxy: { '/api': api, '/auth': api, '/admin': api } },
});
