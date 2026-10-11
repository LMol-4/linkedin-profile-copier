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

// Structure observed on Danielle Jordan, Lisa Kelly and Mark Moynihan in live
// Chrome: UUID section keys, unlinked h2 names, and profile-specific contact URLs.
for (const logo of ["/in/jordan/", "/", null]) test(`recognises UUID top cards with logo ${logo}`, async (t) => {
  const page = await fixture(t, `<main><section aria-label="Primary content">
    <section><h2>Unrelated heading</h2></section>
    <section componentkey="6d596161-e7e7-43c6-a319-e2b4e8e4378d">
      ${logo ? `<a componentkey="topcard-logo-image-referencekey" href="${logo}">Photo</a>` : ""}
      <div><div><h2>Jordan Lee</h2><p>She/Her</p><p>· 1st</p></div>
        <p>Marketing Executive</p><div><p>Ireland</p><p>·</p>
          <p><a href="/in/jordan/overlay/contact-info/">Contact info</a></p></div></div>
    </section></section><aside><h2>Other person</h2></aside></main>`);
  const result = await extract(page, { type: "EXTRACT_BASE_PROFILE" });
  assert.equal(result.ok, true);
  assert.deepEqual(result.profile.header, { name: "Jordan Lee", headline: "Marketing Executive", location: "Ireland" });
});

test("UUID cards belonging to another profile cannot supply the name", async (t) => {
  const page = await fixture(t, `<main><section componentkey="uuid-other">
    <h2>Other Person</h2><a href="/in/other/overlay/contact-info/">Contact info</a>
    <a componentkey="topcard-logo-image-referencekey" href="/in/other/">Photo</a>
    </section><section componentkey="uuid-current"><h2>Jordan Lee</h2>
    <a href="/in/jordan/overlay/contact-info/">Contact info</a></section></main>`);
  const result = await extract(page, { type: "EXTRACT_BASE_PROFILE" });
  assert.equal(result.ok, true);
  assert.equal(result.profile.header.name, "Jordan Lee");
});

test("live SDUI education shape retains all three entries without lists or heading tags", async (t) => {
  const page = await fixture(t, `<main><section aria-label="Primary content">
    <div componentkey="com.linkedin.sdui.profile.card.refPERSONEducationDetailsSection">
      <div data-testid="profile_EducationDetailsSection_jordan" data-component-type="LazyColumn">
        <div style="display:contents"><div><button aria-label="Navigate back to profile main screen"></button><p>Education</p></div></div>
        <div style="display:contents"><div componentkey="uuid-1"><p>University</p><p>MSC, Marketing Management</p><p>Grade: 2:1</p></div></div>
        <div style="display:contents"><div componentkey="uuid-2"><p>University</p><p>Higher Diploma, Business Studies</p><p>Grade: 2:1</p></div></div>
        <div style="display:contents"><div componentkey="uuid-3"><p>University</p><p>Bachelor of Arts</p><p>Grade: 2:1</p></div></div>
      </div></div></section><aside>Other profiles</aside></main>`, "details/education/");
  const result = await extract(page, { type: "EXTRACT_DETAIL_SECTION", sectionKey: "education" });
  assert.equal(result.ok, true);
  assert.equal(result.incomplete, false);
  assert.equal(result.text, "University\nMSC, Marketing Management\nGrade: 2:1\nUniversity\nHigher Diploma, Business Studies\nGrade: 2:1\nUniversity\nBachelor of Arts\nGrade: 2:1");
});

test("waits for a profile name mounted after the document finishes loading", async (t) => {
  const page = await fixture(t, '<main><section id="topcard"></section></main>');
  await page.evaluate(() => fixtureDelay(() => {
    document.querySelector('#topcard').innerHTML = '<h1>Jordan Lee</h1>';
  }, 80));
  const result = await extract(page, { type: "EXTRACT_BASE_PROFILE" });
  assert.equal(result.ok, true);
  assert.equal(result.profile.header.name, "Jordan Lee");
});

test("recognises an SDUI name without requiring a verification or logo link", async (t) => {
  const page = await fixture(t, `<main><section componentkey="com.linkedin.sdui.profile.card.refPERSONTopcard">
    <h2>Jordan Lee</h2></section></main>`);
  const result = await extract(page, { type: "EXTRACT_BASE_PROFILE" });
  assert.equal(result.ok, true);
  assert.equal(result.profile.header.name, "Jordan Lee");
});

test("does not read a different profile that appears during the loading wait", async (t) => {
  const page = await fixture(t, '<main><section id="topcard"></section></main>');
  await page.evaluate(() => fixtureDelay(() => {
    history.pushState({}, "", "/in/someone-else/");
    document.querySelector('#topcard').innerHTML = '<h1>Someone Else</h1>';
  }, 60));
  const result = await extract(page, { type: "EXTRACT_BASE_PROFILE" });
  assert.equal(result.ok, false);
  assert.match(result.error, /profile changed/);
});

