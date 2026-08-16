const test = require("node:test");
const assert = require("node:assert/strict");

global.chrome = {
  runtime: {
    onMessage: {
      addListener() {}
    }
  }
};

const extractor = require("../src/content/profileExtractor.js");

test("removes common LinkedIn controls and consecutive duplicates", () => {
  const lines = extractor.cleanLines([
    "Experience",
    "Lead Designer",
    "Lead Designer",
    "Show all 5 experiences",
    "Northstar Studio",
    "Company logo"
  ].join("\n"));

  assert.deepEqual(lines, ["Experience", "Lead Designer", "Northstar Studio"]);
});

test("removes a section heading while retaining profile content", () => {
  const text = extractor.cleanSectionText(
    "Experience\nLead Designer\nNorthstar Studio\nShow more",
    "experience"
  );

  assert.equal(text, "Lead Designer\nNorthstar Studio");
});
