import { describe, test, expect } from "bun:test";
import { hashContent } from "../src/hash";

describe("hashContent", () => {
  test("produces consistent hashes", () => {
    const hash1 = hashContent("Hello world");
    const hash2 = hashContent("Hello world");
    expect(hash1).toBe(hash2);
  });

  test("produces different hashes for different content", () => {
    const hash1 = hashContent("Hello");
    const hash2 = hashContent("World");
    expect(hash1).not.toBe(hash2);
  });

  test("produces 16-character hex strings", () => {
    const hash = hashContent("test content");
    expect(hash).toHaveLength(16);
    expect(hash).toMatch(/^[0-9a-f]{16}$/);
  });

  test("handles empty strings", () => {
    const hash = hashContent("");
    expect(hash).toHaveLength(16);
  });

  test("handles unicode content", () => {
    const hash = hashContent("¡Hola mundo! 🌍");
    expect(hash).toHaveLength(16);
  });
});
