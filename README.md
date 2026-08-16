# LinkedIn Profile Copier

A small Chrome extension for copying LinkedIn profile details as clean text.

## Install

1. Download or clone this folder.
2. Open `chrome://extensions` in Chrome.
3. Turn on **Developer mode**.
4. Click **Load unpacked**.
5. Select this folder (the one containing `manifest.json`).

## Use

1. Open a LinkedIn profile at `linkedin.com/in/...`.
2. Click the extension icon.
3. Click **Copy full profile**.
4. Use **Copy all** in the panel that appears on the LinkedIn profile.

The active LinkedIn profile stays selected and no separate result tab or window is opened. To include entries hidden behind “Show all,” the extension checks each enabled profile detail page in a temporary inactive tab, one at a time. It uses short, varied pauses between page loads and reads, and every temporary tab closes automatically.

The popup's **Settings** tab controls which sections are included. Markdown formatting is optional and off by default.

## Privacy

Profile data is processed locally and kept only while the in-page copy panel is open. The extension does not send profile data to an external service.

This project is not affiliated with or endorsed by LinkedIn.

## Development

There is no build step. After editing, reload the extension from `chrome://extensions`.

Run the small test suite with:

```sh
npm test
```
