import { useCallback, useEffect, useRef, useState } from "react";
import type { WebContainer } from "@webcontainer/api";
import ChatPanel from "./components/ChatPanel";
import EditorPanel from "./components/EditorPanel";
import PreviewPanel from "./components/PreviewPanel";
import ApiKeyModal from "./components/ApiKeyModal";
import type { TerminalHandle } from "./components/Terminal";
import { generateProjectFromPrompt, hasUsableApiKey } from "./lib/openrouter";
import { getStoredApiKey, setStoredApiKey, clearStoredApiKey } from "./lib/apiKeyStore";
import { bootWebContainer, mountAndRun, writeFiles, runCommands } from "./lib/webcontainerManager";
import type { BootPhase, ChatMessage, ProjectFile } from "./types";

let messageCounter = 0;
const nextId = () => `msg_${++messageCounter}_${Date.now()}`;

/** Upserts `incoming` files into `existing` by path, preserving the order of
 *  files that were already there and appending genuinely new ones. */
function mergeFiles(existing: ProjectFile[], incoming: ProjectFile[]): ProjectFile[] {
  const map = new Map(existing.map((f) => [f.path, f] as const));
  for (const f of incoming) map.set(f.path, f);
  return Array.from(map.values());
}

export default function App() {
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [files, setFiles] = useState<ProjectFile[]>([]);
  const [activePath, setActivePath] = useState<string | null>(null);
  const [isGenerating, setIsGenerating] = useState(false);
  const [phase, setPhase] = useState<BootPhase>("idle");
  const [serverUrl, setServerUrl] = useState<string | null>(null);
  const [apiKeyModalOpen, setApiKeyModalOpen] = useState(() => !hasUsableApiKey());
  const [hasKey, setHasKey] = useState(hasUsableApiKey);

  const containerRef = useRef<WebContainer | null>(null);
  const terminalRef = useRef<TerminalHandle>(null);
  const hasRunInstallRef = useRef(false);
  // Mirrors `files` synchronously so handleSend can read the current project
  // state without needing `files` in its own dependency array (which would
  // otherwise recreate the callback — and re-run the boot effect's closures
  // — on every keystroke-driven edit).
  const filesRef = useRef<ProjectFile[]>([]);
  useEffect(() => {
    filesRef.current = files;
  }, [files]);

  // Requirement 3: boot the WebContainer as soon as the page loads, before
  // the user has typed anything, so the first generation can mount instantly.
  // This runs regardless of which panels are actually visible — on mobile,
  // the terminal/editor/preview are hidden from the UI, but the boot/install/
  // dev-server pipeline below is identical and keeps running in the background.
  useEffect(() => {
    setPhase("booting");
    bootWebContainer()
      .then((c) => {
        containerRef.current = c;
        setPhase("idle");
        terminalRef.current?.write("WebContainer booted. Send a prompt to generate a project.\r\n");
      })
      .catch((err) => {
        setPhase("error");
        terminalRef.current?.write(`\r\n\x1b[31mFailed to boot WebContainer: ${String(err)}\x1b[0m\r\n`);
      });
  }, []);

  const appendMessage = useCallback((role: ChatMessage["role"], content: string) => {
    setMessages((prev) => [...prev, { id: nextId(), role, content, createdAt: Date.now() }]);
  }, []);

  const handleSend = useCallback(async (prompt: string) => {
    appendMessage("user", prompt);
    setIsGenerating(true);

    const isFirstGeneration = !hasRunInstallRef.current;

    try {
      // Iterations get the full current project as context, so the AI is
      // reading and editing the real virtual filesystem instead of guessing.
      const { files: newFiles, commands, summary, usedFallback } = await generateProjectFromPrompt(
        prompt,
        isFirstGeneration ? [] : filesRef.current
      );

      appendMessage(
        "assistant",
        usedFallback ? `${summary} (using local fallback — see the OpenRouter setup note.)` : summary
      );

      if (newFiles.length === 0 && commands.length === 0) {
        // Nothing to apply (e.g. iteration failed, or no key configured yet).
        return;
      }

      const container = containerRef.current;
      if (!container) throw new Error("WebContainer is not ready yet");

      if (isFirstGeneration) {
        hasRunInstallRef.current = true;
        setFiles(newFiles);
        setActivePath(newFiles.find((f) => f.path === "src/App.tsx")?.path ?? newFiles[0]?.path ?? null);
        setPhase("mounting");
        setPhase("installing");
        await mountAndRun(container, newFiles, {
          onOutput: (chunk) => terminalRef.current?.write(chunk),
          onServerReady: (url) => {
            setServerUrl(url);
            setPhase("ready");
          },
        });
        setPhase("starting");
      } else {
        // The AI can touch the virtual filesystem, the editor, and the
        // terminal on follow-up prompts: merge whichever files it changed
        // into state (Monaco updates instantly), hot-write just those files
        // into the running container (Vite's HMR picks them up), then run
        // any commands it asked for (e.g. installing a new package).
        setFiles((prev) => mergeFiles(prev, newFiles));
        if (newFiles.length > 0) setActivePath(newFiles[0].path);
        if (newFiles.length > 0) await writeFiles(container, newFiles);
        if (commands.length > 0) {
          await runCommands(container, commands, (chunk) => terminalRef.current?.write(chunk));
        }
      }
    } catch (err) {
      setPhase("error");
      const message = err instanceof Error ? err.message : String(err);
      appendMessage("assistant", `Something went wrong: ${message}`);
      terminalRef.current?.write(`\r\n\x1b[31m${message}\x1b[0m\r\n`);
    } finally {
      setIsGenerating(false);
    }
  }, [appendMessage]);

  const handleSaveApiKey = useCallback((key: string) => {
    setStoredApiKey(key);
    setHasKey(true);
    setApiKeyModalOpen(false);
  }, []);

  const handleSkipApiKey = useCallback(() => {
    setApiKeyModalOpen(false);
  }, []);

  const handleClearApiKey = useCallback(() => {
    clearStoredApiKey();
    setHasKey(hasUsableApiKey());
    setApiKeyModalOpen(true);
  }, []);

  const handleChangeContents = useCallback((path: string, contents: string) => {
    setFiles((prev) => prev.map((f) => (f.path === path ? { ...f, contents } : f)));
    const container = containerRef.current;
    if (container) {
      void writeFiles(container, [{ path, contents }]);
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

      {/* Mobile: chat is the only visible panel — full width, no editor/terminal.
          The WebContainer boot/install/dev-server pipeline above runs identically
          either way; only the UI for watching it is hidden below the md breakpoint. */}
      <aside className="w-full shrink-0 border-r border-border md:w-[340px]">
        <ChatPanel
          messages={messages}
          isGenerating={isGenerating}
          onSend={handleSend}
          apiKeyPresent={hasKey}
          onManageApiKey={() => setApiKeyModalOpen(true)}
          phase={phase}
          serverUrl={serverUrl}
        />
      </aside>

      <main className="hidden min-w-0 flex-1 border-r border-border md:block">
        <EditorPanel
          files={files}
          activePath={activePath}
          onSelectPath={setActivePath}
          onChangeContents={handleChangeContents}
        />
      </main>

      <aside className="hidden w-[460px] shrink-0 md:block">
        <PreviewPanel
          ref={terminalRef}
          phase={phase}
          serverUrl={serverUrl}
          files={files}
          activePath={activePath}
          onSelectPath={setActivePath}
        />
      </aside>
    </div>
  );
}
