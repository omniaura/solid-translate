import { readFileSync, writeFileSync, existsSync } from "node:fs";
import { join } from "node:path";
import { hashContent } from "./hash.js";
import type { LockFile, LockFileEntry } from "./types.js";

/**
 * Shared lock-file + locale-sync logic used by both the CLI and the Vite
 * plugin. Keeping this single-sourced guarantees the two entry points agree
 * on what the lock file means: an entry exists for a key if and only if that
 * key has been successfully translated to every target locale.
 */

/** Result of comparing the source dictionary against the lock file */
export interface LockDiff {
  /** Keys that are new or changed and need translation */
  changedKeys: Record<string, string>;
  /**
   * Lock entries for the changed keys. These are *pending*: they must only
   * be committed to the lock after translation succeeds for all locales.
   */
  pendingEntries: Record<string, LockFileEntry>;
  /** Keys present in the lock but no longer in the source dictionary */
  deletedKeys: string[];
}

/**
 * Compare the source dictionary against the lock file.
 *
 * When `contexts` is provided (Vite auto-extraction), a context change also
 * marks a key as changed and the new context is recorded in the pending
 * entry. When `contexts` is omitted (CLI), existing lock contexts are
 * preserved unchanged so a CLI run never clobbers Vite-written contexts.
 */
export function diffLock(
  sourceDict: Record<string, string>,
  lock: LockFile,
  contexts?: Record<string, string>,
): LockDiff {
  const changedKeys: Record<string, string> = {};
  const pendingEntries: Record<string, LockFileEntry> = {};

  for (const [key, value] of Object.entries(sourceDict)) {
    const hash = hashContent(value);
    const existing = lock.keys[key];
    const newContext = contexts ? contexts[key] : existing?.context;
    const contextChanged =
      contexts !== undefined && existing?.context !== contexts[key];

    // Re-translate if the key is new, content changed, or context changed
    if (!existing || existing.hash !== hash || contextChanged) {
      changedKeys[key] = value;
      pendingEntries[key] = { hash, source: value, context: newContext };
    }
  }

  const deletedKeys = Object.keys(lock.keys).filter(
    (key) => !(key in sourceDict),
  );

  return { changedKeys, pendingEntries, deletedKeys };
}

/** Translate one batch of changed keys for one target locale */
export type TranslateFn = (
  batch: Record<string, string>,
  targetLocale: string,
  contexts: Record<string, string>,
) => Promise<Record<string, string>>;

/** A translation batch that failed for a target locale */
export interface SyncFailure {
  locale: string;
  keys: string[];
  error: unknown;
}

export interface SyncResult {
  status: "no-source" | "no-changes" | "synced";
  /** Keys translated successfully for ALL target locales (recorded in lock) */
  translatedKeys: string[];
  /** Keys removed from source and pruned from targets + lock */
  deletedKeys: string[];
  /** Failed batches. Non-empty means the run must be treated as failed. */
  failures: SyncFailure[];
}

export interface SyncOptions {
  localesDir: string;
  sourceLocale: string;
  targetLocales: string[];
  batchSize: number;
  translate: TranslateFn;
  /**
   * Context hints from auto-extraction (Vite). Omit to preserve existing
   * lock contexts (CLI).
   */
  contexts?: Record<string, string>;
  log?: (message: string) => void;
}

/**
 * Sync source locale changes into target locale files and the lock file.
 *
 * Guarantees:
 * - Lock entries are committed only for keys whose batches succeeded for
 *   every target locale — the lock never claims a key is translated when
 *   it isn't. Failed keys stay "changed" and are retried on the next run.
 * - Successfully translated batches are still written even when other
 *   batches fail; callers must surface `failures` (exit non-zero / throw).
 * - Deleted source keys are pruned from target files and the lock even
 *   when there is nothing to translate (no AI calls needed).
 */
