const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const root = path.resolve(__dirname, "..");
const manifest = JSON.parse(fs.readFileSync(path.join(root, "manifest.json"), "utf8"));

test("uses Manifest V3 and keeps host access limited to LinkedIn", () => {
  assert.equal(manifest.manifest_version, 3);
  assert.deepEqual(manifest.host_permissions, ["https://*.linkedin.com/*"]);
});

test("all manifest entry points exist", () => {
  const entryPoints = [
    manifest.action.default_popup,
    manifest.background.service_worker,
    ...manifest.content_scripts.flatMap(({ js }) => js)
  ];

  for (const entryPoint of entryPoints) {
    assert.equal(fs.existsSync(path.join(root, entryPoint)), true, `${entryPoint} should exist`);
  }
});
