export interface ChatMessage {
  id: string;
  role: "user" | "assistant" | "system";
  content: string;
  createdAt: number;
  /** Discrete actions the AI took to produce this message, if any — rendered
   *  as small icon chips under the message (e.g. "+2 Files added",
   *  "$ npm install axios"). */
  actions?: ActionLogEntry[];
}

/** The strict, machine-checked action types the AI's JSON response may
 *  contain. Every AI response is validated against this shape before
 *  anything is applied to the virtual filesystem — see
 *  src/lib/openrouter.ts's `normalizeResult`. */
export type AiActionType = "write_file" | "delete_file" | "run_command";

export interface AiAction {
  type: AiActionType;
  /** Required for write_file / delete_file. */
  path?: string;
  /** Required for write_file — the file's complete new contents. */
  contents?: string;
  /** Required for run_command. */
  command?: string;
}

/** Post-processed, UI-ready summary of one applied AiAction, with the
 *  file-added-vs-edited distinction resolved against the project's prior
 *  state (the raw AiAction doesn't know that on its own). */
export interface ActionLogEntry {
  type: "file_added" | "file_edited" | "file_removed" | "command";
  path?: string;
  command?: string;
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
