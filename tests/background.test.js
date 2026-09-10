const test = require("node:test");
const assert = require("node:assert/strict");
const vm = require("node:vm");
const fs = require("node:fs");
const path = require("node:path");
const { webcrypto } = require("node:crypto");
const sourceUrl = "https://www.linkedin.com/in/jordan/";
const key = (id) => `profile-copy-job:${id}`;

function setup(options = {}) {
  const stored = {};
  const tabs = new Map([[1, { id: 1, windowId: 7, url: sourceUrl, status: "complete" }]]);
  const created = [];
  const removed = [];
  const messages = [];
  let clipboardWrites = 0;
  const profile = options.profile || {
    sourceUrl, header: { name: "Jordan" }, sections: { experience: "Engineer" },
    detailUrls: { experience: `${sourceUrl}details/experience/` }
  };
  const event = () => ({ addListener() {} });
  const context = vm.createContext({
    URL, crypto: webcrypto, Uint32Array, console,
    setTimeout: (fn) => setTimeout(fn, 0), clearTimeout,
    chrome: {
      storage: { session: {
        async get(k) { return structuredClone(k === null ? stored : { [k]: stored[k] }); },
        async set(values) { Object.assign(stored, structuredClone(values)); },
        async remove(k) { delete stored[k]; }
      } },
      scripting: { async insertCSS() {}, async executeScript() {} },
      offscreen: { async createDocument() {} },
      runtime: {
        onMessage: event(), getURL: (url) => `chrome-extension://test/${url}`,
        async getContexts() { return [{}]; },
        async sendMessage() { clipboardWrites += 1; return { ok: !options.clipboardFails }; }
      },
      tabs: {
        onUpdated: event(), onRemoved: event(),
        async get(id) { if (!tabs.has(id)) throw new Error("Tab closed"); return { ...tabs.get(id) }; },
        async create(spec) {
          created.push(spec);
          const tab = { ...spec, id: created.length + 10, status: "complete" };
          if (options.redirect) tab.url = options.redirect;
          tabs.set(tab.id, tab);
          return tab;
        },
        async remove(id) { removed.push(id); tabs.delete(id); },
        async sendMessage(id, message) {
          messages.push(message);
          if (options.onSend) await options.onSend(id, message, context);
          if (message.type === "EXTRACT_BASE_PROFILE") return { ok: true, profile: structuredClone(profile) };
          if (message.type === "EXTRACT_DETAIL_SECTION") return { ok: true, text: "Engineer\nFull role description", incomplete: !!options.incomplete };
          return { ok: true };
        }
      }
    }
  });
  context.importScripts = (...files) => files.forEach((file) => vm.runInContext(
    fs.readFileSync(path.join(__dirname, "../src", file), "utf8"), context
  ));
  vm.runInContext(fs.readFileSync(path.join(__dirname, "../src/background.js"), "utf8"), context);
  return { context, stored, tabs, created, removed, messages, clipboardWrites: () => clipboardWrites };
}

test("concurrent starts and runs share one job and one inactive detail tab", async () => {
  const h = setup();
  const request = { sourceTabId: 1, settings: {} };
  const [a, b] = await Promise.all([h.context.createCaptureJob(request), h.context.createCaptureJob(request)]);
  assert.equal(a.jobId, b.jobId);
  await Promise.all([h.context.runCapture(a.jobId), h.context.runCapture(a.jobId)]);
  assert.equal(h.created.length, 1);
  assert.equal(h.created[0].active, false);
  assert.equal(h.created[0].windowId, 7);
  assert.equal(h.removed.length, 1);
  assert.equal(h.stored[key(a.jobId)].status, "complete");
});

test("missing, disabled and unrelated detail links never open tabs", async () => {
  for (const detailUrls of [{}, { skills: "https://www.linkedin.com/search/results/" },
    { skills: "https://www.linkedin.com/in/me/details/skills/" }]) {
    const h = setup({ profile: { sourceUrl, header: { name: "Jordan" }, sections: {}, detailUrls } });
    const job = await h.context.createCaptureJob({ sourceTabId: 1, settings: {} });
    await h.context.runCapture(job.jobId);
    assert.equal(h.created.length, 0);
  }
  const h = setup();
  const job = await h.context.createCaptureJob({ sourceTabId: 1, settings: { sections: { experience: false } } });
  await h.context.runCapture(job.jobId);
  assert.equal(h.created.length, 0);
});

test("redirects keep the base text and close the temporary tab", async () => {
  const h = setup({ redirect: "https://www.linkedin.com/in/me/" });
  const job = await h.context.createCaptureJob({ sourceTabId: 1, settings: {} });
  await h.context.runCapture(job.jobId);
  assert.equal(h.stored[key(job.jobId)].profile.sections.experience, "Engineer");
  assert.equal(h.stored[key(job.jobId)].warnings[0], "Experience");
  assert.equal(h.messages.some((m) => m.type === "EXTRACT_DETAIL_SECTION"), false);
  assert.equal(h.removed.length, 1);
});

test("closing the panel cancels collection and prevents automatic clipboard writes", async () => {
  const h = setup({ onSend: async (_id, message, context) => {
    if (message.type === "EXTRACT_DETAIL_SECTION") {
      const jobs = await context.chrome.storage.session.get(null);
      await context.clearCaptureJob(Object.values(jobs)[0].id);
    }
  } });
  const job = await h.context.createCaptureJob({ sourceTabId: 1, settings: { autoCopy: true } });
  await h.context.runCapture(job.jobId);
  assert.equal(h.stored[key(job.jobId)], undefined);
  assert.equal(h.clipboardWrites(), 0);
  assert.equal(h.tabs.size, 1);
});

