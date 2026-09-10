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
  const page = await fixture(t, "<main><h1>My own profile preview</h1><p>Search suggestions</p></main>", "details/skills/");
  const result = await extract(page, { type: "EXTRACT_DETAIL_SECTION", sectionKey: "skills" });
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
  assert.equal(result.profile.sections.skills, "");
  assert.deepEqual(result.profile.detailUrls, { experience: "https://www.linkedin.com/in/jordan/details/experience/" });
  assert.doesNotMatch(JSON.stringify(result.profile), /preview|Unrelated|more|Contact info/);
  assert.equal(await page.evaluate(() => window.expanded), 2);
  assert.equal(await page.evaluate(() => !!window.badClick), false);
});

test("does not use another person's verified heading as the current profile", async (t) => {
  const page = await fixture(t, `<main><section aria-label="Primary content"><section>
    <a href="/in/someone-else/" componentkey="ProfileVerificationTriggerRef-someone-else"><h2>Someone else</h2></a>
  </section></section></main>`);
  const result = await extract(page, { type: "EXTRACT_BASE_PROFILE" });
  assert.equal(result.ok, false);
});


test("reads SDUI profiles without a verification link and includes counted skills", async (t) => {
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
  assert.match(result.profile.sections.skills, /Sales & Marketing/);
  assert.match(result.profile.sections.skills, /Forecasting/);
  assert.doesNotMatch(result.profile.sections.skills, /Skills \(50\)/);
  assert.deepEqual(result.profile.detailUrls, {
    experience: "https://www.linkedin.com/in/jordan/details/experience/",
    skills: "https://www.linkedin.com/in/jordan/details/skills/"
  });
  assert.doesNotMatch(JSON.stringify(result.profile), /preview|activity|recommendation|Contact info|She\/Her|helped me get this job/);
  assert.equal(await page.evaluate(() => window.expanded), 2);
  assert.equal(await page.evaluate(() => !!window.badClick), false);
});

test("finds counted section headings without copying the heading", async (t) => {
  const page = await fixture(t, `<main>${header}<section><h2>Skills (50)</h2><p>Forecasting</p>
    <a href="/in/jordan/details/skills/">Show all</a></section></main>`);
  const result = await extract(page, { type: "EXTRACT_BASE_PROFILE" });
  assert.equal(result.profile.sections.skills, "Forecasting");
  assert.equal(result.profile.detailUrls.skills, "https://www.linkedin.com/in/jordan/details/skills/");
});

test("rejects another person's unverified top card", async (t) => {
  const page = await fixture(t, `<main><section aria-label="Primary content">
    <section componentkey="com.linkedin.sdui.profile.card.refOTHERTopcard">
      <a href="/in/someone-else/" componentkey="topcard-logo-image-referencekey"></a><h2>Someone else</h2>
    </section></section></main>`);
  const result = await extract(page, { type: "EXTRACT_BASE_PROFILE" });
  assert.equal(result.ok, false);
});