test("education details prefer the complete matching card over earlier unrelated lists", async (t) => {
  const page = await fixture(t, `<main>
    <div componentkey="com.linkedin.sdui.profile.card.refPERSONExperienceDetailsSection">
      <ul class="pvs-list"><li>Unrelated employer</li></ul></div>
    <section componentkey="com.linkedin.sdui.profile.card.refPERSONEducationDetailsSection">
      <h2>Education</h2><ul class="pvs-list"><li>First University</li></ul>
      <ul class="pvs-list"><li>Second University<p hidden id="degree">Full degree description</p>
        <button class="inline-show-more-text__button" onclick="document.querySelector('#degree').hidden=false;this.remove()">See more</button></li></ul>
    </section></main>`, "details/education/");
  const result = await extract(page, { type: "EXTRACT_DETAIL_SECTION", sectionKey: "education" });
  assert.equal(result.ok, true);
  assert.equal(result.incomplete, false);
  assert.equal(result.text, "First University\nSecond University\nFull degree description");
});

test("legacy education details include all lists in their section", async (t) => {
  const page = await fixture(t, `<main><section><h2>Education</h2>
    <div class="pvs-list__container"><ul><li>First University</li></ul></div>
    <div class="pvs-list__container"><ul><li>Earlier School</li></ul></div>
    </section></main>`, "details/education/");
  const result = await extract(page, { type: "EXTRACT_DETAIL_SECTION", sectionKey: "education" });
  assert.equal(result.ok, true);
  assert.equal(result.text, "First University\nEarlier School");
});

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
        session: { get: async (key) => key === null ? options.jobs || {}
          : { [key]: { status: "running", statusText: "Reading profile…" } } },
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

test("reopening the popup shows the running copy and its cancel button", async (t) => {
  const page = await popupFixture(t, { jobs: { "profile-copy-job:job": {
    id: "job", sourceTabId: 1, status: "running", statusText: "Loading full experience…"
  } } });
  await page.getByRole("button", { name: "Cancel copy" }).click();
  assert.deepEqual(await page.evaluate(() => window.requests.map((m) => m.type)), ["CLEAR_CAPTURE_JOB"]);
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
  for (const label of ["first", "second"]) {
    const index = actions.indexOf(label);
    assert.ok(actions[index - 1] >= 140 && actions[index - 1] <= 320);
    assert.ok(actions[index + 1] >= 220 && actions[index + 1] <= 480);
  }
  const loadIndex = actions.indexOf("load");
  assert.ok(actions[loadIndex - 1] >= 320 && actions[loadIndex - 1] <= 680);
  assert.ok(actions[loadIndex + 1] >= 750 && actions[loadIndex + 1] <= 1350);
});

