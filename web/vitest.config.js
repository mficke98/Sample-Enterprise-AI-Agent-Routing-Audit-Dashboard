import { defineConfig } from 'vitest/config';
import react from '@vitejs/plugin-react';

/**
 * Test config is kept separate from vite.config.js so the dev/build pipeline
 * carries no test-only settings (and no jsdom) into a production bundle.
 */
export default defineConfig({
  plugins: [react()],
  test: {
    environment: 'happy-dom',
    globals: true,
    setupFiles: ['./test/setup.js'],
    include: ['test/**/*.test.{js,jsx}'],
    restoreMocks: true,
    coverage: {
      provider: 'v8',
      reportsDirectory: './coverage',
      include: ['src/**/*.{js,jsx}'],
      // main.jsx is the DOM mount point; there is nothing to assert about it
      // that rendering <App /> in a test does not already cover.
      exclude: ['src/main.jsx'],
      reporter: ['text'],
    },
  },
});
