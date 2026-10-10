const fs = require("fs");
const os = require("os");
const path = require("path");

describe("bacadra-tools", () => {
  let editor, editorElement, mainModule, runtimeRequest, tempDir;

  beforeEach(async () => {
    jasmine.attachToDOM(lumine.views.getView(lumine.workspace));
    editor = await lumine.workspace.open("notes.py");
    editorElement = lumine.views.getView(editor);
    const activation = lumine.packages.activatePackage("bacadra-tools");
    lumine.commands.dispatch(editorElement, "bacadra-tools:signer");
    mainModule = (await activation).mainModule;
    runtimeRequest = spyOn(lumine.packages, "requestService").and.returnValue(
      Promise.resolve(true),
    );
    editor.setText("");
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "bacadra-tools-"));
  });

  afterEach(async () => {
    await lumine.packages.deactivatePackage("bacadra-tools");
    if (tempDir) {
      fs.rmSync(tempDir, { recursive: true, force: true, maxRetries: 10, retryDelay: 50 });
    }
  });

  it("registers its complete command surface on the workspace", () => {
    const commands = lumine.commands
      .findCommands({ target: lumine.views.getView(lumine.workspace) })
      .map(({ name }) => name);

    for (const command of [
      "bacadra-tools:signer",
      "bacadra-tools:renumber",
      "bacadra-tools:generalize-cites",
      "bacadra-tools:create-gitignore",
      "bacadra-tools:cdb-clear",
    ]) {
      expect(commands).toContain(command);
    }

    for (const migratedCommand of [
      "bacadra-tools:reopen-in-dev-mode",
      "bacadra-tools:normalize-newlines",
      "bacadra-tools:delete-to-indent",
      "bacadra-tools:big-spaces",
    ]) {
      expect(commands).not.toContain(migratedCommand);
    }
  });

  it("swaps signs in every selection", () => {
    editor.setText("a + b - c");
    editor.setSelectedBufferRange([
      [0, 2],
      [0, 9],
    ]);

    lumine.commands.dispatch(editorElement, "bacadra-tools:signer");

    expect(editor.getText()).toBe("a - b + c");
    expect(runtimeRequest).not.toHaveBeenCalled();
  });

  it("renumbers matching paths in document order", () => {
    const prefix = "assets/[e] {cdbname}/[r] fatig";
    editor.setText(
      `${prefix}-1.png\n${prefix}-15.png\nother\n${prefix}-5.png\n${prefix}-20-final.png`,
    );
    editor.setSelectedBufferRange([
      [0, 0],
      [0, prefix.length],
    ]);

    lumine.commands.dispatch(editorElement, "bacadra-tools:renumber");

    expect(editor.getText()).toBe(
      `${prefix}-1.png\n${prefix}-2.png\nother\n${prefix}-3.png\n${prefix}-4-final.png`,
    );
  });

  it("generalizes national Eurocode citation keys", () => {
    editor.setText("pn-en_1992-1-1:2008 and din-en_1993-1-8:2010-12");

    lumine.commands.dispatch(editorElement, "bacadra-tools:generalize-cites");

    expect(editor.getText()).toBe(":@en_1992-1-1: and :@en_1993-1-8:");
  });

  it("toggles ligatures across the window", async () => {
    await lumine.commands.dispatch(editorElement, "bacadra-tools:ligatures");
    expect(document.body.style.fontVariantLigatures).toBe("none");

    await lumine.commands.dispatch(editorElement, "bacadra-tools:ligatures");
    expect(document.body.style.fontVariantLigatures).toBe("");
  });

  it("creates one Bacadra .gitignore beside a selected file", async () => {
    const filePath = path.join(tempDir, "model.py");
    fs.writeFileSync(filePath, "");
    mainModule.consumeTreeViewSelection({ selectedPaths: () => [filePath] });

    await mainModule.createGitignore();

    expect(fs.readFileSync(path.join(tempDir, ".gitignore"), "utf8")).toBe(
      mainModule.GITIGNORE_CONTENT,
    );
  });

  it("clears the cache through the jupyter.kernel service", async () => {
    const { kernel, operation } = kernelForOutcome({ status: "ok" });
    const success = spyOn(lumine.notifications, "addSuccess");
    mainModule.consumeJupyterKernel({ getActiveKernel: () => kernel });

    await mainModule.cdbClear();

    expect(runtimeRequest).not.toHaveBeenCalled();
    expect(kernel.request).toHaveBeenCalledOnceWith({
      type: "execute",
      purpose: "user",
      code: "cdb.clear()",
    });
    expect(success).toHaveBeenCalledOnceWith("Cache cleared");
    expect(operation.dispose).toHaveBeenCalledTimes(1);
  });

  it("requests jupyter.kernel before clearing when the service is absent", async () => {
    const { kernel, operation } = kernelForOutcome({ status: "ok" });
    runtimeRequest.and.callFake(async () => {
      mainModule.consumeJupyterKernel({ getActiveKernel: () => kernel });
      return true;
    });

    await mainModule.cdbClear();

    expect(runtimeRequest).toHaveBeenCalledWith("jupyter.kernel", "^1.0.0");
    expect(kernel.request).toHaveBeenCalledOnceWith({
      type: "execute",
      purpose: "user",
      code: "cdb.clear()",
    });
    expect(operation.dispose).toHaveBeenCalledTimes(1);
  });

  function kernelForOutcome(outcome) {
    const operation = {
      generation: 1,
      done: Promise.resolve(outcome),
      dispose: jasmine.createSpy("dispose request"),
    };
    const kernel = {
      generation: 1,
      isDestroyed: () => false,
      request: jasmine.createSpy("request").and.returnValue(operation),
    };
    return { kernel, operation };
  }

  it("reports the kernel's Python error and releases the completed request", async () => {
    const { kernel, operation } = kernelForOutcome({
      status: "error",
      error: { ename: "NameError", evalue: "name 'cdb' is not defined", traceback: [] },
    });
    const error = spyOn(lumine.notifications, "addError");
    const success = spyOn(lumine.notifications, "addSuccess");
    mainModule.consumeJupyterKernel({ getActiveKernel: () => kernel });

    await mainModule.cdbClear();

    expect(error).toHaveBeenCalledOnceWith("Failed to clear cache", {
      detail: "NameError: name 'cdb' is not defined",
    });
    expect(success).not.toHaveBeenCalled();
    expect(operation.dispose).toHaveBeenCalledTimes(1);
  });

  it("reports a failure to submit the kernel request", async () => {
    const { kernel } = kernelForOutcome({ status: "ok" });
    kernel.request.and.throwError("Session unavailable");
    const error = spyOn(lumine.notifications, "addError");
    mainModule.consumeJupyterKernel({ getActiveKernel: () => kernel });

    await expectAsync(mainModule.cdbClear()).toBeResolved();

    expect(error).toHaveBeenCalledOnceWith("Failed to clear cache", {
      detail: "Session unavailable",
    });
  });

  it("silently releases a cancelled request", async () => {
    const { kernel, operation } = kernelForOutcome({ status: "cancelled" });
    const error = spyOn(lumine.notifications, "addError");
    const success = spyOn(lumine.notifications, "addSuccess");
    mainModule.consumeJupyterKernel({ getActiveKernel: () => kernel });

    await mainModule.cdbClear();

    expect(error).not.toHaveBeenCalled();
    expect(success).not.toHaveBeenCalled();
    expect(operation.dispose).toHaveBeenCalledTimes(1);
  });

  it("ignores a result from a retired kernel generation", async () => {
    const { kernel, operation } = kernelForOutcome({ status: "ok" });
    kernel.generation = 2;
    const success = spyOn(lumine.notifications, "addSuccess");
    mainModule.consumeJupyterKernel({ getActiveKernel: () => kernel });

    await mainModule.cdbClear();

    expect(success).not.toHaveBeenCalled();
    expect(operation.dispose).toHaveBeenCalledTimes(1);
  });

  it("warns when cache clearing has no active kernel", async () => {
    const notifications = [];
    lumine.notifications.onDidAddNotification((notification) => notifications.push(notification));
    mainModule.consumeJupyterKernel({ getActiveKernel: () => null });

    await mainModule.cdbClear();

    expect(notifications.at(-1).getType()).toBe("warning");
    expect(notifications.at(-1).getMessage()).toContain("No active Jupyter kernel");
  });

  describe("asynchronous revert", () => {
    async function openSource() {
      const sourcePath = path.join(tempDir, "source.txt");
      fs.writeFileSync(sourcePath, "disk one\ndisk two");
      editor = await lumine.workspace.open(sourcePath);
      editorElement = lumine.views.getView(editor);
      editor.setText("unsaved one\nunsaved two");
      editor.setCursorBufferPosition([1, 2]);
      return editor.getPath();
    }

    function deferred() {
      let resolve, reject;
      const promise = new Promise((finish, fail) => {
        resolve = finish;
        reject = fail;
      });
      return { promise, resolve, reject };
    }

    function delayRead(sourcePath, ...responses) {
      const original = fs.promises.readFile;
      return spyOn(fs.promises, "readFile").and.callFake((filePath, ...options) =>
        filePath === sourcePath
          ? responses.shift().promise
          : original.call(fs.promises, filePath, ...options),
      );
    }

    it("deliberately reverts existing unsaved text and retains its normal undo step", async () => {
      await openSource();
      editor.getBuffer().clearUndoStack();

      await expectAsync(mainModule.revertBuffer({ target: editorElement })).toBeResolvedTo(
        undefined,
      );

      expect(editor.getText()).toBe("disk one\ndisk two");
      expect(editor.getCursorBufferPosition()).toEqual([1, 2]);
      editor.undo();
      expect(editor.getText()).toBe("unsaved one\nunsaved two");
    });

    it("does not apply the old file's data after the editor changes path", async () => {
      const sourcePath = await openSource();
      const response = deferred();
      delayRead(sourcePath, response);
      const pending = mainModule.revertBuffer({ target: editorElement });
      const targetPath = path.join(tempDir, "new-target.txt");
      fs.writeFileSync(targetPath, "new target on disk");
      editor.getBuffer().setPath(targetPath);
      editor.setText("edits in the new target");
      response.resolve("old file data");
      await pending;

      expect(editor.getPath()).toBe(targetPath);
      expect(editor.getText()).toBe("edits in the new target");
    });

    it("preserves edits made after the revert request starts", async () => {
      const sourcePath = await openSource();
      const response = deferred();
      delayRead(sourcePath, response);
      const pending = mainModule.revertBuffer({ target: editorElement });
      editor.insertText("later edits");
      const updated = editor.getText();
      response.resolve("old file data");
      await pending;

      expect(editor.getText()).toBe(updated);
    });

    it("discards a revert after its package generation deactivates", async () => {
      const sourcePath = await openSource();
      const response = deferred();
      delayRead(sourcePath, response);
      const pending = mainModule.revertBuffer({ target: editorElement });
      await lumine.packages.deactivatePackage("bacadra-tools");
      response.resolve("old file data");
      await pending;

      expect(editor.getText()).toBe("unsaved one\nunsaved two");
    });

    it("ignores a read that completes after the editor is destroyed", async () => {
      const sourcePath = await openSource();
      const response = deferred();
      delayRead(sourcePath, response);
      const error = spyOn(lumine.notifications, "addError");
      const pending = mainModule.revertBuffer({ target: editorElement });
      editor.destroy();
      response.resolve("old file data");
      await expectAsync(pending).toBeResolved();

      expect(error).not.toHaveBeenCalled();
    });

    it("keeps the newest revert when two reads finish in reverse order", async () => {
      const sourcePath = await openSource();
      const older = deferred();
      const newer = deferred();
      delayRead(sourcePath, older, newer);
      const first = mainModule.revertBuffer({ target: editorElement });
      const second = mainModule.revertBuffer({ target: editorElement });
      newer.resolve("newest disk one\nnewest disk two");
      await second;
      older.resolve("older disk text");
      await first;

      expect(editor.getText()).toBe("newest disk one\nnewest disk two");
    });

    it("shares latest-request ownership between two editors of the same buffer", async () => {
      const sourcePath = await openSource();
      const copy = editor.copy();
      expect(copy.getBuffer()).toBe(editor.getBuffer());
      lumine.workspace.getActivePane().addItem(copy);
      const copyElement = lumine.views.getView(copy);
      expect(mainModule.editorForEvent({ target: copyElement })).toBe(copy);
      const older = deferred();
      const newer = deferred();
      delayRead(sourcePath, older, newer);
      try {
        const first = mainModule.revertBuffer({ target: editorElement });
        const second = mainModule.revertBuffer({ target: copyElement });
        newer.resolve(editor.getText());
        await second;
        older.resolve("older shared-buffer data");
        await first;

        expect(editor.getText()).toBe("unsaved one\nunsaved two");
        expect(copy.getText()).toBe("unsaved one\nunsaved two");
      } finally {
        copy.destroy();
      }
    });

    it("suppresses an obsolete read error after the target path changes", async () => {
      const sourcePath = await openSource();
      const response = deferred();
      delayRead(sourcePath, response);
      const error = spyOn(lumine.notifications, "addError");
      const pending = mainModule.revertBuffer({ target: editorElement });
      editor.getBuffer().setPath(path.join(tempDir, "changed.txt"));
      response.reject(new Error("Old target disappeared"));
      await pending;

      expect(error).not.toHaveBeenCalled();
    });

    it("preserves a cursor and text changed reentrantly by the revert write", async () => {
      const sourcePath = await openSource();
      const response = deferred();
      delayRead(sourcePath, response);
      const pending = mainModule.revertBuffer({ target: editorElement });
      const subscription = editor.onDidChange(() => {
        if (editor.getText() !== "incoming disk data") return;
        editor.setText("replacement written reentrantly");
        editor.setCursorBufferPosition([0, 1]);
      });
      try {
        response.resolve("incoming disk data");
        await pending;
        expect(editor.getText()).toBe("replacement written reentrantly");
        expect(editor.getCursorBufferPosition()).toEqual([0, 1]);
      } finally {
        subscription.dispose();
      }
    });

    it("still reports a failure for the current revert target", async () => {
      const sourcePath = await openSource();
      const response = deferred();
      delayRead(sourcePath, response);
      const error = spyOn(lumine.notifications, "addError");
      const pending = mainModule.revertBuffer({ target: editorElement });
      response.reject(new Error("Permission denied"));
      await pending;

      expect(error).toHaveBeenCalledWith("Failed to revert the file from disk", {
        detail: "Permission denied",
      });
    });
  });
});
