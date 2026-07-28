import * as vscode from "vscode";
import * as path from "path";
import * as fs from "fs";
import {
  generateTree,
  getConfigOptions,
  TreeResult,
} from "./treeGenerator";

type WebviewMessage =
  | { type: "addPatterns"; patterns: string[] }
  | { type: "removePattern"; pattern: string }
  | { type: "resetPatterns" }
  | { type: "setOption"; key: "includeHidden" | "showFileSize" | "humanReadable"; value: boolean }
  | { type: "setHighlightColor"; color: string }
  | { type: "refresh" }
  | { type: "copyToClipboard" }
  | { type: "exportToFile" };

export class FolderTreePanel {
  public static current: FolderTreePanel | undefined;
  private readonly panel: vscode.WebviewPanel;
  private readonly extensionUri: vscode.Uri;
  private rootPath: string = "";
  private disposables: vscode.Disposable[] = [];
  private lastResult: TreeResult | null = null;
  private generationToken = 0;

  private constructor(panel: vscode.WebviewPanel, extensionUri: vscode.Uri) {
    this.panel = panel;
    this.extensionUri = extensionUri;
    this.panel.onDidDispose(() => this.dispose(), null, this.disposables);
    this.panel.webview.onDidReceiveMessage(
      (message) => this.handleMessage(message),
      null,
      this.disposables,
    );
    this.updateHtml();
  }

  public static register(extensionUri: vscode.Uri): FolderTreePanel {
    if (FolderTreePanel.current) {
      return FolderTreePanel.current;
    }
    const panel = vscode.window.createWebviewPanel(
      "exportFoldersTreeStructureView",
      "Folder Tree Structure",
      vscode.ViewColumn.Active,
      {
        enableScripts: true,
        retainContextWhenHidden: true,
        localResourceRoots: [
          vscode.Uri.file(path.join(extensionUri.fsPath, "media")),
        ],
      },
    );
    FolderTreePanel.current = new FolderTreePanel(panel, extensionUri);
    return FolderTreePanel.current;
  }

  public static reveal() {
    if (!FolderTreePanel.current) {
      return;
    }
    FolderTreePanel.current.panel.reveal();
  }

  public async refresh(rootPath: string) {
    this.rootPath = rootPath;
    await this.runGenerate();
  }

  private async runGenerate() {
    if (!this.rootPath) {
      return;
    }
    const token = ++this.generationToken;
    try {
      const config = vscode.workspace.getConfiguration(
        "exportFoldersTreeStructure",
      );
      const options = getConfigOptions();
      const outcome = await generateTree(this.rootPath, options);
      if (token !== this.generationToken) {
        return;
      }
      if (!outcome.result) {
        this.post("error", { message: "Tree generation returned no result" });
        return;
      }
      const result = outcome.result;
      this.lastResult = result;
      this.post("result", {
        text: result.text,
        lines: result.lines,
        stats: result.stats,
        rootPath: this.rootPath,
        options: {
          includeHidden: options.includeHidden,
          showFileSize: options.showFileSize,
          humanReadable: options.humanReadable,
        },
      });
      this.post("patterns", {
        defaults: config.get<string[]>("defaultIgnorePatterns", []),
        customs: config.get<string[]>("customIgnorePatterns", []),
      });
      if (outcome.invalidPatterns.length > 0) {
        this.post("feedback", {
          message: `Ignored invalid patterns: ${outcome.invalidPatterns.join(", ")}`,
        });
      }
    } catch (err) {
      if (token !== this.generationToken) return;
      this.post("error", { message: (err as Error).message });
    }
  }

