import {
  createComponent,
  useContext,
  createSignal,
  createMemo,
  type JSX,
} from "solid-js";
import {
  TranslationContext,
  type TranslationContextValue,
} from "./context.js";
import { detectLocale } from "./locale-detect.js";
import type {
  LazyTranslations,
  TranslationDictionary,
  Translations,
  TranslationsInput,
} from "./types.js";

// ---------------------------------------------------------------------------
// Re-exports
// ---------------------------------------------------------------------------

export type { TranslationContextValue } from "./context.js";
export type {
  LazyTranslations,
  TranslationDictionary,
  Translations,
  TranslationsInput,
} from "./types.js";
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
  /**
   * Translation dictionaries keyed by locale (from `virtual:solid-translate`),
   * or a lazy manifest (from `virtual:solid-translate/lazy`) whose per-locale
   * dictionaries are loaded on demand via dynamic import.
   */
  translations: TranslationsInput;
  /**
   * Persist the active locale to `localStorage` (default: false).
   * When enabled, the initial locale is read from storage (if still valid)
   * before falling back to browser detection, and `setLocale` writes through.
   * Pass `{ key: "..." }` to customize the storage key.
   */
  persistLocale?: boolean | { key?: string };
  children: JSX.Element;
}

const DEFAULT_PERSIST_KEY = "solid-translate:locale";

function isLazyTranslations(
  input: TranslationsInput,
): input is LazyTranslations {
  return (
    typeof input === "object" &&
    input !== null &&
    Array.isArray((input as LazyTranslations).locales) &&
    typeof (input as LazyTranslations).loaders === "object" &&
    (input as LazyTranslations).loaders !== null
  );
}

function readPersistedLocale(key: string): string | undefined {
  try {
    if (typeof localStorage === "undefined") return undefined;
    return localStorage.getItem(key) ?? undefined;
  } catch {
    // SSR / storage disabled
    return undefined;
  }
}

function writePersistedLocale(key: string, locale: string): void {
  try {
    if (typeof localStorage === "undefined") return;
    localStorage.setItem(key, locale);
  } catch {
    // SSR / storage disabled / quota exceeded — ignore
  }
}

export function TranslationProvider(props: TranslationProviderProps) {
  const lazy = isLazyTranslations(props.translations)
    ? props.translations
    : undefined;
  const sourceLocale = props.sourceLocale || lazy?.sourceLocale || "en";
  const availableLocales = createMemo(() =>
    lazy ? lazy.locales : Object.keys(props.translations),
  );

  const persistKey = props.persistLocale
    ? (typeof props.persistLocale === "object"
        ? props.persistLocale.key
        : undefined) || DEFAULT_PERSIST_KEY
    : undefined;

  // Initial locale: explicit prop > persisted value (if valid) > detection
  const persisted = persistKey ? readPersistedLocale(persistKey) : undefined;
  const persistedValid =
    persisted !== undefined &&
    (persisted === sourceLocale || availableLocales().includes(persisted));
  const initialLocale =
    props.locale ||
    (persistedValid ? persisted : undefined) ||
    detectLocale(availableLocales()) ||
    sourceLocale;
  const [locale, setLocaleSignal] = createSignal(initialLocale);

  // Lazily loaded dictionaries, keyed by locale (lazy manifest mode only).
  // Loading NEVER throws or suspends — while a dictionary is in flight,
  // t() falls back to the source text.
  const [loadedDicts, setLoadedDicts] = createSignal<Translations>({});
  const pendingLoads = new Set<string>();

  const loadLocale = (target: string): void => {
    if (!lazy) return;
    const loader = lazy.loaders[target];
    if (!loader) return;
    if (target in loadedDicts() || pendingLoads.has(target)) return;
    pendingLoads.add(target);
    loader()
      .then((dict) => {
        setLoadedDicts((prev) => ({ ...prev, [target]: dict }));
      })
      .catch((err) => {
        console.warn(
          `[solid-translate] Failed to load locale "${target}":`,
          err,
        );
      })
      .finally(() => {
        pendingLoads.delete(target);
      });
  };

  const setLocale = (next: string): void => {
    loadLocale(next);
    setLocaleSignal(next);
    if (persistKey) writePersistedLocale(persistKey, next);
  };

  // Kick off loading for the initial locale (no-op in eager mode, or when
  // the locale has no loader — e.g. the source locale without a dict).
  loadLocale(initialLocale);

  const t = (
    key: string,
    params?: Record<string, string | number>,
  ): string => {
    const cur = locale();
    let text = key;

    // Look up in translation dictionary (works for both source and target locales)
    const dict = lazy
      ? loadedDicts()[cur]
      : (props.translations as Translations)[cur];
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

  return createMemo(() => {
    // IMPORTANT: children are read raw, WITHOUT resolveChildren(). The Solid
    // compiler passes static text as plain strings and wraps every dynamic
    // part (expressions, <Var>, <Num>, elements) in a function or object —
    // that boundary is exactly what separates translatable text from {n}
    // slots. Resolving children first would collapse dynamic strings into
    // text and destroy the key.
    const kids = flattenChildren(props.children);

    // No context — just render children
    if (!ctx) return kids.length === 1 ? kids[0] : kids;

    // Build the template key + ordered slots from the raw children
    const slots: JSX.Element[] = [];
    let template = "";
    for (const kid of kids) {
      if (typeof kid === "string") {
        template += kid;
      } else if (typeof kid === "number") {
        template += String(kid);
      } else if (kid == null || typeof kid === "boolean") {
        // {null} / {undefined} / booleans render nothing
      } else {
        template += `{${slots.length}}`;
        slots.push(kid as JSX.Element);
      }
    }

    // Leading/trailing whitespace is layout, not copy — keep it out of the
    // key, restore it around the translation.
    const lead = /^\s*/.exec(template)![0];
    const rest = template.slice(lead.length);
    const trail = /\s*$/.exec(rest)![0];
    const body = rest.slice(0, rest.length - trail.length);

    const key = props.id || body;
    const translated = lead + ctx.t(key, props.params) + trail;

    // If translation has no slot placeholders, return it as plain text
    if (slots.length === 0 || !/{(\d+)}/.test(translated)) return translated;

    return interpolateSlots(translated, slots);
  }) as unknown as JSX.Element;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Flatten (possibly nested) children arrays WITHOUT resolving functions */
function flattenChildren(child: unknown, out: unknown[] = []): unknown[] {
  if (Array.isArray(child)) {
    for (const c of child) flattenChildren(c, out);
  } else {
    out.push(child);
  }
  return out;
}

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
