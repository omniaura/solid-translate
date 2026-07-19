import type { Plugin, ResolvedConfig } from "vite";
import {
  readFileSync,
  writeFileSync,
  existsSync,
  mkdirSync,
  readdirSync,
} from "node:fs";
import { resolve, join, relative } from "node:path";
import { translateBatch } from "./translate.js";
import { extractStringsFromSource } from "./extract.js";
import { syncLocaleFiles, formatSyncFailures } from "./lock.js";
import type { SolidTranslatePluginConfig } from "./types.js";

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

  return {
    name: "solid-translate",

    configResolved(resolvedConfig: ResolvedConfig) {
      root = resolvedConfig.root;
      resolvedLocalesDir = resolve(root, localesDir);
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

      const result = await syncLocaleFiles({
        localesDir: resolvedLocalesDir,
        sourceLocale,
        targetLocales,
        batchSize,
        // Only pass extraction contexts when autoExtract ran; otherwise
        // preserve the contexts already recorded in the lock file.
        contexts: autoExtract ? contexts : undefined,
        translate: (batch, targetLocale, changedContexts) =>
          translateBatch(
            model,
            batch,
            targetLocale,
            sourceLocale,
            systemPrompt,
            changedContexts,
          ),
        log: (message) => console.log(`[solid-translate] ${message}`),
      });

      if (result.failures.length > 0) {
        // Fail the build: successfully translated batches were written, but
        // failed keys were NOT recorded in the lock, so they retry next run.
        throw new Error(
          [
            "[solid-translate] Translation failed for some batches:",
            ...formatSyncFailures(result.failures).map((line) => `  ${line}`),
            "Failed keys were not recorded in the lock file — fix the error and rebuild to retry them.",
          ].join("\n"),
        );
      }

      if (result.status === "synced") {
        console.log("[solid-translate] Translation complete.");
      }
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
