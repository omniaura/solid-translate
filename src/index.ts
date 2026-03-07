import {
  createComponent,
  useContext,
  createSignal,
  createMemo,
  children as resolveChildren,
  type JSX,
} from "solid-js";
import {
  TranslationContext,
  type TranslationContextValue,
} from "./context.js";
import { detectLocale } from "./locale-detect.js";
import type { TranslationDictionary, Translations } from "./types.js";

// ---------------------------------------------------------------------------
// Re-exports
// ---------------------------------------------------------------------------

export type { TranslationContextValue } from "./context.js";
export type { TranslationDictionary, Translations } from "./types.js";
export type { SolidTranslatePluginConfig } from "./types.js";
export { Var, Num, Currency, DateTime, Plural, LocaleSelector } from "./components.js";
export type {
  VarProps,
  NumProps,
  CurrencyProps,
  DateTimeProps,
  PluralProps,
  LocaleSelectorProps,
} from "./components.js";
export { msg } from "./msg.js";
export { detectLocale } from "./locale-detect.js";

// ---------------------------------------------------------------------------
// Provider
// ---------------------------------------------------------------------------

export interface TranslationProviderProps {
  /**
   * Initial locale. If omitted, auto-detects from the browser's
   * `navigator.languages` header, falling back to `sourceLocale`.
   */
  locale?: string;
  /** Source locale code (default: "en") */
  sourceLocale?: string;
  /** Translation dictionaries keyed by locale */
  translations: Translations;
  children: JSX.Element;
}

export function TranslationProvider(props: TranslationProviderProps) {
  const sourceLocale = props.sourceLocale || "en";
  const availableLocales = createMemo(() => Object.keys(props.translations));

  // Auto-detect locale from browser if not explicitly provided
  const initialLocale =
    props.locale || detectLocale(availableLocales()) || sourceLocale;
  const [locale, setLocale] = createSignal(initialLocale);

  const t = (
    key: string,
    params?: Record<string, string | number>,
  ): string => {
    const cur = locale();
    let text = key;

    // Look up in translation dictionary (works for both source and target locales)
    const dict = props.translations[cur];
    if (dict && key in dict) {
      text = dict[key]!;
    }

    // Interpolate {{variable}} and {variable} placeholders
    if (params) {
      for (const [k, v] of Object.entries(params)) {
        text = text.replace(
          new RegExp(`\\{\\{${k}\\}\\}|\\{${k}\\}`, "g"),
          String(v),
        );
      }
    }

    return text;
  };

  const value: TranslationContextValue = {
    locale,
    setLocale,
    t,
    sourceLocale,
    availableLocales,
    translations: props.translations,
  };

  return createComponent(TranslationContext.Provider, {
    value,
    get children() {
      return props.children;
    },
  });
}

// ---------------------------------------------------------------------------
// Hooks
// ---------------------------------------------------------------------------

/** Access the full translation context. Must be inside a TranslationProvider. */
export function useTranslation(): TranslationContextValue {
  const ctx = useContext(TranslationContext);
  if (!ctx) {
    throw new Error(
      "useTranslation() must be used within a <TranslationProvider>",
    );
  }
  return ctx;
}

/** Access just the current locale and setter. */
export function useLocale(): {
  locale: () => string;
  setLocale: (locale: string) => void;
  sourceLocale: string;
  availableLocales: () => string[];
} {
  const ctx = useTranslation();
  return {
    locale: ctx.locale,
    setLocale: ctx.setLocale,
    sourceLocale: ctx.sourceLocale,
    availableLocales: ctx.availableLocales,
  };
}

// ---------------------------------------------------------------------------
// <T> Component
// ---------------------------------------------------------------------------

export interface TProps {
  /** Explicit translation key. If omitted, children text is used as the key. */
  id?: string;
  /** Interpolation parameters */
  params?: Record<string, string | number>;
  /**
   * AI context hint — tells the AI translator about the meaning of this text.
   * Only used at build time for disambiguation; has no runtime effect.
   *
   * ```tsx
   * <T context="Button to save a document, not save money">Save</T>
   * ```
   */
  context?: string;
  /** Source text / JSX content */
  children?: JSX.Element;
}

/**
 * Translatable content component.
 *
 * ```tsx
 * <T>Hello world</T>
 * <T id="greeting" params={{ name: "Alice" }}>Hello {{name}}</T>
 * <T context="the physical bank">Bank</T>
 * <T>Welcome <Var>{userName()}</Var>, you have <Num>{count()}</Num> items</T>
 * ```
 */
export function T(props: TProps): JSX.Element {
  const ctx = useContext(TranslationContext);
  const resolved = resolveChildren(() => props.children);

  return createMemo(() => {
    const kids = resolved.toArray();

    // No context — just render children
    if (!ctx) return kids.length === 1 ? kids[0] : kids;

    // Simple case: single text child
    if (kids.length === 1 && typeof kids[0] === "string") {
      const key = props.id || (kids[0] as string);
      return ctx.t(key, props.params);
    }

    // Explicit id with non-text children — translate via id
    if (props.id) {
      const translated = ctx.t(props.id, props.params);

      // If translation is just text (no slot placeholders), return it
      if (!/{(\d+)}/.test(translated)) return translated;

      // Collect non-text children (Var, Num, etc.) as ordered slots
      const slots: JSX.Element[] = [];
      for (const kid of kids) {
        if (typeof kid !== "string" && typeof kid !== "number") {
          slots.push(kid as JSX.Element);
        }
      }

      return interpolateSlots(translated, slots);
    }

    // Mixed children without explicit id — build a template key
    const slots: JSX.Element[] = [];
    let template = "";
    for (const kid of kids) {
      if (typeof kid === "string") {
        template += kid;
      } else if (typeof kid === "number") {
        template += String(kid);
      } else {
        template += `{${slots.length}}`;
        slots.push(kid as JSX.Element);
      }
    }

    const translated = ctx.t(template, props.params);
    if (slots.length === 0) return translated;
    return interpolateSlots(translated, slots);
  }) as unknown as JSX.Element;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Split a translated string by `{0}`, `{1}`, etc. and interleave with slots */
function interpolateSlots(
  text: string,
  slots: JSX.Element[],
): (string | JSX.Element)[] {
  const parts = text.split(/\{(\d+)\}/);
  const result: (string | JSX.Element)[] = [];
  for (let i = 0; i < parts.length; i++) {
    if (i % 2 === 0) {
      if (parts[i]) result.push(parts[i]!);
    } else {
      const idx = parseInt(parts[i]!, 10);
      if (slots[idx] !== undefined) result.push(slots[idx]!);
    }
  }
  return result;
}
