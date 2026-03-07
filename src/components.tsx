import { useContext, type JSX, For, createMemo } from "solid-js";
import { TranslationContext } from "./context.js";

// ---------------------------------------------------------------------------
// <Var> — protect dynamic content from translation
// ---------------------------------------------------------------------------

export interface VarProps {
  /** Optional name for the variable (used as placeholder in templates) */
  name?: string;
  children: JSX.Element;
}

/**
 * Marks content as untranslatable. When used inside `<T>`, the content
 * is preserved as-is while surrounding text is translated.
 *
 * ```tsx
 * <T>Hello <Var>{userName()}</Var>, welcome!</T>
 * ```
 */
export function Var(props: VarProps): JSX.Element {
  return (() => props.children) as unknown as JSX.Element;
}

// Mark Var for identification by T component
(Var as any).__st_var = true;

// ---------------------------------------------------------------------------
// <Num> — locale-aware number formatting
// ---------------------------------------------------------------------------

export interface NumProps {
  /** The number to format */
  children: number;
  /** Intl.NumberFormat options */
  options?: Intl.NumberFormatOptions;
}

/**
 * Formats a number according to the current locale using `Intl.NumberFormat`.
 *
 * ```tsx
 * <Num>{1000000}</Num>          // "1,000,000" in en, "1.000.000" in de
 * <Num options={{ style: "percent" }}>{0.42}</Num>  // "42%"
 * ```
 */
export function Num(props: NumProps): JSX.Element {
  const ctx = useContext(TranslationContext);

  return createMemo(() => {
    const locale = ctx?.locale() || "en";
    return new Intl.NumberFormat(locale, props.options).format(props.children);
  }) as unknown as JSX.Element;
}

// ---------------------------------------------------------------------------
// <Currency> — locale-aware currency formatting
// ---------------------------------------------------------------------------

export interface CurrencyProps {
  /** The numeric value */
  children: number;
  /** ISO 4217 currency code (e.g. "USD", "EUR") */
  currency: string;
  /** Additional Intl.NumberFormat options */
  options?: Intl.NumberFormatOptions;
}

/**
 * Formats a number as currency according to the current locale.
 *
 * ```tsx
 * <Currency currency="USD">{29.99}</Currency>    // "$29.99" in en-US
 * <Currency currency="EUR">{29.99}</Currency>    // "29,99 €" in de
 * ```
 */
export function Currency(props: CurrencyProps): JSX.Element {
  const ctx = useContext(TranslationContext);

  return createMemo(() => {
    const locale = ctx?.locale() || "en";
    return new Intl.NumberFormat(locale, {
      style: "currency",
      currency: props.currency,
      ...props.options,
    }).format(props.children);
  }) as unknown as JSX.Element;
}

// ---------------------------------------------------------------------------
// <DateTime> — locale-aware date/time formatting
// ---------------------------------------------------------------------------

export interface DateTimeProps {
  /** The date to format (Date object, timestamp, or ISO string) */
  children: Date | number | string;
  /** Intl.DateTimeFormat options */
  options?: Intl.DateTimeFormatOptions;
}

/**
 * Formats a date/time according to the current locale using `Intl.DateTimeFormat`.
 *
 * ```tsx
 * <DateTime>{new Date()}</DateTime>
 * <DateTime options={{ dateStyle: "long" }}>{new Date()}</DateTime>
 * ```
 */
export function DateTime(props: DateTimeProps): JSX.Element {
  const ctx = useContext(TranslationContext);

  return createMemo(() => {
    const locale = ctx?.locale() || "en";
    const date =
      props.children instanceof Date
        ? props.children
        : new Date(props.children);
    return new Intl.DateTimeFormat(locale, props.options).format(date);
  }) as unknown as JSX.Element;
}

// ---------------------------------------------------------------------------
// <Plural> — CLDR plural rules
// ---------------------------------------------------------------------------

export interface PluralProps {
  /** The count value to determine which plural form to use */
  n: number;
  /** Form for zero items */
  zero?: JSX.Element;
  /** Form for exactly one item */
  one?: JSX.Element;
  /** Form for exactly two items */
  two?: JSX.Element;
  /** Form for "few" items (language-dependent) */
  few?: JSX.Element;
  /** Form for "many" items (language-dependent) */
  many?: JSX.Element;
  /** Default/fallback form */
  other: JSX.Element;
}

/**
 * Renders the appropriate plural form based on CLDR plural rules for the current locale.
 *
 * ```tsx
 * <Plural n={count()}
 *   zero="No items"
 *   one="1 item"
 *   other={`${count()} items`}
 * />
 * ```
 */
export function Plural(props: PluralProps): JSX.Element {
  const ctx = useContext(TranslationContext);

  return createMemo(() => {
    const locale = ctx?.locale() || "en";
    const rules = new Intl.PluralRules(locale);
    const category = rules.select(props.n);

    const forms: Record<string, JSX.Element | undefined> = {
      zero: props.zero,
      one: props.one,
      two: props.two,
      few: props.few,
      many: props.many,
      other: props.other,
    };

    return forms[category] ?? props.other;
  }) as unknown as JSX.Element;
}

// ---------------------------------------------------------------------------
// <LocaleSelector> — drop-in locale picker
// ---------------------------------------------------------------------------

export interface LocaleSelectorProps {
  /** Override which locales to show (defaults to all available) */
  locales?: string[];
  /** Map locale codes to display names, e.g. { en: "English", es: "Español" } */
  labels?: Record<string, string>;
  /** Additional CSS class */
  class?: string;
}

/**
 * A ready-to-use locale selector dropdown.
 *
 * ```tsx
 * <LocaleSelector labels={{ en: "English", es: "Español", fr: "Français" }} />
 * ```
 */
export function LocaleSelector(props: LocaleSelectorProps): JSX.Element {
  const ctx = useContext(TranslationContext);
  if (!ctx) {
    throw new Error(
      "<LocaleSelector> must be used within a <TranslationProvider>",
    );
  }

  const locales = createMemo(() => props.locales || ctx.availableLocales());

  const displayName = (code: string): string => {
    if (props.labels?.[code]) return props.labels[code]!;
    try {
      const dn = new Intl.DisplayNames([code], { type: "language" });
      return dn.of(code) || code;
    } catch {
      return code;
    }
  };

  return (
    <select
      class={props.class}
      value={ctx.locale()}
      onChange={(e) => ctx.setLocale(e.currentTarget.value)}
    >
      <For each={locales()}>
        {(code) => <option value={code}>{displayName(code)}</option>}
      </For>
    </select>
  ) as JSX.Element;
}
