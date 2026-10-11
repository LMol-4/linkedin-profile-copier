# LinkedIn Profile Copier: copy a LinkedIn profile as clean text for ChatGPT, Claude and other AI tools

A free Chrome extension that copies a LinkedIn profile as clean, readable text in one click: name, headline, location, About, full work Experience and Education. Paste it straight into ChatGPT, Claude, Gemini or any other LLM as context, or into notes, a CRM or a document.

No account, no server and no API key: everything runs locally in your browser.

## What people use it for

- **Giving AI tools context:** paste a profile into an LLM to draft outreach, prepare for an interview or meeting, summarise a career, or compare candidates.
- **Recruiting and sales research:** save a candidate's or prospect's background as plain text or Markdown.
- **Your own profile:** export your experience to update a CV, write a bio, or have an AI review your profile.

## Features

- Copies the **full** Experience and Education lists, not just the five entries LinkedIn shows on the main page. Long descriptions are expanded.
- Clean output: no buttons, ads, "People also viewed", skill tags or media attachments.
- Plain text or Markdown headings, with an optional profile URL.
- Choose which sections to include. Optional one-click mode copies straight to the clipboard.
- Warns you when something could not be loaded instead of silently leaving it out.

## Install

1. Download or clone this repository.
2. Open `chrome://extensions` in Chrome.
3. Turn on **Developer mode**.
4. Click **Load unpacked**.
5. Select this folder (the one containing `manifest.json`).

## Use

1. Open a LinkedIn profile at `linkedin.com/in/...`.
2. Click the extension icon, then **Copy profile**.
3. Review the result in the panel on LinkedIn and select **Copy all**.

The popup shows progress, and you can close it while collection continues. **Cancel copy** in the popup, or closing the panel on LinkedIn, stops collection and closes temporary tabs. Navigating away from the profile or closing its tab also cancels the copy.

## How it works

The extension first scrolls the profile until every selected section has loaded. LinkedIn's main page only shows a preview of Experience and Education, so the extension then opens each section's full details page (`/in/<name>/details/experience/`) in a temporary tab, expands descriptions, scrolls until the list stops growing, and closes the tab. Experience loads in a background tab. Education briefly selects its tab, because LinkedIn may not render education history in an inactive tab, then returns you to the profile unless you switched elsewhere.

If a details page redirects, fails to load or runs out of time (15 seconds per section), the result keeps the text from the main page, with descriptions expanded, and shows a warning. Selected sections that never appear, such as a profile without an About section, are also named in the warning.

Collection runs one profile at a time. Description clicks are spaced 250–500 ms apart, and loading more entries waits 800–1,400 ms between requests. Short pauses before opening details pages and after navigation give LinkedIn time to settle.

These delays reduce bursts of activity; they do not make scraping undetectable or prevent account restrictions. [LinkedIn prohibits scraping extensions](https://www.linkedin.com/help/linkedin/answer/a1341387/prohibited-software-and-extensions?lang=en), including tools that copy profiles. If avoiding account restrictions is essential, do not use this extension on LinkedIn.

### Settings

Settings is always accessible in the popup, including when automatic start is enabled.

- **Start when icon is clicked** begins collection immediately when you open the popup on a profile. Off by default. The popup stays open so you can check progress, cancel, or change Settings. Turning it on takes effect the next time you open the popup.
- **Copy to clipboard when ready** automatically copies the finished text, even if you switch tabs. Off by default and independent of automatic start. Enable both for one-click copying. **Copy all** remains available if Chrome blocks the automatic clipboard write.
- Choose the sections to include, optionally add the profile URL, and turn on Markdown headings if needed. Settings save automatically and apply to the next copy.

On other pages, copying is disabled and Settings remains available. Open the main profile rather than a detail page or search result.

## Privacy

Profile data is processed locally and stored in Chrome session storage while the copy panel is open. Closing the panel, leaving the profile, or starting a replacement copy clears its stored data. The extension does not send profile data to an external service.

This project is not affiliated with or endorsed by LinkedIn.

## Development

There is no build step. After editing, reload the extension from `chrome://extensions`.

Run the unit tests with:

```sh
npm test
```

Browser regression tests use Playwright as a development dependency; the extension has no runtime dependencies or build step.

```sh
npm ci
npx playwright install chromium
npm run test:browser
```

These tests use synthetic LinkedIn pages to check extraction, popup behavior, and the loaded extension. They do not require a LinkedIn account. When validating against LinkedIn itself, check a profile with long descriptions and multiple entries; LinkedIn layouts and loading behavior can change.
