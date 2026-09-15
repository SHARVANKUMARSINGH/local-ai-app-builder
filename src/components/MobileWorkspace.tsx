import { useState, type RefObject } from "react";
import type { BootPhase } from "../types";
import FileTree from "./FileTree";
import Terminal, { type TerminalHandle } from "./Terminal";

type Tab = "files" | "preview" | "terminal";

interface MobileWorkspaceProps {
  initialTab: Tab;
  onClose: () => void;
  phase: BootPhase;
  serverUrl: string | null;
  vfsPaths: string[];
  activePath: string | null;
  onSelectPath: (path: string) => void;
  onRefreshVfs: () => void;
  terminalRef: RefObject<TerminalHandle | null>;
}

const TABS: { id: Tab; label: string }[] = [
  { id: "files", label: "Files" },
  { id: "preview", label: "Preview" },
  { id: "terminal", label: "Terminal" },
];

/**
 * On mobile there's no room for the editor/preview/terminal panels alongside
 * chat, so instead they live behind a long-press gesture (see ChatPanel's
 * useLongPress) that opens this as a full-screen overlay — the same three
 * things a desktop user sees in side panels, just one at a time here.
 */
export default function MobileWorkspace({
  initialTab,
  onClose,
  phase,
  serverUrl,
  vfsPaths,
  activePath,
  onSelectPath,
  onRefreshVfs,
  terminalRef,
}: MobileWorkspaceProps) {
  const [tab, setTab] = useState<Tab>(initialTab);

  return (
    <div className="fixed inset-0 z-50 flex flex-col bg-base md:hidden">
      <div className="flex items-center border-b border-border">
        {TABS.map((t) => (
          <button
            key={t.id}
            onClick={() => setTab(t.id)}
            className={
              tab === t.id
                ? "border-b-2 border-white px-4 py-3 text-xs text-text"
                : "border-b-2 border-transparent px-4 py-3 text-xs text-text-muted"
            }
          >
            {t.label}
          </button>
        ))}
        <button onClick={onClose} className="ml-auto px-4 py-3 text-xs text-text-dim">
          Close ✕
        </button>
      </div>

      <div className="min-h-0 flex-1">
        {tab === "files" && (
          <FileTree paths={vfsPaths} activePath={activePath} onSelectFile={onSelectPath} onRefresh={onRefreshVfs} />
        )}

        {tab === "preview" &&
          (serverUrl ? (
            <iframe
              title="mobile-preview"
              src={serverUrl}
              className="h-full w-full border-0 bg-white"
              sandbox="allow-scripts allow-same-origin allow-forms allow-popups allow-modals"
            />
          ) : (
            <div className="flex h-full items-center justify-center p-8 text-center text-sm text-text-dim">
              {phase === "error" ? "Something went wrong — check the Terminal tab." : "Not live yet — still working."}
            </div>
          ))}

        {tab === "terminal" && <Terminal ref={terminalRef} />}
      </div>
    </div>
  );
}
