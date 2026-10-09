describe("Bacadra borrowed service ownership", () => {
  let main, hub, consumers, providers;
  beforeEach(async () => {
    jasmine.attachToDOM(lumine.workspace.getElement());
    // No real kernel bootstrap or execution boundary is used in these controls.
    spyOn(lumine.packages, "requestService").and.resolveTo();
    main = (await lumine.packages.activatePackage("bacadra-tools")).mainModule;
    hub = new lumine.packages.serviceHub.constructor();
    consumers = [
      hub.consume("tree-view.selection", "^1.0.0", (value) => main.consumeTreeViewSelection(value)),
      hub.consume("jupyter.kernel", "^1.0.0", (value) => main.consumeJupyterKernel(value)),
    ];
    providers = [];
  });
  afterEach(async () => {
    consumers.forEach((consumer) => consumer.dispose());
    providers.forEach((provider) => provider.dispose());
    await lumine.packages.deactivatePackage("bacadra-tools");
  });
  function provide(name, value) {
    const provider = hub.provide(name, "1.0.0", value);
    providers.push(provider);
    return provider;
  }
  for (const [name, method, marker] of [
    ["tree-view.selection", "selectedPaths", ["owned-selection"]],
    [
      "jupyter.kernel",
      "getActiveKernel",
      { execute: jasmine.createSpy("inert kernel execute").and.resolveTo({ status: "ok" }) },
    ],
  ]) {
    const read = () =>
      name === "tree-view.selection" ? main.selectedTreePaths() : main.getJupyterKernel();
    it(`retains the shared ${name} payload until its final lease ends`, async () => {
      const value = { [method]: () => marker };
      const first = provide(name, value);
      provide(name, value);
      first.dispose();
      expect(await read()).toBe(marker);
    });
    it(`restores the previous live ${name} payload`, async () => {
      provide(name, { [method]: () => marker });
      const latest = provide(name, { [method]: () => null });
      latest.dispose();
      expect(await read()).toBe(marker);
    });
    it(`does not remove current ${name} through an old activation's lease`, async () => {
      const value = { [method]: () => marker };
      const old = provide(name, value);
      await lumine.packages.deactivatePackage("bacadra-tools");
      main = (await lumine.packages.activatePackage("bacadra-tools")).mainModule;
      provide(name, value);
      old.dispose();
      expect(await read()).toBe(marker);
    });
    it(`uses exact live edge order for A-B-A ${name} connections`, async () => {
      const value = { [method]: () => marker };
      const other = { label: "newest distinct but not newest edge" };
      provide(name, value);
      const middle = provide(name, { [method]: () => other });
      const newest = provide(name, value);

      expect(await read()).toBe(marker);
      newest.dispose();
      expect(await read()).toBe(other);
      middle.dispose();
      expect(await read()).toBe(marker);
    });
  }

  it("does not clear a replacement activation's kernel after an older lazy service wait", async () => {
    let release;
    lumine.packages.requestService.and.returnValue(new Promise((resolve) => (release = resolve)));
    const clearing = main.cdbClear();
    expect(lumine.packages.requestService).toHaveBeenCalledWith("jupyter.kernel", "^1.0.0");
    await lumine.packages.deactivatePackage("bacadra-tools");
    main = (await lumine.packages.activatePackage("bacadra-tools")).mainModule;
    const execute = jasmine.createSpy("replacement kernel execute").and.resolveTo({ status: "ok" });
    provide("jupyter.kernel", { getActiveKernel: () => ({ execute }) });

    release();
    await clearing;

    expect(execute).not.toHaveBeenCalled();
  });

  it("does not issue a no-kernel warning after the waiting owner deactivates", async () => {
    let release;
    lumine.packages.requestService.and.returnValue(new Promise((resolve) => (release = resolve)));
    const warning = spyOn(lumine.notifications, "addWarning");
    const clearing = main.cdbClear();
    await lumine.packages.deactivatePackage("bacadra-tools");

    release();
    await clearing;

    expect(warning).not.toHaveBeenCalled();
  });

  it("reports a live lazy-service failure without rejecting the command", async () => {
    lumine.packages.requestService.and.returnValue(
      Promise.reject(new Error("Live bootstrap failure")),
    );
    const error = spyOn(lumine.notifications, "addError");

    await expectAsync(main.cdbClear()).toBeResolved();

    expect(error).toHaveBeenCalledWith("Failed to clear cache", {
      detail: "Live bootstrap failure",
    });
  });

  it("reports a failed kernel operation already submitted before deactivation", async () => {
    let reject;
    const execute = jasmine
      .createSpy("submitted execution")
      .and.returnValue(new Promise((_resolve, fail) => (reject = fail)));
    provide("jupyter.kernel", { getActiveKernel: () => ({ execute }) });
    const error = spyOn(lumine.notifications, "addError");
    const clearing = main.cdbClear();
    await globalThis.conditionPromise(() => execute.calls.any(), "kernel execution submitted");
    await lumine.packages.deactivatePackage("bacadra-tools");

    reject(new Error("Submitted operation failed"));
    await clearing;

    expect(error).toHaveBeenCalledWith("Failed to clear cache", {
      detail: "Submitted operation failed",
    });
  });
});
