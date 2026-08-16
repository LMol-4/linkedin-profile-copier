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
      const section = anchor?.closest("section") || anchor?.parentElement?.closest("section");
      if (section) {
        return section;
      }
    }

    const candidates = document.querySelectorAll("main section, [role='main'] section");
    for (const section of candidates) {
      const heading = section.querySelector("h1, h2, h3, .pvs-header__title");
      const headingText = normaliseLine(elementText(heading)).toLowerCase();
      if (meta.headings.some((value) => headingText === value || headingText.startsWith(`${value} `))) {
        return section;
      }
    }

    return null;
  }

  function cleanSectionText(value, key) {
    const headings = sectionMeta[key]?.headings || [];
    const lines = cleanLines(value).filter((line) => {
      const lower = line.toLowerCase();
      return !headings.includes(lower) && !headings.some((heading) => lower === `${heading} section`);
    });

    return lines.join("\n").trim();
  }

  function extractHeader() {
    const main = document.querySelector("main, [role='main']") || document.body;
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

    if (!headline || !location) {
      const cardLines = cleanLines(elementText(card));
      const nameIndex = cardLines.indexOf(name);
      const details = cardLines
        .slice(nameIndex >= 0 ? nameIndex + 1 : 0)
        .filter((line) => !/^(contact info|connections?|followers?|message|connect|follow|more)$/i.test(line));

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

    const main = document.querySelector("main, [role='main']");
    return cleanSectionText(elementText(main), key);
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
