import { describe, test, expect } from "bun:test";
import { MockLanguageModelV1 } from "ai/test";
import {
  translateBatch,
  batchMaxTokens,
  backoffDelay,
} from "../src/translate";

/**
 * Build a mock model whose generateText calls return the given texts in
 * order (an Error entry throws instead). Records every prompt so tests can
 * assert which keys each attempt asked for.
 */
function scriptedModel(responses: Array<string | Error>) {
  const prompts: string[] = [];
  let call = 0;
  const model = new MockLanguageModelV1({
    doGenerate: async (options) => {
      const last = options.prompt[options.prompt.length - 1];
      const content = Array.isArray(last?.content) ? last.content : [];
      const textPart = content.find((part) => part.type === "text") as
        | { type: "text"; text: string }
        | undefined;
      prompts.push(textPart?.text ?? "");
      const next = responses[Math.min(call, responses.length - 1)];
      call++;
      if (next instanceof Error) throw next;
      return {
        rawCall: { rawPrompt: null, rawSettings: {} },
        finishReason: "stop",
        usage: { promptTokens: 1, completionTokens: 1 },
        text: next ?? "",
      };
    },
  });
  return { model, prompts, calls: () => call };
}

/** Keys the prompt's JSON object asked the model to translate. */
function requestedKeys(prompt: string): string[] {
  const start = prompt.indexOf("{");
  const parsed = JSON.parse(prompt.slice(start)) as Record<string, string>;
  return Object.keys(parsed);
}

const noSleep = async () => {};

describe("translateBatch recovery", () => {
  test("returns on the first complete response", async () => {
    const { model, calls } = scriptedModel([
      JSON.stringify({ Hello: "Hola", Bye: "Adiós" }),
    ]);
    const out = await translateBatch(
      model,
      { Hello: "Hello", Bye: "Bye" },
      "es",
      "en",
      undefined,
      undefined,
      { sleep: noSleep },
    );
    expect(out).toEqual({ Hello: "Hola", Bye: "Adiós" });
    expect(calls()).toBe(1);
  });

  test("retries only the missing keys and merges partial progress", async () => {
    const { model, prompts } = scriptedModel([
      JSON.stringify({ Hello: "Hola" }), // Bye missing → progress made
      JSON.stringify({ Bye: "Adiós" }),
    ]);
    const out = await translateBatch(
      model,
      { Hello: "Hello", Bye: "Bye" },
      "es",
      "en",
      undefined,
      undefined,
      { sleep: noSleep },
    );
    expect(out).toEqual({ Hello: "Hola", Bye: "Adiós" });
    expect(requestedKeys(prompts[1]!)).toEqual(["Bye"]);
  });

  test("splits a batch that makes no progress and recovers each half", async () => {
    const entries = { A: "a", B: "b", C: "c", D: "d" };
    const { model, prompts } = scriptedModel([
      "{}", // whole batch: nothing → split into [A,B] + [C,D]
      JSON.stringify({ A: "α", B: "β" }),
      JSON.stringify({ C: "γ", D: "δ" }),
    ]);
    const out = await translateBatch(model, entries, "el", "en", undefined, undefined, {
      sleep: noSleep,
    });
    expect(out).toEqual({ A: "α", B: "β", C: "γ", D: "δ" });
    expect(requestedKeys(prompts[0]!)).toEqual(["A", "B", "C", "D"]);
    expect(requestedKeys(prompts[1]!)).toEqual(["A", "B"]);
    expect(requestedKeys(prompts[2]!)).toEqual(["C", "D"]);
  });

  test("a thrown error (unparseable JSON, network) is retried with backoff", async () => {
    const slept: number[] = [];
    const { model, calls } = scriptedModel([
      "Sorry, I cannot help with that.",
      new Error("429 rate limited"),
      JSON.stringify({ Hello: "Hola" }),
    ]);
    const out = await translateBatch(model, { Hello: "Hello" }, "es", "en", undefined, undefined, {
      maxAttempts: 3,
      baseDelayMs: 100,
      sleep: async (ms) => {
        slept.push(ms);
      },
    });
    expect(out).toEqual({ Hello: "Hola" });
    expect(calls()).toBe(3);
    expect(slept.length).toBe(2);
    expect(slept[1]!).toBeGreaterThan(slept[0]! * 1.2);
  });

  test("fails with the remaining keys after maxAttempts, naming the last error", async () => {
    const { model } = scriptedModel([new Error("upstream 503")]);
    await expect(
      translateBatch(model, { Hello: "Hello" }, "es", "en", undefined, undefined, {
        maxAttempts: 2,
        sleep: noSleep,
      }),
    ).rejects.toThrow(/1 of 1 keys after 2 attempts.*upstream 503/);
  });

  test("a single poisoned key fails alone while the rest of the batch succeeds into the error", async () => {
    // A and B translate; C never does. The error must mention only C.
    const { model } = scriptedModel([
      JSON.stringify({ A: "α", B: "β" }),
      "{}",
      "{}",
      "{}",
    ]);
    await expect(
      translateBatch(model, { A: "a", B: "b", C: "c" }, "el", "en", undefined, undefined, {
        maxAttempts: 3,
        sleep: noSleep,
      }),
    ).rejects.toThrow(/1 of 3 keys.*"C"/);
  });

  test("context hints only mention keys in the current subset", async () => {
    const { model, prompts } = scriptedModel([
      JSON.stringify({ Hello: "Hola" }),
      JSON.stringify({ Bye: "Adiós" }),
    ]);
    await translateBatch(
      model,
      { Hello: "Hello", Bye: "Bye" },
      "es",
      "en",
      undefined,
      { Hello: "greeting on the home screen", Bye: "farewell button" },
      { sleep: noSleep },
    );
    expect(prompts[0]).toContain("greeting on the home screen");
    expect(prompts[1]).not.toContain("greeting on the home screen");
    expect(prompts[1]).toContain("farewell button");
  });
});

describe("batchMaxTokens", () => {
  test("grows with key count and source length, capped at 32k", () => {
    expect(batchMaxTokens({ a: "b" })).toBe(2_000 + 400 + Math.ceil(2 * 1.5));
    const long = Object.fromEntries(
      Array.from({ length: 20 }, (_, i) => [`key ${i} ${"x".repeat(300)}`, "y".repeat(300)]),
    );
    expect(batchMaxTokens(long)).toBeGreaterThan(2_000 + 400 * 20 + 10_000);
    const huge = Object.fromEntries(
      Array.from({ length: 200 }, (_, i) => [`k${i}`, "z".repeat(2_000)]),
    );
    expect(batchMaxTokens(huge)).toBe(32_000);
  });
});

describe("backoffDelay", () => {
  test("doubles per attempt with jitter and caps at 30s", () => {
    const a1 = backoffDelay(1, 500);
    const a2 = backoffDelay(2, 500);
    const a3 = backoffDelay(3, 500);
    expect(a1).toBeGreaterThanOrEqual(375);
    expect(a1).toBeLessThanOrEqual(625);
    expect(a2).toBeGreaterThanOrEqual(750);
    expect(a3).toBeGreaterThanOrEqual(1_500);
    expect(backoffDelay(20, 500)).toBeLessThanOrEqual(37_500);
  });
});
