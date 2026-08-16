const tabButtons = Array.from(document.querySelectorAll("[role='tab']"));
const actionButtons = Array.from(document.querySelectorAll("[data-copy-mode]"));
const sectionSettings = document.getElementById("section-settings");
const markdownSetting = document.getElementById("markdown-setting");
const popupStatus = document.getElementById("popup-status");
const savedStatus = document.getElementById("saved-status");

let settings = ProfileCopyConfig.normaliseSettings();
let savedStatusTimer;

function selectTab(selectedButton) {
  for (const button of tabButtons) {
    const selected = button === selectedButton;
    button.classList.toggle("is-active", selected);
    button.setAttribute("aria-selected", String(selected));
    document.getElementById(button.dataset.panel).hidden = !selected;
  }
}

function createSwitch(section) {
  const row = document.createElement("div");
  row.className = "setting-row";

  const copy = document.createElement("div");
  const label = document.createElement("strong");
  const description = document.createElement("span");
  label.textContent = section.label;
  description.textContent = section.description;
  copy.append(label, description);

  const switchLabel = document.createElement("label");
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

function renderSettings() {
  sectionSettings.replaceChildren(...ProfileCopyConfig.sections.map(createSwitch));
  markdownSetting.checked = settings.markdown;
}

function showSaved() {
  window.clearTimeout(savedStatusTimer);
  savedStatus.textContent = "Saved";
  savedStatusTimer = window.setTimeout(() => {
    savedStatus.textContent = "";
  }, 1200);
}

async function persistSettings() {
  if (globalThis.chrome?.storage?.sync) {
    await chrome.storage.sync.set(settings);
  }
  showSaved();
}

function setBusy(busy, mode) {
  for (const button of actionButtons) {
    button.disabled = busy;
    button.textContent = busy && button.dataset.copyMode === mode
      ? "Opening…"
      : `${button.dataset.copyMode === "full" ? "Full" : "Simple"} copy`;
  }
}

async function startCopy(mode) {
  popupStatus.classList.remove("is-error");
  popupStatus.textContent = mode === "full" ? "Preparing a full copy…" : "Reading this profile…";
  setBusy(true, mode);

  try {
    if (!globalThis.chrome?.runtime) {
      throw new Error("Load the extension in Chrome to copy a profile.");
    }

    const [activeTab] = await chrome.tabs.query({ active: true, currentWindow: true });
    const response = await chrome.runtime.sendMessage({
      type: "CREATE_CAPTURE_JOB",
      sourceTabId: activeTab?.id,
      mode,
      settings
    });

    if (!response?.ok) {
      throw new Error(response?.error || "The copy could not be started.");
    }
  } catch (error) {
    popupStatus.textContent = error.message || "Open a LinkedIn profile and try again.";
    popupStatus.classList.add("is-error");
    setBusy(false, mode);
  }
}

tabButtons.forEach((button) => {
  button.addEventListener("click", () => selectTab(button));
});

actionButtons.forEach((button) => {
  button.addEventListener("click", () => startCopy(button.dataset.copyMode));
});

sectionSettings.addEventListener("change", (event) => {
  const sectionKey = event.target.dataset.section;
  if (!sectionKey) {
    return;
  }

  settings.sections[sectionKey] = event.target.checked;
  persistSettings();
});

markdownSetting.addEventListener("change", () => {
  settings.markdown = markdownSetting.checked;
  persistSettings();
});

if (globalThis.chrome?.storage?.sync) {
  chrome.storage.sync.get(["sections", "markdown"]).then((stored) => {
    settings = ProfileCopyConfig.normaliseSettings(stored);
    renderSettings();
  });
} else {
  renderSettings();
}
