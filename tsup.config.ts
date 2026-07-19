import { defineConfig } from "tsup";
import { solidPlugin } from "esbuild-plugin-solid";

export default defineConfig([
  // Runtime entry (browser) — components, hooks, provider.
  // JSX is compiled with babel-preset-solid so dist ships plain JS that any
  // bundler (or node) can parse — consumers must NOT need vite-plugin-solid
  // configured to compile our package.
  {
    entry: { index: "src/index.ts" },
    format: ["esm"],
    dts: true,
    sourcemap: true,
    clean: true,
    platform: "browser",
    external: ["solid-js", "solid-js/web"],
    esbuildPlugins: [solidPlugin()],
  },
  // Vite plugin entry (node) — build-time translation
  {
    entry: { vite: "src/vite.ts" },
    format: ["esm"],
    dts: true,
    sourcemap: true,
    platform: "node",
    external: ["vite", "ai", "glob"],
    noExternal: ["@babel/parser"],
  },
  // CLI entry (node) — npx solid-translate
  {
    entry: { cli: "src/cli.ts" },
    format: ["esm"],
    dts: false,
    sourcemap: false,
    platform: "node",
    external: ["ai", "glob", "@ai-sdk/*"],
    noExternal: ["@babel/parser"],
    banner: {
      js: "#!/usr/bin/env node",
    },
  },
]);
