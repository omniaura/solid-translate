import { describe, test, expect } from "bun:test";
import type {
  SolidTranslatePluginConfig,
  TranslationDictionary,
  Translations,
  LockFile,
  LockFileEntry,
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
});
