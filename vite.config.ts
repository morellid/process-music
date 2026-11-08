import { resolve } from 'node:path';
import { defineConfig } from 'vite';

const page = (path: string) => resolve(import.meta.dirname, path);

// Relative base: the build works at any path (GitHub Pages serves it under /process-music/).
// One page per tool, plus a landing page that links them.
export default defineConfig({
  base: './',
  build: {
    rolldownOptions: {
      input: { index: page('index.html'), pulse: page('pulse/index.html'), tintinnabuli: page('tintinnabuli/index.html') },
    },
  },
});
