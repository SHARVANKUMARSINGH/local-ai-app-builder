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

1. **Boot** (`src/lib/webcontainerManager.ts`) -- `WebContainer.boot()` runs
   once on page load (cached at module scope so React StrictMode's
   double-invoke in dev doesn't try to boot twice, which throws). This
   happens on every screen size, including mobile -- see "Mobile" below.
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
a read-only tree view of every file currently mounted in the WebContainer
(`src/components/FileTree.tsx`), built straight from the same file list the
editor and the AI operate on. Clicking a file opens it in Monaco.

### Mobile

Below the `md` breakpoint, only the chat panel renders -- no editor, no
terminal. The WebContainer boot/install/dev-server pipeline in `App.tsx`
doesn't change at all; it's the exact same code path regardless of screen
size. The chat panel just gains a slim status strip (phase + a link once the
preview URL is live) so there's still a visible signal of what's happening in
the background.

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
