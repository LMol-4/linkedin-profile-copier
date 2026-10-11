const tabButtons = Array.from(document.querySelectorAll("[role='tab']"));
const copyButton = document.querySelector("[data-copy-mode]");
const cancelButton = document.getElementById("cancel-copy");
const sectionSettings = document.getElementById("section-settings");
const popupStatus = document.getElementById("popup-status");
const savedStatus = document.getElementById("saved-status");
const settingInputs = {
  startOnOpen: document.getElementById("start-on-open-setting"),
  autoCopy: document.getElementById("auto-copy-setting"),
  includeProfileUrl: document.getElementById("profile-url-setting"),
  markdown: document.getElementById("markdown-setting")
};
let settings = ProfileCopyConfig.normaliseSettings();
let activeTab;
let currentJobId;
let busy = false;
let ready = false;
let saveQueue = Promise.resolve();

function selectTab(selectedButton) {
  for (const button of tabButtons) {
    const selected = button === selectedButton;
    button.classList.toggle("is-active", selected);
    button.setAttribute("aria-selected", String(selected));
    button.tabIndex = selected ? 0 : -1;
    document.getElementById(button.dataset.panel).hidden = !selected;
  }
}

function createSwitch(section) {
  const row = document.createElement("label");
  row.className = "setting-row";
  const copy = document.createElement("div");
  const label = document.createElement("strong");
  const description = document.createElement("span");
  label.textContent = section.label;
  description.textContent = section.description;
  copy.append(label, description);
  const switchLabel = document.createElement("span");
  switchLabel.className = "switch";
  const input = document.createElement("input");
  input.type = "checkbox";
  input.checked = settings.sections[section.key];
  input.setAttribute("aria-label", `Include ${section.label}`);
  input.dataset.section = section.key;
  const track = document.createElement("span");
  track.className = "switch-track";
  track.setAttribute("aria-hidden", "true");
  switchLabel.append(input, track);
  row.append(copy, switchLabel);
  return row;
}

function updateCopyState() {
  const count = Object.values(settings.sections).filter(Boolean).length;
  document.getElementById("selection-summary").textContent =
    `${count} section${count === 1 ? "" : "s"} · ${settings.markdown ? "Markdown" : "Plain text"}${settings.includeProfileUrl ? " · Profile URL" : ""}`;
  document.getElementById("copy-help").textContent = settings.autoCopy
    ? "Your selected sections will be copied to your clipboard when ready."
    : "Review the text on the profile, then select Copy all.";
  copyButton.disabled = !ready || busy || !ProfileCopyConfig.isProfilePage(activeTab?.url)
    || (!count && !settings.includeProfileUrl);
  copyButton.textContent = busy ? "Copying…" : "Copy profile";
  cancelButton.hidden = !busy || !currentJobId;
}

function persistSettings() {
  updateCopyState();
  const snapshot = { ...settings, sections: { ...settings.sections } };
  savedStatus.textContent = "Saving…";
  savedStatus.classList.remove("is-error");
  saveQueue = saveQueue.catch(() => undefined).then(() => chrome.storage.sync.set(snapshot));
  saveQueue.then(() => { savedStatus.textContent = "Saved"; }).catch(() => {
    savedStatus.textContent = "Could not save. Change the setting again to retry.";
    savedStatus.classList.add("is-error");
  });
}

function renderJob(job) {
  busy = ["ready", "running"].includes(job.status);
  popupStatus.classList.toggle("is-error", job.status === "failed");
  popupStatus.textContent = job.status === "complete"
    ? (job.autoCopyStatus === "copied" ? "Copied to clipboard." : "Ready on the profile. Select Copy all there.")
    : job.error || job.statusText;
  if (job.status === "complete" && job.warnings?.length) popupStatus.textContent += " Some details could not be loaded.";
  updateCopyState();
}

