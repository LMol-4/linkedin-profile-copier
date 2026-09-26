importScripts("shared/config.js", "shared/formatter.js");

const JOB_PREFIX = "profile-copy-job:";
const OFFSCREEN_DOCUMENT_PATH = "src/offscreen/offscreen.html";
const DETAIL_PATHS = ProfileCopyConfig.detailPaths;
const captureStarts = new Map();
const runningCaptures = new Map();
const CAPTURE_DELAYS = Object.freeze({
  beforeInitialRead: { minimum: 250, maximum: 550 },
  beforeBaseRetry: { minimum: 450, maximum: 850 },
  betweenDetailPages: { minimum: 550, maximum: 950 },
  afterDetailLoad: { minimum: 450, maximum: 850 }
});
const MAX_BASE_PROFILE_READS = 4;
let creatingOffscreenDocument;

async function hasOffscreenDocument() {
  const offscreenUrl = chrome.runtime.getURL(OFFSCREEN_DOCUMENT_PATH);

  if (chrome.runtime.getContexts) {
    const contexts = await chrome.runtime.getContexts({
      contextTypes: ["OFFSCREEN_DOCUMENT"],
      documentUrls: [offscreenUrl]
    });
    return contexts.length > 0;
  }

  const matchedClients = await clients.matchAll();
  return matchedClients.some(({ url }) => url === offscreenUrl);
}

async function ensureOffscreenDocument() {
  if (await hasOffscreenDocument()) {
    return;
  }

  if (!creatingOffscreenDocument) {
    creatingOffscreenDocument = chrome.offscreen.createDocument({
      url: OFFSCREEN_DOCUMENT_PATH,
      reasons: ["CLIPBOARD"],
      justification: "Copy a completed LinkedIn profile without changing the active tab."
    }).finally(() => {
      creatingOffscreenDocument = null;
    });
  }

  await creatingOffscreenDocument;
}

async function copyTextOffscreen(text, job) {
  await ensureOffscreenDocument();
  await checkCapture(job);
  const response = await chrome.runtime.sendMessage({
    target: "offscreen",
    type: "COPY_TEXT",
    text
  });

  if (!response?.ok) {
    throw new Error(response?.error || "Chrome blocked the automatic clipboard write.");
  }
}

function jobKey(jobId) {
  return `${JOB_PREFIX}${jobId}`;
}

const isLinkedInProfile = ProfileCopyConfig.isProfilePage;

function profileRoot(urlValue) {
  const url = new URL(urlValue);
  const match = url.pathname.match(/^\/in\/[^/]+/i);
  return `${url.origin}${match[0]}`;
}

function randomBetween(minimum, maximum) {
  const range = maximum - minimum + 1;
  const randomValue = new Uint32Array(1);
  crypto.getRandomValues(randomValue);
  return minimum + (randomValue[0] % range);
}

function sleep(milliseconds) {
  return new Promise((resolve) => setTimeout(resolve, milliseconds));
}

function pauseWithin({ minimum, maximum }) {
  return sleep(randomBetween(minimum, maximum));
}

async function getJob(jobId) {
  const key = jobKey(jobId);
  const stored = await chrome.storage.session.get(key);
  return stored[key];
}

async function setJob(jobId, value) {
  await chrome.storage.session.set({ [jobKey(jobId)]: value });
}

async function patchJob(jobId, patch) {
  const current = await getJob(jobId);
  if (!current || runningCaptures.get(jobId)?.cancelled) {
    throw new Error("Capture job was not found.");
  }

  const next = { ...current, ...patch, updatedAt: new Date().toISOString() };
  await setJob(jobId, next);
  if (runningCaptures.get(jobId)?.cancelled) {
    await chrome.storage.session.remove(jobKey(jobId));
    throw new Error("Copy cancelled.");
  }
  await chrome.tabs.sendMessage(next.sourceTabId, {
    type: "CAPTURE_JOB_UPDATED",
    job: next
  }).catch(() => undefined);
  return next;
}

async function createCaptureJob(request) {
  if (!captureStarts.has(request.sourceTabId) && captureStarts.size) {
    throw new Error("Finish or cancel the other profile copy first.");
  }
  if (!captureStarts.has(request.sourceTabId)) {
    const pending = prepareCaptureJob(request).finally(() => captureStarts.delete(request.sourceTabId));
    captureStarts.set(request.sourceTabId, pending);
  }
  return captureStarts.get(request.sourceTabId);
}

async function clearCaptureJob(jobId) {
  const running = runningCaptures.get(jobId);
  if (running) running.cancelled = true;
  const job = await getJob(jobId);
  await chrome.storage.session.remove(jobKey(jobId));
  if (job?.detailTabId) await chrome.tabs.remove(job.detailTabId).catch(() => undefined);
  if (job) await chrome.tabs.sendMessage(job.sourceTabId, {
    type: "CAPTURE_JOB_CLEARED", jobId
  }).catch(() => undefined);
}

