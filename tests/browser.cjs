const { test, before, after } = require("node:test");
const assert = require("node:assert/strict");
const { chromium } = require("playwright");
const path = require("node:path");
const root = path.resolve(__dirname, "..");
let browser;
before(async () => { browser = await chromium.launch(); });
after(async () => { await browser?.close(); });

async function fixture(t, html, suffix = "") {
  const page = await browser.newPage();
  t.after(() => page.close());
  await page.route("https://www.linkedin.com/**", (route) => route.fulfill({
    contentType: "text/html", body: `<meta charset="utf-8"><style>.visually-hidden { position:absolute;clip:rect(0,0,0,0) }</style>${html}`
  }));
  await page.goto(`https://www.linkedin.com/in/jordan/${suffix}`);
  await page.evaluate(() => {
    window.chrome = { runtime: { onMessage: { addListener(fn) { window.onExtensionMessage = fn; } },
      sendMessage: async () => ({ ok: true }) } };
    const nativeTimeout = window.setTimeout;
    window.fixtureDelay = nativeTimeout;
    window.setTimeout = (fn, ms) => nativeTimeout(fn, Math.min(ms, 5));
  });
  for (const file of ["src/shared/config.js", "src/shared/formatter.js", "src/content/profileExtractor.js"]) {
    await page.addScriptTag({ path: path.join(root, file) });
  }
  return page;
}
const extract = (page, request) => page.evaluate((request) => new Promise((resolve) => {
  window.onExtensionMessage(request, {}, resolve);
}), request);

const header = `<section><h1>Jordan Lee</h1><div class="text-body-medium break-words">Engineer</div>
  <span class="text-body-small t-black--light break-words">London</span></section>`;

test("copies expanded descriptions without the search UI, own preview, or duplicate text", async (t) => {
  const page = await fixture(t, `<nav><button onclick="window.badClick=true">More</button></nav>
    <aside><h1>My own profile</h1><section><div id="about"></div>My own summary</section></aside>
    <main><aside><h1>Another preview</h1></aside>${header}
      <section><div id="about"></div><h2>About</h2>
        <div class="inline-show-more-text"><span aria-hidden="true">Visible summary</span>
          <span class="visually-hidden">Visible summary</span><p hidden id="expanded">Previously hidden description</p>
          <button class="inline-show-more-text__button" aria-expanded="false"
            onclick="document.querySelector('#expanded').hidden=false;this.setAttribute('aria-expanded','true')">…see more</button></div>
        <button onclick="window.badClick=true">More</button><div role="dialog">Search suggestions</div>
      </section><section><div id="experience"></div><h2>Experience</h2><p>Role at Company</p>
        <a href="/in/jordan/details/experience/?tracking=abc">Show all 3 experiences</a>
        <a href="/in/me/details/experience/">Other profile</a>
      </section></main><footer>Unrelated footer</footer>`);
  const result = await extract(page, { type: "EXTRACT_BASE_PROFILE", settings: {} });
  assert.equal(result.ok, true);
  assert.equal(result.profile.header.name, "Jordan Lee");
  assert.equal(result.profile.sections.about, "Visible summary\nPreviously hidden description");
  assert.equal(result.profile.detailUrls.experience, "https://www.linkedin.com/in/jordan/details/experience/");
  assert.equal(await page.evaluate(() => !!window.badClick), false);
});

test("does not guess missing headline or location from nearby controls", async (t) => {
  const page = await fixture(t, "<main><section><h1>Jordan Lee</h1><p>Open to work</p><p>500+ connections</p></section></main>");
  const result = await extract(page, { type: "EXTRACT_BASE_PROFILE" });
  assert.deepEqual(result.profile.header, { name: "Jordan Lee", headline: "", location: "" });
});

test("rejects a missing detail list instead of copying the whole page", async (t) => {
  const page = await fixture(t, "<main><h1>My own profile preview</h1><p>Search suggestions</p></main>", "details/education/");
  const result = await extract(page, { type: "EXTRACT_DETAIL_SECTION", sectionKey: "education" });
  assert.equal(result.ok, false);
  assert.match(result.error, /not loaded/);
});

