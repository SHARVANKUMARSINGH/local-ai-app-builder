import { useState } from "react";
import type { StoredProject } from "../lib/projects";
import { createProject, deleteProject, listProjects } from "../lib/projects";
import ModelPicker from "./ModelPicker";

interface ProjectLandingProps {
  onOpenProject: (project: StoredProject) => void;
}

function formatRelativeTime(ts: number): string {
  const diffMs = Date.now() - ts;
  const mins = Math.round(diffMs / 60000);
  if (mins < 1) return "just now";
  if (mins < 60) return `${mins}m ago`;
  const hours = Math.round(mins / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.round(hours / 24);
  return `${days}d ago`;
}

export default function ProjectLanding({ onOpenProject }: ProjectLandingProps) {
  const [projects, setProjects] = useState<StoredProject[]>(() => listProjects());
  const [name, setName] = useState("");
  const [model, setModel] = useState("openrouter/free");

  const handleCreate = () => {
    const project = createProject(name, model);
    onOpenProject(project);
  };

  const handleDelete = (id: string, e: React.MouseEvent) => {
    e.stopPropagation();
    if (!confirm("Delete this project? This can't be undone.")) return;
    deleteProject(id);
    setProjects(listProjects());
  };

  return (
    <div className="flex h-full w-full items-start justify-center overflow-y-auto bg-base px-4 py-10 md:items-center">
      <div className="w-full max-w-xl">
        <div className="mb-8 text-center">
          <h1 className="glow-text text-lg font-medium tracking-tight text-text">local-ai-app-builder</h1>
          <p className="mt-1 text-xs text-text-dim">Describe an app. Watch it get built, live, in your browser.</p>
        </div>

        <div className="glow-lg rounded-xl border border-border-soft bg-panel p-5">
          <h2 className="text-sm font-medium text-text">Create a project</h2>
          <div className="mt-3 space-y-3">
            <div>
              <label className="mb-1.5 block text-[11px] text-text-dim">Name</label>
              <input
                autoFocus
                value={name}
                onChange={(e) => setName(e.target.value)}
                onKeyDown={(e) => e.key === "Enter" && handleCreate()}
                placeholder="My pomodoro app"
                className="input-glow w-full rounded-md border border-border bg-panel-raised px-3 py-2 text-sm text-text placeholder:text-text-dim"
              />
            </div>

            {/* Per the brief: model choice is a Create Project–only setting —
                it's fixed for the project's lifetime once created. */}
            <ModelPicker value={model} onChange={setModel} />

            <button
              onClick={handleCreate}
              className="btn-glow w-full rounded-md border border-accent-dim bg-accent-soft py-2 text-sm font-medium text-text transition-colors hover:bg-white hover:text-black"
            >
              Create project
            </button>
          </div>
        </div>

        {projects.length > 0 && (
          <div className="mt-8">
            <p className="mb-2 text-[11px] uppercase tracking-wide text-text-dim">Your projects</p>
            <div className="space-y-1.5">
              {projects.map((p) => (
                <button
                  key={p.id}
                  onClick={() => onOpenProject(p)}
                  className="flex w-full items-center gap-3 rounded-lg border border-border-soft bg-panel px-3 py-2.5 text-left hover:border-border"
                >
                  <span className="glow h-1.5 w-1.5 shrink-0 rounded-full bg-white/70" />
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-sm text-text">{p.name}</span>
                    <span className="block truncate text-[11px] text-text-dim">
                      {p.files.length} file{p.files.length === 1 ? "" : "s"} · {p.model} · {formatRelativeTime(p.updatedAt)}
                    </span>
                  </span>
                  <span
                    onClick={(e) => handleDelete(p.id, e)}
                    className="shrink-0 rounded px-2 py-1 text-[11px] text-text-dim hover:text-error"
                  >
                    Delete
                  </span>
                </button>
              ))}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
