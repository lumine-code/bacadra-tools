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
  function pendingExecution() {
    let finish;
    const handle = {
      generation: 0,
      done: new Promise((resolve) => (finish = resolve)),
      dispose: jasmine.createSpy("dispose request").and.callFake(() => {
        finish({ status: "cancelled" });
      }),
    };
    const session = {
      generation: 0,
      isDestroyed: () => false,
      request: jasmine.createSpy("session request").and.returnValue(handle),
    };
    return { session, handle, finish };
  }
  for (const [name, method, marker] of [
    ["tree-view.selection", "selectedPaths", ["owned-selection"]],
    [
      "jupyter.kernel",
      "getActiveKernel",
      {
        generation: 0,
        isDestroyed: () => false,
        request: jasmine.createSpy("inert session request").and.returnValue({
          generation: 0,
          done: Promise.resolve({ status: "ok" }),
          dispose: jasmine.createSpy("dispose inert request"),
        }),
      },
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
    const { session } = pendingExecution();
    provide("jupyter.kernel", { getActiveKernel: () => session });

    release();
    await clearing;

    expect(session.request).not.toHaveBeenCalled();
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

  it("disposes a submitted request without a late notification after deactivation", async () => {
    const { session, handle, finish } = pendingExecution();
    provide("jupyter.kernel", { getActiveKernel: () => session });
    const error = spyOn(lumine.notifications, "addError");
    const success = spyOn(lumine.notifications, "addSuccess");
    const clearing = main.cdbClear();
    await globalThis.conditionPromise(() => session.request.calls.any(), "request submitted");
    await lumine.packages.deactivatePackage("bacadra-tools");

    expect(handle.dispose).toHaveBeenCalledTimes(1);
    finish({ status: "error", error: { ename: "Error", evalue: "Late operation failure" } });
    await clearing;

    expect(error).not.toHaveBeenCalled();
    expect(success).not.toHaveBeenCalled();
    expect(handle.dispose).toHaveBeenCalledTimes(1);
  });

  it("disposes a pending request when its final provider lease is revoked", async () => {
    const { session, handle, finish } = pendingExecution();
    const provider = provide("jupyter.kernel", { getActiveKernel: () => session });
    const error = spyOn(lumine.notifications, "addError");
    const success = spyOn(lumine.notifications, "addSuccess");
    const clearing = main.cdbClear();
    await globalThis.conditionPromise(() => session.request.calls.any(), "request submitted");

    provider.dispose();
    expect(handle.dispose).toHaveBeenCalledTimes(1);
    finish({ status: "ok" });
    await clearing;

    expect(error).not.toHaveBeenCalled();
    expect(success).not.toHaveBeenCalled();
    expect(handle.dispose).toHaveBeenCalledTimes(1);
  });

  it("retains a pending request while a shared provider lease remains", async () => {
    const { session, handle, finish } = pendingExecution();
    const value = { getActiveKernel: () => session };
    const first = provide("jupyter.kernel", value);
    provide("jupyter.kernel", value);
    const success = spyOn(lumine.notifications, "addSuccess");
    const clearing = main.cdbClear();
    await globalThis.conditionPromise(() => session.request.calls.any(), "request submitted");

    first.dispose();
    expect(handle.dispose).not.toHaveBeenCalled();
    finish({ status: "ok" });
    await clearing;

    expect(success).toHaveBeenCalledWith("Cache cleared");
    expect(handle.dispose).toHaveBeenCalledTimes(1);
  });
});
