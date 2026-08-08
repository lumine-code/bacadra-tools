const { CompositeDisposable, Disposable } = require("atom");
const fs = require("fs-extra");
const path = require("path");

module.exports = {
  CALC: "C:/Users/asiloisad/Desktop/CALC.ipy",
  FUND: "C:/Users/asiloisad/Desktop/FUND.ipy",
  TODO: "C:/Users/asiloisad/Desktop/TODO",
  YTDL: "C:/Data/Software/[w] yt-dlp/script.bat",
  UNICODE_README: "C:/Data/Develop/AutoHotKey/unicode-keys/readme.md",
  GITIGNORE_CONTENT: `# Ignore everything
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
`,

  activate() {
    this.treeView = null;
    this.hydrogen = null;
    this.scrollKeeper = null;
    this.disposables = new CompositeDisposable(
      atom.commands.add("atom-workspace", {
        "bacadra-tools:open-CALC": () => this.openCALC(),
        "bacadra-tools:open-FUND": () => this.openFUND(),
        "bacadra-tools:open-TODO": () => this.openTODO(),
        "bacadra-tools:open-YTDL": () => this.openYTDL(),
        "bacadra-tools:unicode-readme": () => this.openUnicodeReadme(),
        "bacadra-tools:ligatures": () => this.ligatures(),
        "bacadra-tools:reopen-in-dev-mode": () => this.reopenInDevMode(),
      }),
      atom.commands.add("atom-text-editor:not([mini])", {
        "bacadra-tools:signer": () => this.signSwaps(),
        "bacadra-tools:revert": () => this.revertBuffer(),
        "bacadra-tools:cdb-clear": () => this.cdbClear(),
        "bacadra-tools:normalize-newlines": () => this.normalizeNewlines(),
        "bacadra-tools:delete-to-indent": () => this.deleteToIndent(),
        "bacadra-tools:big-spaces": () => this.bigSpaces(),
        "bacadra-tools:generalize-cites": () => this.generalizeCites(),
      }),
      atom.commands.add(".tree-view", {
        "bacadra-tools:open-in-this-window": () => this.openInThisWindow(),
        "bacadra-tools:create-gitignore": () => this.createGitignore(),
      }),
    );
  },

  deactivate() {
    this.disposables.dispose();
  },

  consumeTreeView(treeView) {
    this.treeView = treeView;
    return new Disposable(() => {
      this.treeView = null;
    });
  },

  consumeScrollKeeper(scrollKeeper) {
    this.scrollKeeper = scrollKeeper;
    return new Disposable(() => {
      this.scrollKeeper = null;
    });
  },

  preserveScroll(editor, callback) {
    if (
      this.scrollKeeper &&
      typeof this.scrollKeeper.capturePosition === "function" &&
      typeof this.scrollKeeper.restorePosition === "function"
    ) {
      const position = this.scrollKeeper.capturePosition(editor);
      try {
        return callback();
      } finally {
        try {
          this.scrollKeeper.restorePosition(editor, position);
        } finally {
          if (position && typeof position.destroy === "function") {
            position.destroy();
          }
        }
      }
    }

    if (this.scrollKeeper && typeof this.scrollKeeper.preserveScroll === "function") {
      return this.scrollKeeper.preserveScroll(editor, callback);
    }

    if (editor.emitter) {
      const request = { handled: false, perform: callback };
      editor.emitter.emit("scroll-keeper-requested", request);
      if (request.handled) {
        return;
      }
    }

    return callback();
  },

  openInThisWindow() {
    if (!this.treeView) {
      return;
    }
    let projectPaths = this.treeView.selectedPaths().filter((p) => {
      try {
        return fs.statSync(p).isDirectory();
      } catch (e) {
        return false;
      }
    });
    if (!projectPaths.length) {
      return;
    }
    let closeQ = atom.project.getPaths().length ? true : false;
    atom.open({ pathsToOpen: projectPaths });
    if (closeQ) {
      atom.close();
    }
  },

  async createGitignore() {
    if (!this.treeView) {
      return;
    }

    const targetDirs = new Set();
    for (const selectedPath of this.treeView.selectedPaths()) {
      try {
        const stat = await fs.stat(selectedPath);
        targetDirs.add(stat.isDirectory() ? selectedPath : path.dirname(selectedPath));
      } catch (error) {
        console.error(error);
      }
    }

    if (!targetDirs.size) {
      return;
    }

    try {
      for (const targetDir of targetDirs) {
        await fs.writeFile(path.join(targetDir, ".gitignore"), this.GITIGNORE_CONTENT, "utf8");
      }
      atom.notifications.addSuccess("Created .gitignore", {
        detail: Array.from(targetDirs).join("\n"),
      });
    } catch (error) {
      atom.notifications.addError("Failed to create .gitignore", {
        detail: error.message,
      });
    }
  },

  signSwaps() {
    let editor = atom.workspace.getActiveTextEditor();
    if (!editor) {
      return;
    }
    editor.mutateSelectedText((selection, _) => {
      let text = selection.getText();
      text = text.replace(/(\+|-)/g, (matched) => {
        return matched === "+" ? "-" : "+";
      });
      selection.insertText(text);
    });
  },

  generalizeCites() {
    // Replace a national Eurocode cite key (pn/bs/din/nf-en_<part>:<year>) with
    // the annex-neutral bacadra token :@en_<part>:, resolved at render time.
    const editor = atom.workspace.getActiveTextEditor();
    if (!editor) {
      return;
    }
    let count = 0;
    editor.transact(() => {
      editor.scan(
        /(?:pn|bs|din|nf)-en_([^:{}\s]+):[0-9][0-9-]*/g,
        ({ match, replace }) => {
          replace(`:@en_${match[1]}:`);
          count += 1;
        },
      );
    });
    atom.notifications.addSuccess(
      `Generalized ${count} Eurocode cite${count === 1 ? "" : "s"}`,
    );
  },

  normalizeNewlines() {
    let editor = atom.workspace.getActiveTextEditor();
    if (!editor) {
      return;
    }
    const normalize = () =>
      editor.transact(() => {
        editor.backwardsScanInBufferRange(
          /(?:\r?\n){3,}/g,
          [
            [0, 0],
            [1e9, 0],
          ],
          (object) => {
            object.replace("\n\n");
          },
        );
      });

    this.preserveScroll(editor, normalize);
  },

  async revertBuffer() {
    let editor = atom.workspace.getActiveTextEditor();
    let pathSrc = editor.getPath();
    if (!pathSrc) {
      return;
    }
    await fs
      .readFile(pathSrc, { encoding: "utf8" })
      .then((data) => {
        let curPos = editor.getCursorBufferPosition();
        editor.setText(data);
        editor.setCursorBufferPosition(curPos);
      })
      .catch((err) => {
        console.error(err);
      });
  },

  openCALC() {
    atom.workspace.open(this.CALC);
  },

  openFUND() {
    atom.workspace.open(this.FUND);
  },

  openTODO() {
    atom.workspace.open(this.TODO);
  },

  openYTDL() {
    atom.workspace.open(this.YTDL);
  },

  openUnicodeReadme() {
    atom.workspace.open(`markdown-preview://${encodeURI(this.UNICODE_README)}`, {
      searchAllPanes: true,
    });
  },

  ligatures() {
    if (document.body.style.fontVariantLigatures === "none") {
      document.body.style.fontVariantLigatures = "unset";
    } else {
      document.body.style.fontVariantLigatures = "none";
    }
  },

  reopenInDevMode() {
    const projectPaths = atom.project.getPaths();
    atom.open({
      pathsToOpen: projectPaths,
      devMode: true,
      newWindow: true,
    });
    atom.close();
  },

  deleteToIndent() {
    let editor = atom.workspace.getActiveTextEditor();
    if (!editor) {
      return;
    }
    let selections = editor.getSelections();
    editor.transact(() => {
      for (let selection of selections) {
        let currentRange = selection.getBufferRange();
        let endRow = selection.isReversed() ? currentRange.start.row - 1 : currentRange.end.row + 1;
        selection.selectToBufferPosition({ row: endRow, column: 0 });
        selection.selectToFirstCharacterOfLine();
        selection.delete();
      }
    });
  },

  bigSpaces() {
    const editor = atom.workspace.getActiveTextEditor();
    if (!editor) {
      return;
    }
    editor.transact(() => {
      editor.backwardsScanInBufferRange(
        /(\r\n){3,}/gm,
        [
          [0, 0],
          [editor.getLastBufferRow(), 1e9],
        ],
        (item) => {
          item.replace("\n\n");
        },
      );
    });
  },

  consumeHydrogen(hydrogen) {
    this.hydrogen = hydrogen;
    return new Disposable(() => {
      this.hydrogen = null;
    });
  },

  getHydrogenKernel() {
    try {
      return this.hydrogen.getActiveKernel();
    } catch (error) {
      atom.notifications.addError("Hydrogen kernel is not available");
      return false;
    }
  },

  async cdbClear() {
    let kernel = this.getHydrogenKernel();
    if (!kernel) {
      return;
    }
    const result = await kernel.execute("cdb.clear()");
    if (result.status === "ok") {
      atom.notifications.addSuccess("Cache cleared");
    } else {
      atom.notifications.addError("Failed to clear cache", {
        detail: `${result.error.ename}: ${result.error.evalue}`,
      });
    }
  },
};
