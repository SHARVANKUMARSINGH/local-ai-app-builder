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
 * shapes. This is what lets it drive the filesystem, the editor, AND the
 * terminal from one response, and lets the UI render a precise action log
 * (icons, "+2 files added", etc.) instead of guessing from prose.
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
  "summary": "Markdown-formatted explanation of what you did, for the chat.",
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
- "summary" may use Markdown (backticks, bold, lists) — it's rendered as Markdown in the UI.`;

const INITIAL_SYSTEM_PROMPT = `You are an expert React + Vite engineer working inside an in-browser code generator.

Given a user's request, respond with a SMALL, RUNNABLE React + TypeScript + Vite project
that satisfies it, expressed entirely as "write_file" actions.

${RESPONSE_FORMAT_SPEC}

Project rules:
- Always include a valid "package.json" with a "dev" script ("vite") and correct dependencies.
- Keep the dependency list minimal (react, react-dom, vite, @vitejs/plugin-react, typescript).
- Write real, complete file contents — no placeholders or TODOs.
- Prefer functional components and inline styles or a single small CSS file; no external
  UI libraries unless the user explicitly asks for one.
- The app must run standalone with \`npm install && npm run dev\`.
- Don't include any "run_command" actions on this initial generation — \`npm install\` already
  runs automatically against the package.json you return.`;

const ITERATION_SYSTEM_PROMPT = `You are an expert React + Vite engineer working inside an in-browser code generator.
You are editing a project that is ALREADY mounted, installed, and running live in the
user's browser (a WebContainer) — this is a real, running virtual filesystem, not a
hypothetical one. The full current contents of every file will be given to you as
context below. Read them before responding; you're editing this codebase, not starting over.

${RESPONSE_FORMAT_SPEC}

Editing rules:
- Only emit "write_file" for files that are new or whose contents actually changed —
  never resend an unchanged file.
- Use "delete_file" to remove a file the user asked to remove, or one your change makes
  obsolete. Deleting is real: it runs \`rm\` in the container and drops the file from the
  editor and file tree.
- Use "run_command" for anything that needs to happen in the terminal for your change to
  work — most commonly \`npm install <package>\` when you import something new (also add it
  to package.json's "dependencies" yourself in a write_file action; don't rely on the
  install to update package.json for you). Only include commands that are truly necessary.
- Never touch package.json's "scripts" unless the user explicitly asks for a different
  dev tool or setup.
- Keep changes scoped to what the user asked for.`;

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
 * Sends the user's natural-language prompt to the configured OpenRouter model
 * and returns a strictly-validated, ordered list of actions (file writes,
 * file deletes, and terminal commands) to apply.
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
  existingFiles: ProjectFile[] = []
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
      model: OPENROUTER_MODEL,
      temperature: 0.3,
      messages: [
        { role: "system", content: isIteration ? ITERATION_SYSTEM_PROMPT : INITIAL_SYSTEM_PROMPT },
        { role: "user", content: userContent },
      ],
    });

    const raw = completion.choices[0]?.message?.content ?? "";
    const { actions, summary } = normalizeResult(extractJson(raw));
    if (actions.length === 0) throw new Error("Model returned zero actions");
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