test("loads more detail entries and expands their descriptions without clicking other menus", async (t) => {
  const page = await fixture(t, `<main><h1>Experience</h1><div class="pvs-list__container">
    <div>Engineer</div><p hidden id="long-role">Complete role description</p>
    <button class="inline-show-more-text__button" onclick="document.querySelector('#long-role').hidden=false;this.remove()">Show more</button>
    <div class="pvs-list__footer-wrapper"><button onclick="this.parentElement.insertAdjacentHTML('beforebegin','<p>Earlier role</p>');this.remove()">Show more results</button></div>
    <button onclick="window.badClick=true">More</button>
    </div><aside>My own profile preview</aside></main>`, "details/experience/");
  const result = await extract(page, { type: "EXTRACT_DETAIL_SECTION", sectionKey: "experience" });
  assert.equal(result.ok, true);
  assert.match(result.text, /Complete role description/);
  assert.match(result.text, /Earlier role/);
  assert.doesNotMatch(result.text, /preview|Show more/);
  assert.equal(result.incomplete, false);
  assert.equal(await page.evaluate(() => !!window.badClick), false);
});

test("does not extract a different detail section or expand disabled sections", async (t) => {
  const page = await fixture(t, `<main>${header}<section><div id="about"></div><h2>About</h2>
    <button class="inline-show-more-text__button" onclick="window.badClick=true">See more</button></section></main>`);
  const base = await extract(page, { type: "EXTRACT_BASE_PROFILE", settings: { sections: { about: false } } });
  assert.equal(base.profile.sections.about, undefined);
  assert.equal(await page.evaluate(() => !!window.badClick), false);
  const detail = await extract(page, { type: "EXTRACT_DETAIL_SECTION", sectionKey: "skills" });
  assert.equal(detail.ok, false);
});


async function popupFixture(t, options = {}) {
  const page = await browser.newPage({ viewport: { width: 378, height: 600 } });
  t.after(() => page.close());
  await page.addInitScript((options) => {
    window.requests = [];
    window.settingsWrites = [];
    window.storageListeners = [];
    window.chrome = {
      tabs: { query: async () => [{ id: 1, url: options.url || "https://www.linkedin.com/in/jordan/" }] },
      storage: {
        sync: {
          get: async () => { if (options.loadFails) throw new Error("Storage unavailable"); return options.settings || {}; },
          set: async (value) => { if (options.saveFails) throw new Error("Storage unavailable"); window.settingsWrites.push(value); }
        },
        session: { get: async (key) => ({ [key]: { status: "running", statusText: "Reading profile…" } }) },
        onChanged: { addListener: (fn) => window.storageListeners.push(fn) }
      },
      runtime: { sendMessage: async (message) => {
        window.requests.push(message);
        if (message.type === "CLEAR_CAPTURE_JOB") window.storageListeners.forEach((fn) => fn({ "profile-copy-job:job": {} }, "session"));
        return { ok: true, jobId: "job" };
      } }
    };
  }, options);
  await page.goto(require("node:url").pathToFileURL(path.join(root, "src/popup/popup.html")).href);
  return page;
}

test("icon auto-start runs once and leaves settings reachable and editable", async (t) => {
  const page = await popupFixture(t, { settings: { startOnOpen: true } });
  await page.waitForFunction(() => window.requests.length === 1);
  await page.getByRole("tab", { name: "Settings", exact: true }).click();
  const autoStart = page.getByRole("checkbox", { name: "Start when icon is clicked" });
  assert.equal(await autoStart.isChecked(), true);
  await autoStart.uncheck();
  await page.waitForFunction(() => window.settingsWrites.length === 1);
  assert.equal(await page.evaluate(() => window.settingsWrites[0].startOnOpen), false);
  assert.equal(await page.evaluate(() => window.requests.length), 1);
  assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= 378), true);
});

test("non-profile pages never auto-start and still allow settings changes", async (t) => {
  const page = await popupFixture(t, { url: "https://www.linkedin.com/feed/", settings: { startOnOpen: true } });
  await page.waitForSelector("#selection-summary:not(:empty)");
  assert.equal(await page.locator("[data-copy-mode]").isDisabled(), true);
  assert.equal(await page.evaluate(() => window.requests.length), 0);
  await page.getByRole("tab", { name: "Settings", exact: true }).click();
  assert.equal(await page.getByRole("checkbox", { name: "Start when icon is clicked" }).isEnabled(), true);
});

test("manual copy, cancellation, and keyboard navigation work", async (t) => {
  const page = await popupFixture(t);
  await page.getByRole("button", { name: "Copy profile", exact: true }).click();
  await page.getByRole("button", { name: "Cancel copy" }).click();
  assert.equal(await page.getByRole("button", { name: "Copy profile", exact: true }).isEnabled(), true);
  assert.equal(await page.evaluate(() => window.requests.filter((m) => m.type === "CLEAR_CAPTURE_JOB").length), 1);
  await page.getByRole("tab", { name: "Copy", exact: true }).focus();
  await page.keyboard.press("ArrowRight");
  assert.equal(await page.locator("#settings-tab").getAttribute("aria-selected"), "true");
});

