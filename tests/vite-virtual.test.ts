import { describe, test, expect, afterAll } from "bun:test";
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { solidTranslate } from "../src/vite";

const dirs: string[] = [];

afterAll(() => {
  for (const dir of dirs) {
    rmSync(dir, { recursive: true, force: true });
  }
});

function makePlugin(locales: Record<string, Record<string, string>>) {
  const root = mkdtempSync(join(tmpdir(), "st-vite-"));
  dirs.push(root);
  const localesDir = join(root, "locales");
  mkdirSync(localesDir, { recursive: true });
  for (const [locale, dict] of Object.entries(locales)) {
    writeFileSync(join(localesDir, `${locale}.json`), JSON.stringify(dict));
  }

  const plugin: any = solidTranslate({
    sourceLocale: "en",
    targetLocales: ["es", "fr"],
    localesDir: "./locales",
    model: null as any,
  });
  plugin.configResolved({ root });
  return plugin;
}

describe("virtual modules", () => {
  test("eager module resolves and inlines all locales", () => {
    const plugin = makePlugin({
      en: { Hello: "Hello" },
      es: { Hello: "Hola" },
    });
    const resolved = plugin.resolveId("virtual:solid-translate");
    expect(resolved).toBe("\0virtual:solid-translate");
    const code = plugin.load(resolved);
    expect(code).toContain('"es":{"Hello":"Hola"}');
    expect(code).toContain('"en":{"Hello":"Hello"}');
  });

  test("lazy module exports manifest with per-locale dynamic imports", () => {
    const plugin = makePlugin({ en: { Hello: "Hello" } });
    const resolved = plugin.resolveId("virtual:solid-translate/lazy");
    expect(resolved).toBe("\0virtual:solid-translate/lazy");
    const code = plugin.load(resolved);
    expect(code).toContain('export const sourceLocale = "en";');
    expect(code).toContain('export const locales = ["en","es","fr"];');
    expect(code).toContain(
      'import("virtual:solid-translate/locale/es")',
    );
    expect(code).toContain(
      'import("virtual:solid-translate/locale/fr")',
    );
    expect(code).toContain(
      "export default { sourceLocale, locales, loaders };",
    );
  });

  test("per-locale module serves a single dictionary", () => {
    const plugin = makePlugin({
      en: { Hello: "Hello" },
      es: { Hello: "Hola" },
    });
    const resolved = plugin.resolveId("virtual:solid-translate/locale/es");
    expect(resolved).toBe("\0virtual:solid-translate/locale/es");
    const code = plugin.load(resolved);
    expect(code).toBe('export default {"Hello":"Hola"};');
  });

  test("per-locale module for a missing file serves an empty dict", () => {
    const plugin = makePlugin({ en: { Hello: "Hello" } });
    const code = plugin.load("\0virtual:solid-translate/locale/fr");
    expect(code).toBe("export default {};");
  });

  test("path-unsafe locale ids are not resolved", () => {
    const plugin = makePlugin({ en: { Hello: "Hello" } });
    expect(
      plugin.resolveId("virtual:solid-translate/locale/../../etc/passwd"),
    ).toBeUndefined();
    expect(
      plugin.resolveId("virtual:solid-translate/locale/es/extra"),
    ).toBeUndefined();
  });
});

describe("serve-only mode (translate: false)", () => {
  test("buildStart is a no-op: no model needed, no files written", async () => {
    const root = mkdtempSync(join(tmpdir(), "st-vite-serve-"));
    dirs.push(root);
    const localesDir = join(root, "locales");
    mkdirSync(localesDir, { recursive: true });
    writeFileSync(join(localesDir, "en.json"), JSON.stringify({ Hello: "Hello" }));

    const plugin: any = solidTranslate({
      sourceLocale: "en",
      targetLocales: ["es"],
      localesDir: "./locales",
      translate: false,
    });
    plugin.configResolved({ root });
    // Must not throw despite a stale/absent lock and no model
    await plugin.buildStart();
    // Virtual modules still serve the committed files
    const resolved = plugin.resolveId("virtual:solid-translate");
    expect(plugin.load(resolved)).toContain("Hola" === "Hola" ? "Hello" : "");
    // No lock or target files were created
    const { existsSync } = await import("node:fs");
    expect(existsSync(join(localesDir, ".solid-translate.lock"))).toBe(false);
    expect(existsSync(join(localesDir, "es.json"))).toBe(false);
  });

  test("translating mode without model throws a clear error", async () => {
    const root = mkdtempSync(join(tmpdir(), "st-vite-nomodel-"));
    dirs.push(root);
    const localesDir = join(root, "locales");
    mkdirSync(localesDir, { recursive: true });
    writeFileSync(join(localesDir, "en.json"), JSON.stringify({ Hello: "Hello" }));

    const plugin: any = solidTranslate({
      sourceLocale: "en",
      targetLocales: ["es"],
      localesDir: "./locales",
    });
    plugin.configResolved({ root });
    await expect(plugin.buildStart()).rejects.toThrow(/model.*required/);
  });
});
