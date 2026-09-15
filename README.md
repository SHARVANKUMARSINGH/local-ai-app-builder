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
cp .env.local.example .env.local   # then paste your OpenRouter key in
npm run dev
```

Open the printed `localhost` URL. **Use a Chromium-based browser** (Chrome,
Edge, Arc) -- WebContainers currently require `SharedArrayBuffer`, which needs
the page to be cross-origin isolated; Firefox/Safari support is inconsistent.

If you skip the `.env.local` step, the app still works end-to-end: it falls
back to a local starter template (see `src/lib/projectTemplate.ts`) instead of
calling the AI, so you can verify the WebContainer pipeline before wiring up a
real key.

### Getting an OpenRouter key

Sign up at openrouter.ai/keys and create a key. The model used is set in
`src/lib/openrouter.ts` (`OPENROUTER_MODEL`) -- swap it for any model
OpenRouter hosts.

## How it works

1. **Boot** (`src/lib/webcontainerManager.ts`) -- `WebContainer.boot()` runs
   once on page load (cached at module scope so React StrictMode's
   double-invoke in dev doesn't try to boot twice, which throws).
2. **Generate** (`src/lib/openrouter.ts`) -- the prompt is sent to OpenRouter
   with a system prompt that asks for a JSON `{ files, summary }` payload; the
   response is parsed and validated into `ProjectFile[]`.
3. **Mount + run** -- the first generation mounts the files into the
   WebContainer's virtual filesystem, then spawns `npm install` followed by
   `npm run dev`, streaming combined stdout/stderr into the Xterm panel.
   `container.on('server-ready', ...)` fires with the live preview URL, which
   is dropped straight into the iframe.
4. **Iterate** -- later prompts hot-write the changed files directly into the
   already-running container (`writeFiles`), so Vite's own dev server/HMR
   picks them up without a full reinstall. Editing a file by hand in Monaco
   does the same.

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