test("settings load failure never starts a copy with defaults", async (t) => {
  const page = await popupFixture(t, { loadFails: true });
  await page.waitForSelector("#popup-status.is-error");
  assert.equal(await page.locator("[data-copy-mode]").isDisabled(), true);
  assert.equal(await page.evaluate(() => window.requests.length), 0);
});

test("settings save errors are shown and an empty selection cannot start copying", async (t) => {
  const page = await popupFixture(t, { saveFails: true });
  await page.getByRole("tab", { name: "Settings", exact: true }).click();
  await page.getByRole("checkbox", { name: "Start when icon is clicked" }).check();
  await page.waitForSelector("#saved-status.is-error");
  assert.match(await page.locator("#saved-status").innerText(), /Could not save/);
  for (const box of await page.locator("[data-section]").all()) await box.uncheck();
  await page.getByRole("tab", { name: "Copy", exact: true }).click();
  assert.equal(await page.locator("[data-copy-mode]").isDisabled(), true);
});


test("waits for pending pagination and ignores a title-only detail card", async (t) => {
  const page = await fixture(t, `<main><section><h1>Experience</h1></section>
    <aside><div class="pvs-list__container">My own profile preview</div></aside>
    <div class="pvs-list__container"><p>First role</p>
      <div class="pvs-list__footer-wrapper"><button onclick="this.disabled=true;fixtureDelay(() => {
        this.parentElement.insertAdjacentHTML('beforebegin','<p>Delayed role</p>');this.remove()
      }, 60)">Show more results</button></div>
    </div></main>`, "details/experience/");
  const result = await extract(page, { type: "EXTRACT_DETAIL_SECTION", sectionKey: "experience" });
  assert.equal(result.ok, true);
  assert.match(result.text, /Delayed role/);
  assert.doesNotMatch(result.text, /My own profile preview/);
});


test("reads the supplied SDUI structure and expands only description controls", async (t) => {
  const html = require("node:fs").readFileSync(path.join(__dirname, "fixtures/profile-sdui.html"), "utf8");
  const page = await fixture(t, html);
  const result = await extract(page, { type: "EXTRACT_BASE_PROFILE", settings: {} });
  assert.equal(result.ok, true);
  assert.deepEqual(result.profile.header, {
    name: "Jordan Lee", headline: "Chief Executive Officer", location: "London, United Kingdom"
  });
  assert.equal(result.profile.sections.about, "A full profile summary, including its final sentence.");
  assert.match(result.profile.sections.experience, /Full role description.\nIts final line./);
  assert.match(result.profile.sections.experience, /Assistant General Manager/);
  assert.match(result.profile.sections.education, /Bachelor of Science - BS, Business Administration/);
  assert.equal(result.profile.sections.skills, undefined);
  assert.deepEqual(result.profile.detailUrls, { experience: "https://www.linkedin.com/in/jordan/details/experience/" });
  assert.doesNotMatch(JSON.stringify(result.profile), /preview|Unrelated|more|Contact info/);
  assert.equal(await page.evaluate(() => window.expanded), 1);
  assert.equal(await page.evaluate(() => !!window.badClick), false);
});

test("does not use another person's verified heading as the current profile", async (t) => {
  const page = await fixture(t, `<main><section aria-label="Primary content"><section>
    <a href="/in/someone-else/" componentkey="ProfileVerificationTriggerRef-someone-else"><h2>Someone else</h2></a>
  </section></section></main>`);
  const result = await extract(page, { type: "EXTRACT_BASE_PROFILE" });
  assert.equal(result.ok, false);
});