async function checkCapture(job) {
  const source = await chrome.tabs.get(job.sourceTabId);
  if (runningCaptures.get(job.id)?.cancelled || !await getJob(job.id)
    || !isLinkedInProfile(source.url) || profileRoot(source.url) !== profileRoot(job.sourceUrl)) {
    throw new Error("Copy cancelled because the profile was closed or changed.");
  }
}

async function prepareCaptureJob(request) {
  let sourceTab = await chrome.tabs.get(request.sourceTabId);
  if (!isLinkedInProfile(sourceTab.url)) {
    throw new Error("Open a LinkedIn profile before starting a copy.");
  }
  await waitForTab(sourceTab.id, 20000, "the profile");
  sourceTab = await chrome.tabs.get(sourceTab.id);
  if (!isLinkedInProfile(sourceTab.url)) {
    throw new Error("The LinkedIn profile changed while it was loading.");
  }

  const storedJobs = await chrome.storage.session.get(null);
  const activeJob = Object.entries(storedJobs).find(([key, value]) => (
    key.startsWith(JOB_PREFIX)
    && value?.sourceTabId === sourceTab.id
    && ["ready", "running"].includes(value.status)
    && (value.status === "ready" || runningCaptures.has(value.id))
    && profileRoot(value.sourceUrl) === profileRoot(sourceTab.url)
  ));

  if (activeJob) {
    await sendToProfileTab(sourceTab.id, {
      type: "SHOW_CAPTURE_PANEL",
      job: activeJob[1]
    });
    return { ok: true, jobId: activeJob[1].id, alreadyRunning: true };
  }

  if (Array.from(runningCaptures.values()).some((state) => !state.cancelled)
    || Object.entries(storedJobs).some(([key, value]) => key.startsWith(JOB_PREFIX)
      && value?.sourceTabId !== sourceTab.id && value?.status === "ready")) {
    throw new Error("Finish or cancel the other profile copy first.");
  }

  for (const [key, value] of Object.entries(storedJobs)) {
    if (key.startsWith(JOB_PREFIX) && value?.sourceTabId === sourceTab.id) {
      await clearCaptureJob(value.id);
    }
  }
  const settings = ProfileCopyConfig.normaliseSettings(request.settings);
  if (!Object.values(settings.sections).some(Boolean) && !settings.includeProfileUrl) {
    throw new Error("Choose at least one section or the profile URL in Settings.");
  }
  const jobId = crypto.randomUUID();
  const job = {
    id: jobId,
    status: "ready",
    statusText: "Preparing full profile…",
    mode: "full",
    settings,
    sourceTabId: sourceTab.id,
    sourceWindowId: sourceTab.windowId,
    sourceUrl: sourceTab.url,
    createdAt: new Date().toISOString(),
    warnings: []
  };

  await setJob(jobId, job);
  try {
    await sendToProfileTab(sourceTab.id, { type: "SHOW_CAPTURE_PANEL", job });
  } catch (error) {
    await clearCaptureJob(jobId);
    throw error;
  }

  return { ok: true, jobId };
}

async function waitForTab(tabId, timeoutMs = 20000, description = "a detail page") {
  // Polling avoids missing onUpdated between the initial read and listener setup.
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if ((await chrome.tabs.get(tabId)).status === "complete") return;
    await sleep(200);
  }
  throw new Error(`LinkedIn took too long to load ${description}.`);
}

async function sendToProfileTab(tabId, message) {
  const tab = await chrome.tabs.get(tabId);
  const targetUrl = new URL(tab.url || "about:blank");
  if (targetUrl.protocol !== "https:" || !/(^|\.)linkedin\.com$/i.test(targetUrl.hostname)
    || !/^\/in\/[^/]+(?:\/|$)/i.test(targetUrl.pathname)) {
    throw new Error("The LinkedIn profile page is no longer open.");
  }
  try {
    return await chrome.tabs.sendMessage(tabId, message);
  } catch (error) {
    if (!/receiving end does not exist|could not establish connection/i.test(error.message)) throw error;
    await chrome.scripting.insertCSS({
      target: { tabId },
      files: ["src/content/profileOverlay.css"]
    });
    await chrome.scripting.executeScript({
      target: { tabId },
      files: [
        "src/shared/config.js",
        "src/shared/formatter.js",
        "src/content/profileExtractor.js"
      ]
    });
    return chrome.tabs.sendMessage(tabId, message);
  }
}

