import { describe, test, expect } from "bun:test";
import { extractStringsFromSource, type ExtractWarning } from "../src/extract";

describe("extractStringsFromSource — import binding resolution", () => {
  // -------------------------------------------------------------------------
  // False positives: identifiers that merely share a marker's name
  // -------------------------------------------------------------------------

  test("msg as a callback param is not a marker (no warning, no extraction)", () => {
    const code = `
      import { Match, Switch } from "solid-js";
      const el = (
        <Switch>
          <Match when={thing()}>
            {(msg) => <div title={msg().title}>{msg()}</div>}
          </Match>
        </Switch>
      );
    `;
    const warnings: ExtractWarning[] = [];
    const result = extractStringsFromSource(code, "test.tsx", warnings);
    expect(result).toHaveLength(0);
    expect(warnings).toHaveLength(0);
  });

  test("msg param calls with string args are not extracted", () => {
    const code = `
      const run = (msg) => msg("Not a translation");
    `;
    const result = extractStringsFromSource(code, "test.tsx");
    expect(result).toHaveLength(0);
  });

  test("local const msg function is not extracted", () => {
    const code = `
      const msg = (s: string) => s.toUpperCase();
      const a = msg("Shout this");
    `;
    const warnings: ExtractWarning[] = [];
    const result = extractStringsFromSource(code, "test.ts", warnings);
    expect(result).toHaveLength(0);
    expect(warnings).toHaveLength(0);
  });

  test("msg declared inside a function body is not extracted", () => {
    const code = `
      function outer() {
        const msg = (s: string) => s;
        return msg("Local only");
      }
    `;
    const result = extractStringsFromSource(code, "test.ts");
    expect(result).toHaveLength(0);
  });

  test("msg imported from an unrelated module is not extracted", () => {
    const code = `
      import { msg } from "some-logging-lib";
      const a = msg("Log line");
    `;
    const result = extractStringsFromSource(code, "test.ts");
    expect(result).toHaveLength(0);
  });

  test("<T> bound to a local component is not extracted", () => {
    const code = `
      const T = (props: { children: any }) => <span>{props.children}</span>;
      const x = <T>Local component text</T>;
    `;
    const warnings: ExtractWarning[] = [];
    const result = extractStringsFromSource(code, "test.tsx", warnings);
    expect(result).toHaveLength(0);
    expect(warnings).toHaveLength(0);
  });

  test("<T> imported from another library is not extracted", () => {
    const code = `
      import { T } from "some-ui-kit";
      const x = <T>Not ours</T>;
    `;
    const result = extractStringsFromSource(code, "test.tsx");
    expect(result).toHaveLength(0);
  });

  test("<Plural> bound to a local component is not extracted", () => {
    const code = `
      function Plural(props: any) { return null; }
      const x = <Plural n={count()} one="1 item" other="{n} items" />;
    `;
    const result = extractStringsFromSource(code, "test.tsx");
    expect(result).toHaveLength(0);
  });

  // -------------------------------------------------------------------------
  // True positives: real solid-translate bindings, aliased and re-exported
  // -------------------------------------------------------------------------

  test("msg imported from solid-translate is extracted", () => {
    const code = `
      import { msg } from "solid-translate";
      const a = msg("Save changes");
    `;
    const result = extractStringsFromSource(code, "test.ts");
    expect(result).toHaveLength(1);
    expect(result[0]!.key).toBe("Save changes");
  });

  test("aliased import `import { msg as m }` is extracted", () => {
    const code = `
      import { msg as m } from "solid-translate";
      const a = m("Aliased marker");
    `;
    const result = extractStringsFromSource(code, "test.ts");
    expect(result).toHaveLength(1);
    expect(result[0]!.key).toBe("Aliased marker");
  });

  test("re-export wrapper `import { msg } from \"@/i18n\"` is extracted", () => {
    const code = `
      import { msg } from "@/i18n";
      const a = msg("From re-export");
    `;
    const result = extractStringsFromSource(code, "test.ts");
    expect(result).toHaveLength(1);
    expect(result[0]!.key).toBe("From re-export");
  });

  test("relative i18n re-export paths are accepted by default", () => {
    const code = `
      import { msg } from "../lib/i18n";
      const a = msg("Relative re-export");
    `;
    const result = extractStringsFromSource(code, "test.ts");
    expect(result).toHaveLength(1);
    expect(result[0]!.key).toBe("Relative re-export");
  });

  test("aliased <T> import is extracted", () => {
    const code = `
      import { T as Trans } from "solid-translate";
      const x = <Trans>Aliased element</Trans>;
    `;
    const result = extractStringsFromSource(code, "test.tsx");
    expect(result).toHaveLength(1);
    expect(result[0]!.key).toBe("Aliased element");
  });

  test("shadowing only applies inside the shadowing scope", () => {
    const code = `
      import { msg } from "solid-translate";
      const outer = msg("Outer real");
      const inner = (msg: (s: string) => string) => msg("Inner shadowed");
      const after = msg("After real");
    `;
    const result = extractStringsFromSource(code, "test.ts");
    expect(result.map((r) => r.key)).toEqual(["Outer real", "After real"]);
  });

  // -------------------------------------------------------------------------
  // Backwards compatibility: unbound identifiers stay markers
  // -------------------------------------------------------------------------

  test("unbound <T> and msg() are still extracted (snippet sources)", () => {
    const code = `
      const x = <T>Ambient element</T>;
      const a = msg("Ambient call");
    `;
    const result = extractStringsFromSource(code, "test.tsx");
    expect(result.map((r) => r.key)).toEqual(["Ambient element", "Ambient call"]);
  });

  // -------------------------------------------------------------------------
  // Configurable accepted sources
  // -------------------------------------------------------------------------

  test("importSources option accepts custom specifiers", () => {
    const code = `
      import { msg } from "#translate";
      const a = msg("Custom wrapper");
    `;
    const without = extractStringsFromSource(code, "test.ts");
    expect(without).toHaveLength(0);

    const withOption = extractStringsFromSource(code, "test.ts", undefined, {
      importSources: ["#translate"],
    });
    expect(withOption).toHaveLength(1);
    expect(withOption[0]!.key).toBe("Custom wrapper");
  });

  test("importSources option replaces the default i18n heuristic but keeps solid-translate", () => {
    const code = `
      import { msg } from "@/i18n";
      const a = msg("Heuristic path");
    `;
    const result = extractStringsFromSource(code, "test.ts", undefined, {
      importSources: ["#translate"],
    });
    expect(result).toHaveLength(0);

    const direct = extractStringsFromSource(
      `import { msg } from "solid-translate"; const a = msg("Always ok");`,
      "test.ts",
      undefined,
      { importSources: ["#translate"] },
    );
    expect(direct).toHaveLength(1);
  });
});
