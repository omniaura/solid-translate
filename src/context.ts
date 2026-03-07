import { createContext } from "solid-js";
import type { Translations } from "./types.js";

// ---------------------------------------------------------------------------
// Context value type
// ---------------------------------------------------------------------------

export interface TranslationContextValue {
  /** Current locale as a reactive signal */
  locale: () => string;
  /** Switch to a different locale */
  setLocale: (locale: string) => void;
  /** Translate a key with optional interpolation params */
  t: (key: string, params?: Record<string, string | number>) => string;
  /** The source locale code */
  sourceLocale: string;
  /** All available locale codes (reactive) */
  availableLocales: () => string[];
  /** Raw translations object */
  translations: Translations;
}

// ---------------------------------------------------------------------------
// Shared context instance
// ---------------------------------------------------------------------------

export const TranslationContext = createContext<TranslationContextValue>();
