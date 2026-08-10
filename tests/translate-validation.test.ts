import { describe, test, expect, beforeEach, afterEach } from "bun:test";
import { mkdtempSync, rmSync, writeFileSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import {
  extractJsonObject,
  collectBatchTranslations,
} from "../src/translate";
import { syncLocaleFiles, type TranslateFn } from "../src/lock";
import { hashContent } from "../src/hash";
import type { LockFile } from "../src/types";

describe("extractJsonObject", () => {
  test("parses a bare JSON object", () => {
    expect(extractJsonObject('{"a": "b"}')).toEqual({ a: "b" });
  });

  test("strips markdown fences and prose", () => {
    const text = 'Here you go:\n```json\n{"a": "b"}\n```\nDone!';
    expect(extractJsonObject(text)).toEqual({ a: "b" });
  });

  test("throws when no object is present", () => {
    expect(() => extractJsonObject("sorry, I cannot help")).toThrow(
      /no JSON object/,
    );
  });

  test("throws on a JSON array", () => {
    // indexOf("{") only matches inside a nested object — a top-level array
    // with object items parses to the first item, which is an object; a pure
    // scalar array has no braces at all.
    expect(() => extractJsonObject("[1, 2, 3]")).toThrow();
  });
});

describe("collectBatchTranslations", () => {
  test("collects requested keys directly", () => {
    const { translations, missing } = collectBatchTranslations(
      { Hello: "Hola", Bye: "Adiós" },
      ["Hello", "Bye"],
    );
    expect(translations).toEqual({ Hello: "Hola", Bye: "Adiós" });
    expect(missing).toEqual([]);
  });

  test("unwraps a translations envelope", () => {
    const { translations, missing } = collectBatchTranslations(
      { translations: { Hello: "Hola" } },
      ["Hello"],
    );
    expect(translations).toEqual({ Hello: "Hola" });
    expect(missing).toEqual([]);
  });

  test("reports absent, empty, and non-string values as missing", () => {
    const { translations, missing } = collectBatchTranslations(
      { Hello: "Hola", Empty: "", Num: 42 as unknown as string },
      ["Hello", "Empty", "Num", "Absent"],
    );
    expect(translations).toEqual({ Hello: "Hola" });
    expect(missing).toEqual(["Empty", "Num", "Absent"]);
  });

  test("an empty object reports every key missing (Gemini regression)", () => {
    const { translations, missing } = collectBatchTranslations({}, [
      "Hello",
      "Bye",
    ]);
    expect(translations).toEqual({});
    expect(missing).toEqual(["Hello", "Bye"]);
  });

  test("drops extra keys the model invented", () => {
    const { translations } = collectBatchTranslations(
      { Hello: "Hola", Invented: "???" },
      ["Hello"],
    );
    expect(translations).toEqual({ Hello: "Hola" });
  });

  test("does not unwrap when 'translations' is itself a requested key", () => {
    const { translations, missing } = collectBatchTranslations(
      { translations: "traducciones" as unknown as string },
      ["translations"],
    );
    expect(translations).toEqual({ translations: "traducciones" });
    expect(missing).toEqual([]);
  });
});

describe("syncLocaleFiles self-heal", () => {
  let dir: string;

  const fakeTranslate: TranslateFn = async (batch, targetLocale) => {
    const out: Record<string, string> = {};
    for (const [key, value] of Object.entries(batch)) {
      out[key] = `${targetLocale}:${value.toUpperCase()}`;
    }
    return out;
  };

  const fullLock = (dict: Record<string, string>): LockFile => ({
    version: 1,
    sourceLocale: "en",
    keys: Object.fromEntries(
      Object.entries(dict).map(([key, value]) => [
        key,
        { hash: hashContent(value), source: value },
      ]),
    ),
  });

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), "st-heal-"));
  });

  afterEach(() => {
    rmSync(dir, { recursive: true, force: true });
  });

  test("translates keys missing from a target even when the lock is current", async () => {
    const source = { Hello: "Hello", Bye: "Bye" };
    writeFileSync(join(dir, "en.json"), JSON.stringify(source));
    // Lock says everything is translated (poisoned state) …
    writeFileSync(
      join(dir, ".solid-translate.lock"),
      JSON.stringify(fullLock(source)),
    );
    // … but the target file is empty.
    writeFileSync(join(dir, "es.json"), "{}");

    const result = await syncLocaleFiles({
      localesDir: dir,
      sourceLocale: "en",
      targetLocales: ["es"],
      batchSize: 50,
      translate: fakeTranslate,
    });

    expect(result.status).toBe("synced");
    expect(result.failures).toEqual([]);
    const es = JSON.parse(readFileSync(join(dir, "es.json"), "utf-8"));
    expect(es).toEqual({ Hello: "es:HELLO", Bye: "es:BYE" });
  });

  test("heals only the locale that is missing keys", async () => {
    const source = { Hello: "Hello" };
    writeFileSync(join(dir, "en.json"), JSON.stringify(source));
    writeFileSync(
      join(dir, ".solid-translate.lock"),
      JSON.stringify(fullLock(source)),
    );
    writeFileSync(join(dir, "es.json"), "{}");
    writeFileSync(
      join(dir, "fr.json"),
      JSON.stringify({ Hello: "fr:preexisting" }),
    );

    const calls: string[] = [];
    const trackingTranslate: TranslateFn = async (batch, locale) => {
      calls.push(locale);
      return fakeTranslate(batch, locale, {});
    };

    const result = await syncLocaleFiles({
      localesDir: dir,
      sourceLocale: "en",
      targetLocales: ["es", "fr"],
      batchSize: 50,
      translate: trackingTranslate,
    });

    expect(result.status).toBe("synced");
    expect(calls).toEqual(["es"]);
    const fr = JSON.parse(readFileSync(join(dir, "fr.json"), "utf-8"));
    expect(fr).toEqual({ Hello: "fr:preexisting" });
  });

  test("still reports no-changes when targets are complete", async () => {
    const source = { Hello: "Hello" };
    writeFileSync(join(dir, "en.json"), JSON.stringify(source));
    writeFileSync(
      join(dir, ".solid-translate.lock"),
      JSON.stringify(fullLock(source)),
    );
    writeFileSync(join(dir, "es.json"), JSON.stringify({ Hello: "Hola" }));

    const result = await syncLocaleFiles({
      localesDir: dir,
      sourceLocale: "en",
      targetLocales: ["es"],
      batchSize: 50,
      translate: async () => {
        throw new Error("translate should not have been called");
      },
    });

    expect(result.status).toBe("no-changes");
  });

  test("a failed heal keeps the missing state for the next run", async () => {
    const source = { Hello: "Hello" };
    writeFileSync(join(dir, "en.json"), JSON.stringify(source));
    const lock = fullLock(source);
    writeFileSync(join(dir, ".solid-translate.lock"), JSON.stringify(lock));
    writeFileSync(join(dir, "es.json"), "{}");

    const result = await syncLocaleFiles({
      localesDir: dir,
      sourceLocale: "en",
      targetLocales: ["es"],
      batchSize: 50,
      translate: async () => {
        throw new Error("provider down");
      },
    });

    expect(result.failures.length).toBe(1);
    const es = JSON.parse(readFileSync(join(dir, "es.json"), "utf-8"));
    expect(es).toEqual({});
    // Lock entry is untouched, and the key is still detected as missing next run
    const relock = JSON.parse(
      readFileSync(join(dir, ".solid-translate.lock"), "utf-8"),
    );
    expect(relock.keys.Hello).toEqual(lock.keys.Hello);
  });
});
