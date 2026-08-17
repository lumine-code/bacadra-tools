const { CompositeDisposable, Disposable } = require("lumine");
const fs = require("fs");
const os = require("os");
const path = require("path");

const GITIGNORE_CONTENT = `# Ignore everything
*

# But not these files...
!*.ipy
!*.py
!*.dat
*_csm.dat
*_csmlf.dat
*_aqa.dat
*_msh.dat
*_run.dat
!*.gra
!*.tex
!*.bib
!*.def
![[]f[]]*/*.dwg
!*.include
!*.pkl

# ...even if they are in subdirectories
!*/

# ...but exclude
[[]m[]] archive/*
[[]m[]] databox/*
`;

function expandHome(filePath) {
  if (filePath === "~") return os.homedir();
  if (filePath.startsWith("~/") || filePath.startsWith("~\\")) {
    return path.join(os.homedir(), filePath.slice(2));
  }
  return filePath;
}

module.exports = {
  GITIGNORE_CONTENT,

  activate() {
    this.treeView = null;
    this.jupyter = null;
    this.disposables = new CompositeDisposable(
      lumine.commands.add("lumine-workspace", {
        "bacadra-tools:open-CALC": {
          description: "Open the CALC file named in the settings.",
          didDispatch: (event) => this.openConfiguredPath("calcPath", "CALC", event),
        },
        "bacadra-tools:open-FUND": {
          description: "Open the FUND file named in the settings.",
          didDispatch: (event) => this.openConfiguredPath("fundPath", "FUND", event),
        },
        "bacadra-tools:open-TODO": {
          description: "Open the TODO file named in the settings.",
          didDispatch: (event) => this.openConfiguredPath("todoPath", "TODO", event),
        },
        "bacadra-tools:open-YTDL": {
          description: "Open the YTDL file named in the settings.",
          didDispatch: (event) => this.openConfiguredPath("ytdlPath", "YTDL", event),
        },
        "bacadra-tools:unicode-readme": {
          description: "Open the Unicode reference named in the settings.",
          didDispatch: (event) => this.openUnicodeReadme(event),
        },
        "bacadra-tools:ligatures": {
          description: "Turn the font's ligatures off across the window, or back on.",
          didDispatch: () => this.ligatures(),
        },
        "bacadra-tools:signer": {
          description: "Swap every plus and minus in the selection for the other.",
          didDispatch: (event) => this.signSwaps(event),
        },
        "bacadra-tools:revert": {
          description: "Read the file from disk again, discarding unsaved changes.",
          didDispatch: (event) => this.revertBuffer(event),
        },
        "bacadra-tools:cdb-clear": {
          description: "Clear the cdb cache in the kernel serving this file.",
          didDispatch: () => this.cdbClear(),
        },
        "bacadra-tools:generalize-cites": {
          description: "Drop the year from every standard reference in the file.",
          didDispatch: (event) => this.generalizeCites(event),
        },
        "bacadra-tools:create-gitignore": {
          description: "Write a gitignore into each selected folder.",
          didDispatch: () => this.createGitignore(),
        },
      }),
    );
  },

  deactivate() {
    this.disposables?.dispose();
    this.disposables = null;
    this.treeView = null;
    this.jupyter = null;
  },

  consumeTreeViewSelection(treeView) {
    this.treeView = treeView;
    return new Disposable(() => {
      this.treeView = null;
    });
  },

  consumeJupyterKernel(jupyter) {
    this.jupyter = jupyter;
    return new Disposable(() => {
      this.jupyter = null;
    });
  },

  editorForEvent(event) {
    const element = event?.target?.closest?.("lumine-text-editor:not([mini])");
    return element?.getModel?.() ?? lumine.workspace.getActiveTextEditor() ?? null;
  },

  configuredPath(key) {
    const value = lumine.config.get(`bacadra-tools.${key}`);
    return typeof value === "string" && value.trim() ? expandHome(value.trim()) : null;
  },

  openConfiguredPath(key, label) {
    const filePath = this.configuredPath(key);
    if (!filePath) {
      lumine.notifications.addWarning(`Configure the ${label} path in Bacadra Tools settings`);
      return;
    }
    return lumine.workspace.open(filePath);
  },

  selectedTreePaths() {
    return this.treeView?.selectedPaths?.() ?? [];
  },

  async createGitignore() {
    const targetDirs = new Set();
    for (const selectedPath of this.selectedTreePaths()) {
      try {
        const stat = await fs.promises.stat(selectedPath);
        targetDirs.add(stat.isDirectory() ? selectedPath : path.dirname(selectedPath));
      } catch {
        // A stale tree entry is ignored; report only if nothing usable remains.
      }
    }

    if (!targetDirs.size) {
      lumine.notifications.addWarning("Select a file or directory in the tree view");
      return;
    }

    try {
      await Promise.all(
        Array.from(targetDirs, (targetDir) =>
          fs.promises.writeFile(path.join(targetDir, ".gitignore"), GITIGNORE_CONTENT, "utf8"),
        ),
      );
      lumine.notifications.addSuccess("Created .gitignore", {
        detail: Array.from(targetDirs).join("\n"),
      });
    } catch (error) {
      lumine.notifications.addError("Failed to create .gitignore", {
        detail: error.message,
      });
    }
  },

  signSwaps(event) {
    const editor = this.editorForEvent(event);
    if (!editor) return;

    editor.mutateSelectedText((selection) => {
      selection.insertText(
        selection.getText().replace(/(\+|-)/g, (matched) => (matched === "+" ? "-" : "+")),
      );
    });
  },

  generalizeCites(event) {
    const editor = this.editorForEvent(event);
    if (!editor) return;

    let count = 0;
    editor.transact(() => {
      editor.scan(/(?:pn|bs|din|nf)-en_([^:{}\s]+):[0-9][0-9-]*/g, ({ match, replace }) => {
        replace(`:@en_${match[1]}:`);
        count++;
      });
    });
    lumine.notifications.addSuccess(`Generalized ${count} Eurocode cite${count === 1 ? "" : "s"}`);
  },

  async revertBuffer(event) {
    const editor = this.editorForEvent(event);
    const sourcePath = editor?.getPath();
    if (!sourcePath) {
      if (editor) lumine.notifications.addWarning("Save the file before reverting it from disk");
      return;
    }

    try {
      const data = await fs.promises.readFile(sourcePath, "utf8");
      const cursorPosition = editor.getCursorBufferPosition();
      editor.setText(data);
      editor.setCursorBufferPosition(cursorPosition);
    } catch (error) {
      lumine.notifications.addError("Failed to revert the file from disk", {
        detail: error.message,
      });
    }
  },

  openUnicodeReadme() {
    const readmePath = this.configuredPath("unicodeReadmePath");
    if (!readmePath) {
      lumine.notifications.addWarning(
        "Configure the Unicode readme path in Bacadra Tools settings",
      );
      return;
    }
    return lumine.workspace.open(`markdown-preview://${encodeURI(readmePath)}`, {
      searchAllPanes: true,
    });
  },

  ligatures() {
    document.body.style.fontVariantLigatures =
      document.body.style.fontVariantLigatures === "none" ? "" : "none";
  },

  getJupyterKernel() {
    const kernel = this.jupyter?.getActiveKernel?.() ?? null;
    if (!kernel) {
      lumine.notifications.addWarning("No active Jupyter kernel");
    }
    return kernel;
  },

  async cdbClear() {
    const kernel = this.getJupyterKernel();
    if (!kernel) return;

    try {
      const result = await kernel.execute("cdb.clear()");
      if (result.status === "ok") {
        lumine.notifications.addSuccess("Cache cleared");
      } else {
        const name = result.error?.ename ?? "Execution error";
        const value = result.error?.evalue ?? "cdb.clear() failed";
        lumine.notifications.addError("Failed to clear cache", { detail: `${name}: ${value}` });
      }
    } catch (error) {
      lumine.notifications.addError("Failed to clear cache", { detail: error.message });
    }
  },
};
