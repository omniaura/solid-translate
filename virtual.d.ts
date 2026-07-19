/**
 * Ambient types for the solid-translate virtual modules.
 *
 * Add to your project via a triple-slash reference:
 *
 * ```ts
 * /// <reference types="solid-translate/virtual" />
 * ```
 *
 * or in `tsconfig.json`:
 *
 * ```json
 * { "compilerOptions": { "types": ["solid-translate/virtual"] } }
 * ```
 */

declare module "virtual:solid-translate" {
  /** All translations keyed by locale code (eager — inlined at build time) */
  const translations: Record<string, Record<string, string>>;
  export default translations;
}

declare module "virtual:solid-translate/lazy" {
  /** Source locale code */
  export const sourceLocale: string;
  /** All available locale codes (source + targets) */
  export const locales: string[];
  /** Per-locale dictionary loaders (each is its own code-split chunk) */
  export const loaders: Record<
    string,
    () => Promise<Record<string, string>>
  >;
  const manifest: {
    sourceLocale: string;
    locales: string[];
    loaders: Record<string, () => Promise<Record<string, string>>>;
  };
  export default manifest;
}

declare module "virtual:solid-translate/locale/*" {
  /** A single locale's translation dictionary */
  const dictionary: Record<string, string>;
  export default dictionary;
}
