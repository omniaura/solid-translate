import { describe, test, expect } from "bun:test";
import { resolveOpenAICompatible } from "../src/cli";

describe("openai-compatible provider config", () => {
  test("requires baseURL", () => {
    expect(() =>
      resolveOpenAICompatible({ targetLocales: ["es"], provider: "openai-compatible" }),
    ).toThrow(/requires "baseURL"/);
  });

  test("trims trailing slashes and defaults the key env", () => {
    expect(
      resolveOpenAICompatible({
        targetLocales: ["es"],
        provider: "openai-compatible",
        baseURL: "https://api.heyditto.ai/v1///",
      }),
    ).toEqual({ baseURL: "https://api.heyditto.ai/v1", apiKeyEnv: "OPENAI_COMPATIBLE_API_KEY" });
  });

  test("honours apiKeyEnv", () => {
    expect(
      resolveOpenAICompatible({
        targetLocales: ["es"],
        provider: "openai-compatible",
        baseURL: "https://gw.example/v1",
        apiKeyEnv: "DITTO_TRANSLATE_KEY",
      }).apiKeyEnv,
    ).toBe("DITTO_TRANSLATE_KEY");
  });
});
