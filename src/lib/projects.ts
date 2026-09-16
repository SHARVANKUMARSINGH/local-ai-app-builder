import type { ChatMessage, ProjectFile } from "../types";

export interface StoredProject {
  id: string;
  name: string;
  createdAt: number;
  updatedAt: number;
  /** OpenRouter model id chosen when the project was created — fixed for
   *  the life of the project, per the "only in Create Project" setting. */
  model: string;
  files: ProjectFile[];
  messages: ChatMessage[];
}

const INDEX_KEY = "local-ai-app-builder:projects";

function readIndex(): StoredProject[] {
  try {
    const raw = localStorage.getItem(INDEX_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

function writeIndex(projects: StoredProject[]): boolean {
  try {
    localStorage.setItem(INDEX_KEY, JSON.stringify(projects));
    return true;
  } catch {
    // Most likely localStorage quota exceeded (generated projects can get
    // sizeable) — the caller decides how to surface this.
    return false;
  }
}

export function listProjects(): StoredProject[] {
  return readIndex().sort((a, b) => b.updatedAt - a.updatedAt);
}

export function getProject(id: string): StoredProject | null {
  return readIndex().find((p) => p.id === id) ?? null;
}

export function createProject(name: string, model: string): StoredProject {
  const now = Date.now();
  const project: StoredProject = {
    id: crypto.randomUUID(),
    name: name.trim() || "Untitled project",
    createdAt: now,
    updatedAt: now,
    model,
    files: [],
    messages: [],
  };
  const projects = readIndex();
  projects.push(project);
  writeIndex(projects);
  return project;
}

/** Upserts a project's mutable fields (files/messages/updatedAt). Returns
 *  false if the save didn't fit in localStorage's quota — the caller can
 *  still keep working in-memory, it just won't survive a refresh. */
export function saveProject(project: StoredProject): boolean {
  const projects = readIndex();
  const idx = projects.findIndex((p) => p.id === project.id);
  const updated = { ...project, updatedAt: Date.now() };
  if (idx === -1) projects.push(updated);
  else projects[idx] = updated;
  return writeIndex(projects);
}

export function deleteProject(id: string): void {
  writeIndex(readIndex().filter((p) => p.id !== id));
}
