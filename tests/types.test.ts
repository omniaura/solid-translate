import { describe, test, expect } from "bun:test";
import type {
  SolidTranslatePluginConfig,
  TranslationDictionary,
  Translations,
  LockFile,
  LockFileEntry,
  CLIConfig,
} from "../src/types";

describe("types", () => {
  test("TranslationDictionary is a string record", () => {
    const dict: TranslationDictionary = {
      greeting: "Hola",
      farewell: "Adiós",
    };
    expect(dict["greeting"]).toBe("Hola");
  });

  test("Translations maps locales to dictionaries", () => {
    const translations: Translations = {
      es: { greeting: "Hola" },
      fr: { greeting: "Bonjour" },
    };
    expect(translations["es"]!["greeting"]).toBe("Hola");
    expect(translations["fr"]!["greeting"]).toBe("Bonjour");
  });

  test("LockFile has correct shape", () => {
    const entry: LockFileEntry = {
      hash: "abc123",
      source: "Hello",
    };
    const lock: LockFile = {
      version: 1,
      sourceLocale: "en",
      keys: { greeting: entry },
    };
    expect(lock.version).toBe(1);
    expect(lock.keys["greeting"]!.hash).toBe("abc123");
  });

  test("LockFileEntry supports optional context", () => {
    const entry: LockFileEntry = {
      hash: "abc123",
      source: "Save",
      context: "Save a document to disk",
    };
    expect(entry.context).toBe("Save a document to disk");
  });

  test("CLIConfig has correct shape", () => {
    const config: CLIConfig = {
      sourceLocale: "en",
      targetLocales: ["es", "fr"],
      localesDir: "./locales",
      provider: "openai",
      model: "gpt-4o-mini",
      batchSize: 50,
      files: {
        json: { include: ["i18n/[locale]/*.json"] },
        md: { include: ["docs/[locale]/**/*.md"] },
        mdx: { include: [] },
      },
      include: ["src/**/*.tsx"],
    };
    expect(config.targetLocales).toHaveLength(2);
    expect(config.files?.json?.include).toHaveLength(1);
  });
});
