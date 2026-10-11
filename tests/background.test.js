const test = require("node:test");
const assert = require("node:assert/strict");
const vm = require("node:vm");
const fs = require("node:fs");
const path = require("node:path");
const { webcrypto } = require("node:crypto");
const sourceUrl = "https://www.linkedin.com/in/jordan/";
const key = (id) => `profile-copy-job:${id}`;

test("accepts a profile URL with a query and no trailing slash when messaging", async () => {
  const h = setup();
  h.tabs.get(1).url = "https://www.linkedin.com/in/jordan?tracking=profile";
  const response = await h.context.sendToProfileTab(1, { type: "SHOW_CAPTURE_PANEL" });
  assert.equal(response.ok, true);
});

test("reinjects the manifest's content scripts when the profile tab has none", async () => {
  const h = setup();
  const manifest = JSON.parse(fs.readFileSync(path.join(__dirname, "../manifest.json"), "utf8"));
  const injected = [];
  let attempts = 0;
  Object.assign(h.context.chrome.runtime, { getManifest: () => manifest });
  Object.assign(h.context.chrome.scripting, {
    async insertCSS({ files }) { injected.push(...files); },
    async executeScript({ files }) { injected.push(...files); }
  });
  h.context.chrome.tabs.sendMessage = async () => {
    attempts += 1;
    if (attempts === 1) throw new Error("Could not establish connection. Receiving end does not exist.");
    return { ok: true };
  };
  assert.equal((await h.context.sendToProfileTab(1, { type: "SHOW_CAPTURE_PANEL" })).ok, true);
  assert.deepEqual(injected, [...manifest.content_scripts[0].css, ...manifest.content_scripts[0].js]);
});

