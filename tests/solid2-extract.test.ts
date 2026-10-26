import { describe, expect, test } from "bun:test";
import { extractStringsFromSource } from "../src/extract";

describe("Solid 2 extraction", () => {
  test("finds translations inside Loading, Errored, class arrays and ref factories", () => {
    const source = `
      import { Loading, Errored } from "solid-js";
      import { T, Var } from "solid-translate";
      const App = () => <Errored fallback={err => <T>Failed to load</T>}>
        <Loading fallback={<T>Loading content</T>}>
          <section class={["panel", { active: enabled() }]} ref={attach()}>
            <T>Hello <Var>{name()}</Var></T>
          </section>
        </Loading>
      </Errored>;
    `;
    expect(extractStringsFromSource(source, "App.tsx").map(({ key }) => key))
      .toEqual(["Failed to load", "Loading content", "Hello {0}"]);
  });
});
