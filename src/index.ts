import {
  createContext,
  createComponent,
  useContext,
  createSignal,
  createMemo,
  type JSX,
} from "solid-js";
import type { TranslationDictionary, Translations } from "./types.js";

export type { TranslationDictionary, Translations };
export type { SolidTranslatePluginConfig } from "./types.js";

// ---------------------------------------------------------------------------
// Context
// ---------------------------------------------------------------------------

export interface TranslationContextValue {
  /** Current locale as a reactive signal */
  locale: () => string;
  /** Switch to a different locale */
  setLocale: (locale: string) => void;
  /** Translate a key (returns source text if no translation found) */
  t: (key: string, params?: Record<string, string | number>) => string;
  /** The source locale code */
  sourceLocale: string;
  /** All available locale codes */
  availableLocales: string[];
}

const TranslationContext = createContext<TranslationContextValue>();

// ---------------------------------------------------------------------------
// Provider
// ---------------------------------------------------------------------------

export interface TranslationProviderProps {
  /** Initial locale (defaults to sourceLocale) */
  locale?: string;
  /** Source locale code (default: "en") */
  sourceLocale?: string;
  /** Translation dictionaries keyed by locale */
  translations: Translations;
  children: JSX.Element;
}

export function TranslationProvider(props: TranslationProviderProps) {
  const sourceLocale = props.sourceLocale || "en";
  const [locale, setLocale] = createSignal(props.locale || sourceLocale);
  const availableLocales = createMemo(() => Object.keys(props.translations));

  const t = (key: string, params?: Record<string, string | number>): string => {
    const cur = locale();
    let text = key;

    if (cur !== sourceLocale) {
      const dict = props.translations[cur];
      if (dict && key in dict) {
        text = dict[key]!;
      }
    }

    // Interpolate {{variable}} and {variable} placeholders
    if (params) {
      for (const [k, v] of Object.entries(params)) {
        text = text.replace(new RegExp(`\\{\\{${k}\\}\\}|\\{${k}\\}`, "g"), String(v));
      }
    }

    return text;
  };

  const value: TranslationContextValue = {
    locale,
    setLocale,
    t,
    sourceLocale,
    availableLocales: availableLocales() as string[],
  };

  return createComponent(TranslationContext.Provider, {
    value,
    get children() {
      return props.children;
    },
  });
}

// ---------------------------------------------------------------------------
// Hook
// ---------------------------------------------------------------------------

/** Access the translation context. Must be used inside a TranslationProvider. */
export function useTranslation(): TranslationContextValue {
  const ctx = useContext(TranslationContext);
  if (!ctx) {
    throw new Error(
      "useTranslation() must be used within a <TranslationProvider>",
    );
  }
  return ctx;
}

// ---------------------------------------------------------------------------
// <T> Component
// ---------------------------------------------------------------------------

export interface TProps {
  /** Explicit translation key. If omitted, children text is used as the key. */
  id?: string;
  /** Interpolation parameters */
  params?: Record<string, string | number>;
  /** Source text (used as fallback and as key when id is omitted) */
  children?: string;
}

/**
 * Translatable text component.
 *
 * ```tsx
 * <T>Hello world</T>
 * <T id="greeting" params={{ name: "Alice" }}>Hello {{name}}</T>
 * ```
 */
export function T(props: TProps): () => string {
  const ctx = useContext(TranslationContext);

  return () => {
    const key = props.id || props.children || "";
    if (!ctx) return props.children || key;
    return ctx.t(key, props.params);
  };
}
