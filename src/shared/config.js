(function initialiseConfig(root) {
  const sections = [
    { key: "header", label: "Basic details", description: "Name, headline, and location" },
    { key: "about", label: "About", description: "Profile summary" },
    { key: "experience", label: "Experience", description: "Roles and work history" },
    { key: "education", label: "Education", description: "Schools and qualifications" }
  ];

  const defaultSettings = {
    sections: Object.fromEntries(sections.map(({ key }) => [key, true])),
    includeProfileUrl: false,
    markdown: false,
    autoCopy: false,
    startOnOpen: false
  };

  function normaliseSettings(value = {}) {
    value ||= {};
    return {
      sections: Object.fromEntries(sections.map(({ key }) => [key, value.sections?.[key] !== false])),
      includeProfileUrl: Boolean(value.includeProfileUrl),
      markdown: Boolean(value.markdown),
      autoCopy: value.autoCopy === true,
      startOnOpen: value.startOnOpen === true
    };
  }

  // allowSubpath also accepts the profile's detail pages.
  function isProfilePage(value, allowSubpath = false) {
    try {
      const url = new URL(value);
      return url.protocol === "https:" && /(^|\.)linkedin\.com$/i.test(url.hostname)
        && (allowSubpath ? /^\/in\/[^/]+(?:\/|$)/i : /^\/in\/[^/]+\/?$/i).test(url.pathname);
    } catch {
      return false;
    }
  }

  const api = {
    isProfilePage,
    sections,
    detailPaths: {
      experience: "experience", education: "education"
    },
    defaultSettings,
    normaliseSettings
  };

  root.ProfileCopyConfig = api;

  if (typeof module !== "undefined" && module.exports) {
    module.exports = api;
  }
})(globalThis);
