# WebForge

Browser extension that saves a page (or a chunk of a site) as a local `.zip` — HTML plus CSS, JS, images, fonts, the usual stuff. Paths get rewritten so you can open `index.html` offline.

Works in Chrome and Firefox.

<img width="600" height="150" alt="WebForge" src="https://github.com/user-attachments/assets/aac1b0d8-39df-4492-9600-6e518efc9792" />

## Install

**Chrome / Edge / Brave:** `chrome://extensions` → Developer mode → Load unpacked → pick the `webforge` folder.

**Firefox:** `about:debugging#/runtime/this-firefox` → Load Temporary Add-on → select `webforge/manifest.json`.

## Usage

Open a page, click the icon, hit **Clone Page**. Optional toggles:

- strip common tracking scripts
- generate a basic `sitemap.xml`
- **Crawl site** — walk links on the same hostname only (no subdomains, no other sites, off-site redirects are dropped). Set max pages yourself (empty → 10). Every page is visited once, shared assets are stored once, and internal `href`s are rewritten so the zip navigates like the real site

Before each capture it scrolls the page, wakes lazy media, waits for fonts and late network calls, then grabs whatever the tab actually loaded — including runtime stuff like Lottie JSON, wasm and textures, plus shadow DOM and constructable stylesheets. Links it couldn't save stay absolute, so they still work while you're online.

## Limits

- No `chrome://` / `about:` / extension pages
- Crawling drives your current tab and puts it back when it's done
- Heavy SPAs won't be perfect — it freezes what the tab actually rendered, and anything that needs a live API stays broken offline
- Auth works only as far as your cookies go
