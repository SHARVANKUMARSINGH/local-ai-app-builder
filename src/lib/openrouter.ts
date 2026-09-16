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
    defaultHeaders: {
      "HTTP-Referer": "https://localhost",
      "X-Title": "local-ai-app-builder",
    },
  });
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

Tool: none — if the user is asking a question, wants an explanation of existing code,
or is just chatting and genuinely needs no file or terminal change, return
"actions": []  (an empty array) and put your complete answer in "summary". This is a
normal, expected response — not a fallback or a failure. Do NOT invent a file edit or
a command just to have something in "actions" when nothing actually needs to change.

Environment note: this project runs inside a WebContainer that already has Node.js
and npm pre-installed and on PATH. Never write a "run_command" that tries to install
Node, nvm, or a system package manager (apt/brew/etc.) — none of that exists or is
needed here. "run_command" should only ever be things like \`npm install <pkg>\`,
\`npm run <script>\`, or a one-off \`node\` / \`npx\` invocation.`;

const INITIAL_SYSTEM_PROMPT = `You are an expert React + Vite engineer working inside an in-browser AI app builder,
similar to Bolt.new or Lovable. A person describes an app in plain English; you return
one that actually runs.

Given the user's request, respond with a SMALL, RUNNABLE React + TypeScript + Vite
project that satisfies it, expressed entirely as "write_file" actions (this is the
first message for this project, so there's no existing code yet — "Tool: none" doesn't
apply here; always produce a working app).

${RESPONSE_FORMAT_SPEC}

Project rules:
- Always include a valid "package.json" with a "dev" script ("vite") and correct dependencies.
- Keep the dependency list minimal (react, react-dom, vite, @vitejs/plugin-react, typescript).
  Only add another dependency if the request specifically calls for it.
- Write real, complete file contents — no placeholders, no "// TODO", no stub functions.
- Prefer functional components, hooks, and either inline styles or one small CSS file —
  skip external UI/CSS frameworks unless the user explicitly asks for one.
- Match the complexity of the request: a "todo list" doesn't need five files and a
  state-management library.
- The app must run standalone with \`npm install && npm run dev\` — don't reference
  any file, asset, or env var you didn't also create.
- Don't include any "run_command" actions on this initial generation — \`npm install\`
  already runs automatically against the package.json you return.`;

const ITERATION_SYSTEM_PROMPT = `You are an expert React + Vite engineer working inside an in-browser AI app builder.
You are editing a project that is ALREADY mounted, installed, and running live in the
user's browser (a WebContainer) — a real, running virtual filesystem, not a
hypothetical one. The full current contents of every file are given to you as context
below. Read them before responding; you're editing this codebase, not starting over.

${RESPONSE_FORMAT_SPEC}

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

export interface GenerationResult {
  actions: AiAction[];
  summary: string;
  usedFallback: boolean;
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

/** Best-effort extraction of a JSON object from a model response that may be
 *  wrapped in ```json fences or preceded by stray commentary. */
function extractJson(raw: string): unknown {
  const fenced = raw.match(/```(?:json)?\s*([\s\S]*?)```/i);
  const candidate = fenced ? fenced[1] : raw;
  const start = candidate.indexOf("{");
  const end = candidate.lastIndexOf("}");
  if (start === -1 || end === -1) throw new Error("No JSON object found in model response");
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
  // turns that need no file or terminal change. Only the shape of each
  // *present* action is strictly enforced.
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
 * turn) to apply.
 *
 * When `existingFiles` is non-empty, this runs in "iteration" mode: the full
 * current project is sent as context so the model can read and edit the real,
 * already-running codebase — the virtual filesystem — instead of generating
 * blind. With no existing files, it generates a fresh project.
 *
 * If no real API key has been configured, or the request fails for any
 * reason, this falls back to a local starter template (as write_file actions)
 * so the rest of the pipeline stays testable end to end.
 */
export async function generateProjectFromPrompt(
  prompt: string,
  existingFiles: ProjectFile[] = [],
  model: string = OPENROUTER_MODEL
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
    return { ...actionsFromTemplate(prompt), usedFallback: true };
  }

  try {
    const client = createClient(apiKey);
    const userContent = isIteration
      ? `Current project files:\n\n${renderExistingFiles(existingFiles)}\n\n---\n\nUser request: ${prompt}`
      : prompt;

    const completion = await client.chat.completions.create({
      model,
      temperature: 0.3,
      messages: [
        { role: "system", content: isIteration ? ITERATION_SYSTEM_PROMPT : INITIAL_SYSTEM_PROMPT },
        { role: "user", content: userContent },
      ],
    });

    const raw = completion.choices[0]?.message?.content ?? "";
    const { actions, summary } = normalizeResult(extractJson(raw));
    // NOTE: zero actions is valid (Tool: none) — only a genuinely malformed
    // response (caught above by normalizeResult/extractJson) is an error.
    return { actions, summary, usedFallback: false };
  } catch (err) {
    console.error("[openrouter] Generation failed:", err);
    const message = err instanceof Error ? err.message : String(err);
    if (isIteration) {
      // Don't silently fall back to a throwaway template for an edit —
      // that would blow away the user's real, running project.
      return { actions: [], summary: `Edit failed: ${message}`, usedFallback: false };
    }
    const fallback = actionsFromTemplate(prompt);
    return {
      ...fallback,
      summary: `${fallback.summary} (AI call failed — showing a local fallback instead: ${message})`,
      usedFallback: true,
    };
  }
}
