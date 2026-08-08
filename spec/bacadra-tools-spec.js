const fs = require("fs");
const os = require("os");
const path = require("path");

describe("bacadra-tools", () => {
  let editor, editorElement, mainModule, tempDir;

  beforeEach(async () => {
    jasmine.attachToDOM(atom.views.getView(atom.workspace));
    editor = await atom.workspace.open("notes.py");
    editorElement = atom.views.getView(editor);
    const activation = atom.packages.activatePackage("bacadra-tools");
    atom.commands.dispatch(editorElement, "bacadra-tools:signer");
    mainModule = (await activation).mainModule;
    editor.setText("");
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "bacadra-tools-"));
  });

  afterEach(async () => {
    await atom.packages.deactivatePackage("bacadra-tools");
    if (tempDir) {
      fs.rmSync(tempDir, { recursive: true, force: true, maxRetries: 10, retryDelay: 50 });
    }
  });

  it("registers its complete command surface on the workspace", () => {
    const commands = atom.commands
      .findCommands({ target: atom.views.getView(atom.workspace) })
      .map(({ name }) => name);

    for (const command of [
      "bacadra-tools:signer",
      "bacadra-tools:generalize-cites",
      "bacadra-tools:create-gitignore",
      "bacadra-tools:open-in-this-window",
      "bacadra-tools:cdb-clear",
    ]) {
      expect(commands).toContain(command);
    }
  });

  it("swaps signs in every selection", () => {
    editor.setText("a + b - c");
    editor.setSelectedBufferRange([
      [0, 2],
      [0, 9],
    ]);

    atom.commands.dispatch(editorElement, "bacadra-tools:signer");

    expect(editor.getText()).toBe("a - b + c");
  });

  it("generalizes national Eurocode citation keys", () => {
    editor.setText("pn-en_1992-1-1:2008 and din-en_1993-1-8:2010-12");

    atom.commands.dispatch(editorElement, "bacadra-tools:generalize-cites");

    expect(editor.getText()).toBe(":@en_1992-1-1: and :@en_1993-1-8:");
  });

  it("collapses runs of blank lines", () => {
    editor.setText("one\n\n\n\n\ntwo\n");

    atom.commands.dispatch(editorElement, "bacadra-tools:normalize-newlines");

    expect(editor.getText()).toBe("one\n\ntwo\n");
  });

  it("replaces the project through the tree-view selection service", async () => {
    const otherDir = fs.mkdtempSync(path.join(tempDir, "project-"));
    mainModule.consumeTreeViewSelection({ selectedPaths: () => [otherDir] });
    spyOn(atom.project, "setState").and.returnValue(Promise.resolve(true));

    expect(await mainModule.openInThisWindow()).toBe(true);
    expect(atom.project.setState).toHaveBeenCalledWith([otherDir]);
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
    atom.notifications.onDidAddNotification((notification) => notifications.push(notification));
    mainModule.consumeJupyterKernel({ getActiveKernel: () => null });

    await mainModule.cdbClear();

    expect(notifications.at(-1).getType()).toBe("warning");
    expect(notifications.at(-1).getMessage()).toContain("No active Jupyter kernel");
  });
});
