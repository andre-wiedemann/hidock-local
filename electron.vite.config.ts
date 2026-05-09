import { defineConfig, externalizeDepsPlugin } from 'electron-vite';
import { resolve } from 'node:path';

export default defineConfig({
  main: {
    // Don't bundle production deps into the main bundle — packages like
    // ffmpeg-static export paths computed from `__dirname` at module load
    // time, so they have to resolve at runtime from node_modules. The
    // plugin externalizes everything in `dependencies` automatically.
    plugins: [externalizeDepsPlugin()],
    build: {
      outDir: 'out/main',
      lib: { entry: resolve(__dirname, 'src/main/index.ts') }
    }
  },
  preload: {
    plugins: [externalizeDepsPlugin()],
    build: {
      outDir: 'out/preload',
      lib: { entry: resolve(__dirname, 'src/preload/index.ts') }
    }
  },
  renderer: {
    root: resolve(__dirname, 'src/renderer'),
    build: {
      outDir: 'out/renderer',
      rollupOptions: {
        input: { index: resolve(__dirname, 'src/renderer/index.html') }
      }
    },
    resolve: {
      alias: {
        '@': resolve(__dirname, 'src/renderer/src'),
        '@shared': resolve(__dirname, 'src/shared')
      }
    }
  }
});
