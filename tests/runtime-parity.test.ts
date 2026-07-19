/**
 * Runtime key-parity integration tests.
 *
 * Each fixture is compiled with the REAL Solid JSX compiler
 * (babel-preset-solid / dom-expressions), rendered into happy-dom with a
 * translation dictionary keyed by whatever `extractStringsFromSource`
 * produced for the very same source — then we assert the translated text
 * actually appears. This proves extraction keys and runtime lookup keys
 * are identical, end to end.
 *
 * NOTE: requires the browser export condition (`bun test
 * --conditions=browser`, i.e. `bun run test`) so solid-js resolves to its
 * client build instead of the server build.
 */
import { describe, test, expect, afterAll } from "bun:test";
import { mkdirSync, writeFileSync, rmSync } from "node:fs";
import { join } from "node:path";
import { extractStringsFromSource } from "../src/extract";

// @ts-expect-error — no type declarations shipped
import { transformAsync } from "@babel/core";
// @ts-expect-error — no type declarations shipped
import presetSolid from "babel-preset-solid";

const FIXTURE_DIR = join(import.meta.dir, ".tmp-fixtures");
mkdirSync(FIXTURE_DIR, { recursive: true });
afterAll(() => {
  rmSync(FIXTURE_DIR, { recursive: true, force: true });
});

let fixtureId = 0;

/**
 * Compile a JSX snippet with babel-preset-solid, render it inside a
 * TranslationProvider, and return the container plus the extracted keys.
 */
async function renderFixture(
  snippet: string,
  options: {
    translations: Record<string, Record<string, string>>;
    locale?: string;
    props?: Record<string, unknown>;
  },
): Promise<{
  container: HTMLElement;
  keys: string[];
  dispose: () => void;
}> {
  const source = `
import { T, Var, Num, Currency, DateTime, Plural, TranslationProvider } from "../../src/index.ts";

export default function Fixture(props) {
  return (
    <TranslationProvider locale={props.__locale} translations={props.__translations}>
      <div id="out">${snippet}</div>
    </TranslationProvider>
  );
}
`;

  const keys = extractStringsFromSource(source, "fixture.tsx").map(
    (e) => e.key,
  );

  const compiled = await transformAsync(source, {
    presets: [[presetSolid, { generate: "dom", hydratable: false }]],
    filename: "fixture.tsx",
  });

  const path = join(FIXTURE_DIR, `fixture-${fixtureId++}.mjs`);
  writeFileSync(path, compiled!.code!);
  const mod = await import(path);

  const { render } = await import("solid-js/web");
  const container = document.createElement("div");
  document.body.appendChild(container);

  const dispose = render(
    () =>
      mod.default({
        __locale: options.locale ?? "es",
        __translations: options.translations,
        ...options.props,
      }),
    container,
  );

  return {
    container,
    keys,
    dispose: () => {
      dispose();
      container.remove();
    },
  };
}

const out = (c: HTMLElement) => c.querySelector("#out")!.textContent;