async function startCopy() {
  if (copyButton.disabled) return;
  busy = true;
  updateCopyState();
  popupStatus.classList.remove("is-error");
  popupStatus.textContent = "Starting on this profile…";
  try {
    await saveQueue;
    const response = await chrome.runtime.sendMessage({
      type: "CREATE_CAPTURE_JOB", sourceTabId: activeTab.id, settings
    });
    if (!response?.ok) throw new Error(response?.error || "The copy could not be started.");
    currentJobId = response.jobId;
    const stored = await chrome.storage.session.get(`profile-copy-job:${currentJobId}`);
    const job = stored[`profile-copy-job:${currentJobId}`];
    if (job) renderJob(job);
    else { busy = false; popupStatus.textContent = "Copy cancelled. You can try again."; }
  } catch (error) {
    popupStatus.textContent = error.message || "Open a LinkedIn profile and try again.";
    popupStatus.classList.add("is-error");
    busy = false;
  }
  updateCopyState();
}

cancelButton.addEventListener("click", async () => {
  cancelButton.disabled = true;
  try {
    const response = await chrome.runtime.sendMessage({ type: "CLEAR_CAPTURE_JOB", jobId: currentJobId });
    if (!response?.ok) throw new Error(response?.error || "Could not cancel. Try closing the panel on the profile.");
  } catch (error) {
    popupStatus.textContent = error.message;
    popupStatus.classList.add("is-error");
  } finally {
    cancelButton.disabled = false;
  }
});

chrome.storage.onChanged.addListener((changes, area) => {
  const change = changes[`profile-copy-job:${currentJobId}`];
  if (area !== "session" || !change) return;
  if (change.newValue) renderJob(change.newValue);
  else {
    busy = false;
    currentJobId = null;
    popupStatus.textContent = "Copy cancelled. You can start again.";
    updateCopyState();
  }
});

tabButtons.forEach((button, index) => {
  button.addEventListener("click", () => selectTab(button));
  button.addEventListener("keydown", (event) => {
    if (!["ArrowLeft", "ArrowRight", "Home", "End"].includes(event.key)) return;
    event.preventDefault();
    const next = event.key === "Home" ? 0 : event.key === "End" ? tabButtons.length - 1
      : (index + (event.key === "ArrowRight" ? 1 : -1) + tabButtons.length) % tabButtons.length;
    selectTab(tabButtons[next]);
    tabButtons[next].focus();
  });
});
copyButton.addEventListener("click", startCopy);
sectionSettings.addEventListener("change", (event) => {
  const key = event.target.dataset.section;
  if (key) { settings.sections[key] = event.target.checked; persistSettings(); }
});
for (const [key, input] of Object.entries(settingInputs)) {
  input.disabled = true;
  input.addEventListener("change", () => { settings[key] = input.checked; persistSettings(); });
}

async function initialise() {
  try {
    const [stored, tabs] = await Promise.all([
      chrome.storage.sync.get(Object.keys(ProfileCopyConfig.defaultSettings)),
      chrome.tabs.query({ active: true, currentWindow: true })
    ]);
    settings = ProfileCopyConfig.normaliseSettings(stored);
    activeTab = tabs[0];
    sectionSettings.replaceChildren(...ProfileCopyConfig.sections.map(createSwitch));
    for (const [key, input] of Object.entries(settingInputs)) {
      input.checked = settings[key];
      input.disabled = false;
    }
    ready = true;
    updateCopyState();
    const jobs = await chrome.storage.session.get(null);
    const runningJob = Object.entries(jobs).find(([key, job]) => key.startsWith("profile-copy-job:")
      && job?.sourceTabId === activeTab?.id && ["ready", "running"].includes(job.status))?.[1];
    if (runningJob) {
      currentJobId = runningJob.id;
      renderJob(runningJob);
    } else if (!ProfileCopyConfig.isProfilePage(activeTab?.url)) {
      popupStatus.textContent = "Open the main LinkedIn profile to copy. Settings is still available.";
    } else if (settings.startOnOpen) {
      await startCopy();
    }
  } catch {
    popupStatus.textContent = "Could not load settings. Close and reopen the extension to retry.";
    popupStatus.classList.add("is-error");
  }
}
initialise();
