import { useState } from "react";
import ProjectLanding from "./components/ProjectLanding";
import Builder from "./components/Builder";
import type { StoredProject } from "./lib/projects";

export default function App() {
  const [activeProject, setActiveProject] = useState<StoredProject | null>(null);

  if (!activeProject) {
    return <ProjectLanding onOpenProject={setActiveProject} />;
  }

  // key={activeProject.id} forces a full remount of Builder on project
  // switch — a new WebContainer boot, fresh refs, fresh effects — rather
  // than trying to reuse one instance across projects.
  return (
    <Builder
      key={activeProject.id}
      project={activeProject}
      onBackToProjects={() => setActiveProject(null)}
    />
  );
}
