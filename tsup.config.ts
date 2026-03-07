import { defineConfig } from "tsup";

export default defineConfig([
  // Runtime entry (browser) — components, hooks, provider
  {
    entry: { index: "src/index.ts" },
    format: ["esm"],
    dts: true,
    sourcemap: true,
    clean: true,
    platform: "browser",
    external: ["solid-js"],
    jsxFactory: "h",
    esbuildOptions(options) {
      options.jsx = "preserve";
    },
  },
  // Vite plugin entry (node) — build-time translation
  {
    entry: { vite: "src/vite.ts" },
    format: ["esm"],
    dts: true,
    sourcemap: true,
    platform: "node",
    external: ["vite", "ai", "glob"],
  },
  // CLI entry (node) — npx solid-translate
  {
    entry: { cli: "src/cli.ts" },
    format: ["esm"],
    dts: false,
    sourcemap: false,
    platform: "node",
    external: ["ai", "glob", "@ai-sdk/*"],
    banner: {
      js: "#!/usr/bin/env node",
    },
  },
]);
