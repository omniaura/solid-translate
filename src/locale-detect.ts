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

  // Exact match
  for (const bl of browserLocales) {
    const normalized = normalizeLocale(bl);
    if (availableLocales.includes(normalized)) return normalized;
  }

  // Language-only match (e.g. "en-US" → "en")
  for (const bl of browserLocales) {
    const lang = bl.split("-")[0]!.toLowerCase();
    if (availableLocales.includes(lang)) return lang;
  }

  return availableLocales[0] || "en";
}

function normalizeLocale(locale: string): string {
  return locale.toLowerCase().replace("_", "-");
}
