import { defineConfig } from "tsup";
import { transformAsync } from "@babel/core";
import solid from "@solidjs/babel-plugin";
import { readFile } from "node:fs/promises";

export default defineConfig([
  // Compile runtime JSX with the Solid 2 compiler so consumers can use the
  // published plain JS without compiling dependencies themselves.
  {
    entry: { index: "src/index.ts" },
    format: ["esm"],
    dts: true,
    sourcemap: true,
    clean: true,
    platform: "browser",
    external: ["solid-js", "@solidjs/web"],
    esbuildPlugins: [{
      name: "solid-2",
      setup(build) {
        build.onLoad({ filter: /\.tsx$/ }, async ({ path }) => {
          const result = await transformAsync(await readFile(path, "utf8"), {
            filename: path,
            plugins: [[solid, { generate: "dom" }]],
            presets: [["@babel/preset-typescript", { allExtensions: true, isTSX: true }]],
            sourceMaps: "inline",
          });
          return { contents: result!.code!, loader: "js" };
        });
      },
    }],
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
