import { describe, test, expect } from "bun:test";
import { createRoot, createComponent } from "solid-js";
import {
  TranslationProvider,
  useTranslation,
  type TranslationProviderProps,
  type TranslationContextValue,
  type LazyTranslations,
} from "../src/index";

/** Mount a TranslationProvider and capture its context value */
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

/** Flush pending microtasks / loader promises */
function tick(): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, 0));
}

function makeManifest(overrides?: Partial<LazyTranslations>): {
  manifest: LazyTranslations;
  resolveEs: (dict: Record<string, string>) => void;
  esLoadCount: () => number;
} {
  let resolveEs!: (dict: Record<string, string>) => void;
  const esPromise = new Promise<Record<string, string>>((r) => {
    resolveEs = r;
  });
  let loads = 0;
  const manifest: LazyTranslations = {
    sourceLocale: "en",
    locales: ["en", "es"],
    loaders: {
      es: () => {
        loads++;
        return esPromise;
      },
    },
    ...overrides,
  };
  return { manifest, resolveEs, esLoadCount: () => loads };
}

describe("TranslationProvider with lazy manifest", () => {
  test("source locale renders immediately without any dict", () => {
    const { manifest } = makeManifest();
    const { ctx, dispose } = createProvider({
      locale: "en",
      translations: manifest,
    });
    expect(ctx.t("Hello world")).toBe("Hello world");
    expect(ctx.t("Hello {{name}}", { name: "Alice" })).toBe("Hello Alice");
    dispose();
  });

  test("availableLocales derives from manifest.locales", () => {
    const { manifest } = makeManifest();
    const { ctx, dispose } = createProvider({
      locale: "en",
      translations: manifest,
    });
    expect(ctx.availableLocales()).toEqual(["en", "es"]);
    expect(ctx.sourceLocale).toBe("en");
    dispose();
  });

  test("switching locale falls back to source text while pending, then swaps", async () => {
    const { manifest, resolveEs } = makeManifest();
    const { ctx, dispose } = createProvider({
      locale: "en",
      translations: manifest,
    });

    ctx.setLocale("es");
    // Loader still pending — never throw, never suspend, show source text
    expect(ctx.locale()).toBe("es");
    expect(ctx.t("Hello world")).toBe("Hello world");

    resolveEs({ "Hello world": "Hola mundo" });
    await tick();
    expect(ctx.t("Hello world")).toBe("Hola mundo");
    dispose();
  });

  test("initial non-source locale starts loading on mount", async () => {
    const { manifest, resolveEs, esLoadCount } = makeManifest();
    const { ctx, dispose } = createProvider({
      locale: "es",
      translations: manifest,
    });

    expect(esLoadCount()).toBe(1);
    expect(ctx.t("Hello world")).toBe("Hello world");

    resolveEs({ "Hello world": "Hola mundo" });
    await tick();
    expect(ctx.t("Hello world")).toBe("Hola mundo");
    dispose();
  });

  test("loaded dicts are cached — loader runs once per locale", async () => {
    const { manifest, resolveEs, esLoadCount } = makeManifest();
    const { ctx, dispose } = createProvider({
      locale: "en",
      translations: manifest,
    });

    ctx.setLocale("es");
    ctx.setLocale("es");
    resolveEs({ "Hello world": "Hola mundo" });
    await tick();
    ctx.setLocale("en");
    ctx.setLocale("es");
    expect(esLoadCount()).toBe(1);
    expect(ctx.t("Hello world")).toBe("Hola mundo");
    dispose();
  });

  test("loader failure falls back to source text without throwing", async () => {
    const manifest: LazyTranslations = {
      sourceLocale: "en",
      locales: ["en", "es"],
      loaders: {
        es: () => Promise.reject(new Error("network down")),
      },
    };
    const { ctx, dispose } = createProvider({
      locale: "en",
      translations: manifest,
    });

    ctx.setLocale("es");
    await tick();
    expect(ctx.locale()).toBe("es");
    expect(ctx.t("Hello world")).toBe("Hello world");
    dispose();
  });

  test("sourceLocale defaults from the manifest", () => {
    const manifest: LazyTranslations = {
      sourceLocale: "fr",
      locales: ["fr", "es"],
      loaders: { es: () => Promise.resolve({}) },
    };
    const { ctx, dispose } = createProvider({
      locale: "fr",
      translations: manifest,
    });
    expect(ctx.sourceLocale).toBe("fr");
    dispose();
  });

  test("eager translations record still works unchanged", () => {
    const { ctx, dispose } = createProvider({
      locale: "es",
      translations: { es: { "Hello world": "Hola mundo" } },
    });
    expect(ctx.t("Hello world")).toBe("Hola mundo");
    expect(ctx.availableLocales()).toEqual(["es"]);
    dispose();
  });
});
