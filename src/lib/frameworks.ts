export type Platform = "web" | "native";

export interface FrameworkOption {
  id: string;
  label: string;
  blurb: string;
}

/** Shown as a grid on the Create Project screen when platform === "web". */
export const WEB_FRAMEWORKS: FrameworkOption[] = [
  { id: "react", label: "React", blurb: "React + Vite" },
  { id: "vue", label: "Vue", blurb: "Vue 3 + Vite" },
  { id: "svelte", label: "Svelte", blurb: "Svelte + Vite" },
  { id: "vanilla", label: "Vanilla JS", blurb: "Plain JS + Vite, no framework" },
  { id: "static", label: "Static", blurb: "Plain HTML/CSS/JS — for normal pages" },
  { id: "custom", label: "Custom", blurb: "No framework constraint — AI picks the stack" },
];

/** The only option when platform === "native" — fixed, not a further choice,
 *  since Expo is the one stack that can realistically produce a live preview
 *  inside a browser-based WebContainer (via its web target). */
export const NATIVE_FRAMEWORK: FrameworkOption = {
  id: "expo",
  label: "Expo",
  blurb: "React Native + Expo — previewed via Expo's web target",
};

export function frameworkById(id: string): FrameworkOption {
  return WEB_FRAMEWORKS.find((f) => f.id === id) ?? NATIVE_FRAMEWORK;
}

/** Same monogram approach as the model picker's vendor icons — deliberately
 *  plain initials rather than each framework's actual (trademarked) logo. */
export function frameworkInitials(label: string): string {
  const words = label.split(/\s+/).filter(Boolean);
  if (words.length >= 2) return (words[0][0] + words[1][0]).toUpperCase();
  return label.slice(0, 2).toUpperCase();
}
