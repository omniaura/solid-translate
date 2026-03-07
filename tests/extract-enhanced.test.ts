import { describe, test, expect } from "bun:test";
import { extractStringsFromSource } from "../src/extract";

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
});
