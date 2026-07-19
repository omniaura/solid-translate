import { describe, test, expect, afterAll } from "bun:test";
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, dirname, resolve } from "node:path";
import { hashContent } from "../src/hash";

const CLI_PATH = resolve(import.meta.dir, "../src/cli.ts");

const fixtures: string[] = [];

afterAll(() => {
  for (const dir of fixtures) {
    rmSync(dir, { recursive: true, force: true });
  }
});

/** Write a fixture project to a temp dir */
function makeFixture(files: Record<string, string>): string {
  const dir = mkdtempSync(join(tmpdir(), "st-check-"));
  fixtures.push(dir);
  for (const [path, content] of Object.entries(files)) {
    const full = join(dir, path);
    mkdirSync(dirname(full), { recursive: true });
    writeFileSync(full, content);
  }
  return dir;
}

function runCheck(cwd: string): { exitCode: number; report: any } {
  const proc = Bun.spawnSync({
    cmd: [process.execPath, CLI_PATH, "check", "--json"],
    cwd,
    stdout: "pipe",
    stderr: "pipe",
  });
  const stdout = proc.stdout.toString();
  let report: any = null;
  try {
    report = JSON.parse(stdout);
  } catch {
    throw new Error(
      `check did not print valid JSON.\nstdout: ${stdout}\nstderr: ${proc.stderr.toString()}`,
    );
  }
  return { exitCode: proc.exitCode, report };
}

const config = JSON.stringify({
  sourceLocale: "en",
  targetLocales: ["es"],
  localesDir: "./locales",
  include: ["src/**/*.tsx"],
});

const freshLock = JSON.stringify({
  version: 1,
  sourceLocale: "en",
  keys: {
    "Hello world": {
      hash: hashContent("Hello world"),
      source: "Hello world",
    },
  },
});

const baseFixture = {
  "solid-translate.config.json": config,
  "src/App.tsx": `export function App() {\n  return <T>Hello world</T>;\n}\n`,
  "locales/en.json": JSON.stringify({ "Hello world": "Hello world" }),
  "locales/es.json": JSON.stringify({ "Hello world": "Hola mundo" }),
  "locales/.solid-translate.lock": freshLock,
};

describe("check command", () => {
  test("fresh lock and complete locale files exit 0", () => {
    const dir = makeFixture(baseFixture);
    const { exitCode, report } = runCheck(dir);
    expect(exitCode).toBe(0);
    expect(report.fresh).toBe(true);
    expect(report.lock.missing).toEqual([]);
    expect(report.lock.changed).toEqual([]);
    expect(report.lock.orphaned).toEqual([]);
    expect(report.locales.es.missing).toEqual([]);
    expect(report.locales.es.orphaned).toEqual([]);
  });

  test("edited source string exits 1 and reports changed key", () => {
    const dir = makeFixture({
      ...baseFixture,
      "locales/en.json": JSON.stringify({
        "Hello world": "Hello, world!",
      }),
    });
    const { exitCode, report } = runCheck(dir);
    expect(exitCode).toBe(1);
    expect(report.fresh).toBe(false);
    expect(report.lock.changed).toEqual(["Hello world"]);
    expect(report.lock.missing).toEqual([]);
  });

  test("new source string exits 1 and reports missing key everywhere", () => {
    const dir = makeFixture({
      ...baseFixture,
      "src/App.tsx": `export function App() {\n  return (\n    <>\n      <T>Hello world</T>\n      <T>Goodbye</T>\n    </>\n  );\n}\n`,
    });
    const { exitCode, report } = runCheck(dir);
    expect(exitCode).toBe(1);
    expect(report.fresh).toBe(false);
    expect(report.lock.missing).toEqual(["Goodbye"]);
    expect(report.locales.es.missing).toEqual(["Goodbye"]);
  });

  test("missing key in a target locale file exits 1", () => {
    const dir = makeFixture({
      ...baseFixture,
      "locales/es.json": JSON.stringify({}),
    });
    const { exitCode, report } = runCheck(dir);
    expect(exitCode).toBe(1);
    expect(report.fresh).toBe(false);
    expect(report.lock.missing).toEqual([]);
    expect(report.lock.changed).toEqual([]);
    expect(report.locales.es.missing).toEqual(["Hello world"]);
  });

  test("deleted source string reports orphaned lock and locale keys", () => {
    const dir = makeFixture({
      ...baseFixture,
      "src/App.tsx": `export function App() {\n  return null;\n}\n`,
      "locales/en.json": JSON.stringify({}),
    });
    const { exitCode, report } = runCheck(dir);
    expect(exitCode).toBe(1);
    expect(report.lock.orphaned).toEqual(["Hello world"]);
    expect(report.locales.es.orphaned).toEqual(["Hello world"]);
  });

  test("changed context prop reports changed key", () => {
    const dir = makeFixture({
      ...baseFixture,
      "src/App.tsx": `export function App() {\n  return <T context="a greeting">Hello world</T>;\n}\n`,
    });
    const { exitCode, report } = runCheck(dir);
    expect(exitCode).toBe(1);
    expect(report.lock.changed).toEqual(["Hello world"]);
  });

  test("missing target locale file reports every key missing", () => {
    const { "locales/es.json": _es, ...withoutEs } = baseFixture;
    const dir = makeFixture(withoutEs);
    const { exitCode, report } = runCheck(dir);
    expect(exitCode).toBe(1);
    expect(report.locales.es.fileExists).toBe(false);
    expect(report.locales.es.missing).toEqual(["Hello world"]);
  });
});
