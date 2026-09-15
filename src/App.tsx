import { useCallback, useEffect, useRef, useState } from "react";
import type { WebContainer } from "@webcontainer/api";
import ChatPanel from "./components/ChatPanel";
import EditorPanel from "./components/EditorPanel";
import PreviewPanel from "./components/PreviewPanel";
import ApiKeyModal from "./components/ApiKeyModal";
import MobileWorkspace from "./components/MobileWorkspace";
import Resizer from "./components/Resizer";
import type { TerminalHandle } from "./components/Terminal";
import { generateProjectFromPrompt, hasUsableApiKey } from "./lib/openrouter";
import { getStoredApiKey, setStoredApiKey, clearStoredApiKey } from "./lib/apiKeyStore";
import {
  bootWebContainer,
  mountAndRun,
  writeFiles,
  runCommands,
  deletePaths,
  listProjectFiles,
  watchProject,
} from "./lib/webcontainerManager";
import type { ActionLogEntry, AiAction, BootPhase, ChatMessage, ProjectFile } from "./types";

let messageCounter = 0;
const nextId = () => `msg_${++messageCounter}_${Date.now()}`;

export default function App() {
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [files, setFiles] = useState<ProjectFile[]>([]);
  const [vfsPaths, setVfsPaths] = useState<string[]>([]);
  const [activePath, setActivePath] = useState<string | null>(null);
  const [isGenerating, setIsGenerating] = useState(false);
  const [phase, setPhase] = useState<BootPhase>("idle");
  const [serverUrl, setServerUrl] = useState<string | null>(null);
  const [apiKeyModalOpen, setApiKeyModalOpen] = useState(() => !hasUsableApiKey());
  const [hasKey, setHasKey] = useState(hasUsableApiKey);
  const [chatWidth, setChatWidth] = useState(340);
  const [previewWidth, setPreviewWidth] = useState(460);
  const [mobileOverlayTab, setMobileOverlayTab] = useState<"files" | "preview" | "terminal" | null>(null);

  const containerRef = useRef<WebContainer | null>(null);
  const terminalRef = useRef<TerminalHandle>(null);
  const mobileTerminalRef = useRef<TerminalHandle>(null);
  const hasRunInstallRef = useRef(false);
  // Mirrors `files` synchronously so handleSend can read the current project
  // state without needing `files` in its own dependency array.
  const filesRef = useRef<ProjectFile[]>([]);
  useEffect(() => {
    filesRef.current = files;
  }, [files]);

  const writeToTerminals = useCallback((chunk: string) => {
    terminalRef.current?.write(chunk);
    mobileTerminalRef.current?.write(chunk);
  }, []);

  const refreshVfs = useCallback(async () => {
    const container = containerRef.current;
    if (!container) return;
    try {
      const paths = await listProjectFiles(container);
      setVfsPaths(paths);
    } catch {
      // Best-effort — the tab just won't update this cycle.
    }
  }, []);

  // Requirement 3: boot the WebContainer as soon as the page loads, before
  // the user has typed anything, so the first generation can mount instantly.
  // This runs regardless of which panels are actually visible — on mobile,
  // the terminal/editor/preview are hidden from the UI, but the boot/install/
  // dev-server pipeline below is identical and keeps running in the background.
  useEffect(() => {
    let cancelled = false;
    let watcher: { close: () => void } | null = null;

    setPhase("booting");
    bootWebContainer()
      .then((c) => {
        if (cancelled) return;
        containerRef.current = c;
        setPhase("idle");
        writeToTerminals("WebContainer booted. Send a prompt to generate a project.\r\n");

        // Live VFS reload: whenever ANYTHING changes on disk inside the
        // container — a terminal command creating a file, npm install
        // touching package-lock.json, an AI action — refresh the Files tab
        // from the real filesystem, not just from what the app itself wrote.
        watcher = watchProject(c, refreshVfs);
      })
      .catch((err) => {
        if (cancelled) return;
        setPhase("error");
        writeToTerminals(`\r\n\x1b[31mFailed to boot WebContainer: ${String(err)}\x1b[0m\r\n`);
      });

    return () => {
      cancelled = true;
      watcher?.close();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const appendMessage = useCallback(
    (role: ChatMessage["role"], content: string, actions?: ActionLogEntry[]) => {
      setMessages((prev) => [...prev, { id: nextId(), role, content, createdAt: Date.now(), actions }]);
    },
    []
  );

  const handleSend = useCallback(async (prompt: string) => {
    appendMessage("user", prompt);
    setIsGenerating(true);

    const isFirstGeneration = !hasRunInstallRef.current;

    try {
      const { actions, summary, usedFallback } = await generateProjectFromPrompt(
        prompt,
        isFirstGeneration ? [] : filesRef.current
      );

      if (actions.length === 0) {
        appendMessage("assistant", summary);
        return;
      }

      const container = containerRef.current;
      if (!container) throw new Error("WebContainer is not ready yet");

      const knownPaths = new Set(filesRef.current.map((f) => f.path));
      const writes = actions.filter((a): a is AiAction & { type: "write_file" } => a.type === "write_file");
      const deletes = actions.filter((a): a is AiAction & { type: "delete_file" } => a.type === "delete_file");
      const commands = actions
        .filter((a): a is AiAction & { type: "run_command" } => a.type === "run_command")
        .map((a) => a.command!);

      // Build the action log BEFORE applying, from the pre-change knownPaths,
      // so "added" vs "edited" reflects what was actually true at the time.
      const log: ActionLogEntry[] = [
        ...writes.map(
          (w): ActionLogEntry => ({
            type: knownPaths.has(w.path!) ? "file_edited" : "file_added",
            path: w.path,
          })
        ),
        ...deletes.map((d): ActionLogEntry => ({ type: "file_removed", path: d.path })),
        ...commands.map((c): ActionLogEntry => ({ type: "command", command: c })),
      ];
      appendMessage(
        "assistant",
        usedFallback ? `${summary}\n\n*(using local fallback — see the OpenRouter setup note)*` : summary,
        log
      );

      const newProjectFiles: ProjectFile[] = writes.map((w) => ({ path: w.path!, contents: w.contents! }));

      if (isFirstGeneration) {
        hasRunInstallRef.current = true;
        setFiles(newProjectFiles);
        setActivePath(
          newProjectFiles.find((f) => f.path === "src/App.tsx")?.path ?? newProjectFiles[0]?.path ?? null
        );
        setPhase("mounting");
        setPhase("installing");
        await mountAndRun(container, newProjectFiles, {
          onOutput: writeToTerminals,
          onServerReady: (url) => {
            setServerUrl(url);
            setPhase("ready");
          },
        });
        setPhase("starting");
      } else {
        // The AI can touch the virtual filesystem, the editor, and the
        // terminal on follow-up prompts: merge writes, apply deletes, hot-
        // write into the running container (Vite's HMR picks them up), then
        // run any commands it asked for.
        if (newProjectFiles.length > 0) {
          setFiles((prev) => {
            const map = new Map(prev.map((f) => [f.path, f] as const));
            for (const f of newProjectFiles) map.set(f.path, f);
            return Array.from(map.values());
          });
          setActivePath(newProjectFiles[0].path);
          await writeFiles(container, newProjectFiles);
        }
        if (deletes.length > 0) {
          const deletePathSet = new Set(deletes.map((d) => d.path!));
          setFiles((prev) => prev.filter((f) => !deletePathSet.has(f.path)));
          setActivePath((prev) => (prev && deletePathSet.has(prev) ? null : prev));
          await deletePaths(container, deletes.map((d) => d.path!));
        }
        if (commands.length > 0) {
          await runCommands(container, commands, writeToTerminals);
        }
      }

      await refreshVfs();
    } catch (err) {
      setPhase("error");
      const message = err instanceof Error ? err.message : String(err);
      appendMessage("assistant", `Something went wrong: ${message}`);
      writeToTerminals(`\r\n\x1b[31m${message}\x1b[0m\r\n`);
    } finally {
      setIsGenerating(false);
    }
  }, [appendMessage, refreshVfs, writeToTerminals]);

  const handleSaveApiKey = useCallback((key: string) => {
    setStoredApiKey(key);
    setHasKey(true);
    setApiKeyModalOpen(false);
  }, []);

  const handleSkipApiKey = useCallback(() => setApiKeyModalOpen(false), []);

  const handleClearApiKey = useCallback(() => {
    clearStoredApiKey();
    setHasKey(hasUsableApiKey());
    setApiKeyModalOpen(true);
  }, []);

  const handleChangeContents = useCallback((path: string, contents: string) => {
    setFiles((prev) => prev.map((f) => (f.path === path ? { ...f, contents } : f)));
    const container = containerRef.current;
    if (container) void writeFiles(container, [{ path, contents }]);
  }, []);

  /** Opens a path in Monaco, fetching its contents from the real container
   *  filesystem first if it's not one of the files already tracked in state
   *  (e.g. something a terminal command created that the AI never declared). */
  const handleSelectVfsPath = useCallback(async (path: string) => {
    if (filesRef.current.some((f) => f.path === path)) {
      setActivePath(path);
      return;
    }
    const container = containerRef.current;
    if (!container) return;
    try {
      const contents = await container.fs.readFile(path, "utf-8");
      setFiles((prev) => [...prev, { path, contents }]);
      setActivePath(path);
    } catch {
      // Not a readable text file (e.g. a binary) — nothing sensible to show.
    }
  }, []);

  return (
    <div className="flex h-screen w-screen overflow-hidden bg-base text-text">
      {apiKeyModalOpen && (
        <ApiKeyModal
          currentKey={getStoredApiKey()}
          onSave={handleSaveApiKey}
          onSkip={handleSkipApiKey}
          onClear={handleClearApiKey}
        />
      )}

      {/* Mobile: chat is the primary panel, full width. Long-press it to reveal
          Files/Preview/Terminal in a full-screen overlay — see MobileWorkspace.
          The WebContainer boot/install/dev-server pipeline above runs identically
          either way; only the UI for watching it differs below the md breakpoint. */}
      <aside
        style={{ ["--chat-w" as string]: `${chatWidth}px` }}
        className="w-full shrink-0 border-r border-border md:w-[var(--chat-w)]"
      >
        <ChatPanel
          messages={messages}
          isGenerating={isGenerating}
          onSend={handleSend}
          apiKeyPresent={hasKey}
          onManageApiKey={() => setApiKeyModalOpen(true)}
          phase={phase}
          serverUrl={serverUrl}
          onOpenMobileWorkspace={(tab) => setMobileOverlayTab(tab)}
        />
      </aside>

      <Resizer className="hidden md:block" onDrag={(dx) => setChatWidth((w) => Math.min(560, Math.max(260, w + dx)))} />

      <main className="hidden min-w-0 flex-1 border-r border-border md:block">
        <EditorPanel
          files={files}
          activePath={activePath}
          onSelectPath={setActivePath}
          onChangeContents={handleChangeContents}
        />
      </main>

      <Resizer className="hidden md:block" onDrag={(dx) => setPreviewWidth((w) => Math.min(800, Math.max(320, w - dx)))} />

      <aside style={{ width: previewWidth }} className="hidden shrink-0 md:block">
        <PreviewPanel
          ref={terminalRef}
          phase={phase}
          serverUrl={serverUrl}
          vfsPaths={vfsPaths}
          activePath={activePath}
          onSelectPath={handleSelectVfsPath}
          onRefreshVfs={refreshVfs}
        />
      </aside>

      {mobileOverlayTab && (
        <MobileWorkspace
          initialTab={mobileOverlayTab}
          onClose={() => setMobileOverlayTab(null)}
          phase={phase}
          serverUrl={serverUrl}
          vfsPaths={vfsPaths}
          activePath={activePath}
          onSelectPath={handleSelectVfsPath}
          onRefreshVfs={refreshVfs}
          terminalRef={mobileTerminalRef}
        />
      )}
    </div>
  );
}
