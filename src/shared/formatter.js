(function initialiseFormatter(root) {
  function clean(value) {
    return String(value || "")
      .replace(/\r\n/g, "\n")
      .replace(/[ \t]+\n/g, "\n")
      .replace(/\n{3,}/g, "\n\n")
      .trim();
  }

  function formatHeader(header, markdown) {
    const values = [header?.name, header?.headline, header?.location]
      .map(clean)
      .filter(Boolean);

    if (!values.length) {
      return "";
    }

    if (!markdown) {
      return values.join("\n");
    }

    const [name, ...details] = values;
    return [`# ${name}`, ...details].join("\n");
  }

  function formatSection(label, value, markdown) {
    const body = clean(value);
    if (!body) {
      return "";
    }

    const heading = markdown ? `## ${label}` : label.toUpperCase();
    return `${heading}\n${body}`;
  }

  function formatProfile(profile, settings) {
    const config = root.ProfileCopyConfig;
    const normalised = config.normaliseSettings(settings);
    const blocks = [];

    if (normalised.sections.header) {
      blocks.push(formatHeader(profile?.header, normalised.markdown));
    }

    for (const section of config.sections) {
      if (section.key === "header" || !normalised.sections[section.key]) {
        continue;
      }

      blocks.push(
        formatSection(
          section.label,
          profile?.sections?.[section.key],
          normalised.markdown
        )
      );
    }

    const output = blocks.filter(Boolean).join("\n\n");
    return output || "No enabled profile details were found.";
  }

  const api = { clean, formatProfile };
  root.ProfileCopyFormatter = api;

  if (typeof module !== "undefined" && module.exports) {
    module.exports = api;
  }
})(globalThis);
