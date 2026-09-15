export interface ChatMessage {
  id: string;
  role: "user" | "assistant" | "system";
  content: string;
  createdAt: number;
}

/** A single file in the virtual project, keyed by its path relative to the project root. */
export interface ProjectFile {
  path: string;
  contents: string;
}

export type BootPhase =
  | "idle"
  | "booting"
  | "mounting"
  | "installing"
  | "starting"
  | "ready"
  | "error";

export interface TerminalLine {
  id: string;
  text: string;
}