test("reads SDUI profiles without a verification link and omits skill noise", async (t) => {
  const html = require("node:fs").readFileSync(path.join(__dirname, "fixtures/profile-sdui-unverified.html"), "utf8");
  const page = await fixture(t, html);
  const result = await extract(page, { type: "EXTRACT_BASE_PROFILE" });
  assert.equal(result.ok, true);
  assert.deepEqual(result.profile.header, {
    name: "Jordan Lee", headline: "Marketing & Promotions Leader", location: "London, United Kingdom"
  });
  assert.equal(result.profile.sections.about, "Full summary.\nFinal summary line.");
  assert.match(result.profile.sections.experience, /Full role description.\nFinal role line./);
  assert.match(result.profile.sections.education, /Example University/);
  assert.equal(result.profile.sections.skills, undefined);
  assert.doesNotMatch(JSON.stringify(result.profile), /Marketing and \+2 skills|Sales & Marketing|Forecasting/);
  assert.deepEqual(result.profile.detailUrls, {
    experience: "https://www.linkedin.com/in/jordan/details/experience/"
  });
  assert.doesNotMatch(JSON.stringify(result.profile), /preview|activity|recommendation|Contact info|She\/Her|helped me get this job/);
  assert.equal(await page.evaluate(() => window.expanded), 1);
  assert.equal(await page.evaluate(() => !!window.badClick), false);
});

test("finds counted section headings without copying the heading", async (t) => {
  const page = await fixture(t, `<main>${header}<section><h2>Education (2)</h2><p>Example University</p>
    <a href="/in/jordan/details/education/">Show all</a></section></main>`);
  const result = await extract(page, { type: "EXTRACT_BASE_PROFILE" });
  assert.equal(result.profile.sections.education, "Example University");
  assert.equal(result.profile.detailUrls.education, "https://www.linkedin.com/in/jordan/details/education/");
});

test("rejects another person's unverified top card", async (t) => {
  const page = await fixture(t, `<main><section aria-label="Primary content">
    <section componentkey="com.linkedin.sdui.profile.card.refOTHERTopcard">
      <a href="/in/someone-else/" componentkey="topcard-logo-image-referencekey"></a><h2>Someone else</h2>
    </section></section></main>`);
  const result = await extract(page, { type: "EXTRACT_BASE_PROFILE" });
  assert.equal(result.ok, false);
});


test("spaces out description clicks and never clicks the same detail expander twice", async (t) => {
  const page = await fixture(t, `<main><h1>Experience</h1><div class="pvs-list__container"><p>Engineer</p>
    <button class="inline-show-more-text__button" onclick="window.actions.push('first')">See more</button>
    <button class="inline-show-more-text__button" onclick="window.actions.push('second')">See more</button>
    <div class="pvs-list__footer-wrapper"><button onclick="window.actions.push('load');this.remove()">Show more results</button></div>
    </div></main>`, "details/experience/");
  await page.evaluate(() => {
    window.actions = [];
    const timeout = window.setTimeout;
    window.setTimeout = (fn, ms) => { window.actions.push(ms); return timeout(fn, ms); };
  });
  const result = await extract(page, { type: "EXTRACT_DETAIL_SECTION", sectionKey: "experience" });
  assert.equal(result.ok, true);
  assert.equal(result.incomplete, false);
  const actions = await page.evaluate(() => window.actions);
  assert.deepEqual(actions.filter((action) => typeof action === "string"), ["first", "second", "load"]);
  assert.ok(actions[1] >= 250 && actions[1] <= 500);
  assert.ok(actions[3] >= 250 && actions[3] <= 500);
  assert.ok(actions[5] >= 800 && actions[5] <= 1400);
});

test("cancelling during an expansion delay stops further profile clicks", async (t) => {
  const page = await fixture(t, `<main>${header}<section><h2>About</h2>
    <button class="inline-show-more-text__button" onclick="window.actions.push('first')">See more</button>
    <button class="inline-show-more-text__button" onclick="window.actions.push('second')">See more</button>
    </section><section><h2>Experience</h2>
    <button class="inline-show-more-text__button" onclick="window.actions.push('third')">See more</button></section></main>`);
  await extract(page, { type: "SHOW_CAPTURE_PANEL", job: { id: "cancel-test", status: "running" } });
  await page.evaluate(() => {
    window.actions = [];
    const timeout = window.setTimeout;
    window.setTimeout = (fn, ms) => {
      if (ms >= 250) document.querySelector('.lpc-close').click();
      return timeout(fn, ms);
    };
  });
  const result = await extract(page, { type: "EXTRACT_BASE_PROFILE" });
  assert.equal(result.ok, false);
  assert.match(result.error, /cancelled/);
  assert.deepEqual(await page.evaluate(() => window.actions), ["first"]);
});


