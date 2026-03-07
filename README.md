# solid-translate

AI-powered build-time translations for SolidJS. Write your app in one language, and let AI generate translations for all your target locales automatically.

## How it works

1. Write your app normally — keep all copy in your source language
2. Wrap translatable text in `<T>` components
3. Maintain a source locale JSON file with your strings
4. The Vite plugin uses AI to translate to your target locales at build time
5. Translation files get checked into your repo — no API calls on rebuild unless source text changes

## Install

```bash
bun add solid-translate
bun add -d ai @ai-sdk/openai  # or any AI SDK provider
```

## Quick Start

### 1. Create your source locale file

```json
// src/locales/en.json
{
  "greeting": "Welcome to our app!",
  "nav.home": "Home",
  "nav.about": "About Us",
  "items.count": "You have {{count}} items"
}
```

### 2. Configure the Vite plugin

```ts
// vite.config.ts
import { defineConfig } from "vite";
import solidPlugin from "vite-plugin-solid";
import { solidTranslate } from "solid-translate/vite";
import { createOpenAI } from "@ai-sdk/openai";

// Use OpenRouter, OpenAI, or any AI SDK provider
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
    }),
  ],
});
```

### 3. Set up the runtime

```tsx
// App.tsx
import { TranslationProvider, T, useTranslation } from "solid-translate";
import translations from "virtual:solid-translate";

function App() {
  return (
    <TranslationProvider
      locale="es"
      sourceLocale="en"
      translations={translations}
    >
      <Page />
    </TranslationProvider>
  );
}

function Page() {
  const { t, locale, setLocale } = useTranslation();

  return (
    <div>
      <h1><T>Welcome to our app!</T></h1>
      <nav>
        <a><T id="nav.home">Home</T></a>
        <a><T id="nav.about">About Us</T></a>
      </nav>
      <p>{t("items.count", { count: 5 })}</p>

      <select
        value={locale()}
        onChange={(e) => setLocale(e.target.value)}
      >
        <option value="en">English</option>
        <option value="es">Español</option>
        <option value="fr">Français</option>
      </select>
    </div>
  );
}
```

### 4. Build

```bash
bun run build
```

On the first build, the plugin generates translation files:

```
src/locales/
├── en.json                    # Your source (checked in)
├── es.json                    # AI-generated (checked in)
├── fr.json                    # AI-generated (checked in)
├── de.json                    # AI-generated (checked in)
├── ja.json                    # AI-generated (checked in)
└── .solid-translate.lock      # Tracks what's been translated (checked in)
```

On subsequent builds, only changed/new keys are re-translated.

## API

### `<T>` Component

Wrap text for translation. The children text serves as both the source text and the lookup key.

```tsx
// Source text as key
<T>Hello world</T>

// Explicit key with fallback text
<T id="greeting">Hello world</T>

// With interpolation
<T id="welcome" params={{ name: userName() }}>
  Hello {{name}}
</T>
```

### `useTranslation()`

Access the translation context from any component.

```tsx
const { t, locale, setLocale, sourceLocale, availableLocales } = useTranslation();

// Translate programmatically
t("greeting")                          // "¡Bienvenido!"
t("items.count", { count: 3 })         // "Tienes 3 elementos"

// Read/switch locale
locale()                               // "es"
setLocale("fr")                        // Switch to French
```

### `<TranslationProvider>`

Provides translation context to your app.

```tsx
<TranslationProvider
  locale="es"                    // Initial locale
  sourceLocale="en"              // Source locale (default: "en")
  translations={translations}    // Translation dictionaries
>
  {children}
</TranslationProvider>
```

### Vite Plugin Config

```ts
solidTranslate({
  sourceLocale: "en",            // Source locale code (default: "en")
  targetLocales: ["es", "fr"],   // Target locales to generate
  localesDir: "./src/locales",   // Where locale files live (default: "./src/locales")
  model: openai("gpt-4o-mini"), // Any Vercel AI SDK LanguageModelV1
  systemPrompt: "...",           // Custom system prompt (optional)
  batchSize: 50,                 // Keys per API call (default: 50)
})
```

## Using with different AI providers

The plugin accepts any [Vercel AI SDK](https://ai-sdk.dev/) compatible model:

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

## TypeScript

For the virtual module import, add to your `env.d.ts` or `vite-env.d.ts`:

```ts
declare module "virtual:solid-translate" {
  const translations: Record<string, Record<string, string>>;
  export default translations;
}
```

## How change detection works

The `.solid-translate.lock` file tracks a content hash for each source key. On build:

1. Source locale file is read and each value is hashed
2. Hashes are compared against the lock file
3. Only new or changed keys are sent to the AI for translation
4. Unchanged translations are preserved from existing locale files
5. Deleted source keys are removed from all target files

This means you can safely check in all translation files. Rebuilds are free unless you change source text.

## License

MIT
