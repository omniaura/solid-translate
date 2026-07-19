import { parse } from "@babel/parser";

/** Extracted translatable string from source code */
export interface ExtractedString {
  key: string;
  source: string;
  file: string;
  line: number;
  /** AI context hint from the `context` prop */
  context?: string;
}

/** A source construct that could not be extracted statically */
export interface ExtractWarning {
  file: string;
  line: number;
  message: string;
}

// Minimal structural type for Babel AST nodes — avoids a hard dependency on
// @babel/types (we only walk, never construct).
interface Node {
  type: string;
  [key: string]: any;
}

/**
 * Extract translatable strings from source code by parsing it with
 * @babel/parser and walking the AST. Finds:
 * - `<T>text</T>` — source text is used as the key
 * - `<T id="key">fallback</T>` — explicit key
 * - `<T context="hint">text</T>` — with AI context
 * - `<T id="key" context="hint">text</T>` — both
 * - `<T>text <Var>...</Var> more</T>` — builds template with {0} placeholders
 * - `<Plural one="..." other="..." />` — each string-literal form
 * - `msg("text")` — shared string marker
 *
 * The produced keys have EXACT parity with the keys the runtime `<T>`
 * component builds after Solid's JSX compiler (babel-preset-solid /
 * dom-expressions) has processed the source:
 *
 * 1. JSX text is whitespace-collapsed exactly like dom-expressions'
 *    `trimWhitespace`: `\r` removed; if the text contains a newline, every
 *    line after the first has leading whitespace stripped and
 *    whitespace-only lines are dropped, lines are joined with a single
 *    space; finally all whitespace runs collapse to one space. HTML
 *    entities are decoded after collapsing.
 * 2. Static literal expressions (`{"text"}`, `{5}`, `{`text`}`,
 *    `{"a" + "b"}`) are inlined by the compiler and merge into the
 *    surrounding text at runtime, so they merge into the key here too.
 * 3. Element children (`<Var>`, `<Num>`, `<a href=...>`, any component)
 *    and dynamic expressions the compiler wraps in a memo (calls, member
 *    access, tagged templates) become ordered `{0}`, `{1}`, ...
 *    placeholders.
 * 4. `{null}`, `{undefined}` and boolean literals render nothing and are
 *    skipped.
 * 5. The final key is the template with leading/trailing whitespace
 *    trimmed (the runtime trims edges before lookup and restores them
 *    around the translation).
 *
 * Expressions whose runtime type cannot be known statically (bare
 * identifiers, identifier-only conditionals, interpolated template
 * literals, ...) are inlined raw by the compiler — a string value would
 * merge into the runtime key, an element would become a slot — so the
 * whole `<T>` is skipped with a warning. Wrap such values in `<Var>` to
 * make them extractable.
 *
 * Pass a `warnings` array to collect unextractable shapes (dynamic
 * `msg()` arguments, spread props on `<T>`, non-literal `<Plural>`
 * forms, ...).
 */
export function extractStringsFromSource(
  code: string,
  filePath: string,
  warnings?: ExtractWarning[],
): ExtractedString[] {
  const results: ExtractedString[] = [];
  const seen = new Set<string>();

  const warn = (line: number, message: string) => {
    warnings?.push({ file: filePath, line, message });
  };

  let ast: Node;
  try {
    ast = parse(code, {
      sourceType: "module",
      plugins: ["typescript", "jsx"],
      errorRecovery: true,
    }) as unknown as Node;
  } catch (err: any) {
    warn(err?.loc?.line ?? 1, `Failed to parse file: ${err?.message ?? err}`);
    return results;
  }

  const push = (entry: ExtractedString) => {
    if (!entry.key || seen.has(entry.key)) return;
    seen.add(entry.key);
    results.push(entry);
  };

  const visit = (node: Node) => {
    if (node.type === "JSXElement") {
      const name = jsxName(node);
      if (name === "T") {
        const entry = processT(node, filePath, warn);
        if (entry) push(entry);
      } else if (name === "Plural") {
        for (const entry of processPlural(node, filePath, warn)) {
          push(entry);
        }
      }
    } else if (
      node.type === "CallExpression" &&
      node.callee?.type === "Identifier" &&
      node.callee.name === "msg"
    ) {
      const entry = processMsg(node, filePath, warn);
      if (entry) push(entry);
    }
    walkChildren(node, visit);
  };

  visit(ast);
  return results;
}

