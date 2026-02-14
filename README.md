# WebForge

Clone any web page with all its assets in one click. Get a ready-to-open local copy packed into a neat `.zip` file.

Works on Chrome and Firefox.

<img width="600" height="150" alt="WebForge" src="https://github.com/user-attachments/assets/aac1b0d8-39df-4492-9600-6e518efc9792" />

## What it does

You click the button, WebForge grabs the current page HTML, stylesheets, scripts, images, fonts, videos rewrites all the paths so everything points to local files, and hands you a `.zip` you can unpack and open in a browser offline.

No server involved, everything runs locally in the extension.

### Features

- **Full asset download** — CSS, JS, images, fonts, media files, favicons. If the page loads it, WebForge grabs it.
- **Nested CSS resources** — fonts and background images referenced inside stylesheets are fetched too, not just top-level assets.
- **Path rewriting** — all URLs in HTML and CSS are rewritten to point to the local folder structure, so the page actually works when you open `index.html`.
- **Tracking script removal** — optionally strips Google Analytics, Facebook Pixel, Hotjar, Tawk.to, Yandex Metrica, Cloudflare analytics, and a bunch of other trackers. Both external scripts and inline snippets.
- **Sitemap generation** — can build a basic `sitemap.xml` from all the internal links found on the page.
- **CSS beautification** — minified stylesheets are automatically formatted into readable CSS.
- **Clean HTML** — removes `<base>` tags, `integrity`/`crossorigin` attributes, and CSP meta tags that would break the local copy.
- **Organized output** — assets are sorted into folders: `css/`, `js/`, `img/`, `fonts/`, `media/`.

## Install

### Chrome / Edge / Brave

1. Go to `chrome://extensions`
2. Enable **Developer mode** (top right)
3. Click **Load unpacked**
4. Select the `webforge` folder

### Firefox

1. Go to `about:debugging#/runtime/this-firefox`
2. Click **Load Temporary Add-on**
3. Select `manifest.json` from the `webforge` folder

## How to use

1. Navigate to any page you want to clone
2. Click the WebForge icon in the toolbar
3. Toggle options if needed:
   - **Generate sitemap.xml** — collects all same-origin links into a sitemap
   - **Remove tracking scripts** — strips analytics and tracking code
4. Hit **Clone Page**
5. Wait for the progress bar to finish
6. Save the `.zip` wherever you want

The archive contains a folder with `index.html` and an `assets/` directory with everything organized by type.

## How it works

1. A content script (`content.js`) is injected into the active tab. It walks the DOM and collects every external resource URL — stylesheets, scripts, images, fonts, videos, inline style backgrounds, even stuff from CSSOM.
2. The background service worker (`background.js`) takes that list and fetches all resources through the page context (so cookies and auth work naturally).
3. CSS files are parsed for nested `url()` references (like font files or background images), and those are fetched in a second pass.
4. All paths in HTML and CSS are rewritten to point to the local asset structure.
5. If tracking removal is on, known analytics scripts are stripped — both `<script src="...">` tags and inline blocks with tracking signatures.
6. Everything is packed into a `.zip` using JSZip and offered as a download.

## Project structure

```
webforge/
├── manifest.json      — extension manifest (MV3)
├── background.js      — service worker, handles cloning logic
├── content.js         — injected into pages to collect resources
├── popup.html         — extension popup UI
├── popup.js           — popup interaction logic
├── popup.css          — popup styles
├── icons/             — extension icons (16, 48, 128)
└── lib/
    └── jszip.min.js   — JSZip library for building archives
```

## Limitations

- Can't clone browser internal pages (`chrome://`, `about:`, extension pages)
- Pages behind authentication may partially work depending on how the auth is handled if cookies cover it, it'll work
- Very large pages with hundreds of resources will take a bit longer
- Some dynamically loaded content (lazy-loaded images, SPA content) might not be captured since the content script reads the DOM at the moment of injection
- CORS-restricted stylesheets may not have their nested resources fully resolved