function shouldUseDetail(currentText, detailText) {
  if (!detailText?.trim()) {
    return false;
  }

  const currentScore = String(currentText || "").replace(/\s/g, "").length;
  const detailScore = detailText.replace(/\s/g, "").length;
  return detailScore > currentScore;
}

function hasRequestedDetailSection(profile, settings) {
  return Object.keys(DETAIL_PATHS).some((key) => settings.sections[key]
    && (profile.detailUrls?.[key] || profile.sections?.[key]?.trim()));
}

async function readBaseProfile(jobId, job) {
  let response;

  for (let attempt = 0; attempt < MAX_BASE_PROFILE_READS; attempt += 1) {
    response = await sendToProfileTab(job.sourceTabId, {
      type: "EXTRACT_BASE_PROFILE",
      settings: job.settings,
      loadLazySections: attempt === 0
    });

    if (!response?.ok) {
      throw new Error(response?.error || "The open LinkedIn profile could not be read.");
    }

    const profile = response.profile;
    if (!isLinkedInProfile(profile?.sourceUrl) || profileRoot(profile.sourceUrl) !== profileRoot(job.sourceUrl)) {
      throw new Error("The profile changed during copying. Please try again.");
    }

    const requestedDetails = Object.keys(DETAIL_PATHS).some((key) => job.settings.sections[key]);
    if (!requestedDetails || hasRequestedDetailSection(profile, job.settings)
      || attempt === MAX_BASE_PROFILE_READS - 1) {
      return profile;
    }

    await patchJob(jobId, { statusText: "Waiting for profile sections..." });
    await pauseWithin(CAPTURE_DELAYS.beforeBaseRetry);
    await checkCapture(job);
  }

  return response.profile;
}

async function collectDetailSection(jobId, job, sectionKey, detailUrl, index, total) {
  const definition = ProfileCopyConfig.sections.find(({ key }) => key === sectionKey);
  await checkCapture(job);
  await patchJob(jobId, {
    statusText: `Loading full ${definition.label.toLowerCase()}…`,
    progress: { current: index + 1, total }
  });

  await pauseWithin(CAPTURE_DELAYS.betweenDetailPages);
  await checkCapture(job);
  let detailTab;

  try {
    // LinkedIn's SDUI education LazyColumn does not reliably mount in an
    // inactive tab (reproduced on all three live backtest profiles).
    detailTab = await chrome.tabs.create({ active: sectionKey === "education", url: detailUrl, windowId: job.sourceWindowId });
    await patchJob(jobId, { detailTabId: detailTab.id });
    await waitForTab(detailTab.id);
    await pauseWithin(CAPTURE_DELAYS.afterDetailLoad);
    await checkCapture(job);
    const loadedTab = await chrome.tabs.get(detailTab.id);
    const loadedUrl = new URL(loadedTab.url);
    if (`${loadedUrl.origin}${loadedUrl.pathname.replace(/\/?$/, "/")}` !== detailUrl) {
      throw Object.assign(new Error("LinkedIn redirected to a different page."), { stopDetails: true });
    }
    const response = await sendToProfileTab(detailTab.id, {
      type: "EXTRACT_DETAIL_SECTION",
      sectionKey
    });

    if (!response?.ok) {
      throw new Error(response?.error || `Could not read ${definition.label}.`);
    }

    return response;
  } finally {
    if (detailTab?.id) {
      const restoreSource = sectionKey === "education"
        && (await chrome.tabs.get(detailTab.id).catch(() => null))?.active;
      await chrome.tabs.remove(detailTab.id).catch(() => undefined);
      // Do not steal focus back if the user switched elsewhere during capture.
      if (restoreSource) await chrome.tabs.update(job.sourceTabId, { active: true }).catch(() => undefined);
    }
  }
}

function runCapture(jobId) {
  if (!runningCaptures.has(jobId)) {
    const state = { cancelled: false };
    runningCaptures.set(jobId, state);
    state.promise = collectProfile(jobId).finally(() => runningCaptures.delete(jobId));
  }
  return runningCaptures.get(jobId).promise;
}

