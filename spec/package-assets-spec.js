const fs = require("fs");
const path = require("path");

describe("bacadra-tools package assets", () => {
  const root = path.join(__dirname, "..");
  const manifest = require("../package.json");

  it("declares Lumine metadata and current service contracts", () => {
    expect(manifest.engines).toEqual({ lumine: "^1.0.0" });
    expect(manifest.author).toBe("lumine-code");
    expect(manifest.consumedServices["tree-view.selection"]).toBeDefined();
    expect(manifest.consumedServices["jupyter.kernel"]).toBeDefined();
    expect(manifest.consumedServices["jupyter.kernel"].activation).toBeUndefined();
    expect(manifest.consumedServices["hydrogen.provider"]).toBeUndefined();
    expect(manifest.consumedServices["scroll-keeper"]).toBeUndefined();
  });

  it("ships JSON integration files instead of CSON", () => {
    for (const relativePath of ["menus/main.json", "snippets/main.json"]) {
      expect(() =>
        JSON.parse(fs.readFileSync(path.join(root, relativePath), "utf8")),
      ).not.toThrow();
    }
    expect(fs.existsSync(path.join(root, "keymaps/bacadra-tools.json"))).toBe(false);
    expect(fs.existsSync(path.join(root, "menus/bacadra-tools.cson"))).toBe(false);
  });
});
