import { createHash } from "node:crypto";

/** Create a short content hash for change detection */
export function hashContent(content: string): string {
  return createHash("sha256").update(content).digest("hex").slice(0, 16);
}
