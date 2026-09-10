(function initialiseConfig(root) {
  const sections = [
    { key: "header", label: "Basic details", description: "Name, headline, and location" },
    { key: "about", label: "About", description: "Profile summary" },
    { key: "experience", label: "Experience", description: "Roles and work history" },
    { key: "education", label: "Education", description: "Schools and qualifications" },
    { key: "skills", label: "Skills", description: "Listed professional skills" },
    { key: "certifications", label: "Certifications", description: "Licenses and certifications" },
    { key: "projects", label: "Projects", description: "Selected projects" },
    { key: "languages", label: "Languages", description: "Languages and proficiency" }
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

  function isProfilePage(value) {
    try {
      const url = new URL(value);
      return url.protocol === "https:" && /(^|\.)linkedin\.com$/i.test(url.hostname)
        && /^\/in\/[^/]+\/?$/i.test(url.pathname);
    } catch {
      return false;
    }
  }

  const api = {
    isProfilePage,
    sections,
    detailPaths: {
      experience: "experience", education: "education", skills: "skills",
      certifications: "certifications", projects: "projects", languages: "languages"
    },
    defaultSettings,
    normaliseSettings
  };

  root.ProfileCopyConfig = api;

  if (typeof module !== "undefined" && module.exports) {
    module.exports = api;
  }
})(globalThis);
