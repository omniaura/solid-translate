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
}

/** A flat dictionary mapping keys to translated strings */
export type TranslationDictionary = Record<string, string>;

/** All translations keyed by locale code */
export type Translations = Record<string, TranslationDictionary>;

/** Lock file entry tracking a single translation key */
export interface LockFileEntry {
  hash: string;
  source: string;
}

/** Lock file format for tracking translation state */
export interface LockFile {
  version: number;
  sourceLocale: string;
  keys: Record<string, LockFileEntry>;
}
