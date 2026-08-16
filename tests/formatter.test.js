const test = require("node:test");
const assert = require("node:assert/strict");

const config = require("../src/shared/config.js");
const formatter = require("../src/shared/formatter.js");

const profile = {
  header: {
    name: "Jordan Lee",
    headline: "Product Designer",
    location: "London, United Kingdom"
  },
  sections: {
    about: "I make complex products feel simple.",
    experience: "Lead Product Designer\nNorthstar Studio",
    education: "University of the Arts London",
    skills: "Product design\nUser research",
    certifications: "Human-Centred Design Practitioner",
    projects: "Open Design Toolkit",
    languages: "English\nFrench"
  }
};

test("formats a clean plain-text profile", () => {
  const output = formatter.formatProfile(profile, config.defaultSettings);

  assert.match(output, /^Jordan Lee\nProduct Designer\nLondon, United Kingdom/);
  assert.match(output, /\n\nABOUT\nI make complex products feel simple\./);
  assert.match(output, /\n\nEXPERIENCE\nLead Product Designer/);
  assert.doesNotMatch(output, /^#/m);
});

test("adds Markdown headings and respects disabled sections", () => {
  const output = formatter.formatProfile(profile, {
    sections: {
      ...config.defaultSettings.sections,
      about: false,
      projects: false
    },
    markdown: true
  });

  assert.match(output, /^# Jordan Lee/);
  assert.match(output, /\n\n## Experience\n/);
  assert.doesNotMatch(output, /About/);
  assert.doesNotMatch(output, /Projects/);
});
