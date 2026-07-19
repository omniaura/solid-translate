// NOTE: no shebang here — tsup adds it via `banner` in tsup.config.ts.
// Having both produces a dist/cli.js with two shebang lines, which is a
// syntax error under node and bun (the published binary cannot run).

import {
  readFileSync,
  writeFileSync,
  existsSync,
  mkdirSync,
} from "node:fs";
import { resolve, join, dirname, relative, basename } from "node:path";
import { translateBatch, translateMarkdown } from "./translate.js";
import { hashContent } from "./hash.js";
import { extractStringsFromSource } from "./extract.js";
import { syncLocaleFiles, formatSyncFailures } from "./lock.js";
import type { CLIConfig, LockFile } from "./types.js";

const CONFIG_FILENAMES = [
  "solid-translate.config.json",
  "solid-translate.config.js",
  "solid-translate.config.ts",
];

async function main() {
  const args = process.argv.slice(2);
  const command = args[0];

  if (!command || command === "--help" || command === "-h") {
    printUsage();
    process.exit(0);
  }

  if (command === "init") {
    await initConfig();
    return;
  }

  if (command === "extract") {
    await runExtract();
    return;
  }

  if (command === "translate") {
    await runTranslate();
    return;
  }

  if (command === "check") {
    await runCheck(args.includes("--json"));
    return;
  }

  console.error(`Unknown command: ${command}`);
  printUsage();
  process.exit(1);
}

function printUsage() {
  console.log(`
solid-translate — AI-powered translation CLI for SolidJS apps

Usage:
  solid-translate init         Create a config file
  solid-translate extract      Extract strings from source files
  solid-translate translate    Translate source strings + files to target locales
  solid-translate check        Verify translations are up to date (no AI calls)
                               Exit 0 = fresh, 1 = stale. Use --json for machine output

Config: solid-translate.config.json (or .js/.ts)

Environment variables:
  OPENROUTER_API_KEY    OpenRouter API key
  OPENAI_API_KEY        OpenAI API key
  ANTHROPIC_API_KEY     Anthropic API key
  GOOGLE_API_KEY        Google AI API key
`);
}

async function initConfig() {
  const configPath = resolve("solid-translate.config.json");
  if (existsSync(configPath)) {
    console.log("Config already exists: solid-translate.config.json");
    return;
  }

  const config: CLIConfig = {
    sourceLocale: "en",
    targetLocales: ["es", "fr", "de"],
    localesDir: "./src/locales",
    provider: "openai",
    model: "gpt-4o-mini",
    batchSize: 50,
    include: ["src/**/*.tsx", "src/**/*.ts"],
    files: {
      json: { include: [] },
      md: { include: [] },
      mdx: { include: [] },
    },
  };

  writeFileSync(configPath, JSON.stringify(config, null, 2) + "\n");
  console.log("Created solid-translate.config.json");
  console.log("Edit it to set your target locales and AI provider.");
}

async function loadConfig(): Promise<CLIConfig> {
  for (const name of CONFIG_FILENAMES) {
    const path = resolve(name);
    if (existsSync(path)) {
      if (name.endsWith(".json")) {
        return JSON.parse(readFileSync(path, "utf-8"));
      }
      // For .js/.ts, use dynamic import
      const mod = await import(path);
      return mod.default || mod;
    }
  }

  console.error(
    "No config file found. Run `solid-translate init` to create one.",
  );
  process.exit(1);
}

async function createModel(config: CLIConfig) {
  const provider = config.provider || "openai";
  const modelId = config.model || "gpt-4o-mini";

  // Dynamically import the AI SDK provider
  try {
    if (provider === "openai" || provider === "openrouter") {
      const { createOpenAI } = await import("@ai-sdk/openai");
      if (provider === "openrouter") {
        const openrouter = createOpenAI({
          baseURL: "https://openrouter.ai/api/v1",
          apiKey: process.env.OPENROUTER_API_KEY,
        });
        return openrouter(modelId);
      }
      const openai = createOpenAI({
        apiKey: process.env.OPENAI_API_KEY,
      });
      return openai(modelId);
    }

    if (provider === "anthropic") {
      const { createAnthropic } = await import("@ai-sdk/anthropic");
      const anthropic = createAnthropic({
        apiKey: process.env.ANTHROPIC_API_KEY,
      });
      return anthropic(modelId);
    }

    if (provider === "google") {
      const { createGoogleGenerativeAI } = await import("@ai-sdk/google");
      const google = createGoogleGenerativeAI({
        apiKey: process.env.GOOGLE_API_KEY,
      });
      return google(modelId);
    }

    console.error(`Unknown provider: ${provider}`);
    console.error("Supported: openai, openrouter, anthropic, google");
    process.exit(1);
  } catch (err: any) {
    console.error(
      `Failed to load AI provider "${provider}". Make sure @ai-sdk/${provider} is installed.`,
    );
    console.error(err.message);
    process.exit(1);
  }
}

