import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { defineConfig, loadEnv, type Plugin } from "vite";
import react from "@vitejs/plugin-react";

const currentDir = path.dirname(fileURLToPath(import.meta.url));

function configureExtensionManifest(
  googleClientId: string,
  extensionPublicKey: string,
  backendUrl: string
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

      if (extensionPublicKey) {
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
        env.VITE_BACKEND_BASE_URL?.trim() ?? ""
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
