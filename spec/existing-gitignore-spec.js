const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");

describe("Creating a Bacadra gitignore beside existing project settings", () => {
  let scratch, temporaryRoot, selectedPaths, provider, main;

  beforeEach(async () => {
    for (const operation of ["openExternal", "openPath", "showItemInFolder", "openApplication"]) {
      if (!jasmine.isSpy(lumine.shell[operation])) spyOn(lumine.shell, operation).and.resolveTo();
    }
    if (!jasmine.isSpy(lumine.application.openWindow))
      spyOn(lumine.application, "openWindow").and.resolveTo();
    temporaryRoot = fs.realpathSync.native(os.tmpdir());
    scratch = fs.realpathSync.native(fs.mkdtempSync(path.join(temporaryRoot, "bacadra-ignore-")));
    selectedPaths = [];
    provider = lumine.packages.serviceHub.provide("tree-view.selection", "1.0.0", {
      selectedPaths: () => selectedPaths,
    });
    main = (await lumine.packages.activatePackage("bacadra-tools")).mainModule;
    jasmine.attachToDOM(lumine.workspace.getElement());
  });

  afterEach(async () => {
    provider?.dispose();
    if (lumine.packages.isPackageLoaded("bacadra-tools"))
      await lumine.packages.unloadPackage("bacadra-tools");
    await lumine.fileWatchClient.settlePendingTeardown();
    const relative = path.relative(temporaryRoot, fs.realpathSync.native(scratch));
    if (
      !relative ||
      relative === ".." ||
      relative.startsWith(`..${path.sep}`) ||
      path.isAbsolute(relative)
    )
      throw Error("Gitignore fixture escaped private scratch");
    fs.rmSync(scratch, { recursive: true, force: true, maxRetries: 10, retryDelay: 50 });
  });

  function create() {
    return lumine.commands.dispatch(
      lumine.workspace.getElement(),
      "bacadra-tools:create-gitignore",
    );
  }

  it("preserves an existing custom gitignore and reports its refusal", async () => {
    const ignore = path.join(scratch, ".gitignore");
    fs.writeFileSync(ignore, "# private project rules\nkeep-this-secret.dat\n");
    selectedPaths = [scratch];
    const failure = spyOn(lumine.notifications, "addError");
    await create();
    expect(fs.readFileSync(ignore, "utf8")).toBe("# private project rules\nkeep-this-secret.dat\n");
    expect(failure).toHaveBeenCalledTimes(1);
  });

  it("creates a new sibling template while preserving existing selected project rules", async () => {
    const existing = path.join(scratch, "existing"),
      fresh = path.join(scratch, "fresh");
    fs.mkdirSync(existing);
    fs.mkdirSync(fresh);
    fs.writeFileSync(path.join(existing, ".gitignore"), "custom-project-rule\n");
    selectedPaths = [existing, fresh];
    await create();
    expect(fs.readFileSync(path.join(existing, ".gitignore"), "utf8")).toBe(
      "custom-project-rule\n",
    );
    expect(fs.readFileSync(path.join(fresh, ".gitignore"), "utf8")).toBe(main.GITIGNORE_CONTENT);
  });

  it("creates one ordinary template beside a selected file", async () => {
    const file = path.join(scratch, "model.py");
    fs.writeFileSync(file, "# owned\n");
    selectedPaths = [file, scratch];
    await create();
    expect(fs.readFileSync(path.join(scratch, ".gitignore"), "utf8")).toBe(main.GITIGNORE_CONTENT);
  });
});
