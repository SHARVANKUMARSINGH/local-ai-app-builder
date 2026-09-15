import { useMemo, useState } from "react";
import type { ProjectFile } from "../types";

interface TreeNode {
  name: string;
  path: string;
  isDir: boolean;
  children: TreeNode[];
}

function buildTree(files: ProjectFile[]): TreeNode[] {
  const root: TreeNode = { name: "", path: "", isDir: true, children: [] };

  for (const file of files) {
    const parts = file.path.split("/").filter(Boolean);
    let cursor = root;
    parts.forEach((part, i) => {
      const isLast = i === parts.length - 1;
      const path = parts.slice(0, i + 1).join("/");
      let child = cursor.children.find((c) => c.name === part);
      if (!child) {
        child = { name: part, path, isDir: !isLast, children: [] };
        cursor.children.push(child);
      }
      cursor = child;
    });
  }

  const sortTree = (node: TreeNode) => {
    node.children.sort((a, b) => {
      if (a.isDir !== b.isDir) return a.isDir ? -1 : 1;
      return a.name.localeCompare(b.name);
    });
    node.children.forEach(sortTree);
  };
  sortTree(root);

  return root.children;
}

function DirIcon() {
  return (
    <svg width="13" height="13" viewBox="0 0 16 16" fill="none" className="shrink-0 text-text-dim">
      <path
        d="M1.5 3.5A1.5 1.5 0 0 1 3 2h3.379a1.5 1.5 0 0 1 1.06.44l.622.62A1.5 1.5 0 0 0 9.12 3.5H13a1.5 1.5 0 0 1 1.5 1.5v7A1.5 1.5 0 0 1 13 13.5H3A1.5 1.5 0 0 1 1.5 12v-8.5Z"
        stroke="currentColor"
      />
    </svg>
  );
}

function FileIcon() {
  return (
    <svg width="13" height="13" viewBox="0 0 16 16" fill="none" className="shrink-0 text-text-dim">
      <path
        d="M4 1.5h5l3 3v10a1 1 0 0 1-1 1H4a1 1 0 0 1-1-1v-12a1 1 0 0 1 1-1Z"
        stroke="currentColor"
      />
      <path d="M9 1.5v3h3" stroke="currentColor" />
    </svg>
  );
}

function TreeRow({
  node,
  depth,
  activePath,
  expanded,
  onToggle,
  onSelectFile,
}: {
  node: TreeNode;
  depth: number;
  activePath: string | null;
  expanded: Set<string>;
  onToggle: (path: string) => void;
  onSelectFile: (path: string) => void;
}) {
  const isOpen = expanded.has(node.path);

  return (
    <div>
      <button
        onClick={() => (node.isDir ? onToggle(node.path) : onSelectFile(node.path))}
        style={{ paddingLeft: `${8 + depth * 14}px` }}
        className={
          !node.isDir && node.path === activePath
            ? "flex w-full items-center gap-1.5 py-1 pr-2 text-left text-xs text-text glow-text"
            : "flex w-full items-center gap-1.5 py-1 pr-2 text-left text-xs text-text-muted hover:text-text"
        }
      >
        {node.isDir ? <DirIcon /> : <FileIcon />}
        <span className="truncate">{node.name}</span>
      </button>
      {node.isDir && isOpen && (
        <div>
          {node.children.map((child) => (
            <TreeRow
              key={child.path}
              node={child}
              depth={depth + 1}
              activePath={activePath}
              expanded={expanded}
              onToggle={onToggle}
              onSelectFile={onSelectFile}
            />
          ))}
        </div>
      )}
    </div>
  );
}

interface FileTreeProps {
  files: ProjectFile[];
  activePath: string | null;
  onSelectFile: (path: string) => void;
}

export default function FileTree({ files, activePath, onSelectFile }: FileTreeProps) {
  const tree = useMemo(() => buildTree(files), [files]);
  // All top-level directories start expanded so the tree isn't a wall of
  // collapsed folders on first open.
  const [expanded, setExpanded] = useState<Set<string>>(
    () => new Set(tree.filter((n) => n.isDir).map((n) => n.path))
  );

  const toggle = (path: string) => {
    setExpanded((prev) => {
      const next = new Set(prev);
      if (next.has(path)) next.delete(path);
      else next.add(path);
      return next;
    });
  };

  if (files.length === 0) {
    return (
      <div className="flex h-full items-center justify-center text-xs text-text-dim">
        No files mounted yet
      </div>
    );
  }

  return (
    <div className="h-full overflow-y-auto py-2">
      {tree.map((node) => (
        <TreeRow
          key={node.path}
          node={node}
          depth={0}
          activePath={activePath}
          expanded={expanded}
          onToggle={toggle}
          onSelectFile={onSelectFile}
        />
      ))}
    </div>
  );
}
