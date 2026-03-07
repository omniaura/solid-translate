import type { LanguageModelV1 } from "ai";

/** Configuration for the solid-translate Vite plugin */
export interface SolidTranslatePluginConfig {
  /** Source locale code (default: "en") */
  sourceLocale?: string;
  /** Target locale codes to translate into */
  targetLocales: string[];
  /** Directory containing locale JSON files, relative to project root (default: "./src/locales") */
  localesDir?: string;
  /** AI model to use for translations (any Vercel AI SDK LanguageModelV1) */
  model: LanguageModelV1;
  /** Custom system prompt for the AI translator */
  systemPrompt?: string;
  /** Max keys per API call (default: 50) */
  batchSize?: number;
  /**
   * Automatically extract translatable strings from source files.
   * Scans for `<T>` components and `msg()` calls, then writes
   * discovered strings into the source locale JSON file.
   */
  autoExtract?: boolean;
  /**
   * Glob patterns for files to scan during auto-extraction.
   * Default: `["src/**\/*.tsx", "src/**\/*.ts", "src/**\/*.jsx"]`
   */
  include?: string[];
}

/** A flat dictionary mapping keys to translated strings */
export type TranslationDictionary = Record<string, string>;

/** All translations keyed by locale code */
export type Translations = Record<string, TranslationDictionary>;

/** Lock file entry tracking a single translation key */
export interface LockFileEntry {
  hash: string;
  source: string;
  /** AI context hint for disambiguation */
  context?: string;
}

/** Lock file format for tracking translation state */
export interface LockFile {
  version: number;
  sourceLocale: string;
  keys: Record<string, LockFileEntry>;
}

/** Configuration file for the CLI (solid-translate.config.json) */
export interface CLIConfig {
  /** Source locale code (default: "en") */
  sourceLocale?: string;
  /** Target locale codes */
  targetLocales: string[];
  /** Directory for locale files (default: "./src/locales") */
  localesDir?: string;
  /** AI SDK model identifier (e.g. "openai/gpt-4o-mini") */
  model?: string;
  /** AI SDK provider (e.g. "openai", "anthropic") */
  provider?: string;
  /** Custom system prompt */
  systemPrompt?: string;
  /** Max keys per API call (default: 50) */
  batchSize?: number;
  /** Files to translate directly (JSON, Markdown, MDX) */
  files?: {
    json?: { include: string[] };
    md?: { include: string[] };
    mdx?: { include: string[] };
  };
  /** Glob patterns for source files to scan */
  include?: string[];
}
