import { defineConfig } from "vite";
import solid from "@solidjs/vite-plugin";
import { solidTranslate } from "../../dist/vite.js";

export default defineConfig({
  plugins: [solid(), solidTranslate({
    sourceLocale: "en",
    targetLocales: ["es"],
    localesDir: "./locales",
    translate: false,
  })],
});
