import { useCallback, useEffect, useRef, useState } from "react";
import type { WebContainer } from "@webcontainer/api";
import ChatPanel from "./components/ChatPanel";
import EditorPanel from "./components/EditorPanel";
import PreviewPanel from "./components/PreviewPanel";
import ApiKeyModal from "./components/ApiKeyModal";
import type { TerminalHandle } from "./components/Terminal";
import { generateProjectFromPrompt, hasUsableApiKey } from "./lib/openrouter";
import { getStoredApiKey, setStoredApiKey, clearStoredApiKey } from "./lib/apiKeyStore";
import { bootWebContainer, mountAndRun, writeFiles } from "./lib/webcontainerManager";
import type { BootPhase, ChatMessage, ProjectFile } from "./types";

let messageCounter = 0;
const nextId = () => `msg_${++messageCounter}_${Date.now()}`;

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

  // Requirement 3: boot the WebContainer as soon as the page loads, before
  // the user has typed anything, so the first generation can mount instantly.
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

    try {
      const { files: newFiles, summary, usedFallback } = await generateProjectFromPrompt(prompt);
      setFiles(newFiles);
      setActivePath(newFiles.find((f) => f.path === "src/App.tsx")?.path ?? newFiles[0]?.path ?? null);
      appendMessage(
        "assistant",
        usedFallback ? `${summary} (using local fallback — see the OpenRouter setup note.)` : summary
      );

      const container = containerRef.current;
      if (!container) throw new Error("WebContainer is not ready yet");

      if (!hasRunInstallRef.current) {
        hasRunInstallRef.current = true;
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
        // Subsequent prompts: hot-write files instead of a full reinstall —
        // Vite's dev server + HMR picks up the change on its own.
        terminalRef.current?.write("\r\n$ (updating files)\r\n");
        await writeFiles(container, newFiles);
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

      <aside className="w-[340px] shrink-0 border-r border-border">
        <ChatPanel
          messages={messages}
          isGenerating={isGenerating}
          onSend={handleSend}
          apiKeyPresent={hasKey}
          onManageApiKey={() => setApiKeyModalOpen(true)}
        />
      </aside>

      <main className="min-w-0 flex-1 border-r border-border">
        <EditorPanel
          files={files}
          activePath={activePath}
          onSelectPath={setActivePath}
          onChangeContents={handleChangeContents}
        />
      </main>

      <aside className="w-[460px] shrink-0">
        <PreviewPanel ref={terminalRef} phase={phase} serverUrl={serverUrl} />
      </aside>
    </div>
  );
}
