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

test("stops before related profiles and footer content", () => {
  const text = extractor.cleanSectionText([
    "Experience",
    "Regional Director of Store Operations",
    "pOpshelf",
    "Feb 2023 - Present · 3 yrs 7 mos",
    "More profiles for you",
    "Daniel Anticoli",
    "Message",
    "About",
    "Accessibility",
    "Talent Solutions",
    "Select language",
    "English (English)"
  ].join("\n"), "experience");

  assert.equal(text, [
    "Regional Director of Store Operations",
    "pOpshelf",
    "Feb 2023 - Present · 3 yrs 7 mos"
  ].join("\n"));
});

test("recognises a LinkedIn footer even without recommendations", () => {
  const text = extractor.cleanSectionText([
    "Education",
    "West Virginia University",
    "BS, Public Relations",
    "2002 – 2006",
    "About",
    "Accessibility",
    "Careers",
    "LinkedIn Corporation © 2026"
  ].join("\n"), "education");

  assert.equal(text, [
    "West Virginia University",
    "BS, Public Relations",
    "2002 – 2006"
  ].join("\n"));
});