export async function syncLocaleFiles(
  options: SyncOptions,
): Promise<SyncResult> {
  const {
    localesDir,
    sourceLocale,
    targetLocales,
    batchSize,
    translate,
    contexts,
    log = () => {},
  } = options;

  const sourceFilePath = join(localesDir, `${sourceLocale}.json`);
  if (!existsSync(sourceFilePath)) {
    return {
      status: "no-source",
      translatedKeys: [],
      deletedKeys: [],
      failures: [],
    };
  }

  const sourceDict: Record<string, string> = JSON.parse(
    readFileSync(sourceFilePath, "utf-8"),
  );

  const lockFilePath = join(localesDir, ".solid-translate.lock");
  let lock: LockFile = { version: 1, sourceLocale, keys: {} };
  if (existsSync(lockFilePath)) {
    try {
      lock = JSON.parse(readFileSync(lockFilePath, "utf-8"));
    } catch {
      // Corrupted lock file — start fresh
    }
  }

  const { changedKeys, pendingEntries, deletedKeys } = diffLock(
    sourceDict,
    lock,
    contexts,
  );

  // Remove keys that no longer exist in source
  for (const key of deletedKeys) {
    delete lock.keys[key];
  }

  const changedCount = Object.keys(changedKeys).length;

  if (changedCount === 0 && deletedKeys.length === 0) {
    log("No changes detected in locale files.");
    return {
      status: "no-changes",
      translatedKeys: [],
      deletedKeys: [],
      failures: [],
    };
  }

  if (changedCount === 0) {
    // Deletions only — prune target files and the lock, no AI calls needed
    for (const targetLocale of targetLocales) {
      const targetFilePath = join(localesDir, `${targetLocale}.json`);
      const existing = readTargetFile(targetFilePath);
      writeTargetFile(targetFilePath, existing, sourceDict);
      log(`  ${targetLocale}: pruned deleted keys`);
    }
    writeFileSync(lockFilePath, JSON.stringify(lock, null, 2) + "\n");
    log(
      `Removed ${deletedKeys.length} deleted key${deletedKeys.length > 1 ? "s" : ""} from target locales.`,
    );
    return { status: "synced", translatedKeys: [], deletedKeys, failures: [] };
  }

  log(
    `Translating ${changedCount} key${changedCount > 1 ? "s" : ""} to ${targetLocales.length} locale${targetLocales.length > 1 ? "s" : ""}...`,
  );

  // Context hints for the changed keys, passed to the translator
  const changedContexts: Record<string, string> = {};
  for (const key of Object.keys(changedKeys)) {
    const ctx = pendingEntries[key]?.context;
    if (ctx) changedContexts[key] = ctx;
  }

  const failures: SyncFailure[] = [];
  const failedKeys = new Set<string>();

  for (const targetLocale of targetLocales) {
    const targetFilePath = join(localesDir, `${targetLocale}.json`);

    // Load existing translations to preserve unchanged keys
    const existing = readTargetFile(targetFilePath);

    // Batch translate changed keys
    const entries = Object.entries(changedKeys);
    for (let i = 0; i < entries.length; i += batchSize) {
      const batch = Object.fromEntries(entries.slice(i, i + batchSize));
      try {
        const translated = await translate(
          batch,
          targetLocale,
          changedContexts,
        );
        Object.assign(existing, translated);
      } catch (err) {
        failures.push({
          locale: targetLocale,
          keys: Object.keys(batch),
          error: err,
        });
        for (const key of Object.keys(batch)) {
          failedKeys.add(key);
        }
      }
    }

    writeTargetFile(targetFilePath, existing, sourceDict);
    log(`  ${targetLocale}: ${Object.keys(existing).length} keys`);
  }

  // Commit lock entries only for keys that succeeded for ALL target locales.
  // Failed keys keep their old entry (or none), so the next run retries them.
  const translatedKeys: string[] = [];
  for (const [key, entry] of Object.entries(pendingEntries)) {
    if (failedKeys.has(key)) continue;
    lock.keys[key] = entry;
    translatedKeys.push(key);
  }

  writeFileSync(lockFilePath, JSON.stringify(lock, null, 2) + "\n");

  return { status: "synced", translatedKeys, deletedKeys, failures };
}

/** Format sync failures into a human-readable, single-line-per-batch report */
export function formatSyncFailures(failures: SyncFailure[]): string[] {
  return failures.map((failure) => {
    const message =
      failure.error instanceof Error
        ? failure.error.message
        : String(failure.error);
    return `${failure.locale}: ${failure.keys.length} key${failure.keys.length > 1 ? "s" : ""} [${failure.keys.join(", ")}] — ${message}`;
  });
}

function readTargetFile(targetFilePath: string): Record<string, string> {
  if (!existsSync(targetFilePath)) return {};
  try {
    return JSON.parse(readFileSync(targetFilePath, "utf-8"));
  } catch {
    // Corrupted file — regenerate
    return {};
  }
}

function writeTargetFile(
  targetFilePath: string,
  translations: Record<string, string>,
  sourceDict: Record<string, string>,
): void {
  // Remove keys that no longer exist in source
  for (const key of Object.keys(translations)) {
    if (!(key in sourceDict)) {
      delete translations[key];
    }
  }

  // Sort keys for stable, diff-friendly output
  const sorted = Object.fromEntries(
    Object.entries(translations).sort(([a], [b]) => a.localeCompare(b)),
  );

  writeFileSync(targetFilePath, JSON.stringify(sorted, null, 2) + "\n");
}
