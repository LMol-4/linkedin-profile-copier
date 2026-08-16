importScripts("shared/config.js");

const JOB_PREFIX = "profile-copy-job:";
const DETAIL_PATHS = {
  experience: "experience",
  education: "education",
  skills: "skills",
  certifications: "certifications",
  projects: "projects",
  languages: "languages"
};
const CAPTURE_DELAYS = Object.freeze({
  beforeInitialRead: { minimum: 450, maximum: 900 },
  betweenDetailPages: { minimum: 900, maximum: 1800 },
  afterDetailLoad: { minimum: 1500, maximum: 2900 }
});

function jobKey(jobId) {
  return `${JOB_PREFIX}${jobId}`;
}

function isLinkedInProfile(urlValue) {
  try {
    const url = new URL(urlValue);
    return /(^|\.)linkedin\.com$/i.test(url.hostname) && /^\/in\/[^/]+/i.test(url.pathname);
  } catch {
    return false;
  }
}

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
  if (!current) {
    throw new Error("Capture job was not found.");
  }

  const next = { ...current, ...patch, updatedAt: new Date().toISOString() };
  await setJob(jobId, next);
  return next;
}

async function createCaptureJob(request) {
  const sourceTab = await chrome.tabs.get(request.sourceTabId);
  if (!isLinkedInProfile(sourceTab.url)) {
    throw new Error("Open a LinkedIn profile before starting a copy.");
  }

  const mode = request.mode === "full" ? "full" : "simple";
  const settings = ProfileCopyConfig.normaliseSettings(request.settings);
  const jobId = crypto.randomUUID();
  const job = {
    id: jobId,
    status: "ready",
    statusText: mode === "full" ? "Preparing full profile…" : "Reading visible profile…",
    mode,
    settings,
    sourceTabId: sourceTab.id,
    sourceUrl: sourceTab.url,
    createdAt: new Date().toISOString(),
    warnings: []
  };

  await setJob(jobId, job);
  const resultTab = await chrome.tabs.create({
    active: false,
    url: "about:blank"
  });
  await patchJob(jobId, { resultTabId: resultTab.id });
  await chrome.tabs.update(resultTab.id, {
    active: true,
    url: chrome.runtime.getURL(`src/result/result.html?job=${encodeURIComponent(jobId)}`)
  });

  return { ok: true, jobId };
}

async function waitForTab(tabId, timeoutMs = 20000) {
  const initial = await chrome.tabs.get(tabId);
  if (initial.status === "complete") {
    return;
  }

  await new Promise((resolve, reject) => {
    const timeout = setTimeout(() => {
      chrome.tabs.onUpdated.removeListener(onUpdated);
      reject(new Error("LinkedIn took too long to load a detail page."));
    }, timeoutMs);

    function onUpdated(updatedTabId, changeInfo) {
      if (updatedTabId === tabId && changeInfo.status === "complete") {
        clearTimeout(timeout);
        chrome.tabs.onUpdated.removeListener(onUpdated);
        resolve();
      }
    }

    chrome.tabs.onUpdated.addListener(onUpdated);
  });
}

async function sendToProfileTab(tabId, message) {
  try {
    return await chrome.tabs.sendMessage(tabId, message);
  } catch {
    await chrome.scripting.executeScript({
      target: { tabId },
      files: ["src/content/profileExtractor.js"]
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

async function collectDetailSection(jobId, job, sectionKey, index, total) {
  const definition = ProfileCopyConfig.sections.find(({ key }) => key === sectionKey);
  await patchJob(jobId, {
    statusText: `Loading full ${definition.label.toLowerCase()}…`,
    progress: { current: index + 1, total }
  });

  await pauseWithin(CAPTURE_DELAYS.betweenDetailPages);
  const detailUrl = `${profileRoot(job.sourceUrl)}/details/${DETAIL_PATHS[sectionKey]}/`;
  let detailTab;

  try {
    detailTab = await chrome.tabs.create({ active: false, url: detailUrl });
    await waitForTab(detailTab.id);
    await pauseWithin(CAPTURE_DELAYS.afterDetailLoad);
    const response = await sendToProfileTab(detailTab.id, {
      type: "EXTRACT_DETAIL_SECTION",
      sectionKey
    });

    if (!response?.ok) {
      throw new Error(`Could not read ${definition.label}.`);
    }

    return response.text || "";
  } finally {
    if (detailTab?.id) {
      await chrome.tabs.remove(detailTab.id).catch(() => undefined);
    }
  }
}

async function runCapture(jobId) {
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

  await patchJob(jobId, { status: "running", statusText: "Reading visible profile…" });

  try {
    await pauseWithin(CAPTURE_DELAYS.beforeInitialRead);
    const baseResponse = await sendToProfileTab(job.sourceTabId, {
      type: "EXTRACT_BASE_PROFILE",
      settings: job.settings
    });

    if (!baseResponse?.ok) {
      throw new Error("The open LinkedIn profile could not be read.");
    }

    const profile = baseResponse.profile;
    profile.mode = job.mode;
    const warnings = [];

    if (job.mode === "full") {
      const detailSections = Object.keys(DETAIL_PATHS).filter(
        (key) => job.settings.sections[key]
      );

      for (let index = 0; index < detailSections.length; index += 1) {
        const sectionKey = detailSections[index];
        try {
          const detailText = await collectDetailSection(
            jobId,
            job,
            sectionKey,
            index,
            detailSections.length
          );

          if (shouldUseDetail(profile.sections[sectionKey], detailText)) {
            profile.sections[sectionKey] = detailText;
          }
        } catch {
          const label = ProfileCopyConfig.sections.find(({ key }) => key === sectionKey)?.label;
          warnings.push(label || sectionKey);
        }
      }
    }

    await patchJob(jobId, {
      status: "complete",
      statusText: "Profile ready",
      profile,
      warnings,
      completedAt: new Date().toISOString(),
      progress: null
    });

    return { ok: true };
  } catch (error) {
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

  return false;
});

chrome.tabs.onRemoved.addListener(async (tabId) => {
  const stored = await chrome.storage.session.get(null);
  const keysToRemove = Object.entries(stored)
    .filter(([key, value]) => key.startsWith(JOB_PREFIX) && value?.resultTabId === tabId)
    .map(([key]) => key);

  if (keysToRemove.length) {
    await chrome.storage.session.remove(keysToRemove);
  }
});