async function collectProfile(jobId) {
  const job = await getJob(jobId);
  if (!job) {
    throw new Error("Capture job was not found.");
  }

  if (job.status === "complete") {
    return { ok: true, alreadyComplete: true };
  }

  if (job.status === "running") {
    return { ok: true, alreadyRunning: true };
  }

  try {
    await checkCapture(job);
    await patchJob(jobId, { status: "running", statusText: "Reading profile…" });
    await pauseWithin(CAPTURE_DELAYS.beforeInitialRead);
    await checkCapture(job);
    const profile = await readBaseProfile(jobId, job);
    await checkCapture(job);
    profile.mode = job.mode;
    const warnings = [];
    const fallbackSections = new Set();

    const detailSections = Object.keys(DETAIL_PATHS).filter(
      (key) => job.settings.sections[key]
        && profile.detailUrls?.[key] === `${profileRoot(job.sourceUrl)}/details/${DETAIL_PATHS[key]}/`
    );

    for (let index = 0; index < detailSections.length; index += 1) {
      const sectionKey = detailSections[index];
      try {
        const detail = await collectDetailSection(
          jobId,
          job,
          sectionKey,
          profile.detailUrls[sectionKey],
          index,
          detailSections.length
        );

        if (shouldUseDetail(profile.sections[sectionKey], detail.text)) {
          profile.sections[sectionKey] = detail.text;
        }
        if (detail.incomplete || !detail.text?.trim()) fallbackSections.add(sectionKey);
        if (detail.incomplete) warnings.push(`${ProfileCopyConfig.sections.find(({ key }) => key === sectionKey).label} (loading limit reached)`);
      } catch (error) {
        await checkCapture(job);
        const unread = error.stopDetails ? detailSections.slice(index) : [sectionKey];
        warnings.push(...unread.map((section) => {
          fallbackSections.add(section);
          const label = ProfileCopyConfig.sections.find(({ key }) => key === section).label;
          return `${label} (${error.message || "could not be read"})`;
        }));
        if (error.stopDetails) break;
      }
    }

    await checkCapture(job);
    if (fallbackSections.size) {
      await patchJob(jobId, { statusText: "Reading available descriptions…", progress: null });
      const fallback = await sendToProfileTab(job.sourceTabId, {
        type: "EXTRACT_BASE_PROFILE", expandLinkedSections: true,
        settings: { sections: Object.fromEntries(ProfileCopyConfig.sections.map(({ key }) => [key, fallbackSections.has(key)])) }
      }).catch(() => null);
      await checkCapture(job);
      if (fallback?.ok && isLinkedInProfile(fallback.profile?.sourceUrl)
        && profileRoot(fallback.profile.sourceUrl) === profileRoot(job.sourceUrl)) {
        for (const key of fallbackSections) {
          const text = fallback.profile.sections?.[key];
          if (shouldUseDetail(profile.sections[key], text)) profile.sections[key] = text;
        }
      }
    }
    let autoCopyStatus = null;
    if (job.settings.autoCopy) {
      try {
        const formattedProfile = ProfileCopyFormatter.formatProfile(profile, job.settings);
        await copyTextOffscreen(formattedProfile, job);
        autoCopyStatus = "copied";
      } catch {
        autoCopyStatus = "failed";
      }
    }

    await checkCapture(job);
    await patchJob(jobId, {
      status: "complete",
      detailTabId: null,
      statusText: "Profile ready",
      profile,
      warnings,
      autoCopyStatus,
      completedAt: new Date().toISOString(),
      progress: null
    });

    return { ok: true };
  } catch (error) {
    if (!await getJob(jobId) || runningCaptures.get(jobId)?.cancelled) {
      return { ok: false, error: error.message };
    }
    await patchJob(jobId, {
      status: "failed",
      statusText: "Copy failed",
      error: error.message || "The profile could not be copied."
    });
    return { ok: false, error: error.message };
  }
}

chrome.runtime.onMessage.addListener((request, _sender, sendResponse) => {
  if (request?.type === "CREATE_CAPTURE_JOB") {
    createCaptureJob(request)
      .then(sendResponse)
      .catch((error) => sendResponse({ ok: false, error: error.message }));
    return true;
  }

  if (request?.type === "RUN_CAPTURE") {
    runCapture(request.jobId)
      .then(sendResponse)
      .catch((error) => sendResponse({ ok: false, error: error.message }));
    return true;
  }

  if (request?.type === "CLEAR_CAPTURE_JOB") {
    clearCaptureJob(request.jobId)
      .then(() => sendResponse({ ok: true }))
      .catch((error) => sendResponse({ ok: false, error: error.message }));
    return true;
  }

  return false;
});

async function clearTabJobs(tabId, url) {
  const stored = await chrome.storage.session.get(null);
  for (const [key, job] of Object.entries(stored)) {
    if (key.startsWith(JOB_PREFIX) && job?.sourceTabId === tabId
      && (!url || !isLinkedInProfile(url) || profileRoot(url) !== profileRoot(job.sourceUrl))) {
      await clearCaptureJob(job.id);
    }
  }
}

chrome.tabs.onRemoved.addListener((tabId) => { clearTabJobs(tabId).catch(() => undefined); });
chrome.tabs.onUpdated.addListener((tabId, change) => {
  if (change.url || change.status === "loading") {
    clearTabJobs(tabId, change.status === "loading" ? null : change.url).catch(() => undefined);
  }
});
