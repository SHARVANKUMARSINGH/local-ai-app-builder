import OpenAI from "openai";
import type { ProjectFile } from "../types";
import { getBaseTemplateFiles } from "./projectTemplate";

/**
 * ── OpenRouter configuration ────────────────────────────────────────────────
 * OpenRouter exposes an OpenAI-compatible API, so the official `openai` SDK
 * works as-is — you just point `baseURL` at OpenRouter and use an OpenRouter
 * API key instead of an OpenAI one.
 *
 * ⚠️  PLACEHOLDER — put your own key here, or (safer) read it from an env
 * var via Vite's `import.meta.env`. Never commit a real key to git.
 *   1. Create a `.env.local` file in the project root (already git-ignored):
 *        VITE_OPENROUTER_API_KEY=sk-or-v1-...
 *   2. Restart `npm run dev` so Vite picks up the new env var.
 */
const OPENROUTER_API_KEY: string =
  import.meta.env.VITE_OPENROUTER_API_KEY ?? "REPLACE_WITH_YOUR_OPENROUTER_API_KEY";

const OPENROUTER_MODEL = "anthropic/claude-3.5-sonnet";

const client = new OpenAI({
  baseURL: "https://openrouter.ai/api/v1",
  apiKey: OPENROUTER_API_KEY,
  // Required for OpenRouter to accept requests made directly from a browser.
  dangerouslyAllowBrowser: true,
  defaultHeaders: {
    "HTTP-Referer": "https://localhost",
    "X-Title": "local-ai-app-builder",
  },
});

const SYSTEM_PROMPT = `You are an expert React + Vite engineer working inside an in-browser code generator.

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
  "summary": "One sentence describing what you built."
}

Rules:
- "path" values are relative to the project root, forward slashes only, no leading "/".
- Always include a valid "package.json" with a "dev" script ("vite") and correct dependencies.
- Keep the dependency list minimal (react, react-dom, vite, @vitejs/plugin-react, typescript).
- Write real, complete file contents — no "// ..." placeholders or TODOs.
- Prefer functional components and inline styles or a single small CSS file; no external
  UI libraries unless the user explicitly asks for one.
- The app must run standalone with \`npm install && npm run dev\`.`;

export interface GenerationResult {
  files: ProjectFile[];
  summary: string;
  usedFallback: boolean;
}

function isPlaceholderKey(key: string): boolean {
  return !key || key.startsWith("REPLACE_WITH_") || key === "sk-or-v1-your-key-here";
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

function normalizeFiles(parsed: unknown): { files: ProjectFile[]; summary: string } {
  if (
    typeof parsed !== "object" ||
    parsed === null ||
    !Array.isArray((parsed as { files?: unknown }).files)
  ) {
    throw new Error("Model response did not match the expected { files, summary } shape");
  }
  const raw = parsed as { files: unknown[]; summary?: unknown };
  const files: ProjectFile[] = raw.files.map((f) => {
    const file = f as { path?: unknown; contents?: unknown };
    if (typeof file.path !== "string" || typeof file.contents !== "string") {
      throw new Error("Malformed file entry in model response");
    }
    return { path: file.path.replace(/^\/+/, ""), contents: file.contents };
  });
  return {
    files,
    summary: typeof raw.summary === "string" ? raw.summary : "Generated project.",
  };
}

/**
 * Sends the user's natural-language prompt to the configured OpenRouter model
 * and returns a ready-to-mount set of project files.
 *
 * If no real API key has been configured, or the request fails for any
 * reason, this falls back to a local starter template so the rest of the
 * pipeline (mount → install → dev server) stays testable end to end.
 */
export async function generateProjectFromPrompt(prompt: string): Promise<GenerationResult> {
  if (isPlaceholderKey(OPENROUTER_API_KEY)) {
    console.warn(
      "[openrouter] No API key configured — set VITE_OPENROUTER_API_KEY in .env.local. " +
        "Falling back to the local starter template."
    );
    return { ...getBaseTemplateFiles(prompt), usedFallback: true };
  }

  try {
    const completion = await client.chat.completions.create({
      model: OPENROUTER_MODEL,
      temperature: 0.3,
      messages: [
        { role: "system", content: SYSTEM_PROMPT },
        { role: "user", content: prompt },
      ],
    });

    const raw = completion.choices[0]?.message?.content ?? "";
    const { files, summary } = normalizeFiles(extractJson(raw));
    if (files.length === 0) throw new Error("Model returned zero files");
    return { files, summary, usedFallback: false };
  } catch (err) {
    console.error("[openrouter] Generation failed, falling back to starter template:", err);
    const fallback = getBaseTemplateFiles(prompt);
    return {
      ...fallback,
      summary: `${fallback.summary} (AI call failed — showing a local fallback instead: ${
        err instanceof Error ? err.message : String(err)
      })`,
      usedFallback: true,
    };
  }
}