describe("extraction ↔ runtime key parity", () => {
  test("(a) text with apostrophes", async () => {
    const { container, keys, dispose } = await renderFixture(
      `<T>Don't save</T>`,
      { translations: { es: { "Don't save": "No guardes" } } },
    );
    expect(keys).toEqual(["Don't save"]);
    expect(out(container)).toBe("No guardes");
    dispose();
  });

  test("(b) msg() key matches its runtime return value", async () => {
    // msg() is a runtime no-op: the string itself is the runtime key that
    // t() looks up. Extraction of the template literal must yield the same.
    const source = "const label = msg(`Save changes`);";
    const keys = extractStringsFromSource(source, "x.ts").map((e) => e.key);
    const { msg } = await import("../src/msg");
    expect(keys).toEqual([msg(`Save changes`)]);
  });

  test("(c) dynamic expression children build {0} keys", async () => {
    const { container, keys, dispose } = await renderFixture(
      `<T>Hello {props.name()}</T>`,
      {
        translations: { es: { "Hello {0}": "Hola {0}!" } },
        props: { name: () => "Alice" },
      },
    );
    expect(keys).toEqual(["Hello {0}"]);
    expect(out(container)).toBe("Hola Alice!");
    dispose();
  });

  test("(d) element children become slots and stay rendered", async () => {
    const { container, keys, dispose } = await renderFixture(
      `<T>Click <a href="/docs">here</a> now</T>`,
      { translations: { es: { "Click {0} now": "Cliquez {0} maintenant" } } },
    );
    expect(keys).toEqual(["Click {0} now"]);
    expect(out(container)).toBe("Cliquez here maintenant");
    const anchor = container.querySelector("a")!;
    expect(anchor.getAttribute("href")).toBe("/docs");
    expect(anchor.textContent).toBe("here");
    dispose();
  });

  test("(e) multiline text collapses identically on both sides", async () => {
    const { container, keys, dispose } = await renderFixture(
      `<T>
        Hello world,
        this is multiline
      </T>`,
      {
        translations: {
          es: { "Hello world, this is multiline": "Hola mundo multilinea" },
        },
      },
    );
    expect(keys).toEqual(["Hello world, this is multiline"]);
    expect(out(container)).toBe("Hola mundo multilinea");
    dispose();
  });

  test("(e) multiline text around a slot (no space before continuation)", async () => {
    const { container, keys, dispose } = await renderFixture(
      `<T>
        Hello <Var>{props.name()}</Var>
        more text
      </T>`,
      {
        translations: { es: { "Hello {0}more text": "Hola {0} y mas" } },
        props: { name: () => "Bob" },
      },
    );
    expect(keys).toEqual(["Hello {0}more text"]);
    expect(out(container)).toBe("Hola Bob y mas");
    dispose();
  });

  test("(f) attributes containing '>' still translate", async () => {
    const { container, keys, dispose } = await renderFixture(
      `<T params={{ ok: 2 > 1 ? "y" : "n" }}>Compare</T>`,
      { translations: { es: { Compare: "Comparar" } } },
    );
    expect(keys).toEqual(["Compare"]);
    expect(out(container)).toBe("Comparar");
    dispose();
  });

  test("(g) self-closing <T id=.../> translates via its id", async () => {
    const { container, keys, dispose } = await renderFixture(
      `<T id="standalone.key" />`,
      { translations: { es: { "standalone.key": "Autonomo" } } },
    );
    expect(keys).toEqual(["standalone.key"]);
    expect(out(container)).toBe("Autonomo");
    dispose();
  });

  test("Var/Currency slots interpolate and reorder", async () => {
    const { container, keys, dispose } = await renderFixture(
      `<T>You owe <Currency currency="USD">{props.amount()}</Currency> to <Var>{props.name()}</Var></T>`,
      {
        translations: {
          es: { "You owe {0} to {1}": "Le debes {0} a {1}" },
        },
        props: { amount: () => 29.99, name: () => "Alice" },
      },
    );
    expect(keys).toEqual(["You owe {0} to {1}"]);
    // Currency renders with the active locale's (es) formatting
    expect(out(container)).toBe(
      `Le debes ${new Intl.NumberFormat("es", { style: "currency", currency: "USD" }).format(29.99)} a Alice`,
    );
    dispose();
  });

  test("static literal expressions merge into the key on both sides", async () => {
    const { container, keys, dispose } = await renderFixture(
      `<T>Hi {"there"} friend, you have {5} items</T>`,
      {
        translations: {
          es: {
            "Hi there friend, you have 5 items": "Hola amigo, tienes 5 cosas",
          },
        },
      },
    );
    expect(keys).toEqual(["Hi there friend, you have 5 items"]);
    expect(out(container)).toBe("Hola amigo, tienes 5 cosas");
    dispose();
  });

  test("HTML entities decode identically on both sides", async () => {
    const { container, keys, dispose } = await renderFixture(
      `<T>Don&apos;t &amp; stop</T>`,
      { translations: { es: { "Don't & stop": "No pares" } } },
    );
    expect(keys).toEqual(["Don't & stop"]);
    expect(out(container)).toBe("No pares");
    dispose();
  });

  test("edge whitespace stays out of the key but is preserved in render", async () => {
    const { container, keys, dispose } = await renderFixture(
      `<span>before</span><T> padded </T><span>after</span>`,
      { translations: { es: { padded: "relleno" } } },
    );
    expect(keys).toEqual(["padded"]);
    expect(out(container)).toBe("before relleno after");
    dispose();
  });

  test("id + params translate with interpolation", async () => {
    const { container, keys, dispose } = await renderFixture(
      `<T id="greeting" params={{ name: "Ana" }}>Hello {"{{name}}"}</T>`,
      { translations: { es: { greeting: "Hola {{name}}" } } },
    );
    expect(keys).toEqual(["greeting"]);
    expect(out(container)).toBe("Hola Ana");
    dispose();
  });

  test("missing translation falls back to source text with slots", async () => {
    const { container, keys, dispose } = await renderFixture(
      `<T>Hello {props.name()}</T>`,
      { translations: { es: {} }, props: { name: () => "Zed" } },
    );
    expect(keys).toEqual(["Hello {0}"]);
    expect(out(container)).toBe("Hello Zed");
    dispose();
  });

  test("(h) <Plural> forms translate through the dictionary", async () => {
    const translations = {
      es: {
        "No items": "Sin articulos",
        "1 item": "1 articulo",
        "{n} items": "{n} articulos",
      },
    };
    const snippet = (n: number) =>
      `<Plural n={${n}} zero="No items" one="1 item" other="{n} items" />`;

    const one = await renderFixture(snippet(1), { translations });
    expect(one.keys).toEqual(["No items", "1 item", "{n} items"]);
    expect(out(one.container)).toBe("1 articulo");
    one.dispose();

    const five = await renderFixture(snippet(5), { translations });
    expect(out(five.container)).toBe("5 articulos");
    five.dispose();

    const zero = await renderFixture(snippet(0), { translations });
    // CLDR: 0 selects "other" in en/es — "zero" is only used by locales
    // whose plural rules have a zero category
    expect(out(zero.container)).toBe("0 articulos");
    zero.dispose();
  });

  test("<T> without a provider renders source content unchanged", async () => {
    const source = `
import { T, Var } from "../../src/index.ts";
export default function Fixture(props) {
  return <div id="out"><T>Hello <Var>{props.name()}</Var>!</T></div>;
}
`;
    const compiled = await transformAsync(source, {
      presets: [[presetSolid, { generate: "dom", hydratable: false }]],
      filename: "fixture.tsx",
    });
    const path = join(FIXTURE_DIR, `fixture-${fixtureId++}.mjs`);
    writeFileSync(path, compiled!.code!);
    const mod = await import(path);
    const { render } = await import("solid-js/web");
    const container = document.createElement("div");
    document.body.appendChild(container);
    const dispose = render(
      () => mod.default({ name: () => "Ada" }),
      container,
    );
    expect(out(container)).toBe("Hello Ada!");
    dispose();
    container.remove();
  });

  test("locale switching re-renders translated content", async () => {
    const source = `
import { T, TranslationProvider, useLocale } from "../../src/index.ts";

function Inner() {
  const { setLocale } = useLocale();
  return (
    <>
      <div id="out"><T>Good morning</T></div>
      <button id="switch" onClick={() => setLocale("fr")}>fr</button>
    </>
  );
}

export default function Fixture(props) {
  return (
    <TranslationProvider locale="es" translations={props.__translations}>
      <Inner />
    </TranslationProvider>
  );
}
`;
    const keys = extractStringsFromSource(source, "fixture.tsx").map(
      (e) => e.key,
    );
    expect(keys).toContain("Good morning");

    const compiled = await transformAsync(source, {
      presets: [[presetSolid, { generate: "dom", hydratable: false }]],
      filename: "fixture.tsx",
    });
    const path = join(FIXTURE_DIR, `fixture-${fixtureId++}.mjs`);
    writeFileSync(path, compiled!.code!);
    const mod = await import(path);
    const { render } = await import("solid-js/web");
    const container = document.createElement("div");
    document.body.appendChild(container);
    const dispose = render(
      () =>
        mod.default({
          __translations: {
            es: { "Good morning": "Buenos dias" },
            fr: { "Good morning": "Bonjour" },
          },
        }),
      container,
    );
    expect(out(container)).toBe("Buenos dias");
    (container.querySelector("#switch") as HTMLButtonElement).click();
    expect(out(container)).toBe("Bonjour");
    dispose();
    container.remove();
  });
});