// ---------------------------------------------------------------------------
// AST walking
// ---------------------------------------------------------------------------

function walkChildren(node: Node, visit: (node: Node) => void) {
  for (const key of Object.keys(node)) {
    if (key === "loc" || key === "leadingComments" || key === "trailingComments" || key === "innerComments") {
      continue;
    }
    const value = node[key];
    if (Array.isArray(value)) {
      for (const item of value) {
        if (item && typeof item === "object" && typeof item.type === "string") {
          visit(item);
        }
      }
    } else if (value && typeof value === "object" && typeof value.type === "string") {
      visit(value);
    }
  }
}

function jsxName(node: Node): string | undefined {
  const name = node.openingElement?.name;
  return name?.type === "JSXIdentifier" ? name.name : undefined;
}

// ---------------------------------------------------------------------------
// <T> extraction
// ---------------------------------------------------------------------------

function processT(
  node: Node,
  filePath: string,
  warn: (line: number, message: string) => void,
): ExtractedString | null {
  const line = node.loc?.start?.line ?? 1;

  let id: string | undefined;
  let context: string | undefined;

  for (const attr of node.openingElement.attributes as Node[]) {
    if (attr.type === "JSXSpreadAttribute") {
      warn(
        attr.loc?.start?.line ?? line,
        "<T> has spread props; id/context cannot be determined statically",
      );
      continue;
    }
    if (attr.type !== "JSXAttribute" || attr.name?.type !== "JSXIdentifier") {
      continue;
    }
    const attrName = attr.name.name;
    if (attrName !== "id" && attrName !== "context") continue;

    const value = staticAttrString(attr.value);
    if (value === null) {
      warn(
        attr.loc?.start?.line ?? line,
        `<T ${attrName}={...}> is not a static string; skipped`,
      );
      if (attrName === "id") return null;
      continue;
    }
    if (attrName === "id") id = value;
    else context = value;
  }

  const built = buildTemplate(node.children as Node[], filePath, warn);
  if (built === null) return null;

  const { body } = splitEdgeWhitespace(built);
  const key = id ?? body;

  // Nothing translatable: empty, or only placeholders/whitespace
  if (!id && (body === "" || /^(?:\{\d+\}|\s)*$/.test(body))) return null;

  return { key, source: body, file: filePath, line, context };
}

/**
 * Build the runtime template string for a list of JSX children.
 * Returns null (after warning) if any child's runtime shape is unknowable.
 */
function buildTemplate(
  children: Node[],
  filePath: string,
  warn: (line: number, message: string) => void,
  state = { template: "", slots: 0 },
): string | null {
  for (const child of children) {
    const line = child.loc?.start?.line ?? 1;

    if (child.type === "JSXText") {
      const collapsed = collapseJsxText(child.extra?.raw ?? child.value ?? "");
      if (collapsed !== "") state.template += decodeEntities(collapsed);
      continue;
    }

    if (child.type === "JSXElement") {
      state.template += `{${state.slots++}}`;
      continue;
    }

    if (child.type === "JSXFragment") {
      if (buildTemplate(child.children as Node[], filePath, warn, state) === null) {
        return null;
      }
      continue;
    }

    if (child.type !== "JSXExpressionContainer") continue;

    const expr = unwrapTs(child.expression as Node);

    if (expr.type === "JSXEmptyExpression") continue;

    // {null} / {undefined} / {true} / {false} render nothing
    if (
      expr.type === "NullLiteral" ||
      expr.type === "BooleanLiteral" ||
      (expr.type === "Identifier" && expr.name === "undefined")
    ) {
      continue;
    }

    // Static literals are inlined by the compiler and merge into text
    const folded = foldStatic(expr);
    if (folded !== null) {
      state.template += String(folded);
      continue;
    }

    if (expr.type === "JSXElement") {
      state.template += `{${state.slots++}}`;
      continue;
    }

    if (expr.type === "JSXFragment") {
      if (buildTemplate(expr.children as Node[], filePath, warn, state) === null) {
        return null;
      }
      continue;
    }

    // Inlined function values are slots at runtime (typeof kid === "function")
    if (
      expr.type === "ArrowFunctionExpression" ||
      expr.type === "FunctionExpression"
    ) {
      state.template += `{${state.slots++}}`;
      continue;
    }

    // Expressions the compiler wraps in a memo become function slots
    if (isCompiledDynamic(expr)) {
      state.template += `{${state.slots++}}`;
      continue;
    }

    // Anything else (bare identifiers, identifier-only conditionals, ...)
    // is inlined raw by the compiler: a string value would merge into the
    // runtime key, an element would become a slot. Unknowable — skip.
    warn(
      line,
      "<T> contains an expression whose runtime value cannot be determined statically; " +
        "wrap it in <Var> (or use a function call) to make this string extractable",
    );
    return null;
  }

  return state.template;
}

