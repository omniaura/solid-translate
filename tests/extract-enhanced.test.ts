import { describe, test, expect } from "bun:test";
import { extractStringsFromSource, type ExtractWarning } from "../src/extract";

describe("extractStringsFromSource — enhanced features", () => {
  test("extracts context prop", () => {
    const code = `<T context="Button to save a document">Save</T>`;
    const result = extractStringsFromSource(code, "test.tsx");
    expect(result).toHaveLength(1);
    expect(result[0]!.key).toBe("Save");
    expect(result[0]!.context).toBe("Button to save a document");
  });

  test("extracts id + context together", () => {
    const code = `<T id="save_btn" context="save file to disk">Save</T>`;
    const result = extractStringsFromSource(code, "test.tsx");
    expect(result).toHaveLength(1);
    expect(result[0]!.key).toBe("save_btn");
    expect(result[0]!.source).toBe("Save");
    expect(result[0]!.context).toBe("save file to disk");
  });

  test("replaces <Var> with {n} placeholders", () => {
    const code = `<T>Hello <Var>{name}</Var>, welcome!</T>`;
    const result = extractStringsFromSource(code, "test.tsx");
    expect(result).toHaveLength(1);
    expect(result[0]!.key).toBe("Hello {0}, welcome!");
    expect(result[0]!.source).toBe("Hello {0}, welcome!");
  });

  test("replaces multiple Var/Num/Currency components", () => {
    const code = `<T>You owe <Currency>{amount}</Currency> to <Var>{name}</Var></T>`;
    const result = extractStringsFromSource(code, "test.tsx");
    expect(result).toHaveLength(1);
    expect(result[0]!.source).toBe("You owe {0} to {1}");
  });

  test("replaces <Num> with placeholder", () => {
    const code = `<T>You have <Num>{count}</Num> items</T>`;
    const result = extractStringsFromSource(code, "test.tsx");
    expect(result).toHaveLength(1);
    expect(result[0]!.source).toBe("You have {0} items");
  });

  test("replaces <DateTime> with placeholder", () => {
    const code = `<T>Created on <DateTime>{date}</DateTime></T>`;
    const result = extractStringsFromSource(code, "test.tsx");
    expect(result).toHaveLength(1);
    expect(result[0]!.source).toBe("Created on {0}");
  });

  test("extracts msg() calls", () => {
    const code = `
      const label = msg("Save changes");
      const greeting = msg('Hello world');
    `;
    const result = extractStringsFromSource(code, "utils.ts");
    expect(result).toHaveLength(2);
    expect(result.map((r) => r.key)).toContain("Save changes");
    expect(result.map((r) => r.key)).toContain("Hello world");
  });

  test("extracts msg() with params", () => {
    const code = `const text = msg("Hello {{name}}", { name: "World" });`;
    const result = extractStringsFromSource(code, "test.ts");
    expect(result).toHaveLength(1);
    expect(result[0]!.key).toBe("Hello {{name}}");
  });

  test("deduplicates msg() and <T> with same text", () => {
    const code = `
      const label = msg("Hello");
      const el = <T>Hello</T>;
    `;
    const result = extractStringsFromSource(code, "test.tsx");
    expect(result).toHaveLength(1);
  });

  test("handles T with no context prop", () => {
    const code = `<T>No context here</T>`;
    const result = extractStringsFromSource(code, "test.tsx");
    expect(result[0]!.context).toBeUndefined();
  });

  test("handles mixed extraction from real-world code", () => {
    const code = `
      import { T, msg, Var, Num } from "solid-translate";

      const SAVE = msg("Save");
      const DELETE = msg("Delete");

      function App() {
        return (
          <div>
            <h1><T>Welcome to our app!</T></h1>
            <p><T context="user greeting">Hello <Var>{name}</Var></T></p>
            <p><T id="item_count">You have <Num>{count}</Num> items</T></p>
          </div>
        );
      }
    `;
    const result = extractStringsFromSource(code, "App.tsx");
    expect(result.length).toBeGreaterThanOrEqual(4);

    const keys = result.map((r) => r.key);
    expect(keys).toContain("Save");
    expect(keys).toContain("Delete");
    expect(keys).toContain("Welcome to our app!");
    expect(keys).toContain("item_count");
  });

  // -------------------------------------------------------------------------
  // AST-only behaviors
  // -------------------------------------------------------------------------

  test("id/context work with expression-container string values", () => {
    const code = `<T id={"expr.key"} context={\`hint\`}>Text</T>`;
    const result = extractStringsFromSource(code, "test.tsx");
    expect(result).toHaveLength(1);
    expect(result[0]!.key).toBe("expr.key");
    expect(result[0]!.context).toBe("hint");
  });

  test("static string/number literal expressions merge into the text", () => {
    const code = `<T>Hi {"there"} friend, you have {5} items</T>`;
    const result = extractStringsFromSource(code, "test.tsx");
    expect(result).toHaveLength(1);
    expect(result[0]!.key).toBe("Hi there friend, you have 5 items");
  });

  test("static string concatenation folds into the text", () => {
    const code = `<T>{"a" + "b"} c</T>`;
    const result = extractStringsFromSource(code, "test.tsx");
    expect(result).toHaveLength(1);
    expect(result[0]!.key).toBe("ab c");
  });

  test("null/undefined/boolean expression children are skipped", () => {
    const code = `<T>a{null}{undefined}{true}{false}b</T>`;
    const result = extractStringsFromSource(code, "test.tsx");
    expect(result).toHaveLength(1);
    expect(result[0]!.key).toBe("ab");
  });

  test("comment-only expression containers are skipped", () => {
    const code = `<T>a{/* note */}b</T>`;
    const result = extractStringsFromSource(code, "test.tsx");
    expect(result[0]!.key).toBe("ab");
  });

  test("HTML entities are decoded like the compiler", () => {
    const code = `<T>Don&apos;t &amp; won&#39;t&nbsp;stop</T>`;
    const result = extractStringsFromSource(code, "test.tsx");
    expect(result[0]!.key).toBe("Don't & won't stop");
  });

  test("multiline text around a Var matches compiler collapsing", () => {
    // dom-expressions strips the leading whitespace of continuation lines,
    // so there is NO space between the {0} slot and "more text".
    const code = `<T>
      Hello <Var>{name()}</Var>
      more text
    </T>`;
    const result = extractStringsFromSource(code, "test.tsx");
    expect(result[0]!.key).toBe("Hello {0}more text");
  });

  test("member expressions become placeholders", () => {
    const code = `<T>Hi {user.name} welcome</T>`;
    const result = extractStringsFromSource(code, "test.tsx");
    expect(result[0]!.key).toBe("Hi {0} welcome");
  });

  test("fragments are processed inline", () => {
    const code = `<T>x<>y<b>z</b></>w</T>`;
    const result = extractStringsFromSource(code, "test.tsx");
    expect(result[0]!.key).toBe("xy{0}w");
  });

  test("pure-placeholder <T> without id is skipped", () => {
    const code = `<T>{greeting()}</T>`;
    const result = extractStringsFromSource(code, "test.tsx");
    expect(result).toHaveLength(0);
  });

  // -------------------------------------------------------------------------
  // Warnings
  // -------------------------------------------------------------------------

  test("warns and skips <T> with a bare-identifier child", () => {
    // The compiler inlines bare identifiers raw — a string value would merge
    // into the runtime key, so the key cannot be known statically.
    const warnings: ExtractWarning[] = [];
    const code = `const el = <T>Hello {x} end</T>;`;
    const result = extractStringsFromSource(code, "test.tsx", warnings);
    expect(result).toHaveLength(0);
    expect(warnings).toHaveLength(1);
    expect(warnings[0]!.file).toBe("test.tsx");
    expect(warnings[0]!.line).toBe(1);
    expect(warnings[0]!.message).toContain("Var");
  });

  test("warns and skips <T> with an interpolated template child", () => {
    const warnings: ExtractWarning[] = [];
    const code = "const el = <T>{`hi ${x}`} end</T>;";
    const result = extractStringsFromSource(code, "test.tsx", warnings);
    expect(result).toHaveLength(0);
    expect(warnings).toHaveLength(1);
  });

  test("warns on dynamic msg() arguments", () => {
    const warnings: ExtractWarning[] = [];
    const code = [
      `const a = msg(someVar);`,
      "const b = msg(`Hello ${name}`);",
      `const c = msg("a" + dynamic);`,
    ].join("\n");
    const result = extractStringsFromSource(code, "test.ts", warnings);
    expect(result).toHaveLength(0);
    expect(warnings).toHaveLength(3);
    expect(warnings.map((w) => w.line)).toEqual([1, 2, 3]);
  });

  test("warns on spread props on <T> but still extracts children", () => {
    const warnings: ExtractWarning[] = [];
    const code = `<T {...rest}>Spread text</T>`;
    const result = extractStringsFromSource(code, "test.tsx", warnings);
    expect(result).toHaveLength(1);
    expect(result[0]!.key).toBe("Spread text");
    expect(warnings).toHaveLength(1);
    expect(warnings[0]!.message).toContain("spread");
  });

  test("warns and skips <T> with a dynamic id", () => {
    const warnings: ExtractWarning[] = [];
    const code = `<T id={dynamicKey()}>Text</T>`;
    const result = extractStringsFromSource(code, "test.tsx", warnings);
    expect(result).toHaveLength(0);
    expect(warnings).toHaveLength(1);
  });

  test("warns on non-literal <Plural> forms, extracts literal ones", () => {
    const warnings: ExtractWarning[] = [];
    const code = `<Plural n={c()} one="1 item" other={\`\${c()} items\`} />`;
    const result = extractStringsFromSource(code, "test.tsx", warnings);
    expect(result.map((r) => r.key)).toEqual(["1 item"]);
    expect(warnings).toHaveLength(1);
    expect(warnings[0]!.message).toContain("Plural");
  });
});
