/** Extracted translatable string from source code */
export interface ExtractedString {
  key: string;
  source: string;
  file: string;
  line: number;
  /** AI context hint from the `context` prop */
  context?: string;
}

/**
 * Extract translatable strings from source code by finding:
 * - `<T>text</T>` — source text is used as the key
 * - `<T id="key">fallback</T>` — explicit key
 * - `<T context="hint">text</T>` — with AI context
 * - `<T id="key" context="hint">text</T>` — both
 * - `<T>text <Var>...</Var> more</T>` — builds template with {0} placeholders
 * - `msg("text")` — shared string marker
 */
export function extractStringsFromSource(
  code: string,
  filePath: string,
): ExtractedString[] {
  const results: ExtractedString[] = [];
  const seen = new Set<string>();

  // Match <T ...props>children</T>
  const tComponentRegex = /<T(\s[^>]*)?>([^]*?)<\/T>/g;
  let match: RegExpExecArray | null;

  while ((match = tComponentRegex.exec(code)) !== null) {
    const attrs = match[1] || "";
    const rawChildren = match[2]!;
    const line = code.substring(0, match.index).split("\n").length;

    // Parse id attribute
    const idMatch = attrs.match(/id=["']([^"']+)["']/);
    // Parse context attribute
    const contextMatch = attrs.match(/context=["']([^"']+)["']/);

    // Build source text: replace <Var>, <Num>, <Currency>, <DateTime> with {n} placeholders
    // Single-pass replacement to preserve document order
    let slotIndex = 0;
    const source = rawChildren
      .replace(
        /<(?:Var|Num|Currency|DateTime)(?:\s[^>]*)?>([^]*?)<\/(?:Var|Num|Currency|DateTime)>/g,
        () => `{${slotIndex++}}`,
      )
      .trim();

    const key = idMatch ? idMatch[1]! : source;
    if (!key || seen.has(key)) continue;
    seen.add(key);

    results.push({
      key,
      source,
      file: filePath,
      line,
      context: contextMatch ? contextMatch[1] : undefined,
    });
  }

  // Match msg("text") and msg('text') calls
  const msgRegex = /\bmsg\(\s*["']([^"']+)["']\s*(?:,\s*\{[^}]*\})?\s*\)/g;
  while ((match = msgRegex.exec(code)) !== null) {
    const source = match[1]!;
    if (seen.has(source)) continue;
    seen.add(source);
    const line = code.substring(0, match.index).split("\n").length;
    results.push({ key: source, source, file: filePath, line });
  }

  return results;
}
