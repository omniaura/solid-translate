import { describe, test, expect } from "bun:test";
import { msg } from "../src/msg";

describe("msg", () => {
  test("returns source text as-is", () => {
    expect(msg("Hello world")).toBe("Hello world");
  });

  test("ignores params at runtime (no-op)", () => {
    expect(msg("Hello {{name}}", { name: "Alice" })).toBe("Hello {{name}}");
  });

  test("works with empty string", () => {
    expect(msg("")).toBe("");
  });
});
