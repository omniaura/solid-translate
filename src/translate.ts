import { generateObject } from "ai";
import { z } from "zod";
import type { LanguageModelV1 } from "ai";

/**
 * Translate a batch of key-value pairs from one locale to another using AI.
 * Returns a record with the same keys and translated values.
 */
export async function translateBatch(
  model: LanguageModelV1,
  entries: Record<string, string>,
  targetLocale: string,
  sourceLocale: string,
  systemPrompt?: string,
): Promise<Record<string, string>> {
  const keys = Object.keys(entries);
  if (keys.length === 0) return {};

  const defaultSystem = [
    `You are a professional translator specializing in software localization.`,
    `Translate text from "${sourceLocale}" to "${targetLocale}".`,
    `Rules:`,
    `- Preserve the original tone and meaning`,
    `- Keep placeholders like {{variable}} or {variable} unchanged`,
    `- Keep HTML tags unchanged`,
    `- Do not add or remove content`,
    `- Return natural, idiomatic translations`,
  ].join("\n");

  const { object } = await generateObject({
    model,
    schema: z.object({
      translations: z.record(z.string(), z.string()),
    }),
    system: systemPrompt || defaultSystem,
    prompt: [
      `Translate each value in this JSON object from "${sourceLocale}" to "${targetLocale}".`,
      `Return a JSON object with the exact same keys and the translated values.`,
      ``,
      JSON.stringify(entries, null, 2),
    ].join("\n"),
  });

  return object.translations;
}
