import { afterAll, expect, test } from "bun:test";
import { mkdtempSync, rmSync, symlinkSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";

const dir = mkdtempSync(join(tmpdir(), "st-bin-"));
afterAll(() => rmSync(dir, { recursive: true, force: true }));
const cli = resolve(import.meta.dir, "../src/cli.ts");

test("CLI runs through package-manager bin symlinks", () => {
  const bin = join(dir, "solid-translate");
  symlinkSync(cli, bin);
  const result = Bun.spawnSync([process.execPath, bin, "--help"]);
  expect(result.exitCode).toBe(0);
  expect(result.stdout.toString()).toContain("solid-translate — AI-powered translation CLI");
});

test("importing CLI helpers does not print usage or exit the process", () => {
  const result = Bun.spawnSync([process.execPath, "--eval",
    `await import(${JSON.stringify(cli)}); console.log("import completed");`,
  ]);
  expect(result.exitCode).toBe(0);
  expect(result.stdout.toString().trim()).toBe("import completed");
});
