const { CompositeDisposable, Disposable } = require("atom");
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
      atom.commands.add("atom-workspace", {
        "bacadra-tools:open-CALC": (event) => this.openConfiguredPath("calcPath", "CALC", event),
        "bacadra-tools:open-FUND": (event) => this.openConfiguredPath("fundPath", "FUND", event),
        "bacadra-tools:open-TODO": (event) => this.openConfiguredPath("todoPath", "TODO", event),
        "bacadra-tools:open-YTDL": (event) => this.openConfiguredPath("ytdlPath", "YTDL", event),
        "bacadra-tools:unicode-readme": (event) => this.openUnicodeReadme(event),
        "bacadra-tools:ligatures": () => this.ligatures(),
        "bacadra-tools:reopen-in-dev-mode": () => this.reopenInDevMode(),
        "bacadra-tools:signer": (event) => this.signSwaps(event),
        "bacadra-tools:revert": (event) => this.revertBuffer(event),
        "bacadra-tools:cdb-clear": () => this.cdbClear(),
        "bacadra-tools:normalize-newlines": (event) => this.normalizeNewlines(event),
        "bacadra-tools:delete-to-indent": (event) => this.deleteToIndent(event),
        "bacadra-tools:big-spaces": (event) => this.bigSpaces(event),
        "bacadra-tools:generalize-cites": (event) => this.generalizeCites(event),
        "bacadra-tools:create-gitignore": () => this.createGitignore(),
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
    const element = event?.target?.closest?.("atom-text-editor:not([mini])");
    return element?.getModel?.() ?? atom.workspace.getActiveTextEditor() ?? null;
  },

  configuredPath(key) {
    const value = atom.config.get(`bacadra-tools.${key}`);
    return typeof value === "string" && value.trim() ? expandHome(value.trim()) : null;
  },

  openConfiguredPath(key, label) {
    const filePath = this.configuredPath(key);
    if (!filePath) {
      atom.notifications.addWarning(`Configure the ${label} path in Bacadra Tools settings`);
      return;
    }
    return atom.workspace.open(filePath);
  },

  preserveScroll(editor, callback) {
    const element = atom.views.getView(editor);
    if (
      typeof element?.getScrollTop !== "function" ||
      typeof element?.setScrollTop !== "function"
    ) {
      return callback();
    }

    const scrollTop = element.getScrollTop();
    try {
      return callback();
    } finally {
      element.setScrollTop(scrollTop);
    }
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
      atom.notifications.addWarning("Select a file or directory in the tree view");
      return;
    }

    try {
      await Promise.all(
        Array.from(targetDirs, (targetDir) =>
          fs.promises.writeFile(path.join(targetDir, ".gitignore"), GITIGNORE_CONTENT, "utf8"),
        ),
      );
      atom.notifications.addSuccess("Created .gitignore", {
        detail: Array.from(targetDirs).join("\n"),
      });
    } catch (error) {
      atom.notifications.addError("Failed to create .gitignore", {
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
    atom.notifications.addSuccess(`Generalized ${count} Eurocode cite${count === 1 ? "" : "s"}`);
  },

  normalizeNewlines(event) {
    const editor = this.editorForEvent(event);
    if (!editor) return;

    this.preserveScroll(editor, () => {
      editor.transact(() => {
        editor.backwardsScanInBufferRange(
          /(?:\r?\n){3,}/g,
          [
            [0, 0],
            [Infinity, Infinity],
          ],
          ({ replace }) => {
            replace("\n\n");
          },
        );
      });
    });
  },

  async revertBuffer(event) {
    const editor = this.editorForEvent(event);
    const sourcePath = editor?.getPath();
    if (!sourcePath) {
      if (editor) atom.notifications.addWarning("Save the file before reverting it from disk");
      return;
    }

    try {
      const data = await fs.promises.readFile(sourcePath, "utf8");
      const cursorPosition = editor.getCursorBufferPosition();
      editor.setText(data);
      editor.setCursorBufferPosition(cursorPosition);
    } catch (error) {
      atom.notifications.addError("Failed to revert the file from disk", {
        detail: error.message,
      });
    }
  },

  openUnicodeReadme() {
    const readmePath = this.configuredPath("unicodeReadmePath");
    if (!readmePath) {
      atom.notifications.addWarning("Configure the Unicode readme path in Bacadra Tools settings");
      return;
    }
    return atom.workspace.open(`markdown-preview://${encodeURI(readmePath)}`, {
      searchAllPanes: true,
    });
  },

  ligatures() {
    document.body.style.fontVariantLigatures =
      document.body.style.fontVariantLigatures === "none" ? "" : "none";
  },

  reopenInDevMode() {
    atom.open({
      pathsToOpen: atom.project.getPaths(),
      devMode: true,
      newWindow: true,
    });
    atom.close();
  },

  deleteToIndent(event) {
    const editor = this.editorForEvent(event);
    if (!editor) return;

    editor.transact(() => {
      for (const selection of editor.getSelections()) {
        const range = selection.getBufferRange();
        const row = selection.isReversed() ? range.start.row - 1 : range.end.row + 1;
        selection.selectToBufferPosition({ row: Math.max(0, row), column: 0 });
        selection.selectToFirstCharacterOfLine();
        selection.delete();
      }
    });
  },

  bigSpaces(event) {
    const editor = this.editorForEvent(event);
    if (!editor) return;

    editor.transact(() => {
      editor.backwardsScanInBufferRange(
        /(?<=\S) {2,}/g,
        [
          [0, 0],
          [Infinity, Infinity],
        ],
        ({ replace }) => replace(" "),
      );
    });
  },

  getJupyterKernel() {
    const kernel = this.jupyter?.getActiveKernel?.() ?? null;
    if (!kernel) {
      atom.notifications.addWarning("No active Jupyter kernel");
    }
    return kernel;
  },

  async cdbClear() {
    const kernel = this.getJupyterKernel();
    if (!kernel) return;

    try {
      const result = await kernel.execute("cdb.clear()");
      if (result.status === "ok") {
        atom.notifications.addSuccess("Cache cleared");
      } else {
        const name = result.error?.ename ?? "Execution error";
        const value = result.error?.evalue ?? "cdb.clear() failed";
        atom.notifications.addError("Failed to clear cache", { detail: `${name}: ${value}` });
      }
    } catch (error) {
      atom.notifications.addError("Failed to clear cache", { detail: error.message });
    }
  },
};
