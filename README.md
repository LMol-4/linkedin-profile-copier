# LinkedIn Profile Copier: a safe LinkedIn profile scraper.

A free Chrome extension that copies a LinkedIn profile as clean, readable text in one click: name, headline, location, About, full work Experience and Education. Scrape one person at a time: export the LinkedIn profile you are looking at to text, then paste it straight into ChatGPT, Claude, Gemini or any other LLM as context, or into notes, a CRM or a document.

## Manual, not automated scraping

This is not a bulk LinkedIn scraper or a crawler. It only copies the profile you have open, and only when you click **Copy profile**. It does the tedious part of copying a profile by hand: scrolling, opening "Show all", clicking "see more" and cleaning up the text.

## What people use it for

- **Giving AI tools context:** paste a profile into an LLM to draft outreach, prepare for an interview or meeting, summarise a career, or compare candidates.
- **Recruiting and sales research:** save a candidate's or prospect's background as plain text or Markdown.

## Install

1. Download or clone this repository.
2. Open `chrome://extensions` in Chrome.
3. Turn on **Developer mode**.
4. Click **Load unpacked**.
5. Select this folder (the one containing `manifest.json`).

## How it works

The extension first skims down the whole profile to the bottom, like a quick read, with uneven scroll steps, the occasional short bounce back up, and brief pauses, and it stays at the bottom when done. If a selected section is still loading, it waits there a little longer. LinkedIn's main page only shows a preview of Experience and Education, so the extension then opens each section's full details page (`/in/<name>/details/experience/`) in a temporary tab, expands descriptions, scrolls until the list stops growing, and closes the tab.

## Warning

Scraping LinkedIn may violate its Terms of Service. This project is for educational purposes only and is not affiliated with or endorsed by LinkedIn.

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
