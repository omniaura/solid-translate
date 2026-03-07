/** Extracted translatable string from source code */
export interface ExtractedString {
  key: string;
  source: string;
  file: string;
  line: number;
}

/**
 * Extract translatable strings from source code by finding <T> component usage.
 *
 * Supports:
 * - <T>text</T> — source text is used as the key
 * - <T id="key">fallback text</T> — explicit key with fallback
 */
export function extractStringsFromSource(
  code: string,
  filePath: string,
): ExtractedString[] {
  const results: ExtractedString[] = [];
  const seen = new Set<string>();

  // Match <T id="key">text</T>
  const idRegex = /<T\s+id=["']([^"']+)["'][^>]*>([^<]*)<\/T>/g;
  let match: RegExpExecArray | null;

  while ((match = idRegex.exec(code)) !== null) {
    const key = match[1]!;
    const source = match[2]!.trim();
    if (seen.has(key)) continue;
    seen.add(key);
    const line = code.substring(0, match.index).split("\n").length;
    results.push({ key, source, file: filePath, line });
  }

  // Match plain <T>text</T> (source text as key)
  const plainRegex = /<T>([^<]+)<\/T>/g;
  while ((match = plainRegex.exec(code)) !== null) {
    const source = match[1]!.trim();
    if (!source || seen.has(source)) continue;
    seen.add(source);
    const line = code.substring(0, match.index).split("\n").length;
    results.push({ key: source, source, file: filePath, line });
  }

  return results;
}
