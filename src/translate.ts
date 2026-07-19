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

  const generateObject = await loadGenerateObject();
  const { object } = await generateObject({
    model,
    schema: z.object({
      translations: z.record(z.string(), z.string()),
    }),
    system: systemPrompt || defaultSystem,
    prompt: [
      `Translate each value in this JSON object from "${sourceLocale}" to "${targetLocale}".`,
      `Return a JSON object with the exact same keys and the translated values.`,
      contextSection,
      JSON.stringify(entries, null, 2),
    ].join("\n"),
  });

  return object.translations;
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
