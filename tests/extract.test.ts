import { describe, test, expect } from "bun:test";
import { extractStringsFromSource, type ExtractWarning } from "../src/extract";

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
      const page = (
        <div>
          <T>Welcome</T>
          <T>Goodbye</T>
          <T id="nav.home">Home</T>
        </div>
      );
    `;
    const result = extractStringsFromSource(code, "page.tsx");
    expect(result).toHaveLength(3);
    expect(result.map((r) => r.key)).toEqual(["Welcome", "Goodbye", "nav.home"]);
  });

  test("deduplicates identical strings", () => {
    const code = `const x = <div><T>Hello</T> <T>Hello</T></div>;`;
    const result = extractStringsFromSource(code, "test.tsx");
    expect(result).toHaveLength(1);
  });

  test("trims whitespace from text", () => {
    const code = `<T>  Hello world  </T>`;
    const result = extractStringsFromSource(code, "test.tsx");
    expect(result[0]!.source).toBe("Hello world");
  });

  test("tracks line numbers", () => {
    const code = `const a = 1;\nconst b = 2;\nconst c = <T>Hello</T>;\nconst d = 4;`;
    const result = extractStringsFromSource(code, "test.tsx");
    expect(result[0]!.line).toBe(3);
  });

  test("handles empty file", () => {
    const result = extractStringsFromSource("", "empty.tsx");
    expect(result).toHaveLength(0);
  });

  test("ignores non-T components", () => {
    const code = `const x = <div>Hello<span>World</span></div>;`;
    const result = extractStringsFromSource(code, "test.tsx");
    expect(result).toHaveLength(0);
  });

  test("handles single-quoted id attributes", () => {
    const code = `<T id='greeting'>Hi</T>`;
    const result = extractStringsFromSource(code, "test.tsx");
    expect(result[0]!.key).toBe("greeting");
  });

  // -------------------------------------------------------------------------
  // Defects of the old regex extractor
  // -------------------------------------------------------------------------

  test("(a) extracts text with apostrophes", () => {
    const code = `<T>Don't save</T>`;
    const result = extractStringsFromSource(code, "test.tsx");
    expect(result).toHaveLength(1);
    expect(result[0]!.key).toBe("Don't save");
  });

  test("(a) extracts msg() with apostrophes, escapes, and mixed quotes", () => {
    const code = `
      const a = msg("Don't save");
      const b = msg('He said "hi"');
      const c = msg("Line1\\nLine2");
      const d = msg('It\\'s fine');
    `;
    const result = extractStringsFromSource(code, "test.ts");
    expect(result.map((r) => r.key)).toEqual([
      "Don't save",
      'He said "hi"',
      "Line1\nLine2",
      "It's fine",
    ]);
  });

  test("(b) extracts msg() with no-substitution template literals", () => {
    const code = "const a = msg(`Save changes`);";
    const result = extractStringsFromSource(code, "test.ts");
    expect(result).toHaveLength(1);
    expect(result[0]!.key).toBe("Save changes");
  });

  test("(c) dynamic expression children become ordered placeholders", () => {
    const code = `<T>Hello {name()}</T>`;
    const result = extractStringsFromSource(code, "test.tsx");
    expect(result).toHaveLength(1);
    expect(result[0]!.key).toBe("Hello {0}");
  });

  test("(d) element children become placeholders, not raw HTML", () => {
    const code = `<T>Click <a href="/docs">here</a> to continue</T>`;
    const result = extractStringsFromSource(code, "test.tsx");
    expect(result).toHaveLength(1);
    expect(result[0]!.key).toBe("Click {0} to continue");
  });

  test("(e) multiline text collapses like the Solid JSX compiler", () => {
    const code = `<T>
      Hello world,
      this is multiline
    </T>`;
    const result = extractStringsFromSource(code, "test.tsx");
    expect(result).toHaveLength(1);
    expect(result[0]!.key).toBe("Hello world, this is multiline");
  });

  test("(f) attributes containing '>' do not corrupt extraction", () => {
    const code = `<T params={{ ok: a > b }}>Compare</T>`;
    const result = extractStringsFromSource(code, "test.tsx");
    expect(result).toHaveLength(1);
    expect(result[0]!.key).toBe("Compare");
  });

  test("(g) self-closing <T id=.../> is extracted", () => {
    const code = `<T id="standalone.key" />`;
    const result = extractStringsFromSource(code, "test.tsx");
    expect(result).toHaveLength(1);
    expect(result[0]!.key).toBe("standalone.key");
    expect(result[0]!.source).toBe("");
  });

  test("(h) extracts <Plural> string-literal forms", () => {
    const code = `<Plural n={count()} zero="No items" one="1 item" other="{n} items" />`;
    const result = extractStringsFromSource(code, "test.tsx");
    expect(result.map((r) => r.key)).toEqual([
      "No items",
      "1 item",
      "{n} items",
    ]);
  });

  test("(j) ignores <T> and msg() inside comments and string literals", () => {
    const code = `
      // <T>Not this one</T>
      /* msg("nor this") */
      const s = "<T>also not this</T>";
      const m = 'msg("still no")';
      const real = msg("Real string");
    `;
    const result = extractStringsFromSource(code, "test.ts");
    expect(result).toHaveLength(1);
    expect(result[0]!.key).toBe("Real string");
  });

  test("collects a warning on unparseable files", () => {
    const warnings: ExtractWarning[] = [];
    const result = extractStringsFromSource(
      `const = = <<>> not js at all ~~~`,
      "broken.ts",
      warnings,
    );
    expect(result).toHaveLength(0);
    expect(warnings.length).toBeGreaterThan(0);
  });
});
