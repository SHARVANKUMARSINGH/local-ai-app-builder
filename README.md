# local-ai-app-builder

A browser-based AI app generator (Bolt.new / Lovable-style): describe an app in
plain English in the chat panel, and it's generated, installed, and run live
in an in-browser Node.js runtime ([WebContainers](https://webcontainers.io)) —
no backend server required.

```
+----------------+---------------------------+-----------------------------+
|  Chat          |  Monaco code editor       |  Live preview (iframe)      |
|  (prompt the   |  (view/edit generated     |  ----------------------------|
|   AI)          |   files)                  |  Terminal (npm install/dev) |
+----------------+---------------------------+-----------------------------+
```

## Stack

- Vite + React + TypeScript
- `@webcontainer/api` -- boots a Node.js runtime in-browser, mounts a virtual
  filesystem, and runs real `npm install` / `npm run dev` processes.
- `@monaco-editor/react` -- the VS Code editor component.
- `xterm` + `xterm-addon-fit` -- renders the WebContainer process output as a
  real terminal.
- `openai` SDK, pointed at OpenRouter's OpenAI-compatible endpoint, for the
  actual code generation.
- Tailwind CSS v4 (via `@tailwindcss/vite`) for styling.

## Getting started

```bash
npm install
npm run dev
```

Open the printed `localhost` URL. **Use a Chromium-based browser** (Chrome,
Edge, Arc) -- WebContainers currently require `SharedArrayBuffer`, which needs
the page to be cross-origin isolated; Firefox/Safari support is inconsistent.

On first load you'll get a small popup asking for your OpenRouter API key.
That key is saved only in **that browser's localStorage** and is sent
straight from the browser to OpenRouter -- it never touches a server of ours,
which matters because this is a static, backend-less app. You can reopen the
popup any time from the "Add API key" / "API key set" button in the chat
panel's header, to replace or remove it.

If you skip the popup, the app still works end-to-end: it falls back to a
local starter template (see `src/lib/projectTemplate.ts`) instead of calling
the AI, so you can verify the WebContainer pipeline before wiring up a real
key.

There's also a `.env.local` option (`VITE_OPENROUTER_API_KEY`) for solo local
dev -- it's checked as a fallback if no key is saved in localStorage. **Don't
rely on it for anything you deploy publicly**: Vite bakes `VITE_*` env vars
literally into the shipped JS bundle, so anyone visiting your deployed site
could read it out of the network tab. The localStorage popup exists
specifically to avoid that.

### Getting an OpenRouter key

Sign up at openrouter.ai/keys and create a key. The model used is set in
`src/lib/openrouter.ts` (`OPENROUTER_MODEL`) -- swap it for any model
OpenRouter hosts.

## How it works

0. **Projects** -- the app opens on a landing page (`src/components/ProjectLanding.tsx`),
   not straight into the builder. Creating a project asks for a name, a
   **platform** (Web or Native), and a **model**:
   - **Web** shows a framework grid -- React, Vue, Svelte, Vanilla JS,
     Static (plain HTML/CSS/JS, no build step, for ordinary pages), or
     Custom (no framework constraint at all -- the AI picks the stack).
   - **Native** is a single fixed preset: React Native + Expo, previewed via
     Expo's *web* target (`expo start --web`) since there's no mobile
     simulator inside a browser tab -- the AI is told to say so plainly the
     first time, so it's clear you're seeing react-native-web's rendering,
     not a native build. This one is more experimental than the Web presets:
     Expo's install is large and WebContainer wasn't really designed for it.
   - The **model** picker (`src/components/ModelPicker.tsx`) is a
     from-scratch dropdown, not a native `<select>`, fetching OpenRouter's
     live catalog from `GET /api/v1/models` and grouping it into Free / Paid,
     each row with a small vendor monogram (see "Model picker" below for why
     not real logos).

   All three choices are fixed for that project's lifetime, on purpose --
   they're Create Project settings, not per-message ones (`src/lib/frameworks.ts`
   is the small catalog behind the framework grid). Every project's
   `{ name, model, platform, framework, files, messages }` is persisted to
   `localStorage` (`src/lib/projects.ts`), and reopening one from the landing
   page re-mounts its saved files into a fresh WebContainer automatically --
   the dev server session itself can't survive a page reload (it's in-memory
   in the tab), but the code and chat history do.
