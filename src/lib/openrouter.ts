import OpenAI from "openai";
import type { AiAction, ProjectFile } from "../types";
import { getBaseTemplateFiles } from "./projectTemplate";
import { getStoredApiKey } from "./apiKeyStore";

/**
 * ── OpenRouter configuration ────────────────────────────────────────────────
 * OpenRouter exposes an OpenAI-compatible API, so the official `openai` SDK
 * works as-is — you just point `baseURL` at OpenRouter and use an OpenRouter
 * API key instead of an OpenAI one.
 *
 * "openrouter/free" is OpenRouter's own router model: it always resolves to
 * whichever underlying model is currently free, so this doesn't rot the way
 * a hardcoded `some-model:free` id does when that specific model's free tier
 * gets pulled. See https://openrouter.ai/openrouter/free
 *
 * The actual model used per-project is chosen once, at project creation
 * (see ModelPicker.tsx / ProjectLanding.tsx) and passed into
 * `generateProjectFromPrompt` below — this constant is only the default for
 * a brand-new project.
 *
 * This app is a pure static SPA with no backend, so there's no way to keep a
 * key truly secret from the person using it anyway. Given that, the key is
 * resolved in this priority order:
 *   1. localStorage, set via the in-app "Add your API key" popup
 *      (src/components/ApiKeyModal.tsx) — lives only in that browser.
 *   2. VITE_OPENROUTER_API_KEY from `.env.local` — convenient for solo local
 *      dev, but be aware Vite bakes this literally into the shipped JS
 *      bundle, so don't rely on it for a key you deploy publicly.
 */
export const OPENROUTER_MODEL = "openrouter/free";

function resolveApiKey(): string {
  return (
    getStoredApiKey() ??
    import.meta.env.VITE_OPENROUTER_API_KEY ??
    "REPLACE_WITH_YOUR_OPENROUTER_API_KEY"
  );
}

function createClient(apiKey: string): OpenAI {
  return new OpenAI({
    baseURL: "https://openrouter.ai/api/v1",
    apiKey,
    // Required for OpenRouter to accept requests made directly from a browser.
    dangerouslyAllowBrowser: true,
    // Free-tier routing can occasionally stall rather than error out cleanly,
    // and a full multi-file generation can legitimately take a while to
    // stream. Bound it generously so a genuine hang still surfaces as a
    // catchable error, without aborting a slow-but-working response.
    timeout: 90_000,
    maxRetries: 1,
    defaultHeaders: {
      "HTTP-Referer": "https://localhost",
      "X-Title": "local-ai-app-builder",
    },
  });
}

/**
 * ── Per-framework briefs ─────────────────────────────────────────────────
 * Chosen once at project creation (ProjectLanding.tsx) and fixed for the
 * project's lifetime. Each brief tells the model what stack to use and,
 * critically, what its "dev" script should look like — WebContainer detects
 * "server-ready" generically from any process that opens a port, so none of
 * these are hardcoded to Vite specifically except where that's genuinely the
 * simplest correct choice.
 */
const FRAMEWORK_BRIEFS: Record<string, string> = {
  react: `Stack: React + TypeScript + Vite. package.json must have a "dev" script that runs
"vite". Entry point is index.html at the project root, loading /src/main.tsx.`,
  vue: `Stack: Vue 3 + Vite (JavaScript or TypeScript, your choice). package.json must have
a "dev" script that runs "vite". Entry point is index.html at the project root, loading
/src/main.js (or .ts), which mounts the root Vue app.`,
  svelte: `Stack: Svelte + Vite. package.json must have a "dev" script that runs "vite".
Entry point is index.html at the project root, loading /src/main.js (or .ts).`,
  vanilla: `Stack: plain JavaScript + Vite (no framework). package.json must have a "dev"
script that runs "vite". Vite works with zero framework config for plain HTML/CSS/JS —
just index.html, a script tag, and whatever modules you import from it.`,
  static: `Stack: plain static HTML/CSS/JS, no build tool, no framework, no bundler,
no package.json dependencies beyond "vite" itself. package.json must have a "dev" script
that runs "vite" — Vite serves a plain index.html/style.css/script.js project directly
with no config needed. Do not add React, a component framework, or any build-time
tooling — this is meant to be inspectable, ordinary HTML/CSS/JS.`,
  custom: `Stack: your choice — pick whatever fits the request best (could be a different
frontend framework, a small Node/Express server, a CLI tool, anything). There is no
framework constraint here. Whatever you choose, package.json must have a "dev" script
that starts it and, if it's a web app, binds to a port and prints/serves on it —
WebContainer detects "server ready" generically from any process opening a port, not
just Vite, so any dev server works.`,
  expo: `Stack: React Native + Expo, TypeScript. This runs inside a browser-based
WebContainer with no mobile simulator available, so the live preview shown to the user
is Expo's WEB target (react-native-web) — say so plainly in your summary the first time,
so the user knows they're seeing a web-rendered approximation, not a native build.
package.json must have a "dev" script that runs
"expo start --web --port 5173 --non-interactive" (non-interactive avoids CLI prompts
hanging in a terminal with no human to answer them). Use only React Native components
and APIs that are supported by react-native-web (View, Text, StyleSheet, Pressable,
ScrollView, etc.) — anything relying on a real native module won't render in this
preview.`,
};