test("removed sections are neither extracted nor expanded", async (t) => {
  const removed = ["skills", "certifications", "projects", "languages"];
  const page = await fixture(t, `<main>${header}<section><h2>About</h2><p>Full summary</p></section>
    ${removed.map((key) => `<section><div id="${key}"></div><p>Unwanted ${key} content</p>
      <button class="inline-show-more-text__button" onclick="window.badClick=true">See more</button>
      <a href="/in/jordan/details/${key}/">Show all</a></section>`).join("")}</main>`);
  const result = await extract(page, { type: "EXTRACT_BASE_PROFILE", settings: {
    sections: Object.fromEntries(removed.map((key) => [key, true]))
  } });
  assert.deepEqual(result.profile.sections, { about: "Full summary", experience: "", education: "" });
  assert.deepEqual(result.profile.detailUrls, {});
  assert.equal(await page.evaluate(() => !!window.badClick), false);
});

test("settings show only four sections and preserve retained preferences", async (t) => {
  const page = await popupFixture(t, { settings: { sections: {
    about: false, skills: true, certifications: true, projects: true, languages: true
  } } });
  await page.getByRole("tab", { name: "Settings", exact: true }).click();
  assert.deepEqual(await page.locator("[data-section]").evaluateAll((inputs) => inputs.map((input) => input.dataset.section)),
    ["header", "about", "experience", "education"]);
  assert.equal(await page.getByRole("checkbox", { name: "Include About", exact: true }).isChecked(), false);
  await page.getByRole("tab", { name: "Copy", exact: true }).click();
  assert.match(await page.locator("#selection-summary").innerText(), /^3 sections/);
  await page.getByRole("button", { name: "Copy profile", exact: true }).click();
  assert.deepEqual(await page.evaluate(() => window.requests[0].settings.sections),
    { header: true, about: false, experience: true, education: true });
});

test("detail pages omit role skill lists while keeping full descriptions about skills", async (t) => {
  const page = await fixture(t, `<main><h1>Experience</h1><div class="pvs-list__container">
    <p>Engineering Manager</p><p>Developed leadership skills across the team.</p>
    <p><strong>Skills:</strong> Planning · Coaching</p>
    <p><a href="/in/jordan/overlay/123/skill-associations-details/?tracking=abc">Planning and +2 skills</a></p>
    <p hidden id="expanded">Used these skills to mentor new engineers.</p>
    <button class="inline-show-more-text__button" onclick="document.querySelector('#expanded').hidden=false;this.remove()">See more</button>
    </div></main>`, "details/experience/");
  const result = await extract(page, { type: "EXTRACT_DETAIL_SECTION", sectionKey: "experience" });
  assert.equal(result.ok, true);
  assert.equal(result.text, "Engineering Manager\nDeveloped leadership skills across the team.\nUsed these skills to mentor new engineers.");
});

test("education details retain expanded descriptions and load additional schools", async (t) => {
  const page = await fixture(t, `<main><h1>Education</h1><div class="pvs-list__container">
    <p>Example University</p><p>Master of Science</p><p>2018–2020</p>
    <p><span data-testid="expandable-text-box">Thesis and research summary.<span hidden id="full-education"> Advanced research skills.</span><button data-testid="expandable-text-button" onclick="document.querySelector('#full-education').hidden=false;this.remove()">… more</button></span></p>
    <div class="pvs-list__footer-wrapper"><button onclick="this.parentElement.insertAdjacentHTML('beforebegin','<p>Earlier College</p><p>Bachelor of Science</p><p>2014–2018</p>');this.remove()">Show more results</button></div>
    </div><aside>Unrelated school recommendation</aside></main>`, "details/education/");
  const result = await extract(page, { type: "EXTRACT_DETAIL_SECTION", sectionKey: "education" });
  assert.equal(result.ok, true);
  assert.equal(result.incomplete, false);
  assert.match(result.text, /Thesis and research summary. Advanced research skills./);
  assert.match(result.text, /Earlier College\nBachelor of Science\n2014–2018/);
  assert.doesNotMatch(result.text, /Unrelated|Show more/);
});


test("expands long experience descriptions on the main profile without a Show all link", async (t) => {
  const page = await fixture(t, `<main>${header}<section><div id="experience"></div><h2>Experience</h2>
    <p>Example Company</p><ul><li><p>Engineering Manager</p>
      <p><span data-testid="expandable-text-box">Led the engineering team.<span hidden id="full-role"> Mentored engineers and delivered the full programme.</span><button data-testid="expandable-text-button" onclick="document.querySelector('#full-role').hidden=false;this.remove()">… more</button></span></p>
    </li><li><p>Senior Engineer</p><p>Built the original platform.</p></li></ul>
    <button onclick="window.badClick=true">More</button></section></main>`);
  const result = await extract(page, { type: "EXTRACT_BASE_PROFILE" });
  assert.equal(result.ok, true);
  assert.match(result.profile.sections.experience, /Led the engineering team. Mentored engineers and delivered the full programme./);
  assert.match(result.profile.sections.experience, /Senior Engineer\nBuilt the original platform./);
  assert.deepEqual(result.profile.detailUrls, {});
  assert.equal(await page.evaluate(() => !!window.badClick), false);
});


