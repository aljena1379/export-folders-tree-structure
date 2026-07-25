import * as vscode from "vscode";
import * as path from "path";
import * as fs from "fs";
import { generateTree, getConfigOptions, TreeResult } from "./treeGenerator";
import { FolderTreePanel } from "./webviewPanel";

let activeRootPath: string | null = null;
let extensionContext: vscode.ExtensionContext | null = null;

function resolveTargetUri(uri?: vscode.Uri): vscode.Uri | undefined {
  if (uri) return uri;
  const active = vscode.window.activeTextEditor;
  if (active) {
    const folder = vscode.workspace.getWorkspaceFolder(active.document.uri);
    if (folder) return folder.uri;
    return vscode.Uri.file(path.dirname(active.document.uri.fsPath));
  }
  const folders = vscode.workspace.workspaceFolders;
  if (folders && folders.length > 0) return folders[0].uri;
  return undefined;
}

async function buildTree(target: vscode.Uri): Promise<TreeResult> {
  const outcome = await generateTree(target.fsPath, getConfigOptions());
  if (!outcome.result) {
    throw new Error("Tree generation returned no result");
  }
  return outcome.result;
}

async function commandShow(uri?: vscode.Uri) {
  const target = resolveTargetUri(uri);
  if (!target) {
    vscode.window.showErrorMessage(
      "Export Folders Tree: no folder selected or workspace open.",
    );
    return;
  }
  activeRootPath = target.fsPath;

  if (extensionContext) {
    FolderTreePanel.register(extensionContext.extensionUri);
    FolderTreePanel.reveal();
    await FolderTreePanel.current?.refresh(target.fsPath);
  } else {
    vscode.window.showErrorMessage(
      "Export Folders Tree: extension not properly initialized.",
    );
  }
}

async function commandCopy(uri?: vscode.Uri) {
  const target = resolveTargetUri(uri);
  if (!target) {
    vscode.window.showErrorMessage(
      "Export Folders Tree: no folder selected or workspace open.",
    );
    return;
  }
  try {
    const result = await buildTree(target);
    await vscode.env.clipboard.writeText(result.text);
    vscode.window.showInformationMessage(
      `Folder tree copied (${result.stats.totalFolders} folders, ${result.stats.totalFiles} files).`,
    );
  } catch (err) {
    vscode.window.showErrorMessage(
      `Failed to build tree: ${(err as Error).message}`,
    );
  }
}

async function commandExport(uri?: vscode.Uri) {
  const target = resolveTargetUri(uri);
  if (!target) {
    vscode.window.showErrorMessage(
      "Export Folders Tree: no folder selected or workspace open.",
    );
    return;
  }
  try {
    const result = await buildTree(target);
    const defaultName = (path.basename(target.fsPath) || "tree") + "-tree.txt";
    const saveUri = await vscode.window.showSaveDialog({
      defaultUri: vscode.Uri.file(
        path.join(path.dirname(target.fsPath), defaultName),
      ),
      filters: { Text: ["txt"], Markdown: ["md"] },
      title: "Export folder tree structure",
    });
    if (!saveUri) return;

    let content = result.text;
    if (saveUri.fsPath.toLowerCase().endsWith(".md")) {
      content =
        `# ${result.stats.rootPath}\n\n` +
        `Generated: ${result.stats.generatedAt}\n` +
        `Folders: ${result.stats.totalFolders} | Files: ${result.stats.totalFiles}\n\n` +
        "```\n" +
        result.text +
        "\n```\n";
    }
    fs.writeFileSync(saveUri.fsPath, content, "utf8");
    const open = "Open file";
    const choice = await vscode.window.showInformationMessage(
      `Folder tree saved to ${path.basename(saveUri.fsPath)}`,
      open,
    );
    if (choice === open) vscode.window.showTextDocument(saveUri);
  } catch (err) {
    vscode.window.showErrorMessage(
      `Failed to export tree: ${(err as Error).message}`,
    );
  }
}

export function activate(context: vscode.ExtensionContext) {
  extensionContext = context;
  context.subscriptions.push(
    vscode.commands.registerCommand(
      "exportFoldersTreeStructure.show",
      commandShow,
    ),
  );
  context.subscriptions.push(
    vscode.commands.registerCommand(
      "exportFoldersTreeStructure.copy",
      commandCopy,
    ),
  );
  context.subscriptions.push(
    vscode.commands.registerCommand(
      "exportFoldersTreeStructure.export",
      commandExport,
    ),
  );

  context.subscriptions.push(
    vscode.workspace.onDidChangeConfiguration(async (e) => {
      if (
        e.affectsConfiguration(
          "exportFoldersTreeStructure.defaultIgnorePatterns",
        ) ||
        e.affectsConfiguration(
          "exportFoldersTreeStructure.customIgnorePatterns",
        ) ||
        e.affectsConfiguration("exportFoldersTreeStructure.includeHidden") ||
        e.affectsConfiguration("exportFoldersTreeStructure.maxDepth") ||
        e.affectsConfiguration("exportFoldersTreeStructure.showFileSize")
      ) {
        if (FolderTreePanel.current && activeRootPath) {
          await FolderTreePanel.current.refresh(activeRootPath);
        }
      }
    }),
  );
}

export function deactivate() {
  FolderTreePanel.current?.dispose();
}
