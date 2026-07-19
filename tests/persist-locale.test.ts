import { describe, test, expect, beforeEach } from "bun:test";
import { createRoot, createComponent } from "solid-js";
import {
  TranslationProvider,
  useTranslation,
  type TranslationProviderProps,
  type TranslationContextValue,
} from "../src/index";

const DEFAULT_KEY = "solid-translate:locale";

function createProvider(props: Omit<TranslationProviderProps, "children">): {
  ctx: TranslationContextValue;
  dispose: () => void;
} {
  let ctx!: TranslationContextValue;
  const dispose = createRoot((d) => {
    createComponent(TranslationProvider, {
      ...props,
      get children() {
        ctx = useTranslation();
        return null;
      },
    });
    return d;
  });
  return { ctx, dispose };
}

const translations = {
  en: { "Hello world": "Hello world" },
  es: { "Hello world": "Hola mundo" },
};

describe("persistLocale", () => {
  beforeEach(() => {
    localStorage.clear();
  });

  test("disabled by default — setLocale does not write storage", () => {
    const { ctx, dispose } = createProvider({ translations });
    ctx.setLocale("es");
    expect(localStorage.getItem(DEFAULT_KEY)).toBeNull();
    dispose();
  });

  test("valid persisted locale wins over detection", () => {
    localStorage.setItem(DEFAULT_KEY, "es");
    const { ctx, dispose } = createProvider({
      translations,
      persistLocale: true,
    });
    expect(ctx.locale()).toBe("es");
    dispose();
  });

  test("invalid persisted locale falls back to detection", () => {
    localStorage.setItem(DEFAULT_KEY, "xx");
    const { ctx, dispose } = createProvider({
      translations,
      persistLocale: true,
    });
    expect(ctx.locale()).not.toBe("xx");
    expect(["en", "es"]).toContain(ctx.locale());
    dispose();
  });

  test("explicit locale prop takes precedence over persisted value", () => {
    localStorage.setItem(DEFAULT_KEY, "es");
    const { ctx, dispose } = createProvider({
      translations,
      locale: "en",
      persistLocale: true,
    });
    expect(ctx.locale()).toBe("en");
    dispose();
  });

  test("setLocale writes through to storage", () => {
    const { ctx, dispose } = createProvider({
      translations,
      locale: "en",
      persistLocale: true,
    });
    ctx.setLocale("es");
    expect(localStorage.getItem(DEFAULT_KEY)).toBe("es");
    expect(ctx.locale()).toBe("es");
    dispose();
  });

  test("supports a custom storage key", () => {
    localStorage.setItem("my-app:locale", "es");
    const { ctx, dispose } = createProvider({
      translations,
      persistLocale: { key: "my-app:locale" },
    });
    expect(ctx.locale()).toBe("es");
    ctx.setLocale("en");
    expect(localStorage.getItem("my-app:locale")).toBe("en");
    expect(localStorage.getItem(DEFAULT_KEY)).toBeNull();
    dispose();
  });

  test("persisted source locale is accepted even without a dict entry", () => {
    localStorage.setItem(DEFAULT_KEY, "en");
    const { ctx, dispose } = createProvider({
      translations: { es: { "Hello world": "Hola mundo" } },
      sourceLocale: "en",
      persistLocale: true,
    });
    expect(ctx.locale()).toBe("en");
    dispose();
  });
});
