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


test("starting on icon click is opt-in and independent from clipboard copying", () => {
  assert.equal(config.defaultSettings.startOnOpen, false);
  assert.equal(config.normaliseSettings().startOnOpen, false);
  const settings = config.normaliseSettings({ startOnOpen: true });
  assert.equal(settings.startOnOpen, true);
  assert.equal(settings.autoCopy, false);
  assert.equal(config.normaliseSettings({ startOnOpen: "false" }).startOnOpen, false);
});

test("normalises missing and unexpected saved section settings", () => {
  assert.deepEqual(config.normaliseSettings(null).sections, config.defaultSettings.sections);
  const settings = config.normaliseSettings({ sections: { about: false, experience: null, unknown: true } });
  assert.equal(settings.sections.about, false);
  assert.equal(settings.sections.experience, true);
  assert.equal(settings.sections.unknown, undefined);
});
