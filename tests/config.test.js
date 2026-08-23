const test = require("node:test");
const assert = require("node:assert/strict");

const config = require("../src/shared/config.js");

test("automatic copying is opt-in", () => {
  assert.equal(config.defaultSettings.autoCopy, false);
  assert.equal(config.normaliseSettings().autoCopy, false);
  assert.equal(config.normaliseSettings({ autoCopy: true }).autoCopy, true);
});

test("including the profile URL is opt-in", () => {
  assert.equal(config.defaultSettings.includeProfileUrl, false);
  assert.equal(config.normaliseSettings().includeProfileUrl, false);
  assert.equal(config.normaliseSettings({ includeProfileUrl: true }).includeProfileUrl, true);
});
