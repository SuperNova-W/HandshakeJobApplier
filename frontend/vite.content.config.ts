import path from "node:path";
import { fileURLToPath } from "node:url";
import { defineConfig } from "vite";

const currentDir = path.dirname(fileURLToPath(import.meta.url));

// Chrome content scripts declared in the manifest run as classic scripts, not
// ES modules, so they cannot contain `import` statements. We build the content
// script in its own pass as a single self-contained IIFE bundle, which inlines
// every dependency (e.g. the shared handshake helpers) instead of splitting them
// into a separate chunk. Runs after the main build with emptyOutDir disabled so
// it only appends assets/content.js to dist/.
export default defineConfig({
  build: {
    outDir: "dist",
    emptyOutDir: false,
    copyPublicDir: false,
    rollupOptions: {
      input: {
        content: path.resolve(currentDir, "src/content/index.ts")
      },
      output: {
        format: "iife",
        entryFileNames: "assets/content.js",
        assetFileNames: "assets/[name][extname]"
      }
    }
  }
});
