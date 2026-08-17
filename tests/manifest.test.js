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
    ...manifest.content_scripts.flatMap(({ js, css = [] }) => [...js, ...css])
  ];

  for (const entryPoint of entryPoints) {
    assert.equal(fs.existsSync(path.join(root, entryPoint)), true, `${entryPoint} should exist`);
  }

  assert.equal(
    fs.existsSync(path.join(root, "src/offscreen/offscreen.html")),
    true,
    "the offscreen clipboard document should exist"
  );
  assert.equal(
    fs.existsSync(path.join(root, "src/offscreen/offscreen.js")),
    true,
    "the offscreen clipboard script should exist"
  );
});

test("allows opt-in background clipboard writes", () => {
  assert.equal(manifest.permissions.includes("clipboardWrite"), true);
  assert.equal(manifest.permissions.includes("offscreen"), true);
});

test("uses one full-copy action without a result tab page", () => {
  const popup = fs.readFileSync(path.join(root, manifest.action.default_popup), "utf8");
  const background = fs.readFileSync(
    path.join(root, manifest.background.service_worker),
    "utf8"
  );

  assert.equal((popup.match(/data-copy-mode=/g) || []).length, 1);
  assert.match(popup, /data-copy-mode="full"/);
  assert.doesNotMatch(background, /src\/result\/result\.html/);
  assert.doesNotMatch(background, /active:\s*true/);
});