// ---------------------------------------------------------------------------
// <Plural> extraction
// ---------------------------------------------------------------------------

const PLURAL_FORMS = ["zero", "one", "two", "few", "many", "other"];

function processPlural(
  node: Node,
  filePath: string,
  warn: (line: number, message: string) => void,
): ExtractedString[] {
  const entries: ExtractedString[] = [];

  for (const attr of node.openingElement.attributes as Node[]) {
    if (attr.type !== "JSXAttribute" || attr.name?.type !== "JSXIdentifier") {
      continue;
    }
    const attrName = attr.name.name;
    if (!PLURAL_FORMS.includes(attrName)) continue;

    const line = attr.loc?.start?.line ?? node.loc?.start?.line ?? 1;
    const value = staticAttrString(attr.value);
    if (value === null) {
      warn(
        line,
        `<Plural ${attrName}={...}> is not a static string and will not be translated; ` +
          `use a string form with an {n} placeholder to make it translatable`,
      );
      continue;
    }
    if (value === "") continue;
    entries.push({ key: value, source: value, file: filePath, line });
  }

  return entries;
}

// ---------------------------------------------------------------------------
// msg() extraction
// ---------------------------------------------------------------------------

function processMsg(
  node: Node,
  filePath: string,
  warn: (line: number, message: string) => void,
): ExtractedString | null {
  const line = node.loc?.start?.line ?? 1;
  const arg = node.arguments?.[0] ? unwrapTs(node.arguments[0] as Node) : undefined;

  if (!arg) {
    warn(line, "msg() called without arguments; skipped");
    return null;
  }

  const folded = foldStatic(arg);
  if (typeof folded !== "string") {
    warn(
      line,
      "msg() argument is not a static string (dynamic values cannot be extracted); skipped",
    );
    return null;
  }
  if (folded === "") return null;

  return { key: folded, source: folded, file: filePath, line };
}

// ---------------------------------------------------------------------------
// Attribute helpers
// ---------------------------------------------------------------------------

/**
 * Resolve a JSX attribute value to a static string.
 * Handles `attr="text"`, `attr='text'`, `attr={"text"}`, `attr={`text`}`.
 * Returns null if the value is not statically a string.
 */
function staticAttrString(value: Node | null | undefined): string | null {
  if (!value) return null;
  if (value.type === "StringLiteral") return value.value;
  if (value.type === "JSXExpressionContainer") {
    const folded = foldStatic(unwrapTs(value.expression as Node));
    return typeof folded === "string" ? folded : null;
  }
  return null;
}

// ---------------------------------------------------------------------------
// Static expression folding
// ---------------------------------------------------------------------------

/** Unwrap TypeScript-only wrapper expressions (stripped at compile time) */
function unwrapTs(node: Node): Node {
  let current = node;
  while (
    current.type === "TSAsExpression" ||
    current.type === "TSSatisfiesExpression" ||
    current.type === "TSNonNullExpression" ||
    current.type === "TSTypeAssertion" ||
    current.type === "ParenthesizedExpression"
  ) {
    current = current.expression as Node;
  }
  return current;
}

/**
 * Fold a static literal expression to its runtime value.
 * Returns null when the expression is not statically foldable.
 */
function foldStatic(node: Node): string | number | null {
  const expr = unwrapTs(node);

  if (expr.type === "StringLiteral") return expr.value;
  if (expr.type === "NumericLiteral") return expr.value;

  if (expr.type === "TemplateLiteral" && expr.expressions.length === 0) {
    return expr.quasis[0]?.value?.cooked ?? null;
  }

  if (expr.type === "UnaryExpression" && expr.prefix) {
    const inner = foldStatic(expr.argument as Node);
    if (typeof inner === "number") {
      if (expr.operator === "-") return -inner;
      if (expr.operator === "+") return inner;
    }
    return null;
  }

  if (expr.type === "BinaryExpression" && expr.operator === "+") {
    const left = foldStatic(expr.left as Node);
    const right = foldStatic(expr.right as Node);
    if (left === null || right === null) return null;
    // JS semantics: string concat if either side is a string
    return (left as any) + (right as any);
  }

  return null;
}

