(function installProfileExtractor() {
  // A copy orphaned by an extension reload keeps its global, so only skip a live one.
  if (globalThis.__LINKEDIN_PROFILE_COPY_INSTALLED__?.()) {
    return;
  }

  globalThis.__LINKEDIN_PROFILE_COPY_INSTALLED__ = () => Boolean(chrome.runtime?.id);

  const sectionMeta = {
    about: { ids: ["about"], headings: ["about"] },
    experience: { ids: ["experience"], headings: ["experience"] },
    education: { ids: ["education"], headings: ["education"] }
  };

  const removableLinePatterns = [
    /^(?:show|see|view) (?:more|less)$/i,
    /^(?:show|see|view) all(?: \d+)?(?: experiences?|educations?)?$/i,
    /^expand (?:this )?section/i,
    /^collapse (?:this )?section/i,
    /^end of list$/i,
    /^company logo$/i,
    /^school logo$/i,
    /^profile photo$/i,
    /^(?:LinkedIn )?helped me get this job(?: helped me get this job)?$/i,
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
  let capturePanelState = null;
  const excludedContainers = "script, style, nav, aside, footer, "
    + "[role='dialog'], [hidden], .visually-hidden, .sr-only, .lpc-panel";
  const excludedContent = `button, [role='button'], a[href*='/skill-associations-details'], ${excludedContainers}`;

  function primaryRoot() {
    const main = document.querySelector(".scaffold-layout__main")
      || document.querySelector("main, [role='main']");
    return main?.querySelector("section[aria-label='Primary content']") || main;
  }

  const sduiTopcard = "section[componentkey^='com.linkedin.sdui.profile.card.'][componentkey$='Topcard']";

  function profileName() {
    return Array.from(primaryRoot()?.querySelectorAll(
      "h1, h2"
    ) || []).find((heading) => {
      if (heading.closest(excludedContent) || !normaliseLine(elementText(heading))) return false;
      if (heading.tagName === "H1") return true;
      const card = heading.closest("section");
      // Live SDUI cards now have UUID keys. Identify the name card by its
      // profile-specific links, not the generated component key or CSS classes.
      if (!card || card === primaryRoot()) return false;
      const contact = card.querySelector("a[href*='/overlay/contact-info/']");
      const link = heading.closest("a") || card.querySelector(
        "a[componentkey='topcard-logo-image-referencekey']"
      );
      if (contact && card.querySelector("h2") === heading) {
        const contactUrl = new URL(contact.href, window.location.href);
        const expected = `${window.location.pathname.replace(/\/$/, "")}/overlay/contact-info/`;
        if (contactUrl.origin === window.location.origin
          && `${contactUrl.pathname.replace(/\/$/, "")}/` === expected) return true;
      }
      if (!link) return Boolean(heading.closest(sduiTopcard));
      const url = new URL(link.href, window.location.href);
      return url.origin === window.location.origin
        && url.pathname.replace(/\/$/, "") === window.location.pathname.replace(/\/$/, "");
    });
  }

  // Read rendered profile text once, omitting controls and accessibility duplicates.
  function elementText(element) {
    if (!element) return "";
    if (element.nodeType === 3) return element.textContent;
    if (element.nodeType !== 1 || element.matches(excludedContent)) return "";
    const style = window.getComputedStyle(element);
    if (style.display === "none" || ["hidden", "collapse"].includes(style.visibility)) return "";
    if (element.tagName === "BR") return "\n";
    const text = Array.from(element.childNodes, elementText).join("");
    return /^(block|flex|grid|list-item|table)/.test(style.display) ? `\n${text}\n` : text;
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

    const main = primaryRoot();
    if (!main) return null;
    for (const id of meta.ids) {
      const anchor = main.querySelector(`[id="${id}"]`);
      const section = anchor?.closest("section, .artdeco-card");
      if (section && section !== main && main.contains(section) && !anchor.closest(excludedContent)) {
        return section;
      }
    }

    const headings = main.querySelectorAll(
      "h1, h2, h3, [role='heading'], .pvs-header__title"
    );

    for (const heading of headings) {
      const headingText = normaliseLine(elementText(heading)).toLowerCase().replace(/\s*\(\d+\)$/, "");
      if (meta.headings.includes(headingText) && !heading.closest(excludedContent)) {
        const section = heading.closest("section, .artdeco-card");
        if (section && section !== main && main.contains(section)) return section;
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
      const lower = line.toLowerCase().replace(/\s*\(\d+\)$/, "");
      if (key === "experience" && /^skills\s*:/i.test(line)) return false;
      return !headings.includes(lower) && !headings.some((heading) => lower === `${heading} section`);
    });

    return lines.join("\n").trim();
  }

  function extractHeader() {
    const nameElement = profileName();
    const card = nameElement?.closest("section, .artdeco-card");
    const name = normaliseLine(elementText(nameElement));
    if (!card) return { name, headline: "", location: "" };

    let headlineElement = card.querySelector(
      ".text-body-medium.break-words, .text-body-medium[data-generated-suggestion-target]"
    );
    let locationElement = card.querySelector(
      ".text-body-small.inline.t-black--light.break-words, .text-body-small.t-black--light.break-words"
    );

    // SDUI top cards use a name heading and a contact-info row instead of legacy classes.
    if (nameElement.tagName === "H2") {
      const contact = card.querySelector("a[href*='/overlay/contact-info/']");
      const locationRow = contact?.closest("p")?.parentElement;
      locationElement ||= locationRow?.querySelector(":scope > p");
      for (let group = nameElement.parentElement; group && group !== card; group = group.parentElement) {
        if (contact && group.contains(contact)) {
          headlineElement ||= group.querySelector(":scope > p");
          break;
        }
      }
    }

    let headline = normaliseLine(elementText(headlineElement));
    let location = normaliseLine(elementText(locationElement));
    const isConnectionDegree = (line) => /^[•·]?\s*(1st|2nd|3rd)(?:\s+degree connection)?$/i.test(line);

    if (isConnectionDegree(headline)) {
      headline = "";
    }

    if (isConnectionDegree(location)) {
      location = "";
    }

    return { name, headline, location };
  }

  const pause = (ms) => new Promise((resolve) => window.setTimeout(resolve, ms));
  const afterPaint = () => new Promise((resolve) => window.requestAnimationFrame(
    () => window.requestAnimationFrame(resolve)
  ));
  const randomBetween = (minimum, maximum) => minimum + Math.random() * (maximum - minimum);
  const hasSectionContent = (key) => {
    const section = findSection(key);
    return Boolean(section && cleanSectionText(elementText(section), key));
  };
  const scrollMetrics = (surface) => {
    if (surface === document.scrollingElement) {
      return {
        top: surface.scrollTop,
        left: surface.scrollLeft,
        height: Math.max(document.body?.scrollHeight || 0, document.documentElement.scrollHeight),
        viewport: window.innerHeight
      };
    }
    return {
      top: surface.scrollTop, left: surface.scrollLeft,
      height: surface.scrollHeight, viewport: surface.clientHeight
    };
  };

  function profileScrollSurface(start = primaryRoot()) {
    const documentSurface = document.scrollingElement || document.documentElement;
    for (let element = start; element && element !== document.body; element = element.parentElement) {
      const overflow = window.getComputedStyle(element).overflowY;
      if (/^(?:auto|scroll|overlay)$/.test(overflow)
        && element.scrollHeight > element.clientHeight + 2) return element;
    }
    return documentSurface;
  }

  function setScrollPosition(surface, left, top) {
    surface.style.scrollBehavior = "auto";
    if (surface === document.scrollingElement) {
      window.scrollTo({ left, top, behavior: "instant" });
      surface.scrollLeft = left;
      surface.scrollTop = top;
      return;
    }
    surface.scrollTo({ left, top, behavior: "instant" });
    surface.scrollLeft = left;
    surface.scrollTop = top;
  }

  async function loadLazyProfileSections(selected) {
    const requested = Object.keys(ProfileCopyConfig.detailPaths)
      .filter((key) => selected[key] !== false);
    if (!requested.length || requested.every(hasSectionContent)) return;

    const panel = capturePanelState;
    const initialPositions = new Map();
    let unchangedBottomPasses = 0;
    let previousHeight = 0;
    let previousSurface = null;

    try {
      for (let attempt = 0; attempt < 20; attempt += 1) {
        if (panel && panel !== capturePanelState) throw new Error("Copy cancelled.");
        if (requested.every(hasSectionContent)) break;

        const surface = profileScrollSurface();
        if (!initialPositions.has(surface)) {
          initialPositions.set(surface, {
            ...scrollMetrics(surface), behavior: surface.style.scrollBehavior
          });
        }
        if (surface !== previousSurface) {
          unchangedBottomPasses = 0;
          previousHeight = 0;
          previousSurface = surface;
        }
        const current = scrollMetrics(surface);
        const maximum = Math.max(0, current.height - current.viewport);
        // Overlapping, irregular viewport steps trigger lazy cards without a fixed scroll cadence.
        const step = Math.max(350, Math.round(current.viewport * randomBetween(0.58, 0.86)));
        setScrollPosition(surface, current.left, Math.min(maximum, current.top + step));
        await Promise.all([pause(randomBetween(220, 480)), afterPaint()]);

        const next = scrollMetrics(surface);
        const atBottom = next.top + next.viewport >= next.height - 2;
        unchangedBottomPasses = atBottom && next.height <= previousHeight
          ? unchangedBottomPasses + 1 : 0;
        // A freshly refreshed profile may still be header-only. Do not treat that
        // short document as final until LinkedIn has mounted a requested section.
        if (unchangedBottomPasses >= 3 && requested.some(hasSectionContent)) break;
        previousHeight = next.height;
      }
    } finally {
      for (const [surface, initial] of Array.from(initialPositions).reverse()) {
        setScrollPosition(surface, initial.left, initial.top);
        surface.style.scrollBehavior = initial.behavior;
      }
    }
  }

  async function expandDescriptions(section, clicked = new WeakSet(), deadline = Infinity) {
    const panel = capturePanelState;
    for (const button of section?.querySelectorAll(
      "[data-testid='expandable-text-box'] > button[data-testid='expandable-text-button'], "
      + "button.inline-show-more-text__button, button.lt-line-clamp__more, button[aria-label='see more'], "
      + ".inline-show-more-text button[aria-expanded='false']"
    ) || []) {
      if (Date.now() >= deadline || (panel && panel !== capturePanelState)) break;
      if (!clicked.has(button) && !button.closest(excludedContainers)
        && button.getClientRects().length > 0 && !button.disabled
        && button.getAttribute("aria-expanded") !== "true"
        && /^(?:…|\.{3})?\s*(?:(?:see|show)\s+)?more$/i.test(normaliseLine(button.textContent))) {
        await pause(Math.max(0, Math.min(randomBetween(140, 320), deadline - Date.now())));
        if (Date.now() >= deadline || (panel && panel !== capturePanelState)) break;
        clicked.add(button);
        button.click();
        await pause(Math.max(0, Math.min(randomBetween(220, 480), deadline - Date.now())));
      }
    }
  }

  async function extractBaseProfile(settings = {}, expandLinkedSections = false, loadLazySections = false) {
    const selected = settings.sections || {};
    const sections = {};
    const detailUrls = {};
    const panel = capturePanelState;
    const sourceUrl = window.location.href;
    if (!ProfileCopyConfig.isProfilePage(sourceUrl)) {
      throw new Error("Open the main LinkedIn profile and wait for it to load.");
    }
    // Tab completion precedes LinkedIn's client-side rendering, including on SPA navigation.
    const deadline = Date.now() + 10000;
    while (!profileName() && Date.now() < deadline) {
      if (window.location.href !== sourceUrl || (panel && panel !== capturePanelState)) {
        throw new Error("The profile changed during copying. Please try again.");
      }
      await pause(250);
    }
    if (window.location.href !== sourceUrl || (panel && panel !== capturePanelState)) {
      throw new Error("The profile changed during copying. Please try again.");
    }
    if (!profileName()) throw new Error("The profile is still loading. Please try again.");
    if (loadLazySections) await loadLazyProfileSections(selected);

    for (const key of Object.keys(sectionMeta)) {
      if (panel && panel !== capturePanelState) throw new Error("Copy cancelled.");
      if (selected[key] === false) {
        continue;
      }

      const section = findSection(key);
      const path = ProfileCopyConfig.detailPaths[key];
      for (const link of section?.querySelectorAll("a[href]") || []) {
        const url = new URL(link.href, window.location.href);
        const expected = `${window.location.pathname.replace(/\/$/, "")}/details/${path}/`;
        if (path && url.origin === window.location.origin && `${url.pathname.replace(/\/$/, "")}/` === expected) {
          detailUrls[key] = `${url.origin}${expected}`;
          break;
        }
      }
      if (!detailUrls[key] || expandLinkedSections) await expandDescriptions(section);
      sections[key] = cleanSectionText(elementText(section), key);
    }

    return {
      sourceUrl: window.location.href,
      capturedAt: new Date().toISOString(),
      header: selected.header === false ? {} : extractHeader(),
      sections,
      detailUrls
    };
  }

  async function extractDetailSection(key) {
    const path = ProfileCopyConfig.detailPaths[key];
    if (!path || !window.location.pathname.replace(/\/?$/, "/").endsWith(`/details/${path}/`)) {
      throw new Error("LinkedIn opened a different page.");
    }
    const deadline = Date.now() + 15000;
    const detailSection = `${key[0].toUpperCase()}${key.slice(1)}DetailsSection`;
    const findContent = () => {
      const main = primaryRoot();
      const usable = (element) => !element.closest(excludedContent)
        && element.getClientRects().length > 0;
      // Prefer the entire matching card: it can contain multiple lists and schools.
      const card = Array.from(main?.querySelectorAll(
        `[componentkey^='com.linkedin.sdui.profile.card.'][componentkey$='${detailSection}']`
      ) || []).find(usable);
      if (card) return card;
      const section = findSection(key);
      if (section && usable(section) && cleanSectionText(elementText(section), key)) return section;
      // Do not accept a list nested in a different SDUI detail card while ours loads.
      return Array.from(main?.querySelectorAll(
        ".pvs-list__container, ul.pvs-list, [data-view-name='profile-component-entity-list']"
      ) || []).find((list) => usable(list) && !list.closest("[componentkey$='DetailsSection']"));
    };
    let content;
    for (let attempt = 0; attempt < 20 && Date.now() < deadline; attempt += 1) {
      content = findContent();
      if (cleanSectionText(elementText(content), key)) break;
      await pause(randomBetween(240, 420));
    }
    if (!content) throw new Error("The requested section has not loaded.");

    let previous = "";
    let stable = 0;
    const clicked = new WeakSet();
    for (let attempt = 0; attempt < 20 && Date.now() < deadline; attempt += 1) {
      content = findContent();
      await expandDescriptions(content, clicked, deadline);
      const text = cleanSectionText(elementText(content), key);
      // Only list pagination buttons on a verified detail page may load more entries.
      const more = Array.from(content?.querySelectorAll(
        ".pvs-list__footer-wrapper button, button.scaffold-finite-scroll__load-button"
      ) || []).find((button) => (
        /^(?:show|load) more(?: results)?$/i.test(normaliseLine(button.textContent))
        && !button.closest(excludedContainers) && button.getClientRects().length > 0
      ));
      const loading = content?.matches("[aria-busy='true']") || Array.from(content?.querySelectorAll(".artdeco-loader, [aria-busy='true']") || [])
        .some((element) => element.getClientRects().length > 0);
      const loadingMore = more && !more.disabled;
      if (Date.now() >= deadline) return { text, incomplete: true };
      if (loadingMore) {
        await pause(Math.min(randomBetween(320, 680), deadline - Date.now()));
        if (Date.now() >= deadline) return { text, incomplete: true };
        if (more.isConnected && !more.disabled) more.click();
      }
      // Page the real scroller: scrollIntoView does nothing on display: contents wrappers.
      const surface = profileScrollSurface(content);
      const position = scrollMetrics(surface);
      const atBottom = position.top + position.viewport >= position.height - 2;
      if (!atBottom) {
        const step = Math.round(position.viewport * randomBetween(0.58, 0.86));
        setScrollPosition(surface, position.left, Math.min(position.height - position.viewport, position.top + step));
      }
      stable = text === previous && !more && !loading && atBottom ? stable + 1 : 0;
      if (text && stable >= 3) return { text, incomplete: false };
      previous = text;
      await pause(Math.min(
        loadingMore ? randomBetween(750, 1350) : randomBetween(320, 520),
        deadline - Date.now()
      ));
    }
    if (!previous) throw new Error("The requested section has not loaded.");
    return { text: previous, incomplete: true };
  }

  function removeCapturePanel(clearJob = true) {
    if (!capturePanelState) return;
    const { job, element } = capturePanelState;
    element.remove();
    capturePanelState = null;
    startedCaptureJobs.delete(job.id);
    if (clearJob) chrome.runtime.sendMessage({ type: "CLEAR_CAPTURE_JOB", jobId: job.id })
      .catch(() => undefined);
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
      if (!document.execCommand("copy")) {
        button.textContent = "Copy blocked — press Ctrl+C / ⌘C";
        return;
      }
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
          <span class="lpc-eyebrow">LinkedIn Profile Scraper</span>
          <strong data-lpc-title>Full profile copy</strong>
        </div>
        <button class="lpc-close" type="button" aria-label="Close LinkedIn Profile Scraper">×</button>
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
    const close = panel.querySelector(".lpc-close");
    close.setAttribute("aria-label", ["ready", "running"].includes(job.status)
      ? "Cancel copy and close" : "Close LinkedIn Profile Scraper");

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
        warning.textContent = `Some details could not be loaded: ${job.warnings.join(", ")}. Available text is included.`;
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
      : "Keep this profile open. Close this panel to cancel.";
    loading.hidden = false;
    result.hidden = true;
  }

  function showCapturePanel(job) {
    renderCaptureJob(job);

    if (job.status === "ready" && !startedCaptureJobs.has(job.id)) {
      startedCaptureJobs.add(job.id);
      window.setTimeout(() => {
        chrome.runtime.sendMessage({ type: "RUN_CAPTURE", jobId: job.id })
          .then((response) => {
            if (response?.ok === false && capturePanelState?.job.id === job.id) {
              renderCaptureJob({ ...job, status: "failed", error: response.error });
            }
          })
          .catch(() => {
            if (capturePanelState?.job.id === job.id) {
              renderCaptureJob({ ...job, status: "failed", error: "Connection lost. Please try again." });
            }
          })
          .finally(() => startedCaptureJobs.delete(job.id));
      }, 0);
    }
  }

  function handleMessage(request, _sender, sendResponse) {
    if (request?.type === "EXTRACT_BASE_PROFILE") {
      extractBaseProfile(request.settings, request.expandLinkedSections, request.loadLazySections)
        .then((profile) => sendResponse({ ok: true, profile }))
        .catch((error) => sendResponse({ ok: false, error: error.message }));
      return true;
    }

    if (request?.type === "EXTRACT_DETAIL_SECTION") {
      extractDetailSection(request.sectionKey)
        .then((result) => sendResponse({ ok: true, ...result }))
        .catch((error) => sendResponse({ ok: false, error: error.message }));
      return true;
    }

    if (request?.type === "SHOW_CAPTURE_PANEL") {
      showCapturePanel(request.job);
      sendResponse({ ok: true });
      return;
    }

    if (request?.type === "CAPTURE_JOB_CLEARED") {
      if (capturePanelState?.job.id === request.jobId) removeCapturePanel(false);
      sendResponse({ ok: true });
      return;
    }

    if (request?.type === "CAPTURE_JOB_UPDATED") {
      if (capturePanelState?.job.id === request.job.id) {
        renderCaptureJob(request.job);
      }
      sendResponse({ ok: true });
    }
  }

  chrome.runtime.onMessage.addListener(handleMessage);

  if (typeof module !== "undefined" && module.exports) {
    module.exports = { cleanLines, cleanSectionText };
  }
})();
