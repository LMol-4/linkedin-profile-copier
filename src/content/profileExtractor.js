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

  function handleMessage(request, _sender, sendResponse) {
    if (request?.type === "EXTRACT_BASE_PROFILE") {
      sendResponse({ ok: true, profile: extractBaseProfile(request.settings) });
      return;
    }

    if (request?.type === "EXTRACT_DETAIL_SECTION") {
      sendResponse({ ok: true, text: extractDetailSection(request.sectionKey) });
    }
  }

  chrome.runtime.onMessage.addListener(handleMessage);

  if (typeof module !== "undefined" && module.exports) {
    module.exports = { cleanLines, cleanSectionText };
  }
})();
