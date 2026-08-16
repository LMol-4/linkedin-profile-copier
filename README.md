# LinkedIn Profile Copy

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
3. Choose **Simple copy** or **Full copy**.
4. Use **Copy all** in the result tab.

Simple copy reads the details already loaded on the open profile page. Full copy visits each enabled profile detail page in a background tab, one at a time, so it can include entries hidden behind “Show all.” Background tabs close automatically.

The popup's **Settings** tab controls which sections are included. Markdown formatting is optional and off by default.

## Privacy

Profile data is processed locally and kept only for the lifetime of its result tab. The extension does not send profile data to an external service.

This project is not affiliated with or endorsed by LinkedIn.

## Development

There is no build step. After editing, reload the extension from `chrome://extensions`.

Run the small test suite with:

```sh
npm test
```
