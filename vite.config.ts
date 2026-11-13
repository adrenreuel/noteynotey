import { existsSync, readFileSync } from 'node:fs';
import { defineConfig } from 'vite';
import basicSsl from '@vitejs/plugin-basic-ssl';

// Browsers only allow the mic on localhost or HTTPS, so the dev server always
// uses HTTPS. `npm run cert:lan` makes a certificate for this Mac's network
// address, signed by a local authority a phone or iPad can trust, so the app
// opens there with the mic (`npm run dev:lan`). Without it, a throwaway
// certificate covers localhost only.
const lanCert = existsSync('.cert/dev.crt') && existsSync('.cert/dev.key');

export default defineConfig({
  plugins: lanCert ? [] : [basicSsl()],
  server: lanCert ? { https: { cert: readFileSync('.cert/dev.crt'), key: readFileSync('.cert/dev.key') } } : {},
  build: {
    // VexFlow with its Bravura font is about 580 kB minified.
    chunkSizeWarningLimit: 700,
  },
});
