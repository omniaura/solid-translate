# solid-translate

AI-powered i18n for SolidJS — full feature parity with [General Translation](https://generaltranslation.com), but open-source and BYOK (bring your own API key).

Write your app in one language. Wrap text in `<T>`. Get translations generated automatically at build time. No JSON key management. No external service required.

## Features

- **`<T>` Component** — wrap any text for translation. Source text = key (no JSON wrangling)
- **`<Var>`** — protect dynamic content from translation
- **`<Num>`** — locale-aware number formatting via `Intl.NumberFormat`
- **`<Currency>`** — locale-aware currency formatting
- **`<DateTime>`** — locale-aware date/time formatting
- **`<Plural>`** — CLDR plural rules (zero/one/two/few/many/other)
- **`<LocaleSelector>`** — drop-in locale picker component
- **AI Context** — `context` prop for disambiguation ("Save" = save file vs. save money)
- **Auto Locale Detection** — detects from `navigator.languages` when `locale` prop is omitted
- **`msg()`** — mark strings for extraction outside of JSX
- **CLI Tool** — translate JSON, Markdown, and MDX files from the command line
- **Vite Plugin** — build-time translation with smart change detection
- **GitHub Action** — `omniaura/solid-translate@v1` for CI/CD translation automation
- **BYOK** — use any [Vercel AI SDK](https://ai-sdk.dev/) provider (OpenRouter, OpenAI, Anthropic, Google, etc.)

## Install

```bash
bun add solid-translate
bun add -d ai @ai-sdk/openai  # or any AI SDK provider
```

## Quick Start

### 1. Configure the Vite plugin

```ts
// vite.config.ts
import { defineConfig } from "vite";
import solidPlugin from "vite-plugin-solid";
import { solidTranslate } from "solid-translate/vite";
import { createOpenAI } from "@ai-sdk/openai";

const openrouter = createOpenAI({
  baseURL: "https://openrouter.ai/api/v1",
  apiKey: process.env.OPENROUTER_API_KEY,
});

export default defineConfig({
  plugins: [
    solidPlugin(),
    solidTranslate({
      sourceLocale: "en",
      targetLocales: ["es", "fr", "de", "ja"],
      localesDir: "./src/locales",
      model: openrouter("openai/gpt-4o-mini"),
      autoExtract: true, // auto-discover <T> and msg() strings
    }),
  ],
});
```

### 2. Write your app

```tsx
import { TranslationProvider, T, Var, Num, Plural, useTranslation, LocaleSelector } from "solid-translate";
import translations from "virtual:solid-translate";

function App() {
  return (
    <TranslationProvider
      sourceLocale="en"
      translations={translations}
      // locale="es"  ← optional! auto-detects from browser if omitted
    >
      <Page />
    </TranslationProvider>
  );
}

function Page() {
  const { t } = useTranslation();
  const [count, setCount] = createSignal(3);
  const userName = () => "Alice";

  return (
    <div>
      <h1><T>Welcome to our app!</T></h1>

      {/* Dynamic content protected with <Var> */}
      <p><T>Hello <Var>{userName()}</Var>, nice to see you!</T></p>

      {/* AI context for disambiguation */}
      <button><T context="save a document to disk">Save</T></button>

      {/* Explicit key */}
      <a><T id="nav.home">Home</T></a>

      {/* Interpolation */}
      <p>{t("items.count", { count: count() })}</p>

      {/* Pluralization */}
      <Plural n={count()}
        zero="No items in your cart"
        one="1 item in your cart"
        other={`${count()} items in your cart`}
      />

      {/* Locale-aware number */}
      <p>Total: <Num>{1234567.89}</Num></p>

      {/* Locale switcher */}
      <LocaleSelector labels={{ en: "English", es: "Español", fr: "Français" }} />
    </div>
  );
}
```

### 3. Build

```bash
bun run build
```

On the first build, the plugin generates translation files:

```
src/locales/
├── en.json                    # Source (auto-generated or manual)
├── es.json                    # AI-generated
├── fr.json                    # AI-generated
├── de.json                    # AI-generated
├── ja.json                    # AI-generated
└── .solid-translate.lock      # Change tracking
```

On subsequent builds, only changed/new keys are re-translated. Check everything into git.

## API Reference

### Components

#### `<T>` — Translatable Text

```tsx
// Source text as key (no JSON file entry needed)
<T>Hello world</T>

// Explicit key
<T id="greeting">Hello world</T>

// With interpolation
<T params={{ name: userName() }}>Hello {{name}}</T>

// AI context for disambiguation
<T context="financial institution, not river bank">Bank</T>

// Mixed JSX with Var
<T>Welcome <Var>{userName()}</Var>, you have <Num>{count()}</Num> items</T>
```

#### `<Var>` — Variable Protection

Marks dynamic content that should NOT be translated. When used inside `<T>`, the surrounding text is translated but `<Var>` content is preserved.

```tsx
<T>Hello <Var>{userName()}</Var></T>
// Spanish: "Hola {userName()}"
```

#### `<Num>` — Number Formatting

Locale-aware number formatting using `Intl.NumberFormat`.

```tsx
<Num>{1000000}</Num>                              // "1,000,000" (en) / "1.000.000" (de)
<Num options={{ style: "percent" }}>{0.42}</Num>   // "42%"
<Num options={{ notation: "compact" }}>{1500}</Num> // "1.5K"
```

#### `<Currency>` — Currency Formatting

```tsx
<Currency currency="USD">{29.99}</Currency>    // "$29.99" (en-US) / "29,99 $US" (fr)
<Currency currency="EUR">{1000}</Currency>     // "€1,000.00" (en) / "1.000,00 €" (de)
```

#### `<DateTime>` — Date/Time Formatting

```tsx
<DateTime>{new Date()}</DateTime>
<DateTime options={{ dateStyle: "long" }}>{new Date()}</DateTime>
<DateTime options={{ hour: "numeric", minute: "numeric" }}>{Date.now()}</DateTime>
```

#### `<Plural>` — Pluralization (CLDR)

Uses `Intl.PluralRules` for locale-correct plural forms.

```tsx
<Plural n={count()}
  zero="No items"
  one="1 item"
  two="2 items"           // Used in Arabic, Welsh, etc.
  few={`${count()} items`}  // Used in Polish, Czech, etc.
  many={`${count()} items`} // Used in Arabic, etc.
  other={`${count()} items`}
/>
```

#### `<LocaleSelector>` — Locale Picker

Drop-in `<select>` for switching locales.

```tsx
// Auto-generates display names via Intl.DisplayNames
<LocaleSelector />

// Custom labels
<LocaleSelector labels={{ en: "English", es: "Español" }} />

// Subset of locales
<LocaleSelector locales={["en", "es"]} />
```

### Hooks

#### `useTranslation()`

Full translation context.

```tsx
const { t, locale, setLocale, sourceLocale, availableLocales } = useTranslation();

t("greeting")                  // translated string
t("items.count", { count: 3 }) // with interpolation
locale()                       // "es"
setLocale("fr")                // switch locale
availableLocales()             // ["en", "es", "fr", ...]
```

#### `useLocale()`

Lightweight hook for just locale info.

```tsx
const { locale, setLocale, sourceLocale, availableLocales } = useLocale();
```

### `<TranslationProvider>`

Root provider. Wraps your app.

```tsx
<TranslationProvider
  translations={translations}    // Translation dictionaries
  sourceLocale="en"              // Source locale (default: "en")
  // locale="es"                 // Optional: explicit locale
  //                             // If omitted, auto-detects from navigator.languages
>
  {children}
</TranslationProvider>
```

### `msg()` — Shared Strings

Mark strings for extraction outside of JSX. At build time, the Vite plugin extracts them. At runtime, use `t()` to translate.

```tsx
import { msg } from "solid-translate";

// Mark for extraction (build-time)
const SAVE = msg("Save changes");
const DELETE = msg("Delete");

// Translate at runtime
function Toolbar() {
  const { t } = useTranslation();
  return (
    <div>
      <button>{t(SAVE)}</button>
      <button>{t(DELETE)}</button>
    </div>
  );
}
```

## Vite Plugin Config

```ts
solidTranslate({
  sourceLocale: "en",            // Source locale (default: "en")
  targetLocales: ["es", "fr"],   // Target locales
  localesDir: "./src/locales",   // Locale files dir (default: "./src/locales")
  model: openai("gpt-4o-mini"), // Any Vercel AI SDK model
  systemPrompt: "...",           // Custom AI prompt (optional)
  batchSize: 50,                 // Keys per API call (default: 50)
  autoExtract: true,             // Auto-extract <T> and msg() strings (default: false)
  include: ["src/**/*.tsx"],     // Files to scan for extraction
})
```

## CLI

For translating locale files, JSON, Markdown, and MDX outside of the Vite build.

```bash
# Initialize config
npx solid-translate init

# Extract strings from source files
npx solid-translate extract

# Translate everything
npx solid-translate translate
```

### CLI Config (`solid-translate.config.json`)

```json
{
  "sourceLocale": "en",
  "targetLocales": ["es", "fr", "de"],
  "localesDir": "./src/locales",
  "provider": "openrouter",
  "model": "openai/gpt-4o-mini",
  "batchSize": 50,
  "include": ["src/**/*.tsx", "src/**/*.ts"],
  "files": {
    "json": {
      "include": ["i18n/[locale]/*.json"]
    },
    "md": {
      "include": ["docs/[locale]/**/*.md"]
    },
    "mdx": {
      "include": ["content/[locale]/**/*.mdx"]
    }
  }
}
```

The `[locale]` placeholder is replaced with each target locale. Source files are found by replacing `[locale]` with the source locale.

### Environment Variables

```bash
OPENROUTER_API_KEY=...   # OpenRouter
OPENAI_API_KEY=...       # OpenAI
ANTHROPIC_API_KEY=...    # Anthropic
GOOGLE_API_KEY=...       # Google AI
```

## Using with different AI providers

The plugin and CLI accept any [Vercel AI SDK](https://ai-sdk.dev/) compatible model:

```ts
// OpenRouter (access to 100+ models)
import { createOpenAI } from "@ai-sdk/openai";
const openrouter = createOpenAI({
  baseURL: "https://openrouter.ai/api/v1",
  apiKey: process.env.OPENROUTER_API_KEY,
});
const model = openrouter("anthropic/claude-sonnet-4-5");

// OpenAI directly
import { openai } from "@ai-sdk/openai";
const model = openai("gpt-4o-mini");

// Anthropic directly
import { anthropic } from "@ai-sdk/anthropic";
const model = anthropic("claude-haiku-4-5-20251001");

// Google
import { google } from "@ai-sdk/google";
const model = google("gemini-2.0-flash");
```

## CI/CD Integration

### GitHub Action

Use the official action to keep translations up to date automatically:

```yaml
# .github/workflows/translate.yml
name: Translate

on:
  push:
    branches: [main]
  pull_request:

jobs:
  translate:
    runs-on: ubuntu-latest
    permissions:
      contents: write
    steps:
      - uses: actions/checkout@v4

      - uses: omniaura/solid-translate@v1
        env:
          OPENROUTER_API_KEY: ${{ secrets.OPENROUTER_API_KEY }}
        with:
          commit: true
          commit-message: "chore: update translations"
```

#### Action Inputs

| Input | Default | Description |
|-------|---------|-------------|
| `command` | `both` | `extract`, `translate`, or `both` |
| `working-directory` | `.` | Working directory |
| `commit` | `false` | Auto-commit updated translation files |
| `commit-message` | `chore: update translations` | Commit message |
| `node-version` | `22` | Node.js version |
| `package-manager` | `npm` | `npm`, `bun`, `pnpm`, or `yarn` |

#### Action Outputs

| Output | Description |
|--------|-------------|
| `changed` | `true` if translation files were updated |
| `files` | Space-separated list of changed files |

#### Examples

**Translate on PR and commit back:**

```yaml
- uses: omniaura/solid-translate@v1
  env:
    OPENAI_API_KEY: ${{ secrets.OPENAI_API_KEY }}
  with:
    commit: true
    package-manager: bun
```

**Extract only (no AI calls):**

```yaml
- uses: omniaura/solid-translate@v1
  with:
    command: extract
```

**Use output in subsequent steps:**

```yaml
- uses: omniaura/solid-translate@v1
  id: translate
  env:
    ANTHROPIC_API_KEY: ${{ secrets.ANTHROPIC_API_KEY }}

- name: Create PR with translations
  if: steps.translate.outputs.changed == 'true'
  run: |
    echo "Updated files: ${{ steps.translate.outputs.files }}"
```

### Manual CI Setup

Add to your build script for automatic translations on every deploy:

```json
{
  "scripts": {
    "translate": "solid-translate translate",
    "build": "bun run translate && vite build"
  }
}
```

Or directly in a workflow:

```yaml
- name: Translate
  env:
    OPENROUTER_API_KEY: ${{ secrets.OPENROUTER_API_KEY }}
  run: npx solid-translate translate

- name: Build
  run: bun run build
```

## How change detection works

The `.solid-translate.lock` file tracks a content hash for each source key. On build:

1. Source locale file is read and each value is hashed
2. Hashes are compared against the lock file
3. Only new or changed keys are sent to the AI for translation
4. If a key's `context` prop changed, it's re-translated for better accuracy
5. Unchanged translations are preserved from existing locale files
6. Deleted source keys are removed from all target files

This means you can safely check in all translation files. Rebuilds are free unless you change source text.

## TypeScript

For the virtual module import, add to your `env.d.ts` or `vite-env.d.ts`:

```ts
declare module "virtual:solid-translate" {
  const translations: Record<string, Record<string, string>>;
  export default translations;
}
```

## Comparison with General Translation (gt-react)

| Feature | gt-react | solid-translate |
|---------|----------|-----------------|
| `<T>` component | ✅ | ✅ |
| `<Var>` variable protection | ✅ | ✅ |
| `<Num>` number formatting | ✅ | ✅ |
| `<Currency>` formatting | ✅ | ✅ |
| `<DateTime>` formatting | ✅ | ✅ |
| `<Plural>` CLDR rules | ✅ | ✅ |
| `<LocaleSelector>` | ✅ | ✅ |
| AI context disambiguation | ✅ | ✅ |
| Auto locale detection | ✅ | ✅ |
| Shared strings (`msg()`) | ✅ | ✅ |
| CLI for JSON/MD/MDX | ✅ | ✅ |
| CI/CD integration | ✅ | ✅ |
| Official GitHub Action | ❌ | ✅ |
| Zero refactoring | ✅ | ✅ |
| BYOK (bring your own key) | ❌ (SaaS) | ✅ |
| No vendor lock-in | ❌ | ✅ |
| SolidJS native | ❌ (React) | ✅ |
| Build-time translation | ❌ (runtime) | ✅ |
| Open source | Partial | ✅ MIT |

## License

MIT
