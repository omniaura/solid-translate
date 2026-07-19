import { describe, test, expect, beforeEach, afterEach } from "bun:test";
import { mkdtempSync, rmSync, writeFileSync, readFileSync, existsSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { diffLock, syncLocaleFiles, type TranslateFn } from "../src/lock";
import { hashContent } from "../src/hash";
import type { LockFile } from "../src/types";

/** Fake translator: uppercases values, tagging them with the locale */
const fakeTranslate: TranslateFn = async (batch, targetLocale) => {
  const out: Record<string, string> = {};
  for (const [key, value] of Object.entries(batch)) {
    out[key] = `${targetLocale}:${value.toUpperCase()}`;
  }
  return out;
};

/** Translator that must never be called (deletion-only paths) */
const forbiddenTranslate: TranslateFn = async () => {
  throw new Error("translate should not have been called");
};

describe("diffLock", () => {
  const emptyLock = (): LockFile => ({
    version: 1,
    sourceLocale: "en",
    keys: {},
  });

  test("marks new keys as changed", () => {
    const diff = diffLock({ hello: "Hello" }, emptyLock());
    expect(diff.changedKeys).toEqual({ hello: "Hello" });
    expect(diff.pendingEntries.hello).toEqual({
      hash: hashContent("Hello"),
      source: "Hello",
    });
    expect(diff.deletedKeys).toEqual([]);
  });

  test("skips unchanged keys", () => {
    const lock = emptyLock();
    lock.keys.hello = { hash: hashContent("Hello"), source: "Hello" };
    const diff = diffLock({ hello: "Hello" }, lock);
    expect(diff.changedKeys).toEqual({});
    expect(diff.deletedKeys).toEqual([]);
  });

  test("marks content changes as changed", () => {
    const lock = emptyLock();
    lock.keys.hello = { hash: hashContent("Hello"), source: "Hello" };
    const diff = diffLock({ hello: "Hello!" }, lock);
    expect(diff.changedKeys).toEqual({ hello: "Hello!" });
  });

  test("reports deleted keys", () => {
    const lock = emptyLock();
    lock.keys.gone = { hash: hashContent("Gone"), source: "Gone" };
    const diff = diffLock({}, lock);
    expect(diff.changedKeys).toEqual({});
    expect(diff.deletedKeys).toEqual(["gone"]);
  });

  test("does not mutate the lock", () => {
    const lock = emptyLock();
    diffLock({ hello: "Hello" }, lock);
    expect(lock.keys).toEqual({});
  });

  test("with contexts: context change marks key as changed", () => {
    const lock = emptyLock();
    lock.keys.save = {
      hash: hashContent("Save"),
      source: "Save",
      context: "Button to save a document",
    };
    const diff = diffLock({ save: "Save" }, lock, {
      save: "Verb: to save money",
    });
    expect(diff.changedKeys).toEqual({ save: "Save" });
    expect(diff.pendingEntries.save!.context).toBe("Verb: to save money");
  });

  test("with contexts: unchanged context is not re-translated", () => {
    const lock = emptyLock();
    lock.keys.save = {
      hash: hashContent("Save"),
      source: "Save",
      context: "Button to save a document",
    };
    const diff = diffLock({ save: "Save" }, lock, {
      save: "Button to save a document",
    });
    expect(diff.changedKeys).toEqual({});
  });

  test("without contexts (CLI): existing context is preserved, not treated as changed", () => {
    const lock = emptyLock();
    lock.keys.save = {
      hash: hashContent("Save"),
      source: "Save",
      context: "Button to save a document",
    };
    const diff = diffLock({ save: "Save" }, lock);
    expect(diff.changedKeys).toEqual({});
  });

  test("without contexts (CLI): changed key carries existing context forward", () => {
    const lock = emptyLock();
    lock.keys.save = {
      hash: hashContent("Save"),
      source: "Save",
      context: "Button to save a document",
    };
    const diff = diffLock({ save: "Save changes" }, lock);
    expect(diff.pendingEntries.save!.context).toBe(
      "Button to save a document",
    );
  });
});

describe("syncLocaleFiles", () => {
  let dir: string;

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), "solid-translate-lock-"));
  });

  afterEach(() => {
    rmSync(dir, { recursive: true, force: true });
  });

  function writeSource(dict: Record<string, string>) {
    writeFileSync(join(dir, "en.json"), JSON.stringify(dict, null, 2) + "\n");
  }

  function readJSON(name: string): any {
    return JSON.parse(readFileSync(join(dir, name), "utf-8"));
  }

  function sync(
    translate: TranslateFn,
    overrides: Partial<Parameters<typeof syncLocaleFiles>[0]> = {},
  ) {
    return syncLocaleFiles({
      localesDir: dir,
      sourceLocale: "en",
      targetLocales: ["es"],
      batchSize: 50,
      translate,
      ...overrides,
    });
  }

  test("returns no-source when source file is missing", async () => {
    const result = await sync(forbiddenTranslate);
    expect(result.status).toBe("no-source");
  });

  test("translates new keys and records them in the lock", async () => {
    writeSource({ hello: "Hello", bye: "Bye" });
    const result = await sync(fakeTranslate);

    expect(result.status).toBe("synced");
    expect(result.failures).toEqual([]);
    expect(result.translatedKeys.sort()).toEqual(["bye", "hello"]);
    expect(readJSON("es.json")).toEqual({
      hello: "es:HELLO",
      bye: "es:BYE",
    });
    const lock: LockFile = readJSON(".solid-translate.lock");
    expect(Object.keys(lock.keys).sort()).toEqual(["bye", "hello"]);

    // Second run: no changes
    const second = await sync(forbiddenTranslate);
    expect(second.status).toBe("no-changes");
  });

  test("failed batch does not poison the lock and is retried on rerun", async () => {
    writeSource({ hello: "Hello" });

    const failing: TranslateFn = async () => {
      throw new Error("missing API key");
    };
    const result = await sync(failing);

    expect(result.status).toBe("synced");
    expect(result.failures).toHaveLength(1);
    expect(result.failures[0]!.locale).toBe("es");
    expect(result.failures[0]!.keys).toEqual(["hello"]);
    expect(result.translatedKeys).toEqual([]);

    // Target file has no translation, and the lock must NOT claim it does
    expect(readJSON("es.json")).toEqual({});
    const lock: LockFile = readJSON(".solid-translate.lock");
    expect(lock.keys).toEqual({});

    // Rerun with a working translator picks the key back up (no silent
    // "No changes detected" corruption)
    const retry = await sync(fakeTranslate);
    expect(retry.status).toBe("synced");
    expect(retry.translatedKeys).toEqual(["hello"]);
    expect(readJSON("es.json")).toEqual({ hello: "es:HELLO" });
  });

  test("per-batch failure: successful batches are written, failed keys excluded from lock", async () => {
    writeSource({ a: "Alpha", b: "Bravo" });

    // batchSize 1 → two batches; fail only the batch containing "b"
    const partial: TranslateFn = async (batch, targetLocale) => {
      if ("b" in batch) throw new Error("rate limited");
      return fakeTranslate(batch, targetLocale, {});
    };
    const result = await sync(partial, { batchSize: 1 });

    expect(result.failures).toHaveLength(1);
    expect(result.failures[0]!.keys).toEqual(["b"]);
    expect(result.translatedKeys).toEqual(["a"]);
    expect(readJSON("es.json")).toEqual({ a: "es:ALPHA" });
    const lock: LockFile = readJSON(".solid-translate.lock");
    expect(Object.keys(lock.keys)).toEqual(["a"]);
  });

  test("key failing in one locale is excluded from lock even if another locale succeeded", async () => {
    writeSource({ hello: "Hello" });

    const failFrOnly: TranslateFn = async (batch, targetLocale) => {
      if (targetLocale === "fr") throw new Error("boom");
      return fakeTranslate(batch, targetLocale, {});
    };
    const result = await sync(failFrOnly, { targetLocales: ["es", "fr"] });

    expect(result.failures).toHaveLength(1);
    expect(result.failures[0]!.locale).toBe("fr");
    expect(result.translatedKeys).toEqual([]);

    // es got its translation written, but the lock records nothing so both
    // locales retry the key next run
    expect(readJSON("es.json")).toEqual({ hello: "es:HELLO" });
    expect(readJSON("fr.json")).toEqual({});
    const lock: LockFile = readJSON(".solid-translate.lock");
    expect(lock.keys).toEqual({});
  });

  test("deletion-only change prunes target files and lock without AI calls", async () => {
    // Seed: translate two keys normally
    writeSource({ hello: "Hello", bye: "Bye" });
    await sync(fakeTranslate);

    // Delete one key from source; translator must not be called
    writeSource({ hello: "Hello" });
    const result = await sync(forbiddenTranslate);

    expect(result.status).toBe("synced");
    expect(result.deletedKeys).toEqual(["bye"]);
    expect(result.failures).toEqual([]);
    expect(readJSON("es.json")).toEqual({ hello: "es:HELLO" });
    const lock: LockFile = readJSON(".solid-translate.lock");
    expect(Object.keys(lock.keys)).toEqual(["hello"]);

    // And the run after that is a clean no-op
    const third = await sync(forbiddenTranslate);
    expect(third.status).toBe("no-changes");
  });

  test("deleting every source key prunes everything", async () => {
    writeSource({ hello: "Hello" });
    await sync(fakeTranslate);

    writeSource({});
    const result = await sync(forbiddenTranslate);
    expect(result.deletedKeys).toEqual(["hello"]);
    expect(readJSON("es.json")).toEqual({});
    const lock: LockFile = readJSON(".solid-translate.lock");
    expect(lock.keys).toEqual({});
  });

  test("CLI/vite lock parity: CLI-style run preserves context written by vite-style run", async () => {
    // Vite-style run with autoExtract contexts
    writeSource({ save: "Save" });
    await sync(fakeTranslate, {
      contexts: { save: "Button to save a document" },
    });
    let lock: LockFile = readJSON(".solid-translate.lock");
    expect(lock.keys.save!.context).toBe("Button to save a document");

    // CLI-style run (no contexts) sees no changes — no re-translation churn
    const cliRun = await sync(forbiddenTranslate);
    expect(cliRun.status).toBe("no-changes");

    // CLI-style run after a source edit keeps the context in the lock
    writeSource({ save: "Save changes" });
    await sync(fakeTranslate);
    lock = readJSON(".solid-translate.lock");
    expect(lock.keys.save!.context).toBe("Button to save a document");
    expect(lock.keys.save!.source).toBe("Save changes");

    // Vite-style run with the same context again: still no changes
    const viteRun = await sync(forbiddenTranslate, {
      contexts: { save: "Button to save a document" },
    });
    expect(viteRun.status).toBe("no-changes");
  });

  test("passes context hints for changed keys to the translator", async () => {
    writeSource({ save: "Save" });
    let seenContexts: Record<string, string> | undefined;
    const capture: TranslateFn = async (batch, targetLocale, contexts) => {
      seenContexts = contexts;
      return fakeTranslate(batch, targetLocale, contexts);
    };
    await sync(capture, { contexts: { save: "Button label" } });
    expect(seenContexts).toEqual({ save: "Button label" });
  });

  test("recovers from a corrupted lock file", async () => {
    writeSource({ hello: "Hello" });
    writeFileSync(join(dir, ".solid-translate.lock"), "not json{");
    const result = await sync(fakeTranslate);
    expect(result.status).toBe("synced");
    expect(result.translatedKeys).toEqual(["hello"]);
    expect(existsSync(join(dir, "es.json"))).toBe(true);
  });
});