1. **Boot** (`src/lib/webcontainerManager.ts`) -- `WebContainer.boot()` runs
   once per opened project (cached at module scope so React StrictMode's
   double-invoke in dev doesn't try to boot twice, which throws).
2. **Generate** (`src/lib/openrouter.ts`) -- the prompt is sent to
   `openrouter/free` (OpenRouter's own free-tier router model, so this
   doesn't rot the way a hardcoded `some-model:free` id does when that
   specific free listing gets pulled) with a system prompt that asks for a
   JSON `{ files, commands, summary }` payload; the response is parsed and
   validated.
3. **Mount + run** -- the first generation mounts the files into the
   WebContainer's virtual filesystem, then spawns `npm install` followed by
   `npm run dev`, streaming combined stdout/stderr into the Xterm panel.
   `container.on('server-ready', ...)` fires with the live preview URL, which
   is dropped straight into the iframe.
4. **Iterate** -- follow-up prompts send the AI the full current contents of
   every file as context (see `renderExistingFiles` in `openrouter.ts`), so
   it's genuinely reading and editing the running project -- the virtual
   filesystem, the same code visible in Monaco -- rather than regenerating
   blind. It can also return a `commands` array (e.g. `npm install axios`)
   which runs for real in the WebContainer's terminal via `runCommands` in
   `webcontainerManager.ts`. Editing a file by hand in Monaco hot-writes it
   the same way.

### Virtual Files tab

The right panel has two tabs: **Preview** (the live iframe) and **Files** --
a tree view of the WebContainer's actual, real filesystem
(`listProjectFiles` in `webcontainerManager.ts`), not just the subset the app
happens to be tracking for the editor. A `container.fs.watch(".", {
recursive: true })` watcher keeps it live -- a terminal command creating a
file, `npm install` writing `package-lock.json`, an AI-run command -- any of
those trigger a debounced refresh automatically. There's also a manual
Refresh button. Clicking a file not yet open in Monaco lazy-loads its real
contents from the container and opens it.

### The strict action protocol

The AI never returns "a project" loosely -- every response is validated
against exactly four action shapes (`src/lib/openrouter.ts`):

```json
{ "type": "write_file",  "path": "src/App.tsx", "contents": "..." }
{ "type": "delete_file", "path": "src/Old.tsx" }
{ "type": "run_command", "command": "npm install axios" }
{ "type": "summary",     "text": "What I did, in Markdown, for the chat." }
```

Anything that doesn't match one of these four shapes exactly is rejected.
This is what lets one response touch the filesystem, the editor, and the
terminal together -- `write_file`/`delete_file` cover the Files tool,
`run_command` covers the Terminal tool. `summary` is a tool too, not a
separate top-level field -- there's no independent `"summary": "..."` key
anymore; the chat-facing text is carried as a `{ "type": "summary", "text":
"..." }` entry in `actions`, same as any other action, and every response
must include exactly one. **"Tool: none"** -- for when the user is just
asking a question or chatting, with no code change needed -- is just a
response whose *only* action is that summary entry, e.g.
`{ "actions": [ { "type": "summary", "text": "Hi! How can I help?" } ] }`.
`normalizeResult` splits the summary text back out for the chat message and
hands the rest of the app the other three action types only, so nothing
downstream (the action log, the file/terminal apply logic) had to change
when this moved off a separate field -- it's purely a wire-format change.
The model is told returning only a summary is a normal response, not a
failure, so it doesn't invent a pointless file edit just to have something
else in the array. The system prompt also tells it the WebContainer already
has Node.js/npm preinstalled, so it doesn't waste a `run_command` trying to
install Node itself. Applied actions show up in chat as small chips ("+2
Files added", "1 File edited", "$ npm install axios") built from
`ActionLogEntry`s in `Builder.tsx`. The summary text is Markdown, rendered
via `react-markdown` + `remark-gfm`.

### Model picker

`GET https://openrouter.ai/api/v1/models` is a public, unauthenticated
endpoint, so the picker fetches it directly from the browser -- no key
needed just to browse. Models are split into Free (`pricing.prompt` and
`.completion` both `"0"`, or an id ending in `:free`) and Paid, each row
showing a vendor monogram and, for paid models, a $/M-token price. OpenRouter
doesn't return per-model icon assets, and reproducing every provider's
actual brand logo would be a copyright problem regardless, so
`src/lib/vendorIcon.ts` derives a plain two-letter monogram from the vendor
slug (the "openai" in "openai/gpt-4o") instead of a real logo.

### Resizable panels & mobile workspace

Desktop: drag the thin dividers between chat/editor/preview
(`src/components/Resizer.tsx`) to resize them.

Mobile (below the `md` breakpoint): only chat renders. Long-press (or
right-click, which is the same `contextmenu` event) anywhere in the message
list to open a menu -- Files / Preview / Terminal -- each opening full-screen
(`MobileWorkspace.tsx`). The WebContainer pipeline itself doesn't change on
mobile at all; it's the exact same code path as desktop, running in the
background regardless of which panel (if any) is currently open.

## Favicon

`public/favicon.svg` is drawn, not borrowed — `scripts/generate_favicon.py`
procedurally builds an original mark (a terminal-prompt chevron + cursor
block, computed from real geometry, not a copied path) and writes it to both
`scripts/favicon.svg` and `public/favicon.svg`. Re-run
`python3 scripts/generate_favicon.py` after tweaking the constants at the top
of the script (colors, chevron angle, stroke width) to regenerate it.

## Cross-origin isolation

WebContainers need `Cross-Origin-Embedder-Policy: require-corp` and
`Cross-Origin-Opener-Policy: same-origin` on every response. `vite.config.ts`
sets these via `server.headers` / `preview.headers`. If you deploy this
outside of `vite preview` (e.g. a static host), you'll need to configure the
same two headers there too.

## Known limitations

- Changing a generated project's *dependencies* on a follow-up prompt doesn't
  trigger a re-install -- only the first prompt runs `npm install`. Extending
  this to diff `package.json` and re-install when it changes is the natural
  next step.
- The AI call has no streaming/partial-file support; it waits for the full
  JSON payload before mounting anything.
- The mobile long-press Terminal tab only shows output from the moment you
  open it -- there's no replay buffer for what ran before that.
- `openrouter/free` is a random router across whatever's currently free, so
  code quality/reliability varies run to run more than a pinned model would.
- The Native/Expo preset is the least battle-tested path here -- Expo's
  dependency tree is large and WebContainer is a much thinner Node
  environment than a real machine, so treat it as experimental relative to
  the Web framework presets.

## Fixed along the way

A few real bugs worth knowing about if you're reading the history:

- **Typing something like "hi" as the first message used to always scaffold
  a demo project.** The initial system prompt required producing a working
  app no matter what; it now allows the same empty-`actions` "Tool: none"
  response as every other turn, including as the first message, so a
  greeting just gets a reply. With no API key configured yet there's no
  model to make that judgment, so a small offline heuristic
  (`looksLikeGreeting` in `openrouter.ts`) catches obvious greetings there
  instead of running the local fallback template.
- **A stalled OpenRouter request could leave the UI spinning forever.**
  The client sets an explicit `timeout` (90s, generous since a full
  multi-file generation streams for a while) and caps retries, so a hung
  free-tier request surfaces as a catchable error instead of hanging.
  `npm install` and any AI-run terminal command are now similarly bounded
  (`waitForExit` in `webcontainerManager.ts`) and get killed, not just
  waited on forever, if they blow past 2-3 minutes.
- **Asking to "add an index.html file" could break the dev server.** For
  Vite-based frameworks, index.html at the project root is the real Vite
  entry point, not an arbitrary file -- the iteration system prompt now says
  so explicitly, so a request like that edits the existing file (or creates
  a *different* filename for a genuinely separate static page) instead of
  overwriting Vite's entry point with something that breaks it.
- **"Generating…" stayed on screen well after files were added, looking
  stuck.** It wasn't actually stuck -- `npm install` for a fresh project
  can genuinely take a minute-plus, especially on a phone -- but the label
  never changed to say so. The generating indicator now reads `phase`
  (`generatingLabel` in `ChatPanel.tsx`) and says "Installing
  dependencies…" / "Starting dev server…" instead of a flat "Generating…"
  the whole time.
- **A non-JSON response on a non-React project silently swapped in a plain
  React counter app.** The offline fallback template is a hardcoded React +
  Vite app — fine as a stand-in when React is actually the chosen framework,
  actively wrong for anything else (this is exactly what happened testing
  Native/Expo: a response that wasn't valid JSON fell back to a React app
  with no relation to Expo). The fallback now only fires when
  `framework === "react"`; every other framework gets a plain, honest
  "the AI response couldn't be used, try again" instead of a silently wrong
  stack.
- **A parse failure only ever showed a generic error string.** The
  generation call now streams (`stream: true`), and every message that hit
  a fallback or parse error carries the AI's exact raw response
  (`rawResponse` on `ChatMessage`) behind a "Show raw response" toggle, so
  a bad response is inspectable instead of just "No JSON object found."
  The generating indicator itself is now a real Unicode spinner (braille
  frames, `Spinner.tsx`) that's clickable while a request is in flight --
  click it to watch the model's response accumulate live, the same
  transparency you'd get watching Claude's own output stream in.