function frameworkBrief(framework: string): string {
  return FRAMEWORK_BRIEFS[framework] ?? FRAMEWORK_BRIEFS.custom;
}

/**
 * ── The strict action protocol ──────────────────────────────────────────────
 * The AI never returns "a project" or "some files" loosely — it returns an
 * ordered list of `actions`, each one of exactly three machine-checked
 * shapes (or an EMPTY list — see "Tool: none" below). This is what lets one
 * response drive the filesystem, the editor, AND the terminal, and lets the
 * UI render a precise action log (icons, "+2 files added", etc.) instead of
 * guessing from prose.
 *
 *   { "type": "write_file",  "path": "src/App.tsx", "contents": "..." }
 *   { "type": "delete_file", "path": "src/old.tsx" }
 *   { "type": "run_command", "command": "npm install axios" }
 *
 * `normalizeResult` below rejects (throws on) anything that doesn't match
 * one of these three shapes exactly — no partial/loose objects pass through.
 */
const RESPONSE_FORMAT_SPEC = `Respond with ONLY a JSON object (no markdown fences, no commentary, no text
before or after it) matching EXACTLY this shape:

{
  "summary": "Markdown-formatted explanation, for the chat.",
  "actions": [
    { "type": "write_file", "path": "src/App.tsx", "contents": "...\\n" },
    { "type": "delete_file", "path": "src/Unused.tsx" },
    { "type": "run_command", "command": "npm install axios" }
  ]
}

Strict rules for "actions" — every entry must be EXACTLY one of these three shapes,
nothing else:
  - write_file:  { "type": "write_file", "path": "<string>", "contents": "<string>" }
  - delete_file: { "type": "delete_file", "path": "<string>" }
  - run_command: { "type": "run_command", "command": "<string>" }
- "path" is always relative to the project root, forward slashes, no leading "/".
- "contents" on write_file is always the file's COMPLETE new contents (never a diff,
  never "// ...rest unchanged").
- Every other field name is invalid — do not add "description", "reason", etc. to an action.
- "summary" may use Markdown (backticks, bold, lists) — it's rendered as Markdown in the UI.

Tool: none — if the message is a greeting ("hi", "hello"), a question, a request to
explain existing code, or otherwise genuinely needs no file or terminal change, return
"actions": []  (an empty array) and put your complete answer in "summary". This is a
normal, expected response — including as the very FIRST message of a brand new project
if that first message isn't actually an app request. Do NOT scaffold a project just
because it's the first message, and do NOT invent a file edit or command just to have
something in "actions" when nothing actually needs to change.

Environment note: this project runs inside a WebContainer that already has Node.js
and npm pre-installed and on PATH. Never write a "run_command" that tries to install
Node, nvm, or a system package manager (apt/brew/etc.) — none of that exists or is
needed here. "run_command" should only ever be things like \`npm install <pkg>\`,
\`npm run <script>\`, or a one-off \`node\` / \`npx\` invocation.`;

const VITE_INDEX_HTML_NOTE = `
index.html note: for Vite-based projects, index.html at the project root is THE Vite
entry point, not an arbitrary file — it must keep its <script type="module"
src="/src/..."> tag pointing at the real entry file. If the project already has one
(it will, after the first message) and the user asks to "add an index.html file" or
similar, they almost always mean editing this existing file (or adding a DIFFERENT
static HTML file under public/), not replacing the Vite entry point with a plain
static page — doing that breaks the dev server. If they genuinely want a second,
separate static page, give it its own filename (e.g. public/about.html), not
"index.html".`;

