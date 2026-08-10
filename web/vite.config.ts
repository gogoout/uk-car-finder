import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig({
  root: import.meta.dirname,
  plugins: [react()],
  build: {
    outDir: 'dist',
    emptyOutDir: true,
  },
  server: {
    proxy: {
      // This dev server only renders the SPA. The API and D1 live in the
      // Worker, so `pnpm run dev` has to be running in another terminal.
      '/api': {
        target: 'http://localhost:8787',
        configure(proxy) {
          proxy.on('error', (err) => {
            if ((err as NodeJS.ErrnoException).code === 'ECONNREFUSED') {
              console.error(
                '\n  No Worker on :8787 — the API is served by wrangler, not by Vite.' +
                  '\n  Run `pnpm run dev` in another terminal, then reload.\n',
              );
            }
          });
        },
      },
    },
  },
});
