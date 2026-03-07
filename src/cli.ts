#!/usr/bin/env node

import {
  readFileSync,
  writeFileSync,
  existsSync,
  mkdirSync,
} from "node:fs";
import { resolve, join, dirname, relative, basename } from "node:path";
import { hashContent } from "./hash.js";
import { translateBatch, translateMarkdown } from "./translate.js";
import { extractStringsFromSource } from "./extract.js";
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

async function runTranslate() {
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
  const sourceFilePath = join(localesDir, `${sourceLocale}.json`);
  if (!existsSync(sourceFilePath)) {
    console.log(
      "No source locale file found. Run `solid-translate extract` first.",
    );
    return;
  }

  const sourceDict: Record<string, string> = JSON.parse(
    readFileSync(sourceFilePath, "utf-8"),
  );

  // Read lock file
  const lockFilePath = join(localesDir, ".solid-translate.lock");
  let lock: LockFile = { version: 1, sourceLocale, keys: {} };
  if (existsSync(lockFilePath)) {
    try {
      lock = JSON.parse(readFileSync(lockFilePath, "utf-8"));
    } catch {
      // start fresh
    }
  }

  // Find changed keys
  const changedKeys: Record<string, string> = {};
  for (const [key, value] of Object.entries(sourceDict)) {
    const hash = hashContent(value);
    const existing = lock.keys[key];
    if (!existing || existing.hash !== hash) {
      changedKeys[key] = value;
      lock.keys[key] = { hash, source: value };
    }
  }

  // Remove deleted keys
  for (const key of Object.keys(lock.keys)) {
    if (!(key in sourceDict)) {
      delete lock.keys[key];
    }
  }

  if (Object.keys(changedKeys).length === 0) {
    console.log("No changes detected in locale files.");
    return;
  }

  const count = Object.keys(changedKeys).length;
  console.log(
    `Translating ${count} key${count > 1 ? "s" : ""} to ${targetLocales.length} locale${targetLocales.length > 1 ? "s" : ""}...`,
  );

  for (const targetLocale of targetLocales) {
    const targetFilePath = join(localesDir, `${targetLocale}.json`);

    let existing: Record<string, string> = {};
    if (existsSync(targetFilePath)) {
      try {
        existing = JSON.parse(readFileSync(targetFilePath, "utf-8"));
      } catch {
        // regenerate
      }
    }

    const entries = Object.entries(changedKeys);
    for (let i = 0; i < entries.length; i += batchSize) {
      const batch = Object.fromEntries(entries.slice(i, i + batchSize));
      try {
        const translated = await translateBatch(
          model,
          batch,
          targetLocale,
          sourceLocale,
          systemPrompt,
        );
        Object.assign(existing, translated);
      } catch (err) {
        console.error(
          `Failed to translate batch for ${targetLocale}:`,
          err,
        );
      }
    }

    // Remove deleted keys
    for (const key of Object.keys(existing)) {
      if (!(key in sourceDict)) {
        delete existing[key];
      }
    }

    const sorted = Object.fromEntries(
      Object.entries(existing).sort(([a], [b]) => a.localeCompare(b)),
    );
    writeFileSync(targetFilePath, JSON.stringify(sorted, null, 2) + "\n");
    console.log(`  ${targetLocale}: ${Object.keys(sorted).length} keys`);
  }

  writeFileSync(lockFilePath, JSON.stringify(lock, null, 2) + "\n");
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
