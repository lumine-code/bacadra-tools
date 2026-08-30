const fs = require("fs");
const os = require("os");
const path = require("path");

describe("bacadra-tools", () => {
  let editor, editorElement, mainModule, tempDir;

  beforeEach(async () => {
    jasmine.attachToDOM(lumine.views.getView(lumine.workspace));
    editor = await lumine.workspace.open("notes.py");
    editorElement = lumine.views.getView(editor);
    const activation = lumine.packages.activatePackage("bacadra-tools");
    lumine.commands.dispatch(editorElement, "bacadra-tools:signer");
    mainModule = (await activation).mainModule;
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
  });

  it("generalizes national Eurocode citation keys", () => {
    editor.setText("pn-en_1992-1-1:2008 and din-en_1993-1-8:2010-12");

    lumine.commands.dispatch(editorElement, "bacadra-tools:generalize-cites");

    expect(editor.getText()).toBe(":@en_1992-1-1: and :@en_1993-1-8:");
  });

  it("toggles ligatures in the command target's detached Window", async () => {
    lumine.initializeDetachedPaneSurfaces({ force: true });
    const pane = await lumine.workspace.detachPaneItem(editor, { show: false });
    const surface = lumine.workspace.getWindowSurface(editor);

    try {
      await lumine.commands.dispatch(editorElement, "bacadra-tools:ligatures");
      expect(surface.document.body.style.fontVariantLigatures).toBe("none");
      expect(document.body.style.fontVariantLigatures).toBe("");
    } finally {
      if (pane.isDetached()) await lumine.workspace.attachDetachedPane(pane);
      lumine.initializeDetachedPaneSurfaces();
    }
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
    const execute = jasmine.createSpy("execute").and.returnValue(Promise.resolve({ status: "ok" }));
    mainModule.consumeJupyterKernel({ getActiveKernel: () => ({ execute }) });

    await mainModule.cdbClear();

    expect(execute).toHaveBeenCalledWith("cdb.clear()");
  });

  it("warns when cache clearing has no active kernel", async () => {
    const notifications = [];
    lumine.notifications.onDidAddNotification((notification) => notifications.push(notification));
    mainModule.consumeJupyterKernel({ getActiveKernel: () => null });

    await mainModule.cdbClear();

    expect(notifications.at(-1).getType()).toBe("warning");
    expect(notifications.at(-1).getMessage()).toContain("No active Jupyter kernel");
  });
});