function setup(options = {}) {
  const stored = { ...options.stored };
  const tabs = new Map([[1, { id: 1, windowId: 7, url: sourceUrl, status: "complete" }]]);
  const created = [];
  const removed = [];
  const messages = [];
  let clipboardWrites = 0;
  const profile = options.profile || {
    sourceUrl, header: { name: "Jordan" }, sections: { experience: "Engineer" }
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
        async update(id, changes) {
          if (!tabs.has(id)) throw new Error("Tab closed");
          Object.assign(tabs.get(id), changes);
          return { ...tabs.get(id) };
        },
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
          if (message.type === "EXTRACT_BASE_PROFILE") return { ok: true,
            profile: structuredClone(message.expandDetailSections && options.fallback ? options.fallback : profile) };
          if (message.type === "EXTRACT_DETAIL_SECTION") return options.detail || { ok: true, text: "Engineer\nFull role description", incomplete: !!options.incomplete };
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

for (const fails of [false, true]) test(`education mounts in a visible tab and restores the source (failure=${fails})`, async () => {
  const h = setup({ profile: {
    sourceUrl, header: { name: "Jordan" }, sections: { education: "First school" }
  } });
  const send = h.context.chrome.tabs.sendMessage;
  h.context.chrome.tabs.sendMessage = async (id, message) => {
    if (message.type === "EXTRACT_DETAIL_SECTION") {
      assert.equal(h.tabs.get(id).active, true, "SDUI education requires a visible tab");
      return fails ? { ok: false, error: "Unavailable" }
        : { ok: true, text: "First school\nSecond school\nThird school", incomplete: false };
    }
    return send(id, message);
  };
  const job = await h.context.createCaptureJob({ sourceTabId: 1, settings: {} });
  await h.context.runCapture(job.jobId);
  assert.equal(h.created.length, 1);
  assert.equal(h.created[0].active, true);
  assert.equal(h.removed.length, 1);
  assert.equal(h.tabs.get(1).active, true);
  const result = h.stored[key(job.jobId)];
  assert.equal(result.status, "complete");
  if (!fails) {
    assert.match(result.profile.sections.education, /Third school/);
    assert.deepEqual(result.warnings, []);
  }
});

test("education cleanup preserves a user switch to another tab", async () => {
  const h = setup({ profile: { sourceUrl, header: { name: "Jordan" },
    sections: { education: "School" } },
    onSend(id, message) {
      if (message.type === "EXTRACT_DETAIL_SECTION") h.tabs.get(id).active = false;
    }
  });
  const job = await h.context.createCaptureJob({ sourceTabId: 1, settings: {} });
  await h.context.runCapture(job.jobId);
  assert.equal(h.tabs.get(1).active, undefined);
  assert.equal(h.removed.length, 1);
});

test("retries when LinkedIn initially renders About without work history", async () => {
  const h = setup();
  const send = h.context.chrome.tabs.sendMessage;
  let baseReads = 0;
  const lazyLoadRequests = [];
  h.context.chrome.tabs.sendMessage = (id, message) => {
    if (message.type !== "EXTRACT_BASE_PROFILE") return send(id, message);
    baseReads += 1;
    lazyLoadRequests.push(message.loadLazySections);
    if (baseReads === 1) return Promise.resolve({ ok: true, profile: {
      sourceUrl, header: { name: "Jordan" },
      sections: { about: "Profile summary", experience: "", education: "" }
    } });
    return send(id, message).then((response) => {
      response.profile.sections.education = "University";
      return response;
    });
  };

  const job = await h.context.createCaptureJob({ sourceTabId: 1, settings: {} });
  await h.context.runCapture(job.jobId);

  assert.equal(baseReads, 2);
  assert.deepEqual(lazyLoadRequests, [true, false]);
  assert.equal(h.created.length, 2);
  assert.match(h.stored[key(job.jobId)].profile.sections.experience, /Full role description/);
});

test("waits for an in-progress profile refresh before creating the capture panel", async () => {
  const h = setup();
  h.tabs.get(1).status = "loading";
  const get = h.context.chrome.tabs.get;
  let reads = 0;
  h.context.chrome.tabs.get = async (id) => {
    reads += 1;
    if (reads === 3) h.tabs.get(id).status = "complete";
    return get(id);
  };

  const job = await h.context.createCaptureJob({ sourceTabId: 1, settings: {} });

  assert.equal(job.ok, true);
  assert.ok(reads >= 4);
  assert.equal(h.messages[0].type, "SHOW_CAPTURE_PANEL");
  assert.equal(h.tabs.get(1).status, "complete");
});

test("opens this profile's details page even when the main page has no Show all link", async () => {
  const h = setup({ profile: { sourceUrl, header: { name: "Jordan" }, sections: { experience: "Engineer" } } });
  const job = await h.context.createCaptureJob({ sourceTabId: 1, settings: {} });
  await h.context.runCapture(job.jobId);
  assert.deepEqual(h.created.map(({ url }) => url), [`${sourceUrl}details/experience/`]);
  assert.equal(h.stored[key(job.jobId)].profile.sections.experience, "Engineer\nFull role description");
});

test("a complete details read replaces a longer main-page preview", async () => {
  const h = setup({
    profile: { sourceUrl, header: { name: "Jordan" }, sections: { experience: "Engineer\nShow all 4 media\nConference recap" } },
    detail: { ok: true, text: "Engineer", incomplete: false }
  });
  const job = await h.context.createCaptureJob({ sourceTabId: 1, settings: {} });
  await h.context.runCapture(job.jobId);
  assert.equal(h.stored[key(job.jobId)].profile.sections.experience, "Engineer");
});

test("sections missing from the main page or disabled never open details tabs", async () => {
  {
    const h = setup({ profile: { sourceUrl, header: { name: "Jordan" }, sections: {} } });
    const job = await h.context.createCaptureJob({ sourceTabId: 1, settings: {} });
    await h.context.runCapture(job.jobId);
    assert.equal(h.created.length, 0);
  }
  const h = setup();
  const job = await h.context.createCaptureJob({ sourceTabId: 1, settings: { sections: { experience: false } } });
  await h.context.runCapture(job.jobId);
  assert.equal(h.created.length, 0);
});

test("a details page redirected to another case or encoding of the slug still counts", async () => {
  const detailUrl = "https://www.linkedin.com/in/J%C3%B3rdan/details/experience/";
  const h = setup({
    redirect: "https://www.linkedin.com/in/j%C3%93RDAN/details/experience/",
    profile: { sourceUrl: "https://www.linkedin.com/in/J%C3%B3rdan/", header: { name: "Jordan" },
      sections: { experience: "Engineer" } }
  });
  h.tabs.get(1).url = "https://www.linkedin.com/in/J%C3%B3rdan/";
  const job = await h.context.createCaptureJob({ sourceTabId: 1, settings: {} });
  await h.context.runCapture(job.jobId);
  assert.equal(h.created[0].url, detailUrl);
  assert.equal(h.stored[key(job.jobId)].profile.sections.experience, "Engineer\nFull role description");
  assert.deepEqual(h.stored[key(job.jobId)].warnings, []);
});

test("redirects keep the base text and close the temporary tab", async () => {
  const h = setup({ redirect: "https://www.linkedin.com/in/me/" });
  const job = await h.context.createCaptureJob({ sourceTabId: 1, settings: {} });
  await h.context.runCapture(job.jobId);
  assert.equal(h.stored[key(job.jobId)].profile.sections.experience, "Engineer");
  assert.match(h.stored[key(job.jobId)].warnings[0], /Experience.*redirected/);
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
  assert.equal(h.messages.some((message) => message.expandDetailSections), false);
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

test("a restarted worker clears jobs its predecessor left running", async () => {
  const h = setup({ stored: { [key("stale")]: { id: "stale", sourceTabId: 1, sourceUrl, status: "running", detailTabId: 99 } } });
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(h.stored[key("stale")], undefined);
  assert.ok(h.removed.includes(99));
  assert.ok(h.messages.some((message) => message.type === "CAPTURE_JOB_CLEARED"));
});

test("partial details and clipboard failures remain visible to the user", async () => {
  const h = setup({ incomplete: true, clipboardFails: true });
  const job = await h.context.createCaptureJob({ sourceTabId: 1, settings: { autoCopy: true } });
  await h.context.runCapture(job.jobId);
  const result = h.stored[key(job.jobId)];
  assert.equal(result.status, "complete");
  assert.equal(result.autoCopyStatus, "failed");
  assert.match(result.warnings[0], /Experience.*loading limit reached/);
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
    sourceUrl, header: { name: "Jordan" }, sections: { experience: "Engineer", education: "University" }
  } });
  const job = await h.context.createCaptureJob({ sourceTabId: 1, settings: {} });
  await h.context.runCapture(job.jobId);
  const result = h.stored[key(job.jobId)];
  assert.equal(h.created.length, 1);
  assert.equal(h.removed.length, 1);
  assert.equal(result.status, "complete");
  assert.equal(result.warnings.length, 2);
  assert.match(result.warnings[0], /Experience.*security check/);
  assert.match(result.warnings[1], /Education.*security check/);
  assert.deepEqual(result.profile.sections, { experience: "Engineer", education: "University" });
  assert.equal(h.messages.some((message) => message.type === "EXTRACT_DETAIL_SECTION"), false);
});


test("removed sections never open detail tabs even with older saved settings", async () => {
  const removed = ["skills", "certifications", "projects", "languages"];
  const h = setup({ profile: { sourceUrl, header: { name: "Jordan" },
    sections: Object.fromEntries(removed.map((section) => [section, "Text"]))
  } });
  const job = await h.context.createCaptureJob({ sourceTabId: 1, settings: {
    sections: Object.fromEntries(removed.map((section) => [section, true]))
  } });
  await h.context.runCapture(job.jobId);
  assert.equal(h.created.length, 0);
  assert.equal(h.stored[key(job.jobId)].status, "complete");
});


test("detail warnings retain the underlying error and available profile text", async () => {
  const h = setup();
  const send = h.context.chrome.tabs.sendMessage;
  h.context.chrome.tabs.sendMessage = (id, message) => message.type === "EXTRACT_DETAIL_SECTION"
    ? Promise.resolve({ ok: false, error: "The requested section has not loaded." }) : send(id, message);
  const job = await h.context.createCaptureJob({ sourceTabId: 1, settings: {} });
  await h.context.runCapture(job.jobId);
  const result = h.stored[key(job.jobId)];
  assert.equal(result.status, "complete");
  assert.match(result.warnings[0], /Experience.*The requested section has not loaded/);
  assert.equal(result.profile.sections.experience, "Engineer");
  assert.equal(h.created.length, 1);
  assert.equal(h.removed.length, 1);
});


test("successful detail reads never trigger main-profile expansion, even with identical text", async () => {
  for (const text of ["Engineer", "Engineer\nComplete role description"]) {
    const h = setup({ detail: { ok: true, text, incomplete: false } });
    const job = await h.context.createCaptureJob({ sourceTabId: 1, settings: {} });
    await h.context.runCapture(job.jobId);
    assert.equal(h.messages.filter((message) => message.type === "EXTRACT_BASE_PROFILE").length, 1);
    assert.deepEqual(h.stored[key(job.jobId)].warnings, []);
    assert.equal(h.stored[key(job.jobId)].profile.sections.experience, text);
  }
});

test("failed, empty and partial detail reads expand only the affected main-profile section", async () => {
  const expanded = "Engineer\nFull description recovered from the main profile.";
  for (const detail of [
    { ok: false, error: "The requested section has not loaded." },
    { ok: true, text: "", incomplete: false },
    { ok: true, text: "Engineer\nPartial description", incomplete: true }
  ]) {
    const h = setup({ detail, fallback: { sourceUrl, sections: { experience: expanded } } });
    const job = await h.context.createCaptureJob({ sourceTabId: 1, settings: {} });
    await h.context.runCapture(job.jobId);
    const fallback = h.messages.find((message) => message.expandDetailSections);
    assert.deepEqual(JSON.parse(JSON.stringify(fallback.settings.sections)),
      { header: false, about: false, experience: true, education: false });
    assert.equal(h.stored[key(job.jobId)].profile.sections.experience, expanded);
    assert.equal(h.created.length, 1);
    assert.equal(h.removed.length, 1);
  }
});

test("a fallback from another profile cannot replace the available text", async () => {
  const h = setup({ detail: { ok: false, error: "Missing details" }, fallback: {
    sourceUrl: "https://www.linkedin.com/in/someone-else/", sections: { experience: "Another person's much longer experience" }
  } });
  const job = await h.context.createCaptureJob({ sourceTabId: 1, settings: {} });
  await h.context.runCapture(job.jobId);
  assert.equal(h.stored[key(job.jobId)].profile.sections.experience, "Engineer");
});
