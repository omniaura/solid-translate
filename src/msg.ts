/**
 * Mark a string for translation extraction.
 *
 * At build time, the Vite plugin and CLI scan for `msg()` calls and add
 * the strings to the source locale file for AI translation.
 *
 * At runtime, `msg()` is a no-op — it returns the source text as-is.
 * Use `t()` from `useTranslation()` for runtime translation.
 *
 * ```ts
 * // Marks "Save changes" for extraction
 * const label = msg("Save changes");
 *
 * // With interpolation template
 * const greeting = msg("Hello {{name}}", { name: "World" });
 *
 * // In a component, translate at runtime:
 * const { t } = useTranslation();
 * <button>{t(label)}</button>
 * ```
 */
export function msg(
  text: string,
  _params?: Record<string, string | number>,
): string {
  return text;
}
