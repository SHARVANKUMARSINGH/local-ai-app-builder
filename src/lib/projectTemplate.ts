import type { ProjectFile } from "../types";

/**
 * A minimal, dependency-light React + Vite project used as a fallback when
 * no OpenRouter API key is configured. Real generations from the model
 * follow the same shape (see the SYSTEM_PROMPT in ./openrouter.ts) so the
 * WebContainer mount/install/run pipeline behaves identically either way.
 */
export function getBaseTemplateFiles(prompt: string): { files: ProjectFile[]; summary: string } {
  const safePrompt = prompt.trim() || "a starter app";

  const packageJson = {
    name: "generated-app",
    private: true,
    version: "0.0.0",
    type: "module",
    scripts: {
      dev: "vite --host",
      build: "vite build",
      preview: "vite preview",
    },
    dependencies: {
      react: "^18.3.1",
      "react-dom": "^18.3.1",
    },
    devDependencies: {
      "@vitejs/plugin-react": "^4.3.1",
      typescript: "^5.5.4",
      vite: "^5.4.0",
    },
  };

  const files: ProjectFile[] = [
    { path: "package.json", contents: JSON.stringify(packageJson, null, 2) + "\n" },
    {
      path: "vite.config.ts",
      contents: `import { defineConfig } from "vite";\nimport react from "@vitejs/plugin-react";\n\nexport default defineConfig({\n  plugins: [react()],\n});\n`,
    },
    {
      path: "index.html",
      contents: `<!doctype html>\n<html lang="en">\n  <head>\n    <meta charset="UTF-8" />\n    <meta name="viewport" content="width=device-width, initial-scale=1.0" />\n    <title>Generated App</title>\n  </head>\n  <body>\n    <div id="root"></div>\n    <script type="module" src="/src/main.tsx"></script>\n  </body>\n</html>\n`,
    },
    {
      path: "src/main.tsx",
      contents: `import { StrictMode } from "react";\nimport { createRoot } from "react-dom/client";\nimport App from "./App";\nimport "./index.css";\n\ncreateRoot(document.getElementById("root")!).render(\n  <StrictMode>\n    <App />\n  </StrictMode>\n);\n`,
    },
    {
      path: "src/index.css",
      contents: `body {\n  margin: 0;\n  font-family: ui-sans-serif, system-ui, sans-serif;\n  background: #0b0d10;\n  color: #e6e8eb;\n}\n.card {\n  max-width: 560px;\n  margin: 10vh auto;\n  padding: 32px;\n  border: 1px solid #23272f;\n  border-radius: 12px;\n  background: #12151a;\n}\nh1 {\n  font-size: 1.4rem;\n  margin: 0 0 8px;\n}\np {\n  color: #8891a0;\n  line-height: 1.5;\n}\nbutton {\n  margin-top: 16px;\n  padding: 8px 16px;\n  border-radius: 8px;\n  border: 1px solid #f2a93b;\n  background: transparent;\n  color: #f2a93b;\n  cursor: pointer;\n  font-size: 0.9rem;\n}\nbutton:hover {\n  background: #3a2c14;\n}\n`,
    },
    {
      path: "src/App.tsx",
      contents: `import { useState } from "react";\n\nexport default function App() {\n  const [count, setCount] = useState(0);\n\n  return (\n    <div className="card">\n      <h1>Starter app</h1>\n      <p>\n        You asked for: "${safePrompt.replace(/"/g, '\\"')}". This is a local\n        fallback template — connect an OpenRouter API key in\n        <code> src/lib/openrouter.ts</code> to have the AI generate this for real.\n      </p>\n      <button onClick={() => setCount((c) => c + 1)}>Clicked {count} times</button>\n    </div>\n  );\n}\n`,
    },
  ];

  return {
    files,
    summary: `Scaffolded a starter React app for: "${safePrompt}".`,
  };
}
