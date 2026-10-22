import type { DiffFile } from '../../components/diff';

/**
 * The file tree beside the diff (v0.3.0 D-A), like GitHub's: folders first, then files, each by
 * name; a folder holding only one folder is shown as one ("src/search"). The files on the right
 * follow the tree's order, so the tree, `j`/`k` and the page read the same way. Pure.
 */

export interface TreeFolder {
  kind: 'folder';
  /** The shown name: one folder, or a chain of single folders ("src/search"). */
  name: string;
  /** The folder's full path, its id. */
  path: string;
  children: TreeNode[];
}

export interface TreeFile {
  kind: 'file';
  name: string;
  file: DiffFile;
}

export type TreeNode = TreeFolder | TreeFile;

interface Draft {
  folders: Map<string, Draft>;
  files: DiffFile[];
}

const byName = (a: string, b: string) => a.localeCompare(b, undefined, { sensitivity: 'base' });

function baseName(path: string): string {
  return path.slice(path.lastIndexOf('/') + 1);
}

function toNodes(draft: Draft, prefix: string): TreeNode[] {
  const folders = [...draft.folders.entries()]
    .sort(([a], [b]) => byName(a, b))
    .map(([name, sub]): TreeFolder => {
      let shown = name;
      let path = prefix === '' ? name : `${prefix}/${name}`;
      let inner = sub;
      // Fold a chain of folders that each hold only one folder.
      while (inner.files.length === 0 && inner.folders.size === 1) {
        const [[next, deeper]] = [...inner.folders.entries()] as [[string, Draft]];
        shown = `${shown}/${next}`;
        path = `${path}/${next}`;
        inner = deeper;
      }
      return { kind: 'folder', name: shown, path, children: toNodes(inner, path) };
    });
  const files = [...draft.files]
    .sort((a, b) => byName(baseName(a.path), baseName(b.path)))
    .map((file): TreeFile => ({ kind: 'file', name: baseName(file.path), file }));
  return [...folders, ...files];
}

export function buildFileTree(files: readonly DiffFile[]): TreeNode[] {
  const root: Draft = { folders: new Map(), files: [] };
  for (const file of files) {
    const parts = file.path.split('/');
    parts.pop();
    let at = root;
    for (const part of parts) {
      let next = at.folders.get(part);
      if (next === undefined) {
        next = { folders: new Map(), files: [] };
        at.folders.set(part, next);
      }
      at = next;
    }
    at.files.push(file);
  }
  return toNodes(root, '');
}

/** The files in the tree's order (depth first). */
export function treeOrder(nodes: readonly TreeNode[]): DiffFile[] {
  return nodes.flatMap((n) => (n.kind === 'file' ? [n.file] : treeOrder(n.children)));
}

/**
 * The files whose path (or old path, for a rename) holds every word of `query`, ignoring case. An
 * empty query keeps every file.
 */
export function filterFiles(files: readonly DiffFile[], query: string): DiffFile[] {
  const words = query
    .trim()
    .toLowerCase()
    .split(/\s+/)
    .filter((w) => w.length > 0);
  if (words.length === 0) return [...files];
  return files.filter((f) => {
    const hay = `${f.path}\n${f.oldPath ?? ''}`.toLowerCase();
    return words.every((w) => hay.includes(w));
  });
}
