import { forwardRef, useState } from "react";
import type { BootPhase, ProjectFile } from "../types";
import Terminal, { type TerminalHandle } from "./Terminal";
import FileTree from "./FileTree";

type Tab = "preview" | "files";

interface PreviewPanelProps {
  phase: BootPhase;
  serverUrl: string | null;
  files: ProjectFile[];
  activePath: string | null;
  onSelectPath: (path: string) => void;
}

const PHASE_LABEL: Record<BootPhase, string> = {
  idle: "Idle",
  booting: "Booting WebContainer…",
  mounting: "Mounting files…",
  installing: "Installing dependencies…",
  starting: "Starting dev server…",
  ready: "Live",
  error: "Error",
};

function PhaseDot({ phase }: { phase: BootPhase }) {
  if (phase === "error") return <span className="h-2 w-2 rounded-full bg-error" />;
  if (phase === "idle") return <span className="h-2 w-2 rounded-full bg-text-dim" />;
  if (phase === "ready") return <span className="glow h-2 w-2 rounded-full bg-white" />;
  return <span className="glow status-dot-pulse h-2 w-2 rounded-full bg-white" />;
}

const PreviewPanel = forwardRef<TerminalHandle, PreviewPanelProps>(function PreviewPanel(
  { phase, serverUrl, files, activePath, onSelectPath },
  terminalRef
) {
  const [tab, setTab] = useState<Tab>("preview");

  return (
    <div className="flex h-full flex-col bg-panel">
      <div className="flex items-center border-b border-border">
        <button
          onClick={() => setTab("preview")}
          className={
            tab === "preview"
              ? "border-b-2 border-white px-4 py-2.5 text-xs text-text"
              : "border-b-2 border-transparent px-4 py-2.5 text-xs text-text-muted hover:text-text"
          }
        >
          Preview
        </button>
        <button
          onClick={() => setTab("files")}
          className={
            tab === "files"
              ? "border-b-2 border-white px-4 py-2.5 text-xs text-text"
              : "border-b-2 border-transparent px-4 py-2.5 text-xs text-text-muted hover:text-text"
          }
        >
          Files
          {files.length > 0 && <span className="ml-1.5 text-text-dim">{files.length}</span>}
        </button>
        <div className="ml-auto flex items-center gap-2 px-4">
          <PhaseDot phase={phase} />
          <span className="text-xs text-text-muted">{PHASE_LABEL[phase]}</span>
        </div>
      </div>

      <div className="min-h-0 flex-[3]">
        {tab === "preview" ? (
          serverUrl ? (
            <iframe
              title="preview"
              src={serverUrl}
              className="h-full w-full border-0 bg-white"
              // Sandbox stays permissive enough for a full dev-server app (scripts,
              // same-origin fetches to the WebContainer's virtual server, forms).
              sandbox="allow-scripts allow-same-origin allow-forms allow-popups allow-modals"
            />
          ) : (
            <div className="flex h-full items-center justify-center bg-base p-8">
              <div className="glow-lg glow-breathe rounded-xl border border-border-soft px-8 py-6 text-center">
                <p className="text-sm text-text">Nothing running yet</p>
                <p className="mt-1.5 text-xs text-text-dim">
                  Describe an app in the chat to boot a live preview here.
                </p>
              </div>
            </div>
          )
        ) : (
          <FileTree files={files} activePath={activePath} onSelectFile={onSelectPath} />
        )}
      </div>

      <div className="min-h-0 flex-[2] border-t border-border">
        <Terminal ref={terminalRef} />
      </div>
    </div>
  );
});

export default PreviewPanel;
