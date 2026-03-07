import type { Plugin, ResolvedConfig } from "vite";
import {
  readFileSync,
  writeFileSync,
  existsSync,
  mkdirSync,
  readdirSync,
} from "node:fs";
import { resolve, join, relative } from "node:path";
import { hashContent } from "./hash.js";
import { translateBatch } from "./translate.js";
import { extractStringsFromSource } from "./extract.js";
import type { SolidTranslatePluginConfig, LockFile } from "./types.js";

export type { SolidTranslatePluginConfig };

const VIRTUAL_MODULE_ID = "virtual:solid-translate";
const RESOLVED_VIRTUAL_MODULE_ID = "\0" + VIRTUAL_MODULE_ID;

/**
 * Vite plugin for solid-translate.
 *
 * Handles:
 * 1. Optional extraction of <T>, msg() strings from source files
 * 2. AI translation of source locale to target locales (with context support)
 * 3. Lock file management for efficient re-translation
 * 4. Virtual module serving translations at runtime
 */
export function solidTranslate(config: SolidTranslatePluginConfig): Plugin {
  const {
    sourceLocale = "en",
    targetLocales,
    localesDir = "./src/locales",
    model,
    systemPrompt,
    batchSize = 50,
    autoExtract = false,
    include = ["src/**/*.tsx", "src/**/*.ts", "src/**/*.jsx"],
  } = config;

  let root: string;
  let resolvedLocalesDir: string;
  let lockFilePath: string;

  return {
    name: "solid-translate",

    configResolved(resolvedConfig: ResolvedConfig) {
      root = resolvedConfig.root;
      resolvedLocalesDir = resolve(root, localesDir);
      lockFilePath = join(resolvedLocalesDir, ".solid-translate.lock");
    },

    async buildStart() {
      // Ensure locales directory exists
      if (!existsSync(resolvedLocalesDir)) {
        mkdirSync(resolvedLocalesDir, { recursive: true });
      }

      const sourceFilePath = join(
        resolvedLocalesDir,
        `${sourceLocale}.json`,
      );

      // Auto-extraction: scan source files for <T> and msg() strings
      let contexts: Record<string, string> = {};
      if (autoExtract) {
        const extracted = await autoExtractStrings(root, include);
        contexts = extracted.contexts;

        // Merge into source locale file
        let existingSource: Record<string, string> = {};
        if (existsSync(sourceFilePath)) {
          try {
            existingSource = JSON.parse(
              readFileSync(sourceFilePath, "utf-8"),
            );
          } catch {
            // start fresh
          }
        }

        let changed = false;
        for (const [key, value] of Object.entries(extracted.strings)) {
          if (!(key in existingSource)) {
            existingSource[key] = value;
            changed = true;
          }
        }

        if (changed) {
          const sorted = Object.fromEntries(
            Object.entries(existingSource).sort(([a], [b]) =>
              a.localeCompare(b),
            ),
          );
          writeFileSync(
            sourceFilePath,
            JSON.stringify(sorted, null, 2) + "\n",
          );
          console.log(
            `[solid-translate] Auto-extracted ${Object.keys(extracted.strings).length} strings from source`,
          );
        }
      }

      // Read source locale file
      if (!existsSync(sourceFilePath)) {
        console.warn(
          `[solid-translate] Source locale file not found: ${relative(root, sourceFilePath)}`,
        );
        console.warn(
          `[solid-translate] Create it with your source strings, or enable autoExtract`,
        );
        return;
      }

      const sourceDict: Record<string, string> = JSON.parse(
        readFileSync(sourceFilePath, "utf-8"),
      );

      // Read or initialize lock file
      let lock: LockFile = { version: 1, sourceLocale, keys: {} };
      if (existsSync(lockFilePath)) {
        try {
          lock = JSON.parse(readFileSync(lockFilePath, "utf-8"));
        } catch {
          // Corrupted lock file — start fresh
        }
      }

      // Determine which keys have changed or are new
      const changedKeys: Record<string, string> = {};
      for (const [key, value] of Object.entries(sourceDict)) {
        const hash = hashContent(value);
        const existing = lock.keys[key];
        const existingContext = existing?.context;
        const newContext = contexts[key];

        // Re-translate if content changed OR context changed
        if (
          !existing ||
          existing.hash !== hash ||
          existingContext !== newContext
        ) {
          changedKeys[key] = value;
          lock.keys[key] = { hash, source: value, context: newContext };
        }
      }

      // Remove keys that no longer exist in source
      for (const key of Object.keys(lock.keys)) {
        if (!(key in sourceDict)) {
          delete lock.keys[key];
        }
      }

      if (Object.keys(changedKeys).length === 0) {
        console.log(
          "[solid-translate] No changes detected, skipping translation.",
        );
        return;
      }

      const count = Object.keys(changedKeys).length;
      console.log(
        `[solid-translate] Translating ${count} key${count > 1 ? "s" : ""} to ${targetLocales.length} locale${targetLocales.length > 1 ? "s" : ""}...`,
      );

      // Build context map for changed keys
      const changedContexts: Record<string, string> = {};
      for (const key of Object.keys(changedKeys)) {
        const ctx = lock.keys[key]?.context;
        if (ctx) changedContexts[key] = ctx;
      }

      // Translate for each target locale
      for (const targetLocale of targetLocales) {
        const targetFilePath = join(
          resolvedLocalesDir,
          `${targetLocale}.json`,
        );

        // Load existing translations to preserve unchanged keys
        let existing: Record<string, string> = {};
        if (existsSync(targetFilePath)) {
          try {
            existing = JSON.parse(readFileSync(targetFilePath, "utf-8"));
          } catch {
            // Corrupted file — regenerate
          }
        }

        // Batch translate changed keys
        const entries = Object.entries(changedKeys);
        for (let i = 0; i < entries.length; i += batchSize) {
          const batch = Object.fromEntries(
            entries.slice(i, i + batchSize),
          );
          try {
            const translated = await translateBatch(
              model,
              batch,
              targetLocale,
              sourceLocale,
              systemPrompt,
              changedContexts,
            );
            Object.assign(existing, translated);
          } catch (err) {
            console.error(
              `[solid-translate] Failed to translate batch for ${targetLocale}:`,
              err,
            );
          }
        }

        // Remove keys that no longer exist in source
        for (const key of Object.keys(existing)) {
          if (!(key in sourceDict)) {
            delete existing[key];
          }
        }

        // Sort keys for stable, diff-friendly output
        const sorted = Object.fromEntries(
          Object.entries(existing).sort(([a], [b]) => a.localeCompare(b)),
        );

        writeFileSync(
          targetFilePath,
          JSON.stringify(sorted, null, 2) + "\n",
        );
        console.log(
          `[solid-translate] ${targetLocale}: ${Object.keys(sorted).length} keys`,
        );
      }

      // Write updated lock file
      writeFileSync(lockFilePath, JSON.stringify(lock, null, 2) + "\n");
      console.log("[solid-translate] Translation complete.");
    },

    resolveId(id: string) {
      if (id === VIRTUAL_MODULE_ID) {
        return RESOLVED_VIRTUAL_MODULE_ID;
      }
    },

    load(id: string) {
      if (id === RESOLVED_VIRTUAL_MODULE_ID) {
        // Load all locale JSON files and export as a single object
        const translations: Record<string, Record<string, string>> = {};

        if (existsSync(resolvedLocalesDir)) {
          for (const file of readdirSync(resolvedLocalesDir)) {
            if (!file.endsWith(".json")) continue;
            if (file.startsWith(".")) continue;
            const locale = file.replace(".json", "");
            const filePath = join(resolvedLocalesDir, file);
            try {
              translations[locale] = JSON.parse(
                readFileSync(filePath, "utf-8"),
              );
            } catch {
              // Skip malformed files
            }
          }
        }

        return `export default ${JSON.stringify(translations)};`;
      }
    },

    // HMR: reload translations when locale files change
    handleHotUpdate({ file, server }) {
      if (
        file.startsWith(resolvedLocalesDir) &&
        file.endsWith(".json")
      ) {
        const mod = server.moduleGraph.getModuleById(
          RESOLVED_VIRTUAL_MODULE_ID,
        );
        if (mod) {
          server.moduleGraph.invalidateModule(mod);
          return [mod];
        }
      }
    },
  };
}

export default solidTranslate;

// ---------------------------------------------------------------------------
// Auto-extraction helper
// ---------------------------------------------------------------------------

async function autoExtractStrings(
  root: string,
  patterns: string[],
): Promise<{ strings: Record<string, string>; contexts: Record<string, string> }> {
  const strings: Record<string, string> = {};
  const contexts: Record<string, string> = {};

  // Dynamically import glob for file matching
  const { glob } = await import("glob");

  for (const pattern of patterns) {
    const files = await glob(pattern, { cwd: root, absolute: true });
    for (const file of files) {
      try {
        const code = readFileSync(file, "utf-8");
        const extracted = extractStringsFromSource(
          code,
          relative(root, file),
        );
        for (const entry of extracted) {
          strings[entry.key] = entry.source;
          if (entry.context) {
            contexts[entry.key] = entry.context;
          }
        }
      } catch {
        // Skip unreadable files
      }
    }
  }

  return { strings, contexts };
}