async function runExtract() {
  const config = await loadConfig();
  const root = process.cwd();
  const sourceLocale = config.sourceLocale || "en";
  const localesDir = resolve(config.localesDir || "./src/locales");
  const patterns = config.include || [
    "src/**/*.tsx",
    "src/**/*.ts",
    "src/**/*.jsx",
  ];

  if (!existsSync(localesDir)) {
    mkdirSync(localesDir, { recursive: true });
  }

  const { glob } = await import("glob");
  const strings: Record<string, string> = {};
  let total = 0;

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
          total++;
        }
      } catch {
        // skip unreadable
      }
    }
  }

  // Merge with existing source file
  const sourceFilePath = join(localesDir, `${sourceLocale}.json`);
  let existing: Record<string, string> = {};
  if (existsSync(sourceFilePath)) {
    try {
      existing = JSON.parse(readFileSync(sourceFilePath, "utf-8"));
    } catch {
      // start fresh
    }
  }

  let newKeys = 0;
  for (const [key, value] of Object.entries(strings)) {
    if (!(key in existing)) {
      existing[key] = value;
      newKeys++;
    }
  }

  const sorted = Object.fromEntries(
    Object.entries(existing).sort(([a], [b]) => a.localeCompare(b)),
  );
  writeFileSync(sourceFilePath, JSON.stringify(sorted, null, 2) + "\n");

  console.log(
    `Extracted ${total} strings (${newKeys} new) → ${relative(root, sourceFilePath)}`,
  );
}

interface CheckLocaleReport {
  /** Keys present in source but absent from this locale file */
  missing: string[];
  /** Keys present in this locale file but absent from source */
  orphaned: string[];
  /** Whether the locale file exists at all */
  fileExists: boolean;
}

interface CheckReport {
  fresh: boolean;
  lock: {
    /** Source keys with no lock entry (never translated) */
    missing: string[];
    /** Source keys whose text or context changed since last translation */
    changed: string[];
    /** Lock entries for keys no longer in source */
    orphaned: string[];
  };
  locales: Record<string, CheckLocaleReport>;
}

/**
 * CI freshness primitive: verifies the lock file and target locale files
 * are up to date with the current source strings. Runs extraction only —
 * no AI provider, no writes, no `ai` package needed.
 */
