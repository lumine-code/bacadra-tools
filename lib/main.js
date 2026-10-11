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

function escapeRegExp(value) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function expandHome(filePath) {
  if (filePath === "~") return os.homedir();
  if (filePath.startsWith("~/") || filePath.startsWith("~\\")) {
    return path.join(os.homedir(), filePath.slice(2));
  }
  return filePath;
}

module.exports = {
  provideBackgroundTips() {
    return {
      packageName: "bacadra-tools",
      tips: ["Bacadra Tools can generalize national Eurocode citations into annex-neutral tokens."],
    };
  },

  GITIGNORE_CONTENT,

  activate() {
    this.treeView = null;
    this.jupyter = null;
    this.serviceProviders = { treeView: new Map(), jupyter: new Map() };
    this.serviceEdges = { treeView: [], jupyter: [] };
    this.pendingReverts = new WeakMap();
    this.disposables = new CompositeDisposable(
      lumine.commands.add("lumine-workspace", {
        "bacadra-tools:open-calc": {
          description: "Open the CALC file named in the settings.",
          didDispatch: (event) => this.openConfiguredPath("calcPath", "CALC", event),
        },
        "bacadra-tools:open-fund": {
          description: "Open the FUND file named in the settings.",
          didDispatch: (event) => this.openConfiguredPath("fundPath", "FUND", event),
        },
        "bacadra-tools:open-todo": {
          description: "Open the TODO file named in the settings.",
          didDispatch: (event) => this.openConfiguredPath("todoPath", "TODO", event),
        },
        "bacadra-tools:open-ytdl": {
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
        "bacadra-tools:renumber": {
          description: "Renumber matching file names from one in document order.",
          didDispatch: (event) => this.renumber(event),
        },
        "bacadra-tools:revert": {
          description: "Read the file from disk again, discarding unsaved changes.",
          didDispatch: (event) => this.revertBuffer(event),
        },
        "bacadra-tools:cdb-clear": {
          description: "Clear the cdb cache in the active Jupyter kernel.",
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
    const owner = this.disposables;
    const providers = this.serviceProviders;
    const edges = this.serviceEdges;
    this.disposables = null;
    this.pendingReverts = null;
    this.serviceProviders = null;
    this.serviceEdges = null;
    this.treeView = null;
    this.jupyter = null;
    for (const values of Object.values(providers ?? {})) {
      for (const record of values.values()) {
        for (const request of record.requests) request.dispose();
        record.requests.clear();
      }
      values.clear();
    }
    for (const values of Object.values(edges ?? {})) values.length = 0;
    owner?.dispose();
  },

  consumeTreeViewSelection(treeView) {
    return this.consumeService("treeView", treeView);
  },

  consumeJupyterKernel(jupyter) {
    return this.consumeService("jupyter", jupyter);
  },

  consumeService(name, service) {
    const owner = this.disposables;
    const providers = this.serviceProviders?.[name];
    const edges = this.serviceEdges?.[name];
    if (!owner || owner.disposed || !providers) return new Disposable();
    let record = providers.get(service);
    if (!record) {
      record = { leases: 0, requests: new Set() };
      providers.set(service, record);
    }
    record.leases++;
    const edge = { service };
    edges.push(edge);
    this[name] = service;
    return new Disposable(() => {
      if (this.disposables !== owner || providers.get(service) !== record) return;
      const index = edges.indexOf(edge);
      if (index < 0) return;
      edges.splice(index, 1);
      if (--record.leases === 0) {
        for (const request of record.requests) request.dispose();
        record.requests.clear();
        providers.delete(service);
      }
      this[name] = edges.at(-1)?.service ?? null;
    });
  },

  editorForEvent(event) {
    return (
      lumine.workspace.getTextEditorForElement(event?.target, { includeMini: false }) ??
      lumine.workspace.getActiveTextEditor() ??
      null
    );
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
      const results = await Promise.allSettled(
        Array.from(targetDirs, (targetDir) =>
          fs.promises.writeFile(path.join(targetDir, ".gitignore"), GITIGNORE_CONTENT, {
            encoding: "utf8",
            flag: "wx",
          }),
        ),
      );
      const failure = results.find((result) => result.status === "rejected");
      if (failure) throw failure.reason;
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

  renumber(event) {
    const editor = this.editorForEvent(event);
    if (!editor) return;

    const prefix = editor.getSelectedText();
    if (!prefix) {
      lumine.notifications.addWarning("Select a filename prefix to renumber");
      return;
    }

    const pattern = new RegExp(escapeRegExp(prefix) + "-(\\d+)(?=\\D|$)", "g");
    let number = 0;
    editor.transact(() => {
      editor.scan(pattern, ({ match, replace }) => {
        number++;
        const suffix = match[0].slice(prefix.length + 1 + match[1].length);
        replace(prefix + "-" + number + suffix);
      });
    });
    return number;
  },

  generalizeCites(event) {
    const editor = this.editorForEvent(event);
    if (!editor) return;

    editor.transact(() => {
      editor.scan(/(?:pn|bs|din|nf)-en_([^:{}\s]+):[0-9][0-9-]*/g, ({ match, replace }) => {
        replace(`:@en_${match[1]}:`);
      });
    });
  },

  async revertBuffer(event) {
    const editor = this.editorForEvent(event);
    const sourcePath = editor?.getPath();
    if (!sourcePath) {
      if (editor) lumine.notifications.addWarning("Save the file before reverting it from disk");
      return;
    }

    const owner = this.disposables;
    const requests = this.pendingReverts;
    if (!owner || !requests) return;
    const buffer = editor.getBuffer();
    const request = {};
    requests.set(buffer, request);
    let changed = false;
    const changes = buffer.onDidChangeText(() => (changed = true));
    owner.add(changes);
    const ownsTarget = () =>
      this.disposables === owner &&
      this.pendingReverts === requests &&
      requests.get(buffer) === request &&
      !editor.isDestroyed() &&
      editor.getBuffer() === buffer &&
      editor.getPath() === sourcePath;

    try {
      const data = await fs.promises.readFile(sourcePath, "utf8");
      if (!ownsTarget() || changed) return;
      // The observer protects edits made while reading, not the intentional
      // setText below. Stop it before applying the requested revert.
      owner.remove(changes);
      changes.dispose();
      const cursorPosition = editor.getCursorBufferPosition();
      editor.setText(data);
      if (ownsTarget() && editor.getText() === data) {
        editor.setCursorBufferPosition(cursorPosition);
      }
    } catch (error) {
      if (!ownsTarget() || changed) return;
      lumine.notifications.addError("Failed to revert the file from disk", {
        detail: error.message,
      });
    } finally {
      owner.remove(changes);
      changes.dispose();
      if (requests.get(buffer) === request) requests.delete(buffer);
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

  async getJupyterKernel(request = {}) {
    const owner = this.disposables;
    request.owner = owner;
    const owns = () => owner && !owner.disposed && this.disposables === owner;
    if (!owns()) return null;
    if (!this.jupyter) {
      try {
        await lumine.packages.requestService("jupyter.kernel", "^1.0.0");
      } catch (error) {
        if (owns()) throw error;
        return null;
      }
    }
    if (!owns()) return null;
    const service = this.jupyter;
    const record = this.serviceProviders.jupyter.get(service);
    const kernel = service?.getActiveKernel?.() ?? null;
    if (
      !owns() ||
      this.jupyter !== service ||
      this.serviceProviders.jupyter.get(service) !== record
    )
      return null;
    request.service = service;
    request.record = record;
    if (!kernel) {
      lumine.notifications.addWarning("No active Jupyter kernel");
    }
    return kernel;
  },

  async cdbClear() {
    const request = {};
    let operation;
    const owns = () =>
      request.owner &&
      !request.owner.disposed &&
      this.disposables === request.owner &&
      (!request.service ||
        (this.jupyter === request.service &&
          this.serviceProviders.jupyter.get(request.service) === request.record));
    try {
      const kernel = await this.getJupyterKernel(request);
      if (!kernel || !owns()) return;
      operation = kernel.request({ type: "execute", purpose: "user", code: "cdb.clear()" });
      request.record.requests.add(operation);
      const result = await operation.done;
      if (
        !owns() ||
        kernel.isDestroyed() ||
        kernel.generation !== operation.generation ||
        result.status === "cancelled"
      )
        return;
      if (result.status === "ok") {
        lumine.notifications.addSuccess("Cache cleared");
      } else {
        const name = result.error?.ename ?? "Execution error";
        const value = result.error?.evalue ?? "cdb.clear() failed";
        lumine.notifications.addError("Failed to clear cache", { detail: `${name}: ${value}` });
      }
    } catch (error) {
      if (!owns()) return;
      lumine.notifications.addError("Failed to clear cache", { detail: error.message });
    } finally {
      if (operation && request.record.requests.delete(operation)) operation.dispose();
    }
  },
};