function buildInitialSystemPrompt(framework: string): string {
  return `You are an expert software engineer working inside an in-browser AI app builder,
similar to Bolt.new or Lovable. A person describes something in plain English; when it's
an actual app request, you return one that runs.

${frameworkBrief(framework)}

${RESPONSE_FORMAT_SPEC}

Project rules (only apply once you've decided this IS an app request — see "Tool: none" above):
- Write real, complete file contents — no placeholders, no "// TODO", no stub functions.
- Match the complexity of the request: a "todo list" doesn't need five files and a
  state-management library. Keep dependencies minimal — only add one if the request
  specifically needs it.
- The app must run standalone with \`npm install && npm run dev\` — don't reference
  any file, asset, or env var you didn't also create.
- Don't include any "run_command" actions on this initial generation — \`npm install\`
  already runs automatically against the package.json you return.`;
}

function buildIterationSystemPrompt(framework: string): string {
  const isViteBased = framework !== "custom" && framework !== "expo";
  return `You are an expert software engineer working inside an in-browser AI app builder.
You are editing a project that is ALREADY mounted, installed, and running live in the
user's browser (a WebContainer) — a real, running virtual filesystem, not a
hypothetical one. The full current contents of every file are given to you as context
below. Read them before responding; you're editing this codebase, not starting over.

${frameworkBrief(framework)}

${RESPONSE_FORMAT_SPEC}
${isViteBased ? VITE_INDEX_HTML_NOTE : ""}

Editing rules:
- Only emit "write_file" for files that are new or whose contents actually changed —
  never resend an unchanged file. Each "contents" is the file's complete new text.
- Use "delete_file" to remove a file the user asked to remove, or one your change makes
  obsolete. Deleting is real: it runs \`rm\` in the container and drops the file from the
  editor and file tree immediately.
- Use "run_command" for anything that needs to happen in the terminal for your change to
  work — most commonly \`npm install <package>\` when you import something new (also add
  it to package.json's "dependencies" yourself via a write_file action; the install
  running doesn't retroactively edit package.json for you). Only include commands that
  are genuinely necessary — dependencies already installed don't need reinstalling.
- Never touch package.json's "scripts" unless the user explicitly asks for a different
  dev tool or setup.
- Keep changes scoped to what the user actually asked for — don't refactor unrelated
  code, rename things, or "clean up" as a side effect.
- If the request is ambiguous, make the most reasonable interpretation and say what you
  assumed in "summary", rather than responding with only clarifying questions.`;
}

export interface GenerationResult {
  actions: AiAction[];
  summary: string;
  usedFallback: boolean;
  /** The AI's raw, unparsed response text (or an empty string if the call
   *  never returned one, e.g. a network/timeout failure). Kept so the UI can
   *  offer a "show raw response" debug view when parsing fails, instead of
   *  the user only ever seeing a generic error string. */
  rawResponse?: string;
}

function isPlaceholderKey(key: string): boolean {
  return !key || key.startsWith("REPLACE_WITH_") || key === "sk-or-v1-your-key-here";
}

/** Whether a real (non-placeholder) key is currently available from either
 *  localStorage or the build-time env var. Used to decide whether to show
 *  the "add your API key" popup on load. */
export function hasUsableApiKey(): boolean {
  return !isPlaceholderKey(resolveApiKey());
}

const GREETING_RE = /^(hi|hello|hey|yo|sup|hiya|howdy|test|hi there|hello there|what can you do\??)[!.\s]*$/i;

/** Cheap, offline heuristic used ONLY for the no-API-key fallback path,
 *  where there's no model available to make this judgment itself — a real
 *  API call relies on the model following "Tool: none" instead. Without
 *  this, typing "hi" with no key configured yet produced a random demo
 *  template project, which felt arbitrary. */
function looksLikeGreeting(prompt: string): boolean {
  return GREETING_RE.test(prompt.trim());
}

/** Best-effort extraction of a JSON object from a model response that may be
 *  wrapped in ```json fences or preceded by stray commentary. */