test("source navigation stops the job before opening details or copying", async () => {
  const h = setup({ onSend: async (_id, message) => {
    if (message.type === "EXTRACT_BASE_PROFILE") h.tabs.get(1).url = "https://www.linkedin.com/in/someone-else/";
  } });
  const job = await h.context.createCaptureJob({ sourceTabId: 1, settings: { autoCopy: true } });
  await h.context.runCapture(job.jobId);
  assert.equal(h.created.length, 0);
  assert.equal(h.clipboardWrites(), 0);
  assert.equal(h.stored[key(job.jobId)].status, "failed");
});

test("a failed panel injection does not leave a stuck ready job", async () => {
  const h = setup({ onSend: async (_id, message) => {
    if (message.type === "SHOW_CAPTURE_PANEL") throw new Error("Cannot access this page");
  } });
  await assert.rejects(h.context.createCaptureJob({ sourceTabId: 1, settings: {} }), /Cannot access/);
  assert.equal(Object.keys(h.stored).length, 0);
});

test("a new request recovers from a stopped worker and closes its orphaned tab", async () => {
  const h = setup();
  h.stored[key("stale")] = { id: "stale", sourceTabId: 1, sourceUrl, status: "running", detailTabId: 99 };
  const job = await h.context.createCaptureJob({ sourceTabId: 1, settings: {} });
  assert.notEqual(job.jobId, "stale");
  assert.equal(h.stored[key("stale")], undefined);
  assert.ok(h.removed.includes(99));
});

test("partial details and clipboard failures remain visible to the user", async () => {
  const h = setup({ incomplete: true, clipboardFails: true });
  const job = await h.context.createCaptureJob({ sourceTabId: 1, settings: { autoCopy: true } });
  await h.context.runCapture(job.jobId);
  const result = h.stored[key(job.jobId)];
  assert.equal(result.status, "complete");
  assert.equal(result.autoCopyStatus, "failed");
  assert.equal(result.warnings[0], "Experience");
  assert.match(result.profile.sections.experience, /Full role description/);
});

test("rejects non-profile pages and empty selection before creating jobs", async () => {
  const h = setup();
  for (const url of ["https://www.linkedin.com/feed/", `${sourceUrl}details/skills/`, "https://linkedin.com.evil.test/in/user/", "http://www.linkedin.com/in/user/"]) {
    assert.equal(h.context.ProfileCopyConfig.isProfilePage(url), false);
  }
  await assert.rejects(h.context.createCaptureJob({ sourceTabId: 1, settings: {
    sections: Object.fromEntries(h.context.ProfileCopyConfig.sections.map(({ key }) => [key, false]))
  } }), /Choose at least one/);
  assert.equal(Object.keys(h.stored).length, 0);
});


test("only one profile can start or collect at a time", async () => {
  let reading;
  let resume;
  const entered = new Promise((resolve) => { reading = resolve; });
  const held = new Promise((resolve) => { resume = resolve; });
  const h = setup({ onSend: async (_id, message) => {
    if (message.type === "EXTRACT_BASE_PROFILE") { reading(); await held; }
  } });
  h.tabs.set(2, { id: 2, windowId: 7, url: "https://www.linkedin.com/in/someone-else/", status: "complete" });
  const request = (sourceTabId) => ({ sourceTabId, settings: {} });
  const [first, second] = await Promise.allSettled([
    h.context.createCaptureJob(request(1)), h.context.createCaptureJob(request(2))
  ]);
  assert.equal(first.status, "fulfilled");
  assert.equal(second.status, "rejected");
  assert.match(second.reason.message, /Finish or cancel/);
  await assert.rejects(h.context.createCaptureJob(request(2)), /Finish or cancel/);
  const running = h.context.runCapture(first.value.jobId);
  await entered;
  try {
    await assert.rejects(h.context.createCaptureJob(request(2)), /Finish or cancel/);
  } finally { resume(); }
  await running;
  const next = await h.context.createCaptureJob(request(2));
  assert.equal(next.ok, true);
  assert.equal(h.created.length, 1);
});

test("a checkpoint redirect stops all remaining detail tabs and preserves available text", async () => {
  const h = setup({ redirect: "https://www.linkedin.com/checkpoint/challenge/", profile: {
    sourceUrl, header: { name: "Jordan" }, sections: { experience: "Engineer", skills: "Planning" },
    detailUrls: { experience: `${sourceUrl}details/experience/`, skills: `${sourceUrl}details/skills/` }
  } });
  const job = await h.context.createCaptureJob({ sourceTabId: 1, settings: {} });
  await h.context.runCapture(job.jobId);
  const result = h.stored[key(job.jobId)];
  assert.equal(h.created.length, 1);
  assert.equal(h.removed.length, 1);
  assert.equal(result.status, "complete");
  assert.deepEqual(result.warnings, ["Experience", "Skills"]);
  assert.deepEqual(result.profile.sections, { experience: "Engineer", skills: "Planning" });
  assert.equal(h.messages.some((message) => message.type === "EXTRACT_DETAIL_SECTION"), false);
});
