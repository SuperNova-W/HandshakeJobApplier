import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { defineConfig, loadEnv, type Plugin } from "vite";
import react from "@vitejs/plugin-react";

const currentDir = path.dirname(fileURLToPath(import.meta.url));

function configureExtensionManifest(
  googleClientId: string,
  extensionPublicKey: string,
  backendUrl: string,
  storeBuild: boolean
): Plugin {
  return {
    name: "configure-extension-manifest",
    closeBundle() {
      const manifestPath = path.resolve(currentDir, "dist/manifest.json");
      const manifest = JSON.parse(fs.readFileSync(manifestPath, "utf8")) as {
        oauth2?: { client_id?: string };
        key?: string;
        host_permissions?: string[];
      };

      if (googleClientId) {
        if (!manifest.oauth2) manifest.oauth2 = {};
        manifest.oauth2.client_id = googleClientId;
      } else {
        console.warn(
          "Google auth is not configured. Set GOOGLE_OAUTH_CLIENT_ID in frontend/.env.local."
        );
      }

      // The Chrome Web Store rejects uploads whose manifest contains a "key"
      // field (the published item already owns the extension ID), and the
      // public build shouldn't ask for the localhost dev permission. Store
      // builds (`npm run build:store`) therefore skip the key and drop
      // 127.0.0.1 from host_permissions.
      if (storeBuild) {
        delete manifest.key;
        manifest.host_permissions = (manifest.host_permissions ?? []).filter(
          (permission) => !permission.startsWith("http://127.0.0.1")
        );
        if (!backendUrl || /127\.0\.0\.1|localhost/.test(backendUrl)) {
          console.warn(
            "⚠️  Store build without a deployed VITE_BACKEND_BASE_URL — the published " +
              "extension would look for a backend on the user's own machine."
          );
        }
      } else if (extensionPublicKey) {
        manifest.key = extensionPublicKey;
      }

      if (backendUrl) {
        const backendPermission = `${new URL(backendUrl).origin}/*`;
        manifest.host_permissions = Array.from(
          new Set([...(manifest.host_permissions ?? []), backendPermission])
        );
      }

      fs.writeFileSync(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`);
    }
  };
}

export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, currentDir, "");

  return {
    plugins: [
      react(),
      configureExtensionManifest(
        env.GOOGLE_OAUTH_CLIENT_ID?.trim() ?? "",
        env.GOOGLE_EXTENSION_PUBLIC_KEY?.replace(/\s+/g, "") ?? "",
        env.VITE_BACKEND_BASE_URL?.trim() ?? "",
        mode === "store"
      )
    ],
    build: {
      outDir: "dist",
      emptyOutDir: true,
      rollupOptions: {
        input: {
          popup: path.resolve(currentDir, "popup.html"),
          options: path.resolve(currentDir, "options.html"),
          background: path.resolve(currentDir, "src/background/index.ts")
        },
        output: {
          entryFileNames: "assets/[name].js",
          chunkFileNames: "assets/[name].js",
          assetFileNames: "assets/[name][extname]"
        }
      }
    }
  };
});
