/** Build the eagerly bundled board and isolate the Node-native fixture tests. */
import { defineConfig, configDefaults } from 'vitest/config';
import react from '@vitejs/plugin-react';
import tailwindcss from 'tailwindcss';

export default defineConfig({
  plugins: [react()],
  css: { postcss: { plugins: [tailwindcss()] } },
  test: { exclude: [...configDefaults.exclude, 'e2e/**', 'tests/storage.test.js'] },
});