function extractJson(raw: string): unknown {
  const fenced = raw.match(/```(?:json)?\s*([\s\S]*?)```/i);
  const candidate = fenced ? fenced[1] : raw;
  const start = candidate.indexOf("{");
  const end = candidate.lastIndexOf("}");
  if (start === -1 || end === -1) {
    const preview = raw.trim().slice(0, 200);
    throw new Error(
      preview ? `Model didn't return JSON — it said: "${preview}${raw.length > 200 ? "…" : ""}"` : "Model returned an empty response"
    );
  }
  return JSON.parse(candidate.slice(start, end + 1));
}

/** Strictly validates one action against the write_file / delete_file /
 *  run_command shapes — anything else throws, rather than being silently
 *  dropped or guessed at. This is the enforcement point for the "strict
 *  system + JSON protocol" the AI is asked to follow. */
function validateAction(raw: unknown, index: number): AiAction {
  if (typeof raw !== "object" || raw === null) {
    throw new Error(`actions[${index}] is not an object`);
  }
  const a = raw as Record<string, unknown>;

  if (a.type === "write_file") {
    if (typeof a.path !== "string" || !a.path) throw new Error(`actions[${index}] (write_file) missing "path"`);
    if (typeof a.contents !== "string") throw new Error(`actions[${index}] (write_file) missing "contents"`);
    return { type: "write_file", path: a.path.replace(/^\/+/, ""), contents: a.contents };
  }
  if (a.type === "delete_file") {
    if (typeof a.path !== "string" || !a.path) throw new Error(`actions[${index}] (delete_file) missing "path"`);
    return { type: "delete_file", path: a.path.replace(/^\/+/, "") };
  }
  if (a.type === "run_command") {
    if (typeof a.command !== "string" || !a.command) throw new Error(`actions[${index}] (run_command) missing "command"`);
    return { type: "run_command", command: a.command };
  }
  throw new Error(`actions[${index}] has unknown "type": ${JSON.stringify(a.type)}`);
}

function normalizeResult(parsed: unknown): { actions: AiAction[]; summary: string } {
  if (typeof parsed !== "object" || parsed === null) {
    throw new Error("Model response was not a JSON object");
  }
  const raw = parsed as { actions?: unknown; summary?: unknown };
  if (!Array.isArray(raw.actions)) {
    throw new Error('Model response is missing an "actions" array');
  }
  // An empty array is valid and expected — "Tool: none" for pure Q&A/chat
  // turns (including a first-message greeting) that need no file or
  // terminal change. Only the shape of each *present* action is enforced.
  const actions = raw.actions.map(validateAction);
  return {
    actions,
    summary: typeof raw.summary === "string" ? raw.summary : "Done.",
  };
}

/** Renders the existing project as context for an iteration request. Kept to
 *  a reasonable size — very large generated files get truncated rather than
 *  blowing the model's context window. */
function renderExistingFiles(files: ProjectFile[]): string {
  const MAX_CHARS_PER_FILE = 6000;
  return files
    .map((f) => {
      const truncated = f.contents.length > MAX_CHARS_PER_FILE;
      const body = truncated ? f.contents.slice(0, MAX_CHARS_PER_FILE) + "\n/* …truncated… */" : f.contents;
      return `--- ${f.path} ---\n${body}`;
    })
    .join("\n\n");
}

function actionsFromTemplate(prompt: string): { actions: AiAction[]; summary: string } {
  const { files, summary } = getBaseTemplateFiles(prompt);
  return {
    actions: files.map((f): AiAction => ({ type: "write_file", path: f.path, contents: f.contents })),
    summary,
  };
}

/**
 * Sends the user's natural-language prompt to `model` (an OpenRouter model
 * id, chosen once at project-creation time — see ProjectLanding.tsx) and
 * returns a strictly-validated, ordered list of actions (file writes, file
 * deletes, and terminal commands — possibly none at all, for a pure Q&A
 * turn) to apply. `framework` (also fixed at project creation) selects which
 * stack brief and index.html guidance the system prompt uses.
 *
 * The request streams: `onChunk`, if given, is called with the accumulated
 * raw text so far as tokens arrive, so the UI can show the model "typing"
 * live (clicking the generating indicator) instead of a plain wait.
 *
 * When `existingFiles` is non-empty, this runs in "iteration" mode: the full
 * current project is sent as context so the model can read and edit the real,
 * already-running codebase — the virtual filesystem — instead of generating
 * blind. With no existing files, it generates a fresh project (or just
 * replies, if the first message isn't actually an app request).
 *
 * If no real API key has been configured, or the request fails for any
 * reason, this falls back to a local starter template (as write_file actions)
 * so the rest of the pipeline stays testable end to end.
 */
