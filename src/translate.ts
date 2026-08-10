import { z } from "zod";
import type { LanguageModelV1 } from "ai";

/**
 * Lazily import the `ai` package so that merely loading this module (e.g.
 * via the Vite plugin on extract-only or fresh-lock builds) does not require
 * `ai` to be installed. It is only needed when translation actually runs.
 */
async function loadGenerateObject() {
  const { generateObject } = await import("ai");
  return generateObject;
}

async function loadGenerateText() {
  const { generateText } = await import("ai");
  return generateText;
}

/**
 * Pull a JSON object out of a model text response. Tolerates markdown code
 * fences and prose around the object; takes the outermost `{...}` span.
 * Exported for tests.
 */
export function extractJsonObject(text: string): Record<string, unknown> {
  const start = text.indexOf("{");
  const end = text.lastIndexOf("}");
  if (start === -1 || end <= start) {
    throw new Error("model response contained no JSON object");
  }
  const parsed: unknown = JSON.parse(text.slice(start, end + 1));
  if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) {
    throw new Error("model response was not a JSON object");
  }
  return parsed as Record<string, unknown>;
}

/**
 * Normalize a parsed model response into a translations dictionary limited to
 * the requested keys, and report which requested keys are missing (absent,
 * non-string, or empty). Unwraps a `{ "translations": { ... } }` envelope if
 * the model added one. Exported for tests.
 */
export function collectBatchTranslations(
  parsed: Record<string, unknown>,
  requestedKeys: string[],
): { translations: Record<string, string>; missing: string[] } {
  let dict = parsed;
  const inner = parsed["translations"];
  if (
    typeof inner === "object" &&
    inner !== null &&
    !Array.isArray(inner) &&
    // Only unwrap when the envelope key is not itself a requested key
    !requestedKeys.includes("translations")
  ) {
    dict = inner as Record<string, unknown>;
  }

  const translations: Record<string, string> = {};
  const missing: string[] = [];
  for (const key of requestedKeys) {
    const value = dict[key];
    if (typeof value === "string" && value.length > 0) {
      translations[key] = value;
    } else {
      missing.push(key);
    }
  }
  return { translations, missing };
}

/**
 * Translate a batch of key-value pairs from one locale to another using AI.
 * Supports optional per-key context hints for disambiguation.
 */
export async function translateBatch(
  model: LanguageModelV1,
  entries: Record<string, string>,
  targetLocale: string,
  sourceLocale: string,
  systemPrompt?: string,
  contexts?: Record<string, string>,
): Promise<Record<string, string>> {
  const keys = Object.keys(entries);
  if (keys.length === 0) return {};

  const defaultSystem = [
    `You are a professional translator specializing in software localization.`,
    `Translate text from "${sourceLocale}" to "${targetLocale}".`,
    `Rules:`,
    `- Preserve the original tone and meaning`,
    `- Keep placeholders like {{variable}}, {variable}, {0}, {1} unchanged`,
    `- Keep HTML tags unchanged`,
    `- Do not add or remove content`,
    `- Return natural, idiomatic translations`,
  ].join("\n");

  // Build context section if any keys have context hints
  let contextSection = "";
  if (contexts && Object.keys(contexts).length > 0) {
    const contextLines = Object.entries(contexts)
      .filter(([key]) => key in entries)
      .map(([key, ctx]) => `  "${key}": ${ctx}`);
    if (contextLines.length > 0) {
      contextSection = [
        ``,
        `Context hints for disambiguation:`,
        ...contextLines,
        ``,
      ].join("\n");
    }
  }

  // generateText + manual JSON parsing instead of generateObject: a
  // Record<string, string> compiles to a JSON schema made only of
  // `additionalProperties`, which several providers' structured-output modes
  // handle badly — Gemini (via OpenRouter) silently returns `{}` and OpenAI's
  // strict mode rejects the schema outright. Free-form JSON with strict
  // post-validation works across every provider.
  const generateText = await loadGenerateText();
  const basePrompt = [
    `Translate each value in this JSON object from "${sourceLocale}" to "${targetLocale}".`,
    `Respond with ONLY a JSON object — no prose, no code fences — containing the exact same keys and the translated values.`,
    contextSection,
    JSON.stringify(entries, null, 2),
  ].join("\n");

  const attempt = async (prompt: string) => {
    const { text } = await generateText({
      model,
      system: systemPrompt || defaultSystem,
      prompt,
    });
    return collectBatchTranslations(extractJsonObject(text), keys);
  };

  let { translations, missing } = await attempt(basePrompt);

  if (missing.length > 0) {
    // One corrective retry for just the missing keys, then hard-fail so the
    // caller records the batch as failed instead of committing a poisoned
    // lock over silently-untranslated keys.
    const retryEntries: Record<string, string> = {};
    for (const key of missing) retryEntries[key] = entries[key]!;
    const retry = await attempt(
      [
        `Translate each value in this JSON object from "${sourceLocale}" to "${targetLocale}".`,
        `Respond with ONLY a JSON object — no prose, no code fences — containing the exact same keys and the translated values.`,
        contextSection,
        JSON.stringify(retryEntries, null, 2),
      ].join("\n"),
    );
    translations = { ...translations, ...retry.translations };
    missing = retry.missing;
  }

  if (missing.length > 0) {
    const sample = missing.slice(0, 3).join('", "');
    throw new Error(
      `model returned no translation for ${missing.length} of ${keys.length} keys (e.g. "${sample}")`,
    );
  }

  return translations;
}

/**
 * Translate a markdown or MDX string from one locale to another.
 * Preserves code blocks, frontmatter, and MDX components.
 */
export async function translateMarkdown(
  model: LanguageModelV1,
  content: string,
  targetLocale: string,
  sourceLocale: string,
  systemPrompt?: string,
): Promise<string> {
  const defaultSystem = [
    `You are a professional translator specializing in documentation.`,
    `Translate Markdown/MDX content from "${sourceLocale}" to "${targetLocale}".`,
    `Rules:`,
    `- Preserve all Markdown formatting (headers, lists, bold, italic, links, etc.)`,
    `- Preserve code blocks and inline code unchanged`,
    `- Preserve frontmatter YAML keys (only translate values)`,
    `- Preserve MDX component syntax and JSX expressions`,
    `- Preserve URLs and file paths unchanged`,
    `- Return natural, idiomatic translations`,
  ].join("\n");

  const generateObject = await loadGenerateObject();
  const { object } = await generateObject({
    model,
    schema: z.object({
      translated: z.string(),
    }),
    system: systemPrompt || defaultSystem,
    prompt: [
      `Translate this Markdown/MDX content from "${sourceLocale}" to "${targetLocale}".`,
      `Return the complete translated document.`,
      ``,
      content,
    ].join("\n"),
  });

  return object.translated;
}