async function runCheck(jsonOutput: boolean) {
  const config = await loadConfig();
  const root = process.cwd();
  const sourceLocale = config.sourceLocale || "en";
  const targetLocales = config.targetLocales || [];
  const localesDir = resolve(config.localesDir || "./src/locales");
  const patterns = config.include || [
    "src/**/*.tsx",
    "src/**/*.ts",
    "src/**/*.jsx",
  ];

  // 1. Extract strings from source files (read-only)
  const { glob } = await import("glob");
  const extracted: Record<string, string> = {};
  const contexts: Record<string, string> = {};
  for (const pattern of patterns) {
    const files = await glob(pattern, { cwd: root, absolute: true });
    for (const file of files) {
      try {
        const code = readFileSync(file, "utf-8");
        const entries = extractStringsFromSource(
          code,
          relative(root, file),
        );
        for (const entry of entries) {
          extracted[entry.key] = entry.source;
          if (entry.context) {
            contexts[entry.key] = entry.context;
          }
        }
      } catch {
        // skip unreadable
      }
    }
  }

  // 2. Effective source dict: source locale file merged with newly
  //    extracted keys (mirrors what `extract` would write, without writing)
  const sourceFilePath = join(localesDir, `${sourceLocale}.json`);
  const sourceDict: Record<string, string> = {};
  if (existsSync(sourceFilePath)) {
    try {
      Object.assign(
        sourceDict,
        JSON.parse(readFileSync(sourceFilePath, "utf-8")),
      );
    } catch {
      // corrupted source file — treat as empty
    }
  }
  for (const [key, value] of Object.entries(extracted)) {
    if (!(key in sourceDict)) {
      sourceDict[key] = value;
    }
  }

  // 3. Compare keys + hashes + contexts against the lock file
  const lockFilePath = join(localesDir, ".solid-translate.lock");
  let lock: LockFile = { version: 1, sourceLocale, keys: {} };
  if (existsSync(lockFilePath)) {
    try {
      lock = JSON.parse(readFileSync(lockFilePath, "utf-8"));
    } catch {
      // corrupted lock — every key reports as missing
    }
  }

  const report: CheckReport = {
    fresh: true,
    lock: { missing: [], changed: [], orphaned: [] },
    locales: {},
  };

  for (const [key, value] of Object.entries(sourceDict)) {
    const entry = lock.keys[key];
    if (!entry) {
      report.lock.missing.push(key);
    } else if (
      entry.hash !== hashContent(value) ||
      (entry.context ?? undefined) !== (contexts[key] ?? undefined)
    ) {
      report.lock.changed.push(key);
    }
  }
  for (const key of Object.keys(lock.keys)) {
    if (!(key in sourceDict)) {
      report.lock.orphaned.push(key);
    }
  }

  // 4. Every target locale file must contain every source key
  const sourceKeys = Object.keys(sourceDict);
  for (const targetLocale of targetLocales) {
    const targetFilePath = join(localesDir, `${targetLocale}.json`);
    let dict: Record<string, string> = {};
    let fileExists = existsSync(targetFilePath);
    if (fileExists) {
      try {
        dict = JSON.parse(readFileSync(targetFilePath, "utf-8"));
      } catch {
        fileExists = false;
      }
    }
    const localeReport: CheckLocaleReport = {
      missing: sourceKeys.filter((key) => !(key in dict)),
      orphaned: Object.keys(dict).filter((key) => !(key in sourceDict)),
      fileExists,
    };
    report.locales[targetLocale] = localeReport;
  }

  report.fresh =
    report.lock.missing.length === 0 &&
    report.lock.changed.length === 0 &&
    report.lock.orphaned.length === 0 &&
    Object.values(report.locales).every(
      (l) => l.missing.length === 0 && l.orphaned.length === 0,
    );

  if (jsonOutput) {
    console.log(JSON.stringify(report, null, 2));
  } else {
    printCheckReport(report, sourceLocale);
  }

  process.exit(report.fresh ? 0 : 1);
}

function printCheckReport(report: CheckReport, sourceLocale: string) {
  if (report.fresh) {
    console.log("Translations are up to date.");
    return;
  }

  console.log("Translations are stale:\n");

  const { missing, changed, orphaned } = report.lock;
  if (missing.length || changed.length || orphaned.length) {
    console.log(".solid-translate.lock:");
    for (const key of missing) {
      console.log(`  missing:  ${JSON.stringify(key)} (never translated)`);
    }
    for (const key of changed) {
      console.log(`  changed:  ${JSON.stringify(key)} (text or context changed)`);
    }
    for (const key of orphaned) {
      console.log(`  orphaned: ${JSON.stringify(key)} (no longer in source)`);
    }
  }

  for (const [locale, localeReport] of Object.entries(report.locales)) {
    if (!localeReport.missing.length && !localeReport.orphaned.length) {
      continue;
    }
    if (!localeReport.fileExists) {
      console.log(`${locale}.json: (file missing)`);
    } else {
      console.log(`${locale}.json:`);
    }
    for (const key of localeReport.missing) {
      console.log(`  missing:  ${JSON.stringify(key)}`);
    }
    for (const key of localeReport.orphaned) {
      console.log(`  orphaned: ${JSON.stringify(key)}`);
    }
  }

  console.log(
    `\nRun \`solid-translate translate\` to refresh ${sourceLocale} → targets.`,
  );
}

