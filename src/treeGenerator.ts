import * as fs from "fs";
import * as path from "path";
import * as vscode from "vscode";

export interface TreeOptions {
  ignorePatterns: string[];
  includeHidden: boolean;
  maxDepth: number;
  showFileSize: boolean;
  humanReadable: boolean;
}

export interface TreeNode {
  name: string;
  path: string;
  isDirectory: boolean;
  size?: number;
  truncated?: boolean;
  children: TreeNode[];
}

export interface RenderedLine {
  text: string;
  isDir: boolean;
  size?: number;
  truncated?: boolean;
}

export interface TreeStats {
  totalFolders: number;
  totalFiles: number;
  totalSize: number;
  rootPath: string;
  generatedAt: string;
}

export interface TreeResult {
  text: string;
  lines: RenderedLine[];
  stats: TreeStats;
  rootNode: TreeNode;
}

const TRUNCATION_MARK = "… (truncated)";
const REGEX_ESCAPE = ".+^$|(){}[]\\";

/**
 * Convert a minimatch-style glob to a RegExp. Supports single-star,
 * double-star, single-char `?`, character classes and plain literals.
 * Double-star matches any characters including slash; double-star
 * followed by slash matches zero or more directory segments.
 */
export function globToRegex(pattern: string): RegExp {
  let regex = "";
  let i = 0;
  while (i < pattern.length) {
    const ch = pattern[i];
    if (ch === "*") {
      if (pattern[i + 1] === "*") {
        i += 2;
        if (pattern[i] === "/") {
          regex += "(?:[^/]+/)*";
          i++;
        } else {
          regex += ".*";
        }
      } else {
        regex += "[^/]*";
        i++;
      }
    } else if (ch === "?") {
      regex += "[^/]";
      i++;
    } else if (REGEX_ESCAPE.indexOf(ch) >= 0) {
      regex += "\\" + ch;
      i++;
    } else {
      regex += ch;
      i++;
    }
  }
  return new RegExp("^" + regex + "$");
}

/**
 * Build regexes from raw glob strings, dropping anything that fails to
 * compile. Returns the surviving regexes plus a list of the dropped
 * patterns so callers can warn the user.
 */
export function compilePatterns(patterns: string[]): {
  regexes: RegExp[];
  invalid: string[];
} {
  const regexes: RegExp[] = [];
  const invalid: string[] = [];
  for (const raw of patterns) {
    const p = raw.trim();
    if (!p) continue;
    try {
      regexes.push(globToRegex(p));
    } catch {
      invalid.push(p);
    }
  }
  return { regexes, invalid };
}

/**
 * Ignore match supporting both full-path and basename semantics.
 * Patterns ending in `node_modules` match any ancestor of the path,
 * and patterns with a directory prefix also match the bare basename.
 */
function shouldIgnore(
  relPath: string,
  base: string,
  patterns: RegExp[],
): boolean {
  if (patterns.length === 0) {
    return false;
  }
  const normalized = relPath.replace(/\\/g, "/");
  for (const p of patterns) {
    if (p.test(normalized) || p.test(base)) {
      return true;
    }
    const src = p.source.startsWith("^") ? p.source.slice(1) : p.source;
    const loose = new RegExp("^(?:.*/)?" + src);
    if (loose.test(base)) {
      return true;
    }
  }
  return false;
}

function formatSize(bytes: number): string {
  if (bytes === 0) return "0 B";
  const units = ["B", "KB", "MB", "GB", "TB"];
  const exp = Math.min(
    Math.floor(Math.log(bytes) / Math.log(1024)),
    units.length - 1,
  );
  const value = bytes / Math.pow(1024, exp);
  const display =
    exp === 0 ?
      value.toString()
    : value.toFixed(
        value < 10 ? 2
        : value < 100 ? 1
        : 0,
      );
  return `${display} ${units[exp]}`;
}

