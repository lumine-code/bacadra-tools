const fs = require("node:fs");
const path = require("node:path");
const assert = require("node:assert/strict");

const packages = JSON.parse(fs.readFileSync(0, "utf8"));
const included = new Set(packages[0].files.map((file) => file.path));
const keymaps = fs.readdirSync(path.join(__dirname, "../keymaps"));
assert.ok(keymaps.length > 0, "The declared keyboard shortcuts must exist");
for (const file of keymaps) {
  assert.ok(included.has(`keymaps/${file}`), `The real package payload omits keymaps/${file}`);
}
console.log(`Verified ${keymaps.length} keymap asset in the real npm pack payload`);
