/**
 * Detect the user's preferred locale from browser settings.
 *
 * Checks `navigator.languages` (and falls back to `navigator.language`)
 * then matches against the list of available locales. Tries exact match
 * first, then language-only match (e.g. "en-US" → "en").
 */
export function detectLocale(availableLocales?: string[]): string {
  if (typeof navigator === "undefined") return "en";

  const browserLocales = navigator.languages
    ? [...navigator.languages]
    : [navigator.language || "en"];

  if (!availableLocales || availableLocales.length === 0) {
    return normalizeLocale(browserLocales[0] || "en");
  }

  // Map normalized available locales back to their canonical casing so a
  // browser "pt-br" can match an available "pt-BR" (and return "pt-BR").
  const canonical = new Map<string, string>();
  for (const al of availableLocales) {
    const normalized = normalizeLocale(al);
    if (!canonical.has(normalized)) canonical.set(normalized, al);
  }

  // Exact match (case-insensitive)
  for (const bl of browserLocales) {
    const match = canonical.get(normalizeLocale(bl));
    if (match) return match;
  }

  // Language-only match (e.g. "en-US" → "en")
  for (const bl of browserLocales) {
    const lang = normalizeLocale(bl).split("-")[0]!;
    const match = canonical.get(lang);
    if (match) return match;
  }

  return availableLocales[0] || "en";
}

function normalizeLocale(locale: string): string {
  return locale.toLowerCase().replace("_", "-");
}