async function runTranslate() {
  // Deferred so ai-free commands (extract, check) never load the `ai` package
  const { translateBatch, translateMarkdown } = await import(
    "./translate.js"
  );
  const config = await loadConfig();
  const root = process.cwd();
  const sourceLocale = config.sourceLocale || "en";
  const targetLocales = config.targetLocales;
  const localesDir = resolve(config.localesDir || "./src/locales");
  const batchSize = config.batchSize || 50;

  if (!targetLocales || targetLocales.length === 0) {
    console.error("No targetLocales configured.");
    process.exit(1);
  }

  const model = await createModel(config);

  // 1. Translate locale JSON files
  await translateLocaleFiles(
    model,
    localesDir,
    sourceLocale,
    targetLocales,
    batchSize,
    config.systemPrompt,
  );

  // 2. Translate additional file types (JSON, Markdown, MDX)
  if (config.files) {
    const { glob } = await import("glob");

    for (const [format, opts] of Object.entries(config.files)) {
      if (!opts?.include?.length) continue;

      for (const pattern of opts.include) {
        // Pattern should contain [locale] placeholder
        if (!pattern.includes("[locale]")) {
          console.warn(
            `Pattern "${pattern}" missing [locale] placeholder, skipping`,
          );
          continue;
        }

        // Find source files
        const sourcePattern = pattern.replace("[locale]", sourceLocale);
        const files = await glob(sourcePattern, {
          cwd: root,
          absolute: true,
        });

        for (const file of files) {
          const content = readFileSync(file, "utf-8");

          for (const targetLocale of targetLocales) {
            const targetPath = resolve(
              root,
              pattern
                .replace("[locale]", targetLocale)
                .replace(
                  basename(file),
                  basename(file),
                ),
            );

            // Derive target path from source path by replacing locale
            const actualTarget = file.replace(
              `/${sourceLocale}/`,
              `/${targetLocale}/`,
            );

            if (format === "json") {
              // JSON translation: key-value pairs
              try {
                const sourceDict = JSON.parse(content);
                const translated = await translateBatch(
                  model,
                  sourceDict,
                  targetLocale,
                  sourceLocale,
                  config.systemPrompt,
                );
                mkdirSync(dirname(actualTarget), { recursive: true });
                writeFileSync(
                  actualTarget,
                  JSON.stringify(translated, null, 2) + "\n",
                );
                console.log(
                  `${format}: ${relative(root, actualTarget)}`,
                );
              } catch (err) {
                console.error(
                  `Failed to translate ${relative(root, file)}:`,
                  err,
                );
              }
            } else {
              // MD/MDX translation: full document
              try {
                const translated = await translateMarkdown(
                  model,
                  content,
                  targetLocale,
                  sourceLocale,
                  config.systemPrompt,
                );
                mkdirSync(dirname(actualTarget), { recursive: true });
                writeFileSync(actualTarget, translated);
                console.log(
                  `${format}: ${relative(root, actualTarget)}`,
                );
              } catch (err) {
                console.error(
                  `Failed to translate ${relative(root, file)}:`,
                  err,
                );
              }
            }
          }
        }
      }
    }
  }

  console.log("\nTranslation complete.");
}

async function translateLocaleFiles(
  model: any,
  localesDir: string,
  sourceLocale: string,
  targetLocales: string[],
  batchSize: number,
  systemPrompt?: string,
) {
  const result = await syncLocaleFiles({
    localesDir,
    sourceLocale,
    targetLocales,
    batchSize,
    translate: (batch, targetLocale, contexts) =>
      translateBatch(
        model,
        batch,
        targetLocale,
        sourceLocale,
        systemPrompt,
        contexts,
      ),
    log: (message) => console.log(message),
  });

  if (result.status === "no-source") {
    console.log(
      "No source locale file found. Run `solid-translate extract` first.",
    );
    return;
  }

  if (result.failures.length > 0) {
    console.error("\nTranslation failed for some batches:");
    for (const line of formatSyncFailures(result.failures)) {
      console.error(`  ${line}`);
    }
    console.error(
      "Failed keys were not recorded in the lock file — fix the error and rerun `solid-translate translate` to retry them.",
    );
    process.exit(1);
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
