import { WebContainer } from "@webcontainer/api";
import type { FileSystemTree, WebContainerProcess } from "@webcontainer/api";
import type { ProjectFile } from "../types";

/**
 * Waits for a spawned process to exit, but kills it and rejects if it takes
 * longer than `ms`. Without this, a genuinely stuck `npm install` (bad
 * network inside the container, a postinstall script that hangs, etc.)
 * would leave the whole generating flow spinning forever with no way out —
 * this guarantees it eventually surfaces as a catchable, retryable error.
 */
function waitForExit(proc: WebContainerProcess, ms: number, label: string): Promise<number> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      proc.kill();
      reject(new Error(`${label} timed out after ${Math.round(ms / 1000)}s and was stopped`));
    }, ms);
    proc.exit.then(
      (code) => {
        clearTimeout(timer);
        resolve(code);
      },
      (err) => {
        clearTimeout(timer);
        reject(err);
      }
    );
  });
}

/**
 * WebContainer.boot() may only be called ONCE per page load — calling it a
 * second time throws. React 18/19 StrictMode intentionally double-invokes
 * effects in dev, so we cache the boot promise at module scope (outside any
 * component) and hand every caller the same instance.
 */
let bootPromise: Promise<WebContainer> | null = null;

export function bootWebContainer(): Promise<WebContainer> {
  if (!bootPromise) {
    bootPromise = WebContainer.boot();
  }
  return bootPromise;
}

/** Converts a flat list of { path, contents } files into the nested
 *  FileSystemTree shape WebContainer.mount() expects, creating any
 *  intermediate directories along the way. */
export function toFileSystemTree(files: ProjectFile[]): FileSystemTree {
  const tree: FileSystemTree = {};

  for (const file of files) {
    const parts = file.path.split("/").filter(Boolean);
    const fileName = parts.pop();
    if (!fileName) continue;

    let cursor = tree;
    for (const dir of parts) {
      const existing = cursor[dir];
      if (existing && "directory" in existing) {
        cursor = existing.directory;
      } else {
        const next: FileSystemTree = {};
        cursor[dir] = { directory: next };
        cursor = next;
      }
    }

    cursor[fileName] = { file: { contents: file.contents } };
  }

  return tree;
}

export interface RunCallbacks {
  onOutput: (chunk: string) => void;
  onServerReady: (url: string, port: number) => void;
}

/**
 * Mounts the given files, then runs `npm install` followed by `npm run dev`
 * inside the container, streaming combined stdout/stderr to `onOutput` and
 * reporting the preview URL once Vite's dev server announces it's ready.
 */
export async function mountAndRun(
  container: WebContainer,
  files: ProjectFile[],
  { onOutput, onServerReady }: RunCallbacks
): Promise<void> {
  await container.mount(toFileSystemTree(files));

  container.on("server-ready", (port, url) => {
    onServerReady(url, port);
  });

  onOutput("$ npm install\r\n");
  const install = await container.spawn("npm", ["install"]);
  install.output.pipeTo(
    new WritableStream({
      write: (chunk) => onOutput(chunk),
    })
  );
  const installExit = await waitForExit(install, 180_000, "npm install");
  if (installExit !== 0) {
    onOutput(`\r\n\x1b[31mnpm install exited with code ${installExit}\x1b[0m\r\n`);
    throw new Error(`npm install failed with exit code ${installExit}`);
  }

  onOutput("\r\n$ npm run dev\r\n");
  const dev = await container.spawn("npm", ["run", "dev"]);
  dev.output.pipeTo(
    new WritableStream({
      write: (chunk) => onOutput(chunk),
    })
  );
  // Intentionally not awaiting `dev.exit` — the dev server runs indefinitely.
}

/** Overwrites the in-container files with a fresh generation and lets Vite's
 *  own HMR/file-watcher pick up the changes, instead of re-installing and
 *  restarting the whole dev server from scratch. */
