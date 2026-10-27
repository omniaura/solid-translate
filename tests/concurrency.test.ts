import { test, expect } from "bun:test";
import { mkdtempSync, writeFileSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { syncLocaleFiles } from "../src/lock";

test("a global pool overlaps locales/batches, caps requests, and preserves failure lock semantics", async () => {
  const localesDir = mkdtempSync(join(tmpdir(), "translate-pool-"));
  try {
    writeFileSync(join(localesDir, "en.json"), JSON.stringify({ a: "A", b: "B", c: "C" }));
    let active = 0, peak = 0, calls = 0;
    const result = await syncLocaleFiles({
      localesDir, sourceLocale: "en", targetLocales: ["es", "fr"], batchSize: 1, concurrency: 3,
      translate: async (batch, locale) => {
        calls++;
        peak = Math.max(peak, ++active);
        await new Promise(resolve => setTimeout(resolve, 5));
        active--;
        if (locale === "fr" && "b" in batch) throw new Error("provider unavailable");
        return Object.fromEntries(Object.keys(batch).map(key => [key, `${locale}:${key}`]));
      },
    });
    expect(calls).toBe(6);
    expect(peak).toBe(3);
    expect(result.failures).toHaveLength(1);
    expect(result.translatedKeys).toEqual(["a", "c"]);
    expect(JSON.parse(readFileSync(join(localesDir, "es.json"), "utf8"))).toEqual({ a: "es:a", b: "es:b", c: "es:c" });
    expect(JSON.parse(readFileSync(join(localesDir, ".solid-translate.lock"), "utf8")).keys.b).toBeUndefined();
  } finally { rmSync(localesDir, { recursive: true }); }
});

test("rejects invalid limits before reading files or calling the provider", async () => {
  for (const concurrency of [0, -1, 1.5, 33, NaN]) {
    await expect(syncLocaleFiles({ localesDir: "/absent", sourceLocale: "en", targetLocales: ["es"], batchSize: 8, concurrency, translate: async () => { throw new Error("must not run"); } })).rejects.toThrow("concurrency");
  }
});
