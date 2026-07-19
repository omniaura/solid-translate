import { describe, test, expect, beforeEach, afterEach } from "bun:test";
import { detectLocale } from "../src/locale-detect";

describe("detectLocale", () => {
  const originalNavigator = globalThis.navigator;

  function mockNavigator(languages: string[], language?: string) {
    Object.defineProperty(globalThis, "navigator", {
      value: { languages, language: language || languages[0] },
      writable: true,
      configurable: true,
    });
  }

  afterEach(() => {
    Object.defineProperty(globalThis, "navigator", {
      value: originalNavigator,
      writable: true,
      configurable: true,
    });
  });

  test("returns exact match from available locales", () => {
    mockNavigator(["es", "en"]);
    expect(detectLocale(["en", "es", "fr"])).toBe("es");
  });

  test("falls back to language-only match", () => {
    mockNavigator(["en-US", "fr-FR"]);
    expect(detectLocale(["en", "fr", "de"])).toBe("en");
  });

  test("returns first available locale if no match", () => {
    mockNavigator(["zh", "ja"]);
    expect(detectLocale(["en", "es"])).toBe("en");
  });

  test("returns browser locale if no available locales", () => {
    mockNavigator(["fr"]);
    expect(detectLocale()).toBe("fr");
  });

  test("returns 'en' when navigator is undefined", () => {
    Object.defineProperty(globalThis, "navigator", {
      value: undefined,
      writable: true,
      configurable: true,
    });
    expect(detectLocale(["en", "es"])).toBe("en");
  });

  test("handles navigator.language fallback", () => {
    Object.defineProperty(globalThis, "navigator", {
      value: { languages: undefined, language: "de" },
      writable: true,
      configurable: true,
    });
    expect(detectLocale(["en", "de"])).toBe("de");
  });

  test("normalizes locale codes", () => {
    mockNavigator(["EN-US"]);
    expect(detectLocale(["en-us", "fr"])).toBe("en-us");
  });

  test("matches mixed-case available locales case-insensitively", () => {
    mockNavigator(["pt-br"]);
    expect(detectLocale(["en", "pt-BR"])).toBe("pt-BR");
  });

  test("returns canonical casing from availableLocales, not the browser's", () => {
    mockNavigator(["PT-BR"]);
    expect(detectLocale(["en", "pt-BR"])).toBe("pt-BR");
  });

  test("language-only match is case-insensitive with canonical casing", () => {
    mockNavigator(["FR-CA"]);
    expect(detectLocale(["en", "FR"])).toBe("FR");
  });

  test("normalizes underscores against mixed-case available locales", () => {
    mockNavigator(["pt_BR"]);
    expect(detectLocale(["en", "pt-BR"])).toBe("pt-BR");
  });
});
