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
