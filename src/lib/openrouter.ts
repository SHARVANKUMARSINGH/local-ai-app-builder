import OpenAI from "openai";
import type { ProjectFile } from "../types";
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

const INITIAL_SYSTEM_PROMPT = `You are an expert React + Vite engineer working inside an in-browser code generator.

Given a user's request, respond with a SMALL, RUNNABLE React + TypeScript + Vite project
that satisfies it. Respond with ONLY a JSON object (no markdown fences, no commentary)
matching exactly this shape:

{
  "files": [
    { "path": "package.json", "contents": "..." },
    { "path": "index.html", "contents": "..." },
    { "path": "vite.config.ts", "contents": "..." },
    { "path": "src/main.tsx", "contents": "..." },
    { "path": "src/App.tsx", "contents": "..." }
  ],
  "commands": [],
  "summary": "One sentence describing what you built."
}

Rules:
- "path" values are relative to the project root, forward slashes only, no leading "/".
- Always include a valid "package.json" with a "dev" script ("vite") and correct dependencies.
- Keep the dependency list minimal (react, react-dom, vite, @vitejs/plugin-react, typescript).
- Write real, complete file contents — no "// ..." placeholders or TODOs.
- Prefer functional components and inline styles or a single small CSS file; no external
  UI libraries unless the user explicitly asks for one.
- The app must run standalone with \`npm install && npm run dev\`.
- Leave "commands" empty on this initial generation — \`npm install\` already runs
  automatically against the package.json you return.`;

const ITERATION_SYSTEM_PROMPT = `You are an expert React + Vite engineer working inside an in-browser code generator.
You are editing a project that is ALREADY mounted, installed, and running live in the
user's browser (a WebContainer). The full current contents of every file in the project
will be given to you as context. Read them before responding — you're editing this real,
running codebase, not starting from scratch.

Respond with ONLY a JSON object (no markdown fences, no commentary) matching exactly this
shape:

{
  "files": [ { "path": "src/App.tsx", "contents": "..." } ],
  "commands": ["npm install some-package"],
  "summary": "One sentence describing what you changed."
}

Rules:
- In "files", include ONLY files that are new or whose contents changed. Do not resend
  unchanged files. Each file's "contents" must be the COMPLETE new contents of that file,
  not a diff or a snippet.
- Use "commands" for anything that needs to run in the project's terminal to make your
  change work — most commonly \`npm install <package>\` when you import something not
  already in package.json (also update package.json's "dependencies" to match). Only
  include commands that are actually necessary; leave the array empty otherwise.
- If you add a dependency, you do not need to run \`npm install\` with no arguments —
  only install the new package(s) by name so the existing install isn't repeated.
- Never rewrite package.json's "dev"/"scripts" section unless the user explicitly asks
  for a different tool or setup.
- Keep changes scoped to what the user asked for.`;

export interface GenerationResult {
  files: ProjectFile[];
  commands: string[];
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

function normalizeResult(parsed: unknown): { files: ProjectFile[]; commands: string[]; summary: string } {
  if (
    typeof parsed !== "object" ||
    parsed === null ||
    !Array.isArray((parsed as { files?: unknown }).files)
  ) {
    throw new Error("Model response did not match the expected { files, summary } shape");
  }
  const raw = parsed as { files: unknown[]; commands?: unknown; summary?: unknown };
  const files: ProjectFile[] = raw.files.map((f) => {
    const file = f as { path?: unknown; contents?: unknown };
    if (typeof file.path !== "string" || typeof file.contents !== "string") {
      throw new Error("Malformed file entry in model response");
    }
    return { path: file.path.replace(/^\/+/, ""), contents: file.contents };
  });
  const commands: string[] = Array.isArray(raw.commands)
    ? raw.commands.filter((c): c is string => typeof c === "string" && c.trim().length > 0)
    : [];
  return {
    files,
    commands,
    summary: typeof raw.summary === "string" ? raw.summary : "Generated project.",
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

/**
 * Sends the user's natural-language prompt to the configured OpenRouter model
 * and returns a ready-to-mount set of file changes (and any terminal commands
 * needed to support them).
 *
 * When `existingFiles` is non-empty, this runs in "iteration" mode: the full
 * current project is sent as context so the model can read and edit the real,
 * already-running codebase (the virtual filesystem, effectively) instead of
 * generating blind. With no existing files, it generates a fresh project.
 *
 * If no real API key has been configured, or the request fails for any
 * reason, this falls back to a local starter template so the rest of the
 * pipeline (mount → install → dev server) stays testable end to end.
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
      // No sensible offline fallback for an edit to an unknown existing
      // project — surface this clearly instead of silently no-op'ing.
      return { files: [], commands: [], summary: "No API key configured — can't edit without one.", usedFallback: true };
    }
    return { ...getBaseTemplateFiles(prompt), commands: [], usedFallback: true };
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
    const { files, commands, summary } = normalizeResult(extractJson(raw));
    if (files.length === 0 && commands.length === 0) {
      throw new Error("Model returned no file changes or commands");
    }
    return { files, commands, summary, usedFallback: false };
  } catch (err) {
    console.error("[openrouter] Generation failed:", err);
    const message = err instanceof Error ? err.message : String(err);
    if (isIteration) {
      // Don't silently fall back to a throwaway template for an edit —
      // that would blow away the user's real, running project.
      return { files: [], commands: [], summary: `Edit failed: ${message}`, usedFallback: false };
    }
    const fallback = getBaseTemplateFiles(prompt);
    return {
      ...fallback,
      commands: [],
      summary: `${fallback.summary} (AI call failed — showing a local fallback instead: ${message})`,
      usedFallback: true,
    };
  }
}