test("reads the supplied SDUI Experience detail layout without heading tags or expand buttons", async (t) => {
  const html = require("node:fs").readFileSync(path.join(__dirname, "fixtures/experience-sdui.html"), "utf8");
  const page = await fixture(t, html, "details/experience/");
  const result = await extract(page, { type: "EXTRACT_DETAIL_SECTION", sectionKey: "experience" });
  assert.equal(result.ok, true);
  assert.equal(result.incomplete, false);
  assert.equal(result.text, ["Engineering Manager", "Example Company · Full-time", "2020 - Present",
    "Complete role description.", "Its final sentence.", "Earlier Company", "5 years", "Senior Engineer",
    "2017 - 2020", "Full earlier description.", "Used research skills to deliver the project.", "Engineer", "2015 - 2017"].join("\n"));
  assert.equal(await page.evaluate(() => !!window.badClick), false);
});

test("waits for the matching SDUI detail card and ignores other section containers", async (t) => {
  const page = await fixture(t, `<main><div componentkey="com.linkedin.sdui.profile.card.refPERSONExperienceDetailsSection">
    <p>Wrong section role</p></div><div id="delayed"></div></main>`, "details/education/");
  await page.evaluate(() => fixtureDelay(() => {
    document.querySelector('#delayed').outerHTML = '<div componentkey="com.linkedin.sdui.profile.card.refPERSONEducationDetailsSection"><p>Education</p><p>Example University</p><p>Full qualification</p></div>';
  }, 50));
  const result = await extract(page, { type: "EXTRACT_DETAIL_SECTION", sectionKey: "education" });
  assert.equal(result.ok, true);
  assert.equal(result.incomplete, false);
  assert.equal(result.text, "Example University\nFull qualification");
});


test("defers linked-section expansion and can expand just that section on fallback", async (t) => {
  const page = await fixture(t, `<main>${header}
    <section><h2>About</h2><p hidden id="summary">Full summary</p><button class="inline-show-more-text__button" onclick="document.querySelector('#summary').hidden=false;this.remove()">See more</button></section>
    <section><h2>Experience</h2><p>Engineer</p><p hidden id="role-description">Full role description</p>
      <button class="inline-show-more-text__button" onclick="document.querySelector('#role-description').hidden=false;this.remove()">See more</button>
      <a href="/in/jordan/details/experience/">Show all</a></section>
    <section><h2>Education</h2><p hidden id="qualification">Full qualification</p><button class="inline-show-more-text__button" onclick="document.querySelector('#qualification').hidden=false;this.remove()">See more</button></section></main>`);
  const base = await extract(page, { type: "EXTRACT_BASE_PROFILE" });
  assert.equal(base.profile.sections.about, "Full summary");
  assert.equal(base.profile.sections.experience, "Engineer");
  assert.equal(base.profile.sections.education, "Full qualification");
  assert.equal(await page.locator('#role-description').isVisible(), false);
  assert.equal(base.profile.detailUrls.experience, "https://www.linkedin.com/in/jordan/details/experience/");
  const fallback = await extract(page, { type: "EXTRACT_BASE_PROFILE", expandLinkedSections: true,
    settings: { sections: { header: false, about: false, experience: true, education: false } } });
  assert.deepEqual(fallback.profile.sections, { experience: "Engineer\nFull role description" });
  assert.equal(await page.locator('#role-description').isVisible(), true);
});

test("an unrelated Show all link cannot suppress main-profile expansion", async (t) => {
  const page = await fixture(t, `<main>${header}<section><h2>Experience</h2><p>Engineer</p>
    <p hidden id="full-role">Full description</p><button class="inline-show-more-text__button" onclick="document.querySelector('#full-role').hidden=false;this.remove()">See more</button>
    <a href="/in/someone-else/details/experience/">Show all</a></section></main>`);
  const result = await extract(page, { type: "EXTRACT_BASE_PROFILE" });
  assert.equal(result.profile.sections.experience, "Engineer\nFull description");
  assert.deepEqual(result.profile.detailUrls, {});
});