test("cancelling during an expansion delay stops further profile clicks", async (t) => {
  const page = await fixture(t, `<main>${header}<section><h2>About</h2>
    <button class="inline-show-more-text__button" onclick="window.actions.push('first');document.querySelector('.lpc-close').click()">See more</button>
    <button class="inline-show-more-text__button" onclick="window.actions.push('second')">See more</button>
    </section><section><h2>Experience</h2>
    <button class="inline-show-more-text__button" onclick="window.actions.push('third')">See more</button></section></main>`);
  await extract(page, { type: "SHOW_CAPTURE_PANEL", job: { id: "cancel-test", status: "running" } });
  await page.evaluate(() => {
    window.actions = [];
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

test("scrolls to mount lazy profile sections before the first extraction", async (t) => {
  const page = await fixture(t, `<main>${header}
    <section><div id="about"></div><h2>About</h2><p>Profile summary</p></section>
    <div style="height: 1800px"></div><div id="lazy-sections"></div></main>`);
  await page.evaluate(() => {
    window.lazyScrollEvents = [];
    window.lazyScanDelays = [];
    const randomValues = [0, 0, 0.999, 0.999];
    Math.random = () => randomValues.shift() ?? 0.5;
    const acceleratedTimeout = window.setTimeout;
    window.setTimeout = (fn, milliseconds) => {
      window.lazyScanDelays.push(milliseconds);
      return acceleratedTimeout(fn, milliseconds);
    };
    addEventListener("scroll", () => {
      window.lazyScrollEvents.push(scrollY);
      if (scrollY < 700 || document.querySelector("#experience")) return;
      document.querySelector("#lazy-sections").innerHTML = '<section><div id="experience"></div><h2>Experience</h2><p>Engineer at Company</p><a href="/in/jordan/details/experience/">Show all experiences</a></section>';
    });
  });
  const result = await extract(page, {
    type: "EXTRACT_BASE_PROFILE",
    loadLazySections: true,
    settings: { sections: { header: false, about: false, experience: true, education: false } }
  });

  const scrollState = await page.evaluate(() => ({
    events: window.lazyScrollEvents, delays: window.lazyScanDelays,
    scrollHeight: document.documentElement.scrollHeight, innerHeight
  }));
  assert.ok(scrollState.events.filter((value) => value > 0).length >= 2, JSON.stringify(scrollState));
  assert.ok(scrollState.events.every((value) => value >= 0 && value <= scrollState.scrollHeight));
  assert.ok(scrollState.delays.every((value) => value >= 220 && value <= 480));
  assert.notEqual(scrollState.delays[0], scrollState.delays[1]);
  assert.equal(result.ok, true);
  assert.equal(result.profile.sections.experience, "Engineer at Company");
  assert.equal(result.profile.detailUrls.experience, "https://www.linkedin.com/in/jordan/details/experience/");
  assert.equal(await page.evaluate(() => window.scrollY), 0);
});

test("waits for a refreshed profile body to grow before scanning lazy sections", async (t) => {
  const page = await fixture(t, `<main>${header}<div id="delayed-profile-body"></div>
    <div id="delayed-sections"></div></main>`);
  await page.evaluate(() => {
    addEventListener("scroll", () => {
      if (scrollY < 300 || document.querySelector("#experience")) return;
      document.querySelector("#delayed-sections").innerHTML = '<section><div id="experience"></div><h2>Experience</h2><p>Delayed role</p><a href="/in/jordan/details/experience/">Show all experiences</a></section>';
    });
    fixtureDelay(() => {
      document.querySelector("#delayed-profile-body").style.height = "1800px";
    }, 150);
  });

  const result = await extract(page, {
    type: "EXTRACT_BASE_PROFILE",
    loadLazySections: true,
    settings: { sections: { header: false, about: false, experience: true, education: false } }
  });

  assert.equal(result.ok, true);
  assert.equal(result.profile.sections.experience, "Delayed role");
  assert.equal(result.profile.detailUrls.experience, "https://www.linkedin.com/in/jordan/details/experience/");
  assert.equal(await page.evaluate(() => window.scrollY), 0);
});

test("scrolls when LinkedIn mounts an empty Experience placeholder", async (t) => {
  const page = await fixture(t, `<main>${header}<div style="height: 1800px"></div>
    <section><div id="experience"></div><h2>Experience</h2><div id="delayed-experience"></div></section></main>`);
  await page.evaluate(() => {
    window.placeholderScrollEvents = [];
    addEventListener("scroll", () => {
      window.placeholderScrollEvents.push(scrollY);
      if (scrollY < 300 || document.querySelector("#delayed-role")) return;
      document.querySelector("#delayed-experience").innerHTML = '<p id="delayed-role">Role loaded after scrolling</p><a href="/in/jordan/details/experience/">Show all experiences</a>';
    });
  });

  const result = await extract(page, {
    type: "EXTRACT_BASE_PROFILE",
    loadLazySections: true,
    settings: { sections: { header: false, about: false, experience: true, education: false } }
  });

  assert.ok(await page.evaluate(() => window.placeholderScrollEvents.some((value) => value >= 300)));
  assert.equal(result.profile.sections.experience, "Role loaded after scrolling");
  assert.equal(result.profile.detailUrls.experience, "https://www.linkedin.com/in/jordan/details/experience/");
});

test("uses a nested profile scroll container when the window cannot scroll", async (t) => {
  const page = await fixture(t, `<div id="profile-scroll" style="height: 500px; overflow-y: auto">
    <main>${header}<div style="height: 1400px"></div>
      <section><div id="experience"></div><h2>Experience</h2><div id="nested-experience"></div></section>
    </main></div>`);
  await page.evaluate(() => {
    window.nestedScrollEvents = [];
    const container = document.querySelector("#profile-scroll");
    container.addEventListener("scroll", () => {
      window.nestedScrollEvents.push(container.scrollTop);
      if (container.scrollTop < 300 || document.querySelector("#nested-role")) return;
      document.querySelector("#nested-experience").innerHTML = '<p id="nested-role">Role loaded in nested scroller</p><a href="/in/jordan/details/experience/">Show all experiences</a>';
    });
  });

  const result = await extract(page, {
    type: "EXTRACT_BASE_PROFILE",
    loadLazySections: true,
    settings: { sections: { header: false, about: false, experience: true, education: false } }
  });

  assert.ok(await page.evaluate(() => window.nestedScrollEvents.some((value) => value >= 300)));
  assert.equal(result.profile.sections.experience, "Role loaded in nested scroller");
  assert.equal(await page.locator("#profile-scroll").evaluate((element) => element.scrollTop), 0);
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

test("education waits while its matching card is busy loading additional schools", async (t) => {
  const page = await fixture(t, `<main>
    <section aria-busy="true" componentkey="com.linkedin.sdui.profile.card.refPERSONEducationDetailsSection">
      <h2>Education</h2><ul><li>First University</li></ul>
    </section></main>`, "details/education/");
  await page.evaluate(() => {
    // Start loading when extraction first reads the card, avoiding a race with setup.
    const card = document.querySelector("section");
    const original = card.querySelectorAll.bind(card);
    let started = false;
    card.querySelectorAll = (...args) => {
      if (!started) {
        started = true;
        fixtureDelay(() => {
          card.insertAdjacentHTML("beforeend", "<ul><li>Earlier School</li></ul>");
          card.setAttribute("aria-busy", "false");
        }, 60);
      }
      return original(...args);
    };
  });
  const result = await extract(page, { type: "EXTRACT_DETAIL_SECTION", sectionKey: "education" });
  assert.equal(result.ok, true);
  assert.equal(result.incomplete, false);
  assert.equal(result.text, "First University\nEarlier School");
});

test("education details scroll the page scroller to load schools behind display: contents wrappers", async (t) => {
  const school = (n) => `<div style="height:120px"><p>School ${n}</p></div>`;
  const page = await fixture(t, `<main style="height:300px;overflow-y:auto">
    <div componentkey="com.linkedin.sdui.profile.card.refPERSONEducationDetailsSection">
      <p>Education</p><div data-component-type="LazyColumn" style="display:contents">
        ${[1, 2, 3].map(school).join("")}</div></div></main>`, "details/education/");
  await page.evaluate((batch) => {
    const main = document.querySelector("main");
    const column = document.querySelector("[data-component-type='LazyColumn']");
    let next = 4;
    main.addEventListener("scroll", () => {
      if (next <= 9 && main.scrollTop + main.clientHeight >= main.scrollHeight - 50) {
        column.insertAdjacentHTML("beforeend", batch.replace(/N/g, next) + batch.replace(/N/g, next + 1) + batch.replace(/N/g, next + 2));
        next += 3;
      }
    });
  }, school("N"));
  const result = await extract(page, { type: "EXTRACT_DETAIL_SECTION", sectionKey: "education" });
  assert.equal(result.ok, true);
  assert.equal(result.incomplete, false);
  assert.equal(result.text, [...Array.from({ length: 9 }, (_, i) => `School ${i + 1}`)].join("\n"));
});

test("finds the Show all link when its profile slug differs in case", async (t) => {
  const page = await fixture(t, `<main>${header}<section><h2>Experience</h2><p>Engineer</p>
    <a href="/in/Jordan/details/experience">Show all 9 experiences</a></section></main>`);
  const result = await extract(page, { type: "EXTRACT_BASE_PROFILE" });
  assert.equal(result.profile.detailUrls.experience, "https://www.linkedin.com/in/Jordan/details/experience/");
});

test("finds SDUI sections by card key when LinkedIn is not in English", async (t) => {
  const card = (key, heading, body) => `<section componentkey="com.linkedin.sdui.profile.card.refPERSON${key}">
    <h2>${heading}</h2><p>${body}</p></section>`;
  const page = await fixture(t, `<main>${header}${card("About", "Infos", "Ingénieure à Paris")}
    ${card("ExperienceTopLevelSection", "Expérience", "Ingénieure\nAcme")}
    ${card("EducationTopLevelSection", "Formation", "Sorbonne")}</main>`);
  const result = await extract(page, { type: "EXTRACT_BASE_PROFILE" });
  assert.deepEqual(result.profile.sections, {
    about: "Ingénieure à Paris", experience: "Ingénieure\nAcme", education: "Sorbonne"
  });
});

test("drops media attachments and their Show all label from role text", async (t) => {
  const page = await fixture(t, `<main>
    <div componentkey="com.linkedin.sdui.profile.card.refPERSONExperienceDetailsSection">
      <div componentkey="entity-collection-item-one"><p>Producer</p><p>Example Events</p>
        <p>Ran the speaker programme.</p>
        <a href="/in/jordan/overlay/Position/1/image-list/?profileId=x"><p>Conference recap</p></a>
        <a href="/in/jordan/overlay/Position/1/treasury/?profileId=x"><p>Research lab</p></a>
        <a href="/in/jordan/overlay/Position/1/image-list/?profileId=x">Show all 4 media</a></div>
    </div></main>`, "details/experience/");
  const result = await extract(page, { type: "EXTRACT_DETAIL_SECTION", sectionKey: "experience" });
  assert.equal(result.text, "Producer\nExample Events\nRan the speaker programme.");
});