  private updateHtml() {
    const config = vscode.workspace.getConfiguration(
      "exportFoldersTreeStructure",
    );
    const initialOptions = {
      includeHidden: config.get<boolean>("includeHidden", false),
      showFileSize: config.get<boolean>("showFileSize", false),
      humanReadable: config.get<boolean>("humanReadable", false),
    };
    const searchHighlightColor = config.get<string>(
      "searchHighlightColor",
      "#BF0AC2A6",
    );
    const parsedColor = parseHighlightColor(searchHighlightColor);
    const cssUri = this.panel.webview.asWebviewUri(
      vscode.Uri.file(path.join(this.extensionUri.fsPath, "media", "main.css")),
    );
    const jsUri = this.panel.webview.asWebviewUri(
      vscode.Uri.file(path.join(this.extensionUri.fsPath, "media", "main.js")),
    );
    const nonce = getNonce();
    const chk = (v: boolean) => (v ? "checked" : "");

    this.panel.webview.html = `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8" />
  <meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src ${this.panel.webview.cspSource} 'nonce-${nonce}'; script-src 'nonce-${nonce}';" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <style nonce="${nonce}">:root { --search-highlight-bg: ${searchHighlightColor}; }</style>
  <link rel="stylesheet" href="${cssUri}" />
  <title>Folder Tree Structure</title>
</head>
<body>
  <div id="app">
    <header class="toolbar">
      <div class="title">
        <span class="icon">📁</span>
        <span id="root-label">Folder Tree Structure</span>
      </div>
      <div class="toolbar-actions">
        <button id="btn-refresh" class="btn">🔄 Refresh</button>
        <button id="btn-copy" class="btn">📋 Copy</button>
        <button id="btn-export" class="btn">💾 Export text</button>
      </div>
    </header>

    <section class="stats" id="stats">
      <div class="stat"><span class="stat-label">Folders</span><span class="stat-value" id="stat-folders">—</span></div>
      <div class="stat"><span class="stat-label">Files</span><span class="stat-value" id="stat-files">—</span></div>
      <div class="stat"><span class="stat-label">Total size</span><span class="stat-value" id="stat-size">—</span></div>
      <div class="stat"><span class="stat-label">Generated</span><span class="stat-value" id="stat-time">—</span></div>
    </section>

    <section class="settings">
      <div class="settings-row">
        <label>Options:</label>
        <label class="check"><input type="checkbox" id="opt-include-hidden" ${chk(initialOptions.includeHidden)} /> Hidden</label>
        <label class="check"><input type="checkbox" id="opt-show-size" ${chk(initialOptions.showFileSize)} /> Show size</label>
        <label class="check"><input type="checkbox" id="opt-human-readable" ${chk(initialOptions.humanReadable)} /> Human readable</label>
      </div>
    </section>

    <section class="settings advanced-settings">
      <button class="advanced-toggle" id="btn-advanced-toggle">
        <span class="chevron">▶</span> Advanced settings
      </button>
      <div class="advanced-body" id="advanced-body">
        <div class="settings-row">
          <label>Highlight color:</label>
          <div class="color-picker">
            <input type="color" id="highlight-color" value="${parsedColor.base}" title="Pick a base color" />
            <div class="opacity-group">
              <input type="range" id="highlight-opacity" min="0" max="100" value="${parsedColor.alpha}" class="opacity-slider" />
              <span class="opacity-label">${parsedColor.alpha}%</span>
            </div>
            <span class="color-hex-preview" id="color-hex-preview">${searchHighlightColor.toUpperCase()}</span>
          </div>
        </div>
        <div class="settings-divider"></div>
        <div class="settings-row">
          <label for="pattern-input">Ignore pattern (glob):</label>
          <div class="input-row">
            <input id="pattern-input" type="text" placeholder="e.g. *.lock, src/**/*.test.ts, **/node_modules" />
            <button id="btn-add-pattern" class="btn">Add</button>
          </div>
        </div>
        <div class="chips" id="pattern-chips"></div>
      </div>
    </section>

    <section class="tree-wrap">
      <div class="tree-toolbar">
        <div class="search-box">
          <input id="search-input" type="text" placeholder="🔍 Search files…" spellcheck="false" />
        </div>
        <span id="search-count" class="search-count"></span>
        <span id="copy-feedback" class="feedback"></span>
      </div>
      <pre id="tree" class="tree">Select a folder and run "Export: Show Folder Tree Structure".</pre>
    </section>
  </div>
  <script src="${jsUri}" nonce="${nonce}"></script>
</body>
</html>`;
  }

