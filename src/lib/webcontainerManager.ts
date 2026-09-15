import { WebContainer } from "@webcontainer/api";
import type { FileSystemTree } from "@webcontainer/api";
import type { ProjectFile } from "../types";

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
  const installExit = await install.exit;
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
