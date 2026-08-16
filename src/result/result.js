const jobId = new URLSearchParams(window.location.search).get("job");
const storageKey = jobId ? `profile-copy-job:${jobId}` : "";

const elements = {
  pageTitle: document.getElementById("page-title"),
  modeBadge: document.getElementById("mode-badge"),
  statusCard: document.getElementById("status-card"),
  statusTitle: document.getElementById("status-title"),
  statusDetail: document.getElementById("status-detail"),
  outputCard: document.getElementById("output-card"),
  output: document.getElementById("profile-output"),
  copyButton: document.getElementById("copy-button"),
  captureMeta: document.getElementById("capture-meta"),
  warning: document.getElementById("warning")
};

let runRequested = false;

function showFailure(message) {
  elements.pageTitle.textContent = "Couldn’t copy this profile";
  elements.statusTitle.textContent = "Copy failed";
  elements.statusDetail.textContent = message || "Return to the LinkedIn profile and try again.";
  elements.statusCard.classList.add("is-error");
  elements.outputCard.hidden = true;
}

function showComplete(job) {
  const profileName = job.profile?.header?.name || "LinkedIn profile";
  const output = ProfileCopyFormatter.formatProfile(job.profile, job.settings);
  const completedAt = new Date(job.completedAt || Date.now());

  elements.pageTitle.textContent = profileName;
  elements.modeBadge.textContent = job.mode === "full" ? "Full copy" : "Simple copy";
  elements.output.value = output;
  elements.captureMeta.textContent = `${job.mode === "full" ? "Full" : "Simple"} copy · ${completedAt.toLocaleString()}`;
  elements.statusCard.hidden = true;
  elements.outputCard.hidden = false;

  if (job.warnings?.length) {
    elements.warning.textContent = `The visible-page version was used for: ${job.warnings.join(", ")}.`;
    elements.warning.hidden = false;
  }
}

async function requestRun() {
  if (runRequested || !jobId) {
    return;
  }

  runRequested = true;
  const response = await chrome.runtime.sendMessage({ type: "RUN_CAPTURE", jobId });
  if (!response?.ok && !response?.alreadyRunning) {
    showFailure(response?.error);
  }
}

function renderJob(job) {
  if (!job) {
    showFailure("This capture has expired. Start a new copy from the extension popup.");
    return;
  }

  elements.modeBadge.textContent = job.mode === "full" ? "Full copy" : "Simple copy";

  if (job.status === "complete") {
    showComplete(job);
    return;
  }

  if (job.status === "failed") {
    showFailure(job.error);
    return;
  }

  elements.statusTitle.textContent = job.statusText || "Reading profile…";
  elements.statusDetail.textContent = job.progress
    ? `Section ${job.progress.current} of ${job.progress.total}. Background tabs close automatically.`
    : "Keep this tab open for a moment.";

  if (job.status === "ready") {
    requestRun();
  }
}

async function copyOutput() {
  const text = elements.output.value;

  try {
    await navigator.clipboard.writeText(text);
  } catch {
    elements.output.focus();
    elements.output.select();
    document.execCommand("copy");
  }

  elements.copyButton.textContent = "Copied";
  window.setTimeout(() => {
    elements.copyButton.textContent = "Copy all";
  }, 1600);
}

elements.copyButton.addEventListener("click", copyOutput);

if (globalThis.chrome?.storage?.session && jobId) {
  chrome.storage.onChanged.addListener((changes, areaName) => {
    if (areaName === "session" && changes[storageKey]) {
      renderJob(changes[storageKey].newValue);
    }
  });

  chrome.storage.session.get(storageKey).then((stored) => renderJob(stored[storageKey]));
} else if (new URLSearchParams(window.location.search).has("preview")) {
  showComplete({
    mode: "full",
    completedAt: new Date().toISOString(),
    settings: ProfileCopyConfig.defaultSettings,
    profile: {
      header: {
        name: "Jordan Lee",
        headline: "Product designer building useful, human software",
        location: "London, United Kingdom"
      },
      sections: {
        about: "I turn complex product problems into clear, thoughtful experiences.",
        experience: "Lead Product Designer\nNorthstar Studio\n2023 – Present\n\nProduct Designer\nFieldwork\n2020 – 2023",
        education: "University of the Arts London\nBA, Interaction Design",
        skills: "Product design\nDesign systems\nUser research",
        certifications: "Human-Centred Design Practitioner",
        projects: "Open Design Toolkit",
        languages: "English\nFrench"
      }
    },
    warnings: []
  });
} else {
  showFailure("This result link is missing its capture reference.");
}
