# LinkedIn Profile Copier

A small Chrome extension for copying LinkedIn profile details as clean text.

## Install

1. Download or clone this folder.
2. Open `chrome://extensions` in Chrome.
3. Turn on **Developer mode**.
4. Click **Load unpacked**.
5. Select this folder (the one containing `manifest.json`).

## Use

1. Open the main LinkedIn profile at `linkedin.com/in/...`.
2. Click the extension icon, then **Copy profile**.
3. Review the result in the panel on LinkedIn and select **Copy all**.

The popup shows progress. You can close the popup while collection continues. **Cancel copy** in the popup, or closing the panel on LinkedIn, stops collection and closes temporary tabs. Navigating away from the profile or closing its tab also cancels the job.

The extension expands supported “see more” descriptions. It opens a temporary inactive tab only for an enabled section with a matching “Show all” link on that profile, then expands descriptions and loads more entries there. Your profile stays selected. If LinkedIn redirects, fails to load, or reaches the collection limit, the result shows a warning and keeps the available text. Detail reads are bounded to 15 seconds and 20 loading passes per section.

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
