import { describe, test, expect } from "bun:test";
import { extractStringsFromSource } from "../src/extract";

describe("extractStringsFromSource", () => {
  test("extracts plain <T> text", () => {
    const code = `<T>Hello world</T>`;
    const result = extractStringsFromSource(code, "test.tsx");
    expect(result).toHaveLength(1);
    expect(result[0]!.key).toBe("Hello world");
    expect(result[0]!.source).toBe("Hello world");
    expect(result[0]!.file).toBe("test.tsx");
  });

  test("extracts <T id=...> with explicit key", () => {
    const code = `<T id="greeting">Hello there!</T>`;
    const result = extractStringsFromSource(code, "test.tsx");
    expect(result).toHaveLength(1);
    expect(result[0]!.key).toBe("greeting");
    expect(result[0]!.source).toBe("Hello there!");
  });

  test("extracts multiple strings", () => {
    const code = `
      <div>
        <T>Welcome</T>
        <T>Goodbye</T>
        <T id="nav.home">Home</T>
      </div>
    `;
    const result = extractStringsFromSource(code, "page.tsx");
    expect(result).toHaveLength(3);
    expect(result.map((r) => r.key)).toEqual(["nav.home", "Welcome", "Goodbye"]);
  });

  test("deduplicates identical strings", () => {
    const code = `<T>Hello</T> <T>Hello</T>`;
    const result = extractStringsFromSource(code, "test.tsx");
    expect(result).toHaveLength(1);
  });

  test("trims whitespace from text", () => {
    const code = `<T>  Hello world  </T>`;
    const result = extractStringsFromSource(code, "test.tsx");
    expect(result[0]!.source).toBe("Hello world");
  });

  test("tracks line numbers", () => {
    const code = `line 1\nline 2\n<T>Hello</T>\nline 4`;
    const result = extractStringsFromSource(code, "test.tsx");
    expect(result[0]!.line).toBe(3);
  });

  test("handles empty file", () => {
    const result = extractStringsFromSource("", "empty.tsx");
    expect(result).toHaveLength(0);
  });

  test("ignores non-T components", () => {
    const code = `<div>Hello</div><span>World</span>`;
    const result = extractStringsFromSource(code, "test.tsx");
    expect(result).toHaveLength(0);
  });

  test("handles single-quoted id attributes", () => {
    const code = `<T id='greeting'>Hi</T>`;
    const result = extractStringsFromSource(code, "test.tsx");
    expect(result[0]!.key).toBe("greeting");
  });
});