/**
 * Mirror of dom-expressions' `isDynamic` for component children: an
 * expression containing a call, member access, tagged template, or spread
 * (outside nested functions) is wrapped in a memo by the compiler and
 * arrives at the runtime as a function — i.e. a slot.
 */
function isCompiledDynamic(node: Node): boolean {
  if (
    node.type === "CallExpression" ||
    node.type === "OptionalCallExpression" ||
    node.type === "TaggedTemplateExpression" ||
    node.type === "MemberExpression" ||
    node.type === "OptionalMemberExpression" ||
    node.type === "SpreadElement" ||
    node.type === "NewExpression" ||
    (node.type === "BinaryExpression" && node.operator === "in")
  ) {
    return true;
  }

  // Function bodies are lazy — dynamic content inside them does not make
  // the expression itself dynamic (matches dom-expressions traversal).
  if (
    node.type === "ArrowFunctionExpression" ||
    node.type === "FunctionExpression"
  ) {
    return false;
  }

  let found = false;
  walkChildren(node, function check(child: Node) {
    if (found) return;
    if (
      child.type === "ArrowFunctionExpression" ||
      child.type === "FunctionExpression"
    ) {
      return;
    }
    if (
      child.type === "CallExpression" ||
      child.type === "OptionalCallExpression" ||
      child.type === "TaggedTemplateExpression" ||
      child.type === "MemberExpression" ||
      child.type === "OptionalMemberExpression" ||
      child.type === "SpreadElement" ||
      child.type === "NewExpression" ||
      (child.type === "BinaryExpression" && child.operator === "in")
    ) {
      found = true;
      return;
    }
    walkChildren(child, check);
  });
  return found;
}

// ---------------------------------------------------------------------------
// JSX text handling
// ---------------------------------------------------------------------------

/**
 * Exact replication of dom-expressions' `trimWhitespace`, which the Solid
 * JSX compiler applies to every JSX text node at build time.
 */
function collapseJsxText(raw: string): string {
  let text = raw.replace(/\r/g, "");
  if (/\n/.test(text)) {
    text = text
      .split("\n")
      .map((t, i) => (i ? t.replace(/^\s*/, "") : t))
      .filter((t) => !/^\s*$/.test(t))
      .join(" ");
  }
  return text.replace(/\s+/g, " ");
}

/** Split off leading/trailing whitespace (runtime `<T>` does the same). */
function splitEdgeWhitespace(text: string): {
  lead: string;
  body: string;
  trail: string;
} {
  const lead = /^\s*/.exec(text)![0];
  const rest = text.slice(lead.length);
  const trail = /\s*$/.exec(rest)![0];
  return { lead, body: rest.slice(0, rest.length - trail.length), trail };
}

const NAMED_ENTITIES: Record<string, string> = {
  amp: "&",
  lt: "<",
  gt: ">",
  quot: '"',
  apos: "'",
  nbsp: "\u00a0",
  copy: "©",
  reg: "®",
  trade: "™",
  hellip: "…",
  mdash: "—",
  ndash: "–",
  lsquo: "‘",
  rsquo: "’",
  ldquo: "“",
  rdquo: "”",
  laquo: "«",
  raquo: "»",
  times: "×",
  divide: "÷",
  middot: "·",
  bull: "•",
  deg: "°",
  plusmn: "±",
  euro: "€",
  pound: "£",
  yen: "¥",
  cent: "¢",
  sect: "§",
  para: "¶",
  dagger: "†",
  shy: "\u00ad",
};

/** Decode numeric and common named HTML entities (compiler decodes JSX text) */
function decodeEntities(text: string): string {
  if (!text.includes("&")) return text;
  return text.replace(
    /&(?:#x([0-9a-fA-F]+)|#(\d+)|([a-zA-Z][a-zA-Z0-9]*));/g,
    (match, hex, dec, name) => {
      if (hex) return String.fromCodePoint(parseInt(hex, 16));
      if (dec) return String.fromCodePoint(parseInt(dec, 10));
      return NAMED_ENTITIES[name] ?? match;
    },
  );
}
