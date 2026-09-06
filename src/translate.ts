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

/** Tuning knobs for translateBatch's recovery loop. */
export interface TranslateBatchOptions {
  /**
   * Attempts per (sub-)batch before giving up (default 3). Each attempt
   * targets only the keys still missing; a batch that stays incomplete is
   * split in half and each half gets its own attempts, so one truncated or
   * malformed response never fails the whole batch.
   */
  maxAttempts?: number;
  /** Base delay for exponential backoff between attempts (default 500ms). */
  baseDelayMs?: number;
  /** Optional progress logger for retries and splits. */
  log?: (message: string) => void;
  /** Injectable sleep for tests. */
  sleep?: (ms: number) => Promise<void>;
}

const DEFAULT_MAX_ATTEMPTS = 3;
const DEFAULT_BASE_DELAY_MS = 500;

/**
 * Output token ceiling for one model call. Provider defaults (often 4k)
 * truncate large batches mid-JSON; scale with the key count AND the amount
 * of source text so a batch of long paragraphs (or a target script that
 * tokenizes densely) still fits. Exported for tests.
 */
export function batchMaxTokens(entries: Record<string, string>): number {
  const keyCount = Object.keys(entries).length;
  let sourceChars = 0;
  for (const [key, value] of Object.entries(entries)) {
    sourceChars += key.length + value.length;
  }
  return Math.min(32_000, 2_000 + 400 * keyCount + Math.ceil(sourceChars * 1.5));
}

/** Exponential backoff with jitter: base, 2×base, 4×base … capped at 30s. */
export function backoffDelay(attempt: number, baseDelayMs: number): number {
  const exp = Math.min(30_000, baseDelayMs * 2 ** Math.max(0, attempt - 1));
  return Math.round(exp * (0.75 + Math.random() * 0.5));
}

function defaultSleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Translate a batch of key-value pairs from one locale to another using AI.
 * Supports optional per-key context hints for disambiguation.
 *
 * Recovery: a call that throws (network, rate limit, unparseable JSON) or
 * comes back with keys missing is retried with exponential backoff, always
 * for just the keys still missing. A batch that makes no progress across an
 * attempt is split in half and each half is translated independently, down
 * to single keys. Only when a key fails every attempt does the batch throw,
 * so the caller records exactly those keys as failed.
 */
export async function translateBatch(
  model: LanguageModelV1,
  entries: Record<string, string>,
  targetLocale: string,
  sourceLocale: string,
  systemPrompt?: string,
  contexts?: Record<string, string>,
  options: TranslateBatchOptions = {},
): Promise<Record<string, string>> {
  const keys = Object.keys(entries);
  if (keys.length === 0) return {};

  const maxAttempts = Math.max(1, options.maxAttempts ?? DEFAULT_MAX_ATTEMPTS);
  const baseDelayMs = options.baseDelayMs ?? DEFAULT_BASE_DELAY_MS;
  const sleep = options.sleep ?? defaultSleep;
  const log = options.log ?? (() => {});

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

  const contextSectionFor = (subset: Record<string, string>): string => {
    if (!contexts || Object.keys(contexts).length === 0) return "";
    const contextLines = Object.entries(contexts)
      .filter(([key]) => key in subset)
      .map(([key, ctx]) => `  "${key}": ${ctx}`);
    if (contextLines.length === 0) return "";
    return [``, `Context hints for disambiguation:`, ...contextLines, ``].join(
      "\n",
    );
  };

  // generateText + manual JSON parsing instead of generateObject: a
  // Record<string, string> compiles to a JSON schema made only of
  // `additionalProperties`, which several providers' structured-output modes
  // handle badly — Gemini (via OpenRouter) silently returns `{}` and OpenAI's
  // strict mode rejects the schema outright. Free-form JSON with strict
  // post-validation works across every provider.
  const generateText = await loadGenerateText();

  const attempt = async (subset: Record<string, string>) => {
    const subsetKeys = Object.keys(subset);
    const { text } = await generateText({
      model,
      system: systemPrompt || defaultSystem,
      prompt: [
        `Translate each value in this JSON object from "${sourceLocale}" to "${targetLocale}".`,
        `Respond with ONLY a JSON object — no prose, no code fences — containing the exact same keys and the translated values.`,
        contextSectionFor(subset),
        JSON.stringify(subset, null, 2),
      ].join("\n"),
      maxTokens: batchMaxTokens(subset),
    });
    return collectBatchTranslations(extractJsonObject(text), subsetKeys);
  };

  const translations: Record<string, string> = {};
  const failed: string[] = [];
  let lastError: unknown;

  const recover = async (pending: string[], depth: number): Promise<void> => {
    let remaining = pending;
    for (let n = 1; n <= maxAttempts && remaining.length > 0; n++) {
      const subset: Record<string, string> = {};
      for (const key of remaining) subset[key] = entries[key]!;
      let missing: string[];
      try {
        const result = await attempt(subset);
        Object.assign(translations, result.translations);
        missing = result.missing;
      } catch (err) {
        lastError = err;
        missing = remaining;
        log(
          `translate ${targetLocale}: attempt ${n}/${maxAttempts} for ${remaining.length} key(s) failed: ${err instanceof Error ? err.message : String(err)}`,
        );
      }
      if (missing.length === 0) return;
      const progressed = missing.length < remaining.length;
      remaining = missing;
      // No progress on a multi-key batch: the response was probably truncated
      // or malformed as a whole. Halve it and let each half recover on its own.
      if (!progressed && remaining.length > 1) {
        const mid = Math.ceil(remaining.length / 2);
        log(
          `translate ${targetLocale}: splitting ${remaining.length} key(s) into ${mid} + ${remaining.length - mid}`,
        );
        await recover(remaining.slice(0, mid), depth + 1);
        await recover(remaining.slice(mid), depth + 1);
        return;
      }
      if (n < maxAttempts) await sleep(backoffDelay(n, baseDelayMs));
    }
    failed.push(...remaining);
  };

  await recover(keys, 0);

  if (failed.length > 0) {
    const sample = failed.slice(0, 3).join('", "');
    const cause =
      lastError instanceof Error ? ` (last error: ${lastError.message})` : "";
    throw new Error(
      `model returned no translation for ${failed.length} of ${keys.length} keys after ${maxAttempts} attempts (e.g. "${sample}")${cause}`,
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
    // Scale the output ceiling with document size so long documents are not
    // truncated by provider-default limits.
    maxTokens: Math.min(32_000, 2_000 + Math.ceil(content.length / 2)),
    prompt: [
      `Translate this Markdown/MDX content from "${sourceLocale}" to "${targetLocale}".`,
      `Return the complete translated document.`,
      ``,
      content,
    ].join("\n"),
  });

  return object.translated;
}
