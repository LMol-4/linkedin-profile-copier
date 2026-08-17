(function installProfileExtractor() {
  if (globalThis.__LINKEDIN_PROFILE_COPY_INSTALLED__) {
    return;
  }

  globalThis.__LINKEDIN_PROFILE_COPY_INSTALLED__ = true;

  const sectionMeta = {
    about: { ids: ["about"], headings: ["about"] },
    experience: { ids: ["experience"], headings: ["experience"] },
    education: { ids: ["education"], headings: ["education"] },
    skills: { ids: ["skills"], headings: ["skills"] },
    certifications: {
      ids: ["licenses_and_certifications", "certifications"],
      headings: ["licenses & certifications", "licenses and certifications", "certifications"]
    },
    projects: { ids: ["projects"], headings: ["projects"] },
    languages: { ids: ["languages"], headings: ["languages"] }
  };

  const removableLinePatterns = [
    /^show (all|more|less)(?:\s+\d+)?/i,
    /^see (all|more|less)/i,
    /^view (all|more)/i,
    /^expand (?:this )?section/i,
    /^collapse (?:this )?section/i,
    /^end of list$/i,
    /^company logo$/i,
    /^school logo$/i,
    /^profile photo$/i,
    /^graphic$/i
  ];
  const sectionBoundaryPatterns = [
    /^more profiles for you$/i,
    /^people also viewed$/i,
    /^people you may know$/i,
    /^recommended for you$/i,
    /^select language$/i,
    /^linkedin corporation ©\s*\d{4}$/i
  ];
  const startedCaptureJobs = new Set();
  const dismissedCaptureJobs = new Set();
  let capturePanelState = null;

  function elementText(element) {
    return element ? element.innerText || element.textContent || "" : "";
  }

  function normaliseLine(line) {
    return line
      .replace(/\u00a0/g, " ")
      .replace(/[ \t]+/g, " ")
      .replace(/^\s*[•·]\s*/, "• ")
      .trim();
  }

  function cleanLines(value) {
    const result = [];

    for (const rawLine of String(value || "").split(/\r?\n/)) {
      const line = normaliseLine(rawLine);
      if (!line || removableLinePatterns.some((pattern) => pattern.test(line))) {
        continue;
      }

      if (result[result.length - 1] !== line) {
        result.push(line);
      }
    }

    return result;
  }

  function findSection(key) {
    const meta = sectionMeta[key];
    if (!meta) {
      return null;
    }

    for (const id of meta.ids) {
      const anchor = document.getElementById(id);
      const section = anchor?.closest("section, .artdeco-card")
        || anchor?.parentElement?.closest("section, .artdeco-card");
      if (section) {
        return section;
      }
    }

    const primaryRoot = document.querySelector(".scaffold-layout__main")
      || document.querySelector("main, [role='main']")
      || document.body;
    const headings = primaryRoot.querySelectorAll(
      "h1, h2, h3, [role='heading'], .pvs-header__title"
    );

    for (const heading of headings) {
      const headingText = normaliseLine(elementText(heading)).toLowerCase();
      if (meta.headings.some((value) => headingText === value || headingText.startsWith(`${value} `))) {
        return heading.closest("section, .artdeco-card") || heading.parentElement;
      }
    }

    return null;
  }

  function cleanSectionText(value, key) {
    const headings = sectionMeta[key]?.headings || [];
    const cleanedLines = cleanLines(value);
    const boundaryIndex = cleanedLines.findIndex((line, index) => {
      if (sectionBoundaryPatterns.some((pattern) => pattern.test(line))) {
        return true;
      }

      return /^about$/i.test(line) && /^accessibility$/i.test(cleanedLines[index + 1] || "");
    });
    const boundedLines = boundaryIndex >= 0
      ? cleanedLines.slice(0, boundaryIndex)
      : cleanedLines;
    const lines = boundedLines.filter((line) => {
      const lower = line.toLowerCase();
      return !headings.includes(lower) && !headings.some((heading) => lower === `${heading} section`);
    });

    return lines.join("\n").trim();
  }

  function extractHeader() {
    const main = document.querySelector(".scaffold-layout__main")
      || document.querySelector("main, [role='main']")
      || document.body;
    const nameElement = main.querySelector("h1");
    const card = nameElement?.closest("section") || main.querySelector("section") || main;
    const name = normaliseLine(elementText(nameElement));

    const headlineElement = card.querySelector(
      ".text-body-medium.break-words, .text-body-medium[data-generated-suggestion-target]"
    );
    const locationElement = card.querySelector(
      ".text-body-small.inline.t-black--light.break-words, .text-body-small.t-black--light.break-words"
    );

    let headline = normaliseLine(elementText(headlineElement));
    let location = normaliseLine(elementText(locationElement));
    const isConnectionDegree = (line) => /^[•·]?\s*(1st|2nd|3rd)(?:\s+degree connection)?$/i.test(line);

    if (isConnectionDegree(headline)) {
      headline = "";
    }

    if (isConnectionDegree(location)) {
      location = "";
    }

    if (!headline || !location) {
      const cardLines = cleanLines(elementText(card));
      const nameIndex = cardLines.indexOf(name);
      const details = cardLines
        .slice(nameIndex >= 0 ? nameIndex + 1 : 0)
        .filter((line) => (
          !isConnectionDegree(line)
          && !/^(contact info|connections?|followers?|message|connect|follow|more)$/i.test(line)
        ));

      headline ||= details[0] || "";
      location ||= details.find((line) => line !== headline && !/\d[\d,.]*\+?\s+(connections?|followers?)/i.test(line)) || "";
    }

    return { name, headline, location };
  }

  function extractBaseProfile(settings = {}) {
    const selected = settings.sections || {};
    const sections = {};

    for (const key of Object.keys(sectionMeta)) {
      if (selected[key] === false) {
        continue;
      }

      const section = findSection(key);
      sections[key] = cleanSectionText(elementText(section), key);
    }

    return {
      sourceUrl: window.location.href,
      capturedAt: new Date().toISOString(),
      header: selected.header === false ? {} : extractHeader(),
      sections
    };
  }

  function extractDetailSection(key) {
    const section = findSection(key);
    if (section) {
      return cleanSectionText(elementText(section), key);
    }

    const primaryRoot = document.querySelector(".scaffold-layout__main")
      || document.querySelector("main, [role='main']");
    const detailList = primaryRoot?.querySelector(
      ".pvs-list__container, ul.pvs-list, [data-view-name='profile-component-entity-list']"
    );
    return cleanSectionText(elementText(detailList || primaryRoot), key);
  }

  function removeCapturePanel() {
    if (!capturePanelState) {
      return;
    }

    const { job } = capturePanelState;
    capturePanelState.element.remove();
    capturePanelState = null;

    if (["complete", "failed"].includes(job.status)) {
      chrome.runtime.sendMessage({
        type: "CLEAR_CAPTURE_JOB",
        jobId: job.id
      }).catch(() => undefined);
    } else {
      dismissedCaptureJobs.add(job.id);
    }
  }

  async function copyCaptureOutput() {
    const textarea = capturePanelState?.element.querySelector("[data-lpc-output]");
    const button = capturePanelState?.element.querySelector("[data-lpc-copy]");
    if (!textarea || !button) {
      return;
    }

    try {
      await navigator.clipboard.writeText(textarea.value);
    } catch {
      textarea.focus();
      textarea.select();
      document.execCommand("copy");
    }

    button.textContent = "Copied";
    window.setTimeout(() => {
      if (button.isConnected) {
        button.textContent = "Copy all";
      }
    }, 1600);
  }

  function createCapturePanel(job) {
    capturePanelState?.element.remove();

    const panel = document.createElement("aside");
    panel.className = "lpc-panel";
    panel.setAttribute("aria-live", "polite");
    panel.innerHTML = `
      <header class="lpc-header">
        <div>
          <span class="lpc-eyebrow">LinkedIn Profile Copier</span>
          <strong data-lpc-title>Full profile copy</strong>
        </div>
        <button class="lpc-close" type="button" aria-label="Close profile copier">×</button>
      </header>
      <div class="lpc-body">
        <div class="lpc-loading" data-lpc-loading>
          <span class="lpc-spinner" aria-hidden="true"></span>
          <div>
            <strong data-lpc-status>Preparing full profile…</strong>
            <p data-lpc-detail>Keep this profile tab open.</p>
          </div>
        </div>
        <div class="lpc-result" data-lpc-result hidden>
          <textarea data-lpc-output spellcheck="false" aria-label="Copied LinkedIn profile text"></textarea>
          <p class="lpc-auto-copy" data-lpc-auto-copy hidden></p>
          <p class="lpc-warning" data-lpc-warning hidden></p>
          <button class="lpc-copy" data-lpc-copy type="button">Copy all</button>
        </div>
      </div>
    `;

    panel.querySelector(".lpc-close").addEventListener("click", removeCapturePanel);
    panel.querySelector("[data-lpc-copy]").addEventListener("click", copyCaptureOutput);
    document.body.appendChild(panel);
    capturePanelState = { element: panel, job };
    return panel;
  }

  function renderCaptureJob(job) {
    const panel = capturePanelState?.job.id === job.id
      ? capturePanelState.element
      : createCapturePanel(job);
    capturePanelState.job = job;

    const title = panel.querySelector("[data-lpc-title]");
    const loading = panel.querySelector("[data-lpc-loading]");
    const status = panel.querySelector("[data-lpc-status]");
    const detail = panel.querySelector("[data-lpc-detail]");
    const result = panel.querySelector("[data-lpc-result]");
    const output = panel.querySelector("[data-lpc-output]");
    const autoCopy = panel.querySelector("[data-lpc-auto-copy]");
    const warning = panel.querySelector("[data-lpc-warning]");

    if (job.status === "complete") {
      title.textContent = job.profile?.header?.name || "Profile ready";
      output.value = ProfileCopyFormatter.formatProfile(job.profile, job.settings);
      loading.hidden = true;
      result.hidden = false;

      if (job.autoCopyStatus === "copied") {
        autoCopy.textContent = "Copied automatically to your clipboard.";
        autoCopy.classList.remove("lpc-is-warning");
        autoCopy.hidden = false;
      } else if (job.autoCopyStatus === "failed") {
        autoCopy.textContent = "Automatic copy was blocked. Use Copy all below.";
        autoCopy.classList.add("lpc-is-warning");
        autoCopy.hidden = false;
      } else {
        autoCopy.hidden = true;
      }

      if (job.warnings?.length) {
        warning.textContent = `Used the visible profile version for: ${job.warnings.join(", ")}.`;
        warning.hidden = false;
      } else {
        warning.hidden = true;
      }
      return;
    }

    if (job.status === "failed") {
      title.textContent = "Copy failed";
      status.textContent = job.error || "The profile could not be copied.";
      detail.textContent = "Close this panel and try again from the extension.";
      panel.classList.add("lpc-is-error");
      loading.hidden = false;
      result.hidden = true;
      return;
    }

    panel.classList.remove("lpc-is-error");
    title.textContent = "Full profile copy";
    status.textContent = job.statusText || "Reading profile…";
    detail.textContent = job.progress
      ? `Section ${job.progress.current} of ${job.progress.total}. Temporary tabs close automatically.`
      : "Keep this profile tab open.";
    loading.hidden = false;
    result.hidden = true;
  }

  function showCapturePanel(job) {
    dismissedCaptureJobs.delete(job.id);
    renderCaptureJob(job);

    if (job.status === "ready" && !startedCaptureJobs.has(job.id)) {
      startedCaptureJobs.add(job.id);
      window.setTimeout(() => {
        chrome.runtime.sendMessage({ type: "RUN_CAPTURE", jobId: job.id })
          .catch(() => startedCaptureJobs.delete(job.id));
      }, 0);
    }
  }

  function handleMessage(request, _sender, sendResponse) {
    if (request?.type === "EXTRACT_BASE_PROFILE") {
      sendResponse({ ok: true, profile: extractBaseProfile(request.settings) });
      return;
    }

    if (request?.type === "EXTRACT_DETAIL_SECTION") {
      sendResponse({ ok: true, text: extractDetailSection(request.sectionKey) });
      return;
    }

    if (request?.type === "SHOW_CAPTURE_PANEL") {
      showCapturePanel(request.job);
      sendResponse({ ok: true });
      return;
    }

    if (request?.type === "CAPTURE_JOB_UPDATED") {
      if (capturePanelState?.job.id === request.job.id) {
        renderCaptureJob(request.job);
      } else if (
        dismissedCaptureJobs.has(request.job.id)
        && ["complete", "failed"].includes(request.job.status)
      ) {
        dismissedCaptureJobs.delete(request.job.id);
        chrome.runtime.sendMessage({
          type: "CLEAR_CAPTURE_JOB",
          jobId: request.job.id
        }).catch(() => undefined);
      }
      sendResponse({ ok: true });
    }
  }

  chrome.runtime.onMessage.addListener(handleMessage);

  if (typeof module !== "undefined" && module.exports) {
    module.exports = { cleanLines, cleanSectionText };
  }
})();
