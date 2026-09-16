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
   not straight into the builder. Creating a project asks for a name and a
   model (`src/components/ModelPicker.tsx` -- a from-scratch dropdown, not a
   native `<select>`, fetching OpenRouter's live catalog from
   `GET /api/v1/models` and grouping it into Free / Paid, each row with a
   small vendor monogram -- see "Model picker" below for why not real logos).
   The model choice is fixed for that project's lifetime, on purpose --
   it's a Create Project setting, not a per-message one. Every project's
   `{ name, model, files, messages }` is persisted to `localStorage`
   (`src/lib/projects.ts`) and reopening one from the landing page re-mounts
   its saved files into a fresh WebContainer automatically -- the dev server
   session itself can't survive a page reload (it's in-memory in the tab),
   but the code and chat history do.
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
against exactly three action shapes, or an empty list (`src/lib/openrouter.ts`):

```json
{ "type": "write_file",  "path": "src/App.tsx", "contents": "..." }
{ "type": "delete_file", "path": "src/Old.tsx" }
{ "type": "run_command", "command": "npm install axios" }
```

Anything that doesn't match one of these three shapes exactly is rejected.
This is what lets one response touch the filesystem, the editor, and the
terminal together -- `write_file`/`delete_file` cover the Files tool,
`run_command` covers the Terminal tool. An **empty `actions: []`** is
explicitly valid too ("Tool: none" in the system prompt) -- for when the
user is just asking a question or chatting, with no code change needed; the
model is told this is a normal response, not a failure, so it doesn't
invent a pointless file edit just to have something in the array. The
system prompt also tells it the WebContainer already has Node.js/npm
preinstalled, so it doesn't waste a `run_command` trying to install Node
itself. Applied actions show up in chat as small chips ("+2 Files added",
"1 File edited", "$ npm install axios") built from `ActionLogEntry`s in
`Builder.tsx`. The `summary` field is Markdown, rendered via
`react-markdown` + `remark-gfm`.

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
- No persistence -- refreshing the page loses the generated project (nothing
  is written to browser storage yet).