function buildNode(
  absPath: string,
  relPath: string,
  options: TreeOptions,
  patterns: RegExp[],
  depth: number,
): TreeNode | null {
  const base = path.basename(absPath);
  let stat: fs.Stats;
  try {
    stat = fs.statSync(absPath);
  } catch {
    return null;
  }
  const isDir = stat.isDirectory();
  const node: TreeNode = {
    name: base,
    path: relPath || base,
    isDirectory: isDir,
    size: isDir ? undefined : stat.size,
    children: [],
  };
  if (!isDir) {
    return node;
  }
  if (depth >= options.maxDepth) {
    node.truncated = true;
    return node;
  }
  let entries: fs.Dirent[];
  try {
    entries = fs.readdirSync(absPath, { withFileTypes: true });
  } catch {
    return node;
  }
  entries = entries.filter((e) => {
    if (!options.includeHidden && e.name.startsWith(".")) {
      return false;
    }
    const childRel = relPath ? `${relPath}/${e.name}` : e.name;
    return !shouldIgnore(childRel, e.name, patterns);
  });

  for (const entry of entries) {
    const childAbs = path.join(absPath, entry.name);
    const childRel = relPath ? `${relPath}/${entry.name}` : entry.name;
    const child = buildNode(childAbs, childRel, options, patterns, depth + 1);
    if (child) {
      node.children.push(child);
    }
  }
  return node;
}

function getIndent(depth: number, isRoot: boolean, humanReadable: boolean): string {
  if (isRoot) return "";
  if (humanReadable) {
    return "-".repeat(depth * 4);
  }
  return "-".repeat(depth);
}

function renderNode(
  node: TreeNode,
  depth: number,
  isRoot: boolean,
  options: TreeOptions,
): RenderedLine[] {
  const lines: RenderedLine[] = [];
  const sizeLabel =
    !node.isDirectory && options.showFileSize && node.size !== undefined ?
      `  (${formatSize(node.size)})`
    : "";
  const prefix = getIndent(depth, isRoot, options.humanReadable);
  const displayName = isRoot ? node.path : node.name + sizeLabel;
  const headerText = prefix + displayName;
  lines.push({
    text: headerText,
    isDir: node.isDirectory,
    size: isRoot ? undefined : node.size,
    truncated: !!node.truncated,
  });

  if (!node.isDirectory) {
    return lines;
  }

  if (node.truncated && !isRoot) {
    const truncatedPrefix = options.humanReadable
      ? "-".repeat((depth + 1) * 4)
      : "-".repeat(depth + 1);
    lines.push({
      text: truncatedPrefix + TRUNCATION_MARK,
      isDir: false,
      truncated: true,
    });
    return lines;
  }

  const children = node.children;
  children.forEach((child) => {
    const childLines = renderNode(child, depth + 1, false, options);
    for (const ln of childLines) {
      lines.push(ln);
    }
  });

  return lines;
}

function countStats(
  node: TreeNode,
  folders: { count: number },
  files: { count: number; size: number },
): void {
  if (node.isDirectory) {
    folders.count++;
    for (const c of node.children) {
      countStats(c, folders, files);
    }
  } else {
    files.count++;
    files.size += node.size ?? 0;
  }
}

export interface GenerateOutcome {
  result?: TreeResult;
  invalidPatterns: string[];
}

export async function generateTree(
  rootPath: string,
  options: TreeOptions,
): Promise<GenerateOutcome> {
  const { regexes, invalid } = compilePatterns(options.ignorePatterns);
  const rootNode = buildNode(rootPath, "", options, regexes, 0);
  if (!rootNode) {
    throw new Error(`Cannot read path: ${rootPath}`);
  }
  const lines = renderNode(rootNode, 0, true, options);
  const folders = { count: 0 };
  const files = { count: 0, size: 0 };
  countStats(rootNode, folders, files);
  return {
    invalidPatterns: invalid,
    result: {
      text: lines.map((l) => l.text).join("\n"),
      lines,
      rootNode,
      stats: {
        totalFolders: folders.count,
        totalFiles: files.count,
        totalSize: files.size,
        rootPath,
        generatedAt: new Date().toISOString(),
      },
    },
  };
}

export function getConfigOptions(): TreeOptions {
  const config = vscode.workspace.getConfiguration(
    "exportFoldersTreeStructure",
  );
  return {
    ignorePatterns: collectIgnorePatterns(config),
    includeHidden: config.get<boolean>("includeHidden", false),
    maxDepth: config.get<number>("maxDepth", 20),
    showFileSize: config.get<boolean>("showFileSize", false),
    humanReadable: config.get<boolean>("humanReadable", false),
  };
}

export function collectIgnorePatterns(
  config: vscode.WorkspaceConfiguration,
): string[] {
  const defaults = config.get<string[]>("defaultIgnorePatterns", []);
  const custom = config.get<string[]>("customIgnorePatterns", []);
  return dedupe([...defaults, ...custom]);
}

function dedupe(arr: string[]): string[] {
  return Array.from(new Set(arr.map((s) => s.trim()).filter(Boolean)));
}
