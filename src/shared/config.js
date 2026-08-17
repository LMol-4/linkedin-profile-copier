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
    markdown: false,
    autoCopy: false
  };

  function normaliseSettings(value = {}) {
    return {
      sections: {
        ...defaultSettings.sections,
        ...(value.sections || {})
      },
      markdown: Boolean(value.markdown),
      autoCopy: Boolean(value.autoCopy)
    };
  }

  const api = {
    sections,
    defaultSettings,
    normaliseSettings
  };

  root.ProfileCopyConfig = api;

  if (typeof module !== "undefined" && module.exports) {
    module.exports = api;
  }
})(globalThis);
