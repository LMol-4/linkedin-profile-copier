const test = require("node:test");
const assert = require("node:assert/strict");
const { chromium } = require("playwright");
const path = require("node:path");
const root = path.resolve(__dirname, "..");

for (const layout of ["legacy", "SDUI", "unavailable"]) test(`loaded extension collects ${layout} details, closes tabs, injects after SPA navigation, and cancels`, { timeout: 30000 }, async (t) => {
  const context = await chromium.launchPersistentContext("", {
    channel: "chromium", headless: true,
    args: [`--disable-extensions-except=${root}`, `--load-extension=${root}`, "--host-resolver-rules=MAP www.linkedin.com ~NOTFOUND"]
  });
  t.after(() => context.close());
  await context.route("**/*", (route) => {
    const url = route.request().url();
    if (!url.startsWith("https://www.linkedin.com/")) return route.abort();
    const body = url.includes("/details/experience/")
      ? (layout === "unavailable" ? "<main><p>Experience temporarily unavailable</p></main>"
        : layout === "SDUI" ? require("node:fs").readFileSync(path.join(__dirname, "fixtures/experience-sdui.html"), "utf8")
        : `<main><h1>Experience</h1><div class="pvs-list__container"><p>Engineer at Company</p>
          <p hidden id="more">Full experience description</p>
          <button class="inline-show-more-text__button" onclick="document.querySelector('#more').hidden=false;this.remove()">See more</button>
        </div><aside>My own profile preview</aside></main>`)
      : `<main><section><h1>Jordan Lee</h1><div class="text-body-medium break-words">Engineer</div></section>
          <section><div id="experience"></div><h2>Experience</h2><p>Engineer at Company</p>
            <p hidden id="base-full">Full description recovered from the main profile</p>
            <button class="inline-show-more-text__button" onclick="window.baseExpansions=(window.baseExpansions||0)+1;document.querySelector('#base-full').hidden=false;this.remove()">See more</button>
            <a href="/in/jordan/details/experience/">Show all 4 experiences</a>
          </section></main><aside>Search suggestions</aside>`;
    return route.fulfill({ contentType: "text/html; charset=utf-8", body });
  });
  const worker = context.serviceWorkers()[0] || await context.waitForEvent("serviceworker");
  // Playwright cannot route the first navigation initiated by chrome.tabs.create.
  // Keep native tab creation, then navigate the new tab through Playwright's fixture route.
  await worker.evaluate(() => {
    const createTab = chrome.tabs.create;
    chrome.tabs.create = (properties) => createTab({ ...properties, url: "about:blank" });
  });
  const source = context.pages()[0];
  await source.goto("https://www.linkedin.com/feed/");
  // A profile reached through LinkedIn's client-side navigation needs script injection.
  await source.evaluate(() => history.pushState({}, "", "/in/jordan/"));
  const sourceTabId = await worker.evaluate(async () => {
    const tabs = await chrome.tabs.query({});
    return tabs.find((tab) => tab.url === "https://www.linkedin.com/in/jordan/").id;
  });
  const created = [];
  context.on("page", (page) => {
    created.push(page);
    page.goto("https://www.linkedin.com/in/jordan/details/experience/").catch(() => undefined);
  });
  await worker.evaluate((sourceTabId) => createCaptureJob({ sourceTabId, settings: { sections: { about: false, education: false } } }), sourceTabId);
  await source.locator("[data-lpc-result]:not([hidden])").waitFor({ timeout: 15000 });
  const text = await source.locator("[data-lpc-output]").inputValue();
  assert.match(text, /^Jordan Lee/);
  if (layout === "unavailable") {
    assert.match(text, /Full description recovered from the main profile/);
  } else {
    assert.match(text, layout === "SDUI" ? /Complete role description./ : /Full experience description/);
    if (layout === "SDUI") assert.match(text, /Engineer\n2015 - 2017/);
  }
  assert.equal(await source.locator("[data-lpc-warning]").isVisible(), layout === "unavailable");
  assert.equal(await source.evaluate(() => window.baseExpansions || 0), layout === "unavailable" ? 1 : 0);
  assert.doesNotMatch(text, /Search suggestions|My own profile preview/);
  assert.equal(created.length, 1);
  assert.equal(created[0].isClosed(), true);
  assert.equal(await worker.evaluate(async () => (await chrome.tabs.query({ active: true }))[0].url),
    "https://www.linkedin.com/in/jordan/");

  const second = await worker.evaluate((sourceTabId) => createCaptureJob({ sourceTabId, settings: { sections: { about: false, education: false } } }), sourceTabId);
  await context.waitForEvent("page", { timeout: 10000 });
  await worker.evaluate((jobId) => clearCaptureJob(jobId), second.jobId);
  await source.locator(".lpc-panel").waitFor({ state: "detached" });
  await source.waitForFunction(() => !document.querySelector(".lpc-panel"));
  assert.equal(await worker.evaluate(async () => Object.keys(await chrome.storage.session.get(null)).length), 0);
  await Promise.all(created.filter((page) => !page.isClosed()).map((page) => page.waitForEvent("close")));
  assert.ok(created.every((page) => page.isClosed()));
});
