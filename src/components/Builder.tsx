import { useCallback, useEffect, useRef, useState } from "react";
import type { WebContainer } from "@webcontainer/api";
import ChatPanel from "./ChatPanel";
import EditorPanel from "./EditorPanel";
import PreviewPanel from "./PreviewPanel";
import ApiKeyModal from "./ApiKeyModal";
import MobileWorkspace from "./MobileWorkspace";
import Resizer from "./Resizer";
import type { TerminalHandle } from "./Terminal";
import { generateProjectFromPrompt, hasUsableApiKey } from "../lib/openrouter";
import { getStoredApiKey, setStoredApiKey, clearStoredApiKey } from "../lib/apiKeyStore";
import { saveProject, type StoredProject } from "../lib/projects";
import { frameworkById } from "../lib/frameworks";
import {
  bootWebContainer,
  mountAndRun,
  writeFiles,
  runCommands,
  deletePaths,
  listProjectFiles,
  watchProject,
} from "../lib/webcontainerManager";
import type { ActionLogEntry, AiAction, BootPhase, ChatMessage, ProjectFile } from "../types";

let messageCounter = 0;
const nextId = () => `msg_${++messageCounter}_${Date.now()}`;

interface BuilderProps {
  project: StoredProject;
  onBackToProjects: () => void;
}

/**
 * The 3-panel workspace for one project. Mounted fresh per project (see
 * App.tsx) — switching projects unmounts this entirely, which is what gives
 * each project its own WebContainer boot, refs, and effect lifecycle rather
 * than trying to reuse one WebContainer instance across projects.
 */
export default function Builder({ project, onBackToProjects }: BuilderProps) {
  const [messages, setMessages] = useState<ChatMessage[]>(project.messages);
  const [files, setFiles] = useState<ProjectFile[]>(project.files);
  const [vfsPaths, setVfsPaths] = useState<string[]>([]);
  const [activePath, setActivePath] = useState<string | null>(
    project.files.find((f) => f.path === "src/App.tsx")?.path ?? project.files[0]?.path ?? null
  );
  const [isGenerating, setIsGenerating] = useState(false);
  const [streamingText, setStreamingText] = useState("");
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
  // A resumed project (opened from the landing page with files already
  // saved) skips straight to iteration mode once its resume-mount finishes;
  // a brand-new project waits for the first prompt to do the first mount.
  const hasRunInstallRef = useRef(project.files.length > 0);
  const filesRef = useRef<ProjectFile[]>(project.files);
  useEffect(() => {
    filesRef.current = files;
  }, [files]);

  // Persist this project's files/messages to localStorage whenever they
  // change, so closing the tab or going back to the project list doesn't
  // lose work. The WebContainer session itself can't be persisted (it's
  // in-memory in this tab), but re-opening the project resumes it below.
  useEffect(() => {
    saveProject({ ...project, files, messages });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [files, messages]);

  const writeToTerminals = useCallback((chunk: string) => {
    terminalRef.current?.write(chunk);
    mobileTerminalRef.current?.write(chunk);
  }, []);

  const refreshVfs = useCallback(async () => {
    const container = containerRef.current;
    if (!container) return;
    try {
      setVfsPaths(await listProjectFiles(container));
    } catch {
      // Best-effort — the tab just won't update this cycle.
    }
  }, []);

  // Boot the WebContainer as soon as this project opens, before the user has
  // typed anything. If the project already has saved files (resumed from the
  // landing page), immediately mount + install + run them so reopening a
  // project feels like resuming, not starting over. This runs regardless of
  // which panels are visible — on mobile the pipeline is identical, just
  // hidden behind the long-press workspace overlay.
  useEffect(() => {
    let cancelled = false;
    let watcher: { close: () => void } | null = null;

    setPhase("booting");
    bootWebContainer()
      .then(async (c) => {
        if (cancelled) return;
        containerRef.current = c;
        watcher = watchProject(c, refreshVfs);

        if (project.files.length > 0) {
          writeToTerminals(`Resuming "${project.name}"…\r\n`);
          setPhase("installing");
          try {
            await mountAndRun(c, project.files, {
              onOutput: writeToTerminals,
              onServerReady: (url) => {
                if (cancelled) return;
                setServerUrl(url);
                setPhase("ready");
              },
            });
            if (!cancelled) setPhase("starting");
          } catch (err) {
            if (!cancelled) {
              setPhase("error");
              writeToTerminals(`\r\n\x1b[31m${String(err)}\x1b[0m\r\n`);
            }
          }
          await refreshVfs();
        } else {
          setPhase("idle");
          writeToTerminals("WebContainer booted. Send a prompt to generate a project.\r\n");
        }
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
    (role: ChatMessage["role"], content: string, actions?: ActionLogEntry[], rawResponse?: string) => {
      setMessages((prev) => [
        ...prev,
        { id: nextId(), role, content, createdAt: Date.now(), actions, rawResponse: rawResponse || undefined },
      ]);
    },
    []
  );

  const handleSend = useCallback(async (prompt: string) => {
    appendMessage("user", prompt);
    setIsGenerating(true);
    setStreamingText("");

    const isFirstGeneration = !hasRunInstallRef.current;

    try {
      const { actions, summary, usedFallback, rawResponse } = await generateProjectFromPrompt(
        prompt,
        isFirstGeneration ? [] : filesRef.current,
        project.model,
        project.framework ?? "react",
        setStreamingText
      );

      // Empty actions is valid ("Tool: none") — a pure Q&A/chat turn that
      // needs no file or terminal change at all.
      if (actions.length === 0) {
        appendMessage("assistant", summary, undefined, rawResponse);
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
        log,
        rawResponse
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
      setStreamingText("");
    }
  }, [appendMessage, refreshVfs, writeToTerminals, project.model, project.framework]);

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

      <aside
        style={{ ["--chat-w" as string]: `${chatWidth}px` }}
        className="w-full shrink-0 border-r border-border md:w-[var(--chat-w)]"
      >
        <ChatPanel
          projectName={project.name}
          onBackToProjects={onBackToProjects}
          model={project.model}
          frameworkLabel={frameworkById(project.framework ?? "react").label}
          messages={messages}
          isGenerating={isGenerating}
          streamingText={streamingText}
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