export async function writeFiles(container: WebContainer, files: ProjectFile[]): Promise<void> {
  for (const file of files) {
    const parts = file.path.split("/").filter(Boolean);
    if (parts.length > 1) {
      const dir = parts.slice(0, -1).join("/");
      await container.fs.mkdir(dir, { recursive: true });
    }
    await container.fs.writeFile(file.path, file.contents);
  }
}

const EXCLUDED_DIRS = new Set(["node_modules", ".git", "dist", ".vite", ".cache"]);

/**
 * Recursively lists every file path (not directories) currently in the
 * container's filesystem, skipping build/dependency directories. This backs
 * the Files (VFS) tab, which reflects the REAL filesystem — including files
 * a terminal command created that the AI never explicitly declared — rather
 * than just the subset of files the app happens to be tracking in React
 * state for the editor.
 */
export async function listProjectFiles(container: WebContainer, dir = "."): Promise<string[]> {
  let entries;
  try {
    entries = await container.fs.readdir(dir, { withFileTypes: true });
  } catch {
    return [];
  }

  const paths: string[] = [];
  for (const entry of entries) {
    if (EXCLUDED_DIRS.has(entry.name)) continue;
    const path = dir === "." ? entry.name : `${dir}/${entry.name}`;
    if (entry.isDirectory()) {
      paths.push(...(await listProjectFiles(container, path)));
    } else {
      paths.push(path);
    }
  }
  return paths;
}

/** Deletes the given paths (files or directories) from the container. */
export async function deletePaths(container: WebContainer, paths: string[]): Promise<void> {
  for (const path of paths) {
    await container.fs.rm(path, { recursive: true, force: true });
  }
}

/**
 * Watches the whole project for filesystem changes (a terminal command
 * creating a file, an AI-run command adding/removing something, etc.) and
 * calls `onChange` — debounced — whenever something changes, so the Files
 * tab can refresh itself instead of only updating when the app itself wrote
 * a file. Returns the underlying watcher so the caller can `.close()` it.
 */
export function watchProject(container: WebContainer, onChange: () => void): { close: () => void } {
  let debounceTimer: ReturnType<typeof setTimeout> | null = null;
  const scheduleRefresh = () => {
    if (debounceTimer) clearTimeout(debounceTimer);
    debounceTimer = setTimeout(onChange, 300);
  };
  const watcher = container.fs.watch(".", { recursive: true }, () => scheduleRefresh());
  return {
    close: () => {
      if (debounceTimer) clearTimeout(debounceTimer);
      watcher.close();
    },
  };
}/** Splits a shell command string into argv, respecting simple "quoted" and
 *  'quoted' segments. Good enough for the kind of commands the model is
 *  asked to produce (`npm install foo`, `npm install -D foo bar`) — not a
 *  full shell parser. */
function tokenizeCommand(command: string): string[] {
  const tokens: string[] = [];
  const regex = /"([^"]*)"|'([^']*)'|(\S+)/g;
  let match: RegExpExecArray | null;
  while ((match = regex.exec(command)) !== null) {
    tokens.push(match[1] ?? match[2] ?? match[3]);
  }
  return tokens;
}

/**
 * Runs a list of shell commands inside the container sequentially, streaming
 * combined stdout/stderr to `onOutput`. Used for AI-requested follow-up
 * actions like `npm install <package>` on an already-running project — this
 * is what lets the AI actually drive the terminal, not just the filesystem.
 */
export async function runCommands(
  container: WebContainer,
  commands: string[],
  onOutput: (chunk: string) => void
): Promise<void> {
  for (const command of commands) {
    const [cmd, ...args] = tokenizeCommand(command);
    if (!cmd) continue;
    onOutput(`\r\n$ ${command}\r\n`);
    const proc = await container.spawn(cmd, args);
    proc.output.pipeTo(new WritableStream({ write: (chunk) => onOutput(chunk) }));
    const exit = await waitForExit(proc, 120_000, `"${command}"`);
    if (exit !== 0) {
      onOutput(`\r\n\x1b[31m"${command}" exited with code ${exit}\x1b[0m\r\n`);
    }
  }
}
