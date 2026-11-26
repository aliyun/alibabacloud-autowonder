import { defineConfig } from 'vite';

// Keep the versioned protocol endpoint stable for tabs that survive a deployment.
export default defineConfig({
  publicDir: false,
  build: {
    outDir: 'dist/preview-inspector',
    emptyOutDir: false,
    lib: {
      entry: 'src/features/prd/previewInspector.ts',
      name: 'AutowonderPreviewInspector',
      formats: ['iife'],
      fileName: () => 'bridge-v1.js',
    },
    minify: 'esbuild',
  },
});