export async function generateProjectFromPrompt(
  prompt: string,
  existingFiles: ProjectFile[] = [],
  model: string = OPENROUTER_MODEL,
  framework: string = "react",
  onChunk?: (accumulatedText: string) => void
): Promise<GenerationResult> {
  const apiKey = resolveApiKey();
  const isIteration = existingFiles.length > 0;

  if (isPlaceholderKey(apiKey)) {
    console.warn(
      "[openrouter] No API key configured — add one via the popup, or set " +
        "VITE_OPENROUTER_API_KEY in .env.local. Falling back to the local starter template."
    );
    if (isIteration) {
      return { actions: [], summary: "No API key configured — can't edit without one.", usedFallback: true };
    }
    if (looksLikeGreeting(prompt)) {
      return {
        actions: [],
        summary:
          "Hi! Add an OpenRouter API key (top-right) and describe an app — e.g. " +
          '"a pomodoro timer" or "a markdown note app" — and I\'ll build it live.',
        usedFallback: false,
      };
    }
    // The offline starter template is a plain React + Vite app — it's only a
    // sane stand-in when that's actually the chosen framework. Using it for
    // anything else (vue, svelte, expo, custom...) would silently swap the
    // project onto the wrong stack, which is worse than no fallback at all.
    if (framework !== "react") {
      return {
        actions: [],
        summary: `No API key configured, and the offline starter template is React-only, so it can't stand in for this ${framework} project. Add an OpenRouter API key (top-right) to actually generate one.`,
        usedFallback: false,
      };
    }
    return { ...actionsFromTemplate(prompt), usedFallback: true };
  }

  let raw = "";
  try {
    const client = createClient(apiKey);
    const userContent =
      (isIteration
        ? `Current project files:\n\n${renderExistingFiles(existingFiles)}\n\n---\n\nUser request: ${prompt}`
        : prompt) +
      '\n\n(Respond with ONLY the JSON object described in the system prompt — no other text before or after it.)';

    const stream = await client.chat.completions.create({
      model,
      temperature: 0.3,
      stream: true,
      messages: [
        {
          role: "system",
          content: isIteration ? buildIterationSystemPrompt(framework) : buildInitialSystemPrompt(framework),
        },
        { role: "user", content: userContent },
      ],
    });

    for await (const chunk of stream) {
      const delta = chunk.choices[0]?.delta?.content ?? "";
      if (delta) {
        raw += delta;
        onChunk?.(raw);
      }
    }

    const { actions, summary } = normalizeResult(extractJson(raw));
    return { actions, summary, usedFallback: false, rawResponse: raw };
  } catch (err) {
    console.error("[openrouter] Generation failed:", err);
    const message = err instanceof Error ? err.message : String(err);
    if (isIteration) {
      // Don't silently fall back to a throwaway template for an edit —
      // that would blow away the user's real, running project.
      return { actions: [], summary: `Edit failed: ${message}`, usedFallback: false, rawResponse: raw };
    }
    if (looksLikeGreeting(prompt)) {
      return {
        actions: [],
        summary: `Hi! (The model call failed just now: ${message} — try again, or describe an app to build.)`,
        usedFallback: false,
        rawResponse: raw,
      };
    }
    // Same reasoning as the no-key path above: don't paper over a failed
    // generation with a React template when the project isn't React — that
    // silently swaps the whole project onto the wrong stack instead of just
    // reporting the failure. This is exactly the bug where an Expo/Native
    // project that got a non-JSON response back had a random Vite+React
    // counter app inserted in its place.
    if (framework !== "react") {
      return {
        actions: [],
        summary: `The AI response couldn't be used: ${message}. Not falling back to a template here — the offline starter is a plain React app, and this project is ${framework}, so a fallback would replace it with the wrong stack. Try sending the request again.`,
        usedFallback: false,
        rawResponse: raw,
      };
    }
    const fallback = actionsFromTemplate(prompt);
    return {
      ...fallback,
      summary: `${fallback.summary} (AI call failed — showing a local fallback instead: ${message})`,
      usedFallback: true,
      rawResponse: raw,
    };
  }
}
