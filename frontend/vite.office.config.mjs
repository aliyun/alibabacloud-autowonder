import { defineConfig } from 'vite';

// The Java deployment replaces old assets on release. Keep this module URL stable
// for open tabs and only download Three.js when the office scene is mounted.
export default defineConfig({
  publicDir: false,
  build: {
    outDir: 'dist/office',
    emptyOutDir: false,
    lib: {
      entry: 'src/features/office/scene/scene.ts',
      formats: ['es'],
      fileName: () => 'renderer-v1.js',
    },
    minify: 'esbuild',
    rollupOptions: { output: { minifyInternalExports: true, compact: true } },
  },
});