  private async handleMessage(message: WebviewMessage) {
    switch (message.type) {
      case "addPatterns":
        await this.updateCustomPatterns((existing) =>
          dedupe([...existing, ...message.patterns]),
        );
        break;
      case "removePattern":
        await this.updateCustomPatterns((existing) =>
          existing.filter((p) => p !== message.pattern),
        );
        break;
      case "resetPatterns":
        await this.updateCustomPatterns(() => []);
        break;
      case "setOption":
        await this.updateOption(message.key, message.value);
        break;
      case "setHighlightColor":
        await this.updateHighlightColor(message.color);
        break;
      case "refresh":
        await this.runGenerate();
        break;
      case "copyToClipboard":
        if (this.lastResult) {
          await vscode.env.clipboard.writeText(this.lastResult.text);
          this.post("feedback", { message: "Copied to clipboard ✓" });
        }
        break;
      case "exportToFile":
        if (this.lastResult) {
          await this.exportLast();
        }
        break;
    }
  }

  private async updateCustomPatterns(
    transform: (existing: string[]) => string[],
  ): Promise<void> {
    const config = vscode.workspace.getConfiguration(
      "exportFoldersTreeStructure",
    );
    const existing = config.get<string[]>("customIgnorePatterns", []);
    const next = dedupe(transform(existing));
    await config.update(
      "customIgnorePatterns",
      next,
      vscode.ConfigurationTarget.Workspace,
    );
  }

  private async updateOption(
    key: "includeHidden" | "showFileSize" | "humanReadable",
    value: boolean,
  ): Promise<void> {
    const config = vscode.workspace.getConfiguration(
      "exportFoldersTreeStructure",
    );
    await config.update(key, value, vscode.ConfigurationTarget.Workspace);
  }

  private async exportLast() {
    if (!this.lastResult) {
      return;
    }
    const defaultName =
      (path.basename(this.lastResult.stats.rootPath) || "tree") + "-tree.txt";
    const saveUri = await vscode.window.showSaveDialog({
      defaultUri: vscode.Uri.file(
        path.join(path.dirname(this.lastResult.stats.rootPath), defaultName),
      ),
      filters: { Text: ["txt"], Markdown: ["md"] },
      title: "Export folder tree structure",
    });
    if (!saveUri) {
      return;
    }
    let content = this.lastResult.text;
    if (saveUri.fsPath.toLowerCase().endsWith(".md")) {
      content =
        `# ${this.lastResult.stats.rootPath}\n\n` +
        `Generated: ${this.lastResult.stats.generatedAt}\n` +
        `Folders: ${this.lastResult.stats.totalFolders} | ` +
        `Files: ${this.lastResult.stats.totalFiles}\n\n` +
        "```\n" +
        this.lastResult.text +
        "\n```\n";
    }
    fs.writeFileSync(saveUri.fsPath, content, "utf8");
    this.post("feedback", {
      message: "Saved " + path.basename(saveUri.fsPath) + " ✓",
    });
    const open = "Open file";
    const choice = await vscode.window.showInformationMessage(
      `Folder tree saved to ${saveUri.fsPath}`,
      open,
    );
    if (choice === open) {
      vscode.window.showTextDocument(saveUri);
    }
  }

  private post(type: string, payload: unknown) {
    this.panel.webview.postMessage({ type, payload });
  }

  private async updateHighlightColor(color: string): Promise<void> {
    const config = vscode.workspace.getConfiguration(
      "exportFoldersTreeStructure",
    );
    await config.update(
      "searchHighlightColor",
      color,
      vscode.ConfigurationTarget.Workspace,
    );
  }

  public dispose() {
    FolderTreePanel.current = undefined;
    while (this.disposables.length) {
      const d = this.disposables.pop();
      if (d) {
        d.dispose();
      }
    }
  }
}

function dedupe(arr: string[]): string[] {
  return Array.from(new Set(arr.map((s) => s.trim()).filter(Boolean)));
}

function parseHighlightColor(hex: string): { base: string; alpha: number } {
  const clean = hex.replace("#", "");
  if (clean.length === 8) {
    const r = clean.slice(0, 6);
    const a = parseInt(clean.slice(6, 8), 16);
    return { base: "#" + r, alpha: Math.round((a / 255) * 100) };
  }
  return { base: "#" + clean.slice(0, 6), alpha: 100 };
}

function getNonce(): string {
  let text = "";
  const possible =
    "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789";
  for (let i = 0; i < 32; i++) {
    text += possible.charAt(Math.floor(Math.random() * possible.length));
  }
  return text;
}
