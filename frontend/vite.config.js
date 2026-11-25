/** Build the eagerly bundled board and isolate the Node-native fixture tests. */
import { defineConfig, configDefaults } from 'vitest/config';
import react from '@vitejs/plugin-react';
import tailwindcss from 'tailwindcss';
import {readFileSync} from 'node:fs';

/** Embed the favicon so same-document navigation remains fully offline. */
const offlineFavicon = {
  name: 'offline-favicon',
  transformIndexHtml(html) {
    const icon = readFileSync(new URL('./public/mark.svg', import.meta.url));
    return html.replace('href="/mark.svg"', `href="data:image/svg+xml;base64,${icon.toString('base64')}"`);
  },
};

export default defineConfig({
  plugins: [react(), offlineFavicon],
  css: { postcss: { plugins: [tailwindcss()] } },
  test: { exclude: [...configDefaults.exclude, 'e2e/**', 'tests/storage.test.js'] },
});
