try {
    importScripts('lib/jszip.min.js');
} catch (_) {
}

const MAX_ASSET_ROUNDS = 4;
const FETCH_TIMEOUT_MS = 20000;
const PAGE_LOAD_TIMEOUT_MS = 45000;

const STRIP_QUERY_PARAMS = [
    /^utm_/i, /^fbclid$/i, /^gclid$/i, /^yclid$/i, /^msclkid$/i,
    /^igshid$/i, /^mc_cid$/i, /^mc_eid$/i, /^_rsc$/i, /^__flight__$/i
];

const DOCUMENT_CONTENT_TYPES = new Set([
    'text/html', 'application/xhtml+xml', 'text/x-component'
]);

function sanitizeFilename(name) {
    return name
        .replace(/[<>:"/\\|?*#]/g, '_')
        .replace(/\s+/g, '_')
        .replace(/_+/g, '_')
        .substring(0, 120);
}

function getExtFromUrl(url) {
    try {
        const basename = new URL(url).pathname.split('/').pop() || '';
        const lastDot = basename.lastIndexOf('.');
        if (lastDot !== -1) {
            const ext = basename.substring(lastDot + 1).toLowerCase();
            if (ext.length <= 12 && /^[a-z0-9]+$/.test(ext)) return ext;
        }
    } catch (_) { }
    return '';
}

const CONTENT_TYPE_EXT = {
    'text/css': 'css',
    'text/javascript': 'js', 'application/javascript': 'js', 'application/x-javascript': 'js',
    'module': 'js', 'text/plain': 'txt',
    'application/json': 'json', 'application/manifest+json': 'webmanifest', 'application/ld+json': 'json',
    'application/wasm': 'wasm',
    'application/xml': 'xml', 'text/xml': 'xml',
    'image/png': 'png', 'image/apng': 'apng', 'image/jpeg': 'jpg', 'image/gif': 'gif',
    'image/svg+xml': 'svg', 'image/webp': 'webp', 'image/avif': 'avif',
    'image/x-icon': 'ico', 'image/vnd.microsoft.icon': 'ico', 'image/bmp': 'bmp',
    'font/woff': 'woff', 'font/woff2': 'woff2', 'font/ttf': 'ttf', 'font/otf': 'otf',
    'application/font-woff': 'woff', 'application/font-woff2': 'woff2',
    'application/x-font-woff': 'woff', 'application/x-font-ttf': 'ttf',
    'application/vnd.ms-fontobject': 'eot',
    'video/mp4': 'mp4', 'video/webm': 'webm', 'video/quicktime': 'mov',
    'audio/mpeg': 'mp3', 'audio/ogg': 'ogg', 'audio/wav': 'wav', 'audio/x-wav': 'wav',
    'model/gltf-binary': 'glb', 'model/gltf+json': 'gltf'
};

function baseContentType(ct) {
    return (ct || '').split(';')[0].trim().toLowerCase();
}

function getExtFromContentType(ct) {
    return CONTENT_TYPE_EXT[baseContentType(ct)] || '';
}

function typeFolder(type) {
    return { css: 'css', js: 'js', img: 'img', font: 'fonts', media: 'media' }[type] || 'other';
}

function guessTypeByExt(ext) {
    if (ext === 'css') return 'css';
    if (['js', 'mjs', 'cjs'].includes(ext)) return 'js';
    if (['png', 'jpg', 'jpeg', 'gif', 'svg', 'webp', 'avif', 'ico', 'bmp', 'apng'].includes(ext)) return 'img';
    if (['woff', 'woff2', 'ttf', 'otf', 'eot'].includes(ext)) return 'font';
    if (['mp4', 'webm', 'mp3', 'ogg', 'oga', 'wav', 'm4a', 'mov'].includes(ext)) return 'media';
    return 'other';
}

function defaultExtForType(type) {
    return { css: 'css', js: 'js', img: 'png', font: 'woff2', media: 'mp4' }[type] || 'bin';
}

const PRECOMPRESSED_EXTS = new Set([
    'png', 'jpg', 'jpeg', 'gif', 'webp', 'avif', 'apng',
    'woff', 'woff2', 'mp4', 'webm', 'mp3', 'ogg', 'oga', 'm4a', 'mov',
    'zip', 'gz', 'br', 'glb'
]);

function zipOptionsFor(fileName) {
    const ext = (fileName.split('.').pop() || '').toLowerCase();
    return PRECOMPRESSED_EXTS.has(ext) ? { compression: 'STORE' } : undefined;
}

function filenameFromUrl(url) {
    try {
        if (url.startsWith('webforge-inline:')) return sanitizeFilename(url.slice('webforge-inline:'.length));
        let name = new URL(url).pathname.split('/').filter(Boolean).pop() || 'file';
        name = name.split('?')[0].split('#')[0];
        return sanitizeFilename(decodeURIComponent(name)) || 'file';
    } catch (_) {
        return 'file';
    }
}

function base64ToUint8(b64) {
    const binary = atob(b64);
    const bytes = new Uint8Array(binary.length);
    for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
    return bytes;
}

function bufToBase64(buffer) {
    const bytes = new Uint8Array(buffer);
    let binary = '';
    const chunk = 0x8000;
    for (let i = 0; i < bytes.length; i += chunk) {
        binary += String.fromCharCode.apply(null, bytes.subarray(i, i + chunk));
    }
    return btoa(binary);
}

function decodeText(bytes, contentType) {
    const m = /charset=["']?([\w-]+)/i.exec(contentType || '');
    const label = m ? m[1].toLowerCase() : 'utf-8';
    try {
        return new TextDecoder(label).decode(bytes);
    } catch (_) {
        return new TextDecoder('utf-8').decode(bytes);
    }
}

function encodeText(text) {
    return new TextEncoder().encode(text);
}

function normalizePageUrl(url) {
    try {
        const u = new URL(url);
        u.hash = '';
        const kept = [];
        for (const [key, value] of u.searchParams) {
            if (STRIP_QUERY_PARAMS.some((re) => re.test(key))) continue;
            kept.push([key, value]);
        }
        const params = new URLSearchParams(kept);
        const query = params.toString();
        let path = u.pathname.replace(/\/index\.html?$/i, '/');
        if (path !== '/') path = path.replace(/\/+$/, '');
        if (!path) path = '/';
        return u.origin + path + (query ? '?' + query : '');
    } catch (_) {
        return url;
    }
}

// Every page lives at the archive root, so a single "assets/..." prefix is valid
// from any page — which is what makes rewriting bundled JS safe.
function pageUrlToLocalPath(pageUrl) {
    try {
        const u = new URL(pageUrl);
        let path = decodeURIComponent(u.pathname || '/').replace(/^\/+/, '').replace(/\/+$/, '');
        if (!path) return 'index.html';

        let name = path.split('/').filter(Boolean).map((s) => sanitizeFilename(s)).join('-');
        name = name.replace(/\.(html?|php|aspx?|jsp)$/i, '');
        if (u.search) {
            name += '-' + sanitizeFilename(u.search.replace(/^\?/, '').replace(/[=&]/g, '-'));
        }
        name = name.replace(/^[-_]+|[-_]+$/g, '');
        return (name ? name.substring(0, 120) : 'page') + '.html';
    } catch (_) {
        return 'index.html';
    }
}

function relativePath(fromFile, toFile) {
    const from = fromFile.split('/').filter(Boolean).slice(0, -1);
    const to = toFile.split('/').filter(Boolean);
    let i = 0;
    while (i < from.length && i < to.length - 1 && from[i] === to[i]) i++;
    const ups = from.length - i;
    return (ups ? '../'.repeat(ups) : '') + to.slice(i).join('/');
}

function isCssMinified(css) {
    if (css.length < 200) return false;
    const lines = css.split('\n');
    return css.length / lines.length > 200;
}

function beautifyCss(css) {
    if (!isCssMinified(css)) return css;

    const store = [];
    const masked = css.replace(/\/\*[\s\S]*?\*\/|"(?:\\.|[^"\\])*"|'(?:\\.|[^'\\])*'|url\([^)]*\)/g, (m) => {
        store.push(m);
        return `\u0000${store.length - 1}\u0000`;
    });

    let depth = 0;
    const formatted = masked
        .replace(/\s*\{\s*/g, ' {\n')
        .replace(/\s*;\s*/g, ';\n')
        .replace(/\s*\}\s*/g, '\n}\n')
        .split('\n')
        .map((line) => {
            const trimmed = line.trim();
            if (!trimmed) return '';
            if (trimmed.startsWith('}')) depth = Math.max(0, depth - 1);
            const indented = '  '.repeat(depth) + trimmed;
            if (trimmed.endsWith('{')) depth++;
            return indented;
        })
        .filter((line) => line !== '')
        .join('\n');

    const restored = formatted.replace(/\u0000(\d+)\u0000/g, (m, i) => store[Number(i)]) + '\n';

    // Formatting must only ever move whitespace around
    if (restored.replace(/\s+/g, '') !== css.replace(/\s+/g, '')) return css;
    return restored;
}

function sendProgress(percent, status) {
    chrome.runtime.sendMessage({ type: 'progress', percent, status }).catch(() => { });
}
function sendDone() {
    chrome.runtime.sendMessage({ type: 'done' }).catch(() => { });
}
function sendError(message) {
    chrome.runtime.sendMessage({ type: 'error', message }).catch(() => { });
}

async function fetchInPageContext(urls) {
    const results = {};
    const BATCH = 8;

    function toBase64(buffer) {
        const bytes = new Uint8Array(buffer);
        let binary = '';
        const chunk = 0x8000;
        for (let i = 0; i < bytes.length; i += chunk) {
            binary += String.fromCharCode.apply(null, bytes.subarray(i, i + chunk));
        }
        return btoa(binary);
    }

    for (let i = 0; i < urls.length; i += BATCH) {
        await Promise.all(urls.slice(i, i + BATCH).map(async (url) => {
            try {
                const resp = await fetch(url, { credentials: 'same-origin', cache: 'force-cache' });
                if (!resp.ok) { results[url] = null; return; }
                const buf = await resp.arrayBuffer();
                results[url] = { base64: toBase64(buf), contentType: resp.headers.get('content-type') || '' };
            } catch (_) {
                results[url] = null;
            }
        }));
    }
    return results;
}

async function fetchInExtension(urls, credentials = 'include', concurrency = 10) {
    const results = {};
    let cursor = 0;

    async function worker() {
        while (cursor < urls.length) {
            const url = urls[cursor++];
            const controller = new AbortController();
            const timer = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);
            try {
                const resp = await fetch(url, { credentials, signal: controller.signal });
                if (!resp.ok) { results[url] = null; continue; }
                const buf = await resp.arrayBuffer();
                results[url] = { base64: bufToBase64(buf), contentType: resp.headers.get('content-type') || '' };
            } catch (_) {
                results[url] = null;
            } finally {
                clearTimeout(timer);
            }
        }
    }

    await Promise.all(Array.from({ length: Math.min(concurrency, urls.length) }, worker));
    return results;
}

async function fetchViaPage(tabId, urls) {
    if (tabId == null || urls.length === 0) return {};
    try {
        const res = await chrome.scripting.executeScript({
            target: { tabId },
            func: fetchInPageContext,
            args: [urls]
        });
        return res?.[0]?.result || {};
    } catch (_) {
        return {};
    }
}

async function fetchAll(tabId, urls, onProgress) {
    const CHUNK = 24;
    const fetched = {};

    for (let i = 0; i < urls.length; i += CHUNK) {
        const chunk = urls.slice(i, i + CHUNK);

        // Extension context first: host permissions mean no CORS wall
        Object.assign(fetched, await fetchInExtension(chunk, 'include'));

        // The page has the right cookies, referer and origin for picky servers
        const missing = chunk.filter((url) => !fetched[url]?.base64);
        for (const [url, value] of Object.entries(await fetchViaPage(tabId, missing))) {
            if (value?.base64) fetched[url] = value;
        }

        // Some hosts reject credentialed cross-site requests outright
        const stillMissing = chunk.filter((url) => !fetched[url]?.base64);
        if (stillMissing.length > 0) {
            for (const [url, value] of Object.entries(await fetchInExtension(stillMissing, 'omit'))) {
                if (value?.base64) fetched[url] = value;
            }
        }

        if (onProgress) onProgress(Math.min(i + CHUNK, urls.length), urls.length);
    }

    return fetched;
}

function looksLikeDocument(contentType, bytes) {
    const ct = baseContentType(contentType);
    if (DOCUMENT_CONTENT_TYPES.has(ct)) return true;
    if (ct && ct !== 'application/octet-stream' && ct !== 'binary/octet-stream') return false;
    const head = new TextDecoder('utf-8').decode(bytes.subarray(0, 256)).trim().toLowerCase();
    return head.startsWith('<!doctype html') || head.startsWith('<html');
}

const TRACKING_DOMAINS = [
    'google-analytics.com', 'googletagmanager.com', 'analytics.google.com',
    'stats.g.doubleclick.net', 'connect.facebook.net', 'pixel.facebook.com',
    'embed.tawk.to', 'va.tawk.to', 'static.hotjar.com', 'script.hotjar.com',
    'mc.yandex.ru', 'cdn.mouseflow.com', 'cdn.heapanalytics.com', 'cdn.segment.com',
    'cdn.mxpnl.com', 'js.intercomcdn.com', 'widget.intercom.io', 'snap.licdn.com',
    'bat.bing.com', 'clarity.ms', 'static.cloudflareinsights.com',
    'challenges.cloudflare.com', 'plausible.io', 'cdn.amplitude.com'
];

const TRACKING_PATH_PATTERNS = [
    /\/gtag\/js/i, /\/ga\.js/i, /\/analytics\.js/i, /\/twk-/i, /\/tawk/i,
    /\/beacon\.min\.js/i, /\/fbevents?\.js/i, /\/pixel\.js/i
];

const INLINE_TRACKING_SIGNATURES = [
    'gtag(', 'GoogleAnalyticsObject', '__gaTracker', 'ga("create"', "ga('create'",
    'fbq(', 'Tawk_API', 'Tawk_LoadStart', 'tawk.to',
    'hotjar.com', '_hjSettings', 'hj(', 'ym(', 'mc.yandex.ru',
    '__CF$cv$params', 'data-cf-beacon', 'mouseflow', 'heapanalytics',
    'intercomSettings', 'clarity(', 'clarity.ms'
];

function isTrackingUrl(url) {
    try {
        const u = new URL(url);
        if (TRACKING_DOMAINS.some((d) => u.hostname === d || u.hostname.endsWith('.' + d))) return true;
        if (TRACKING_PATH_PATTERNS.some((p) => p.test(u.pathname))) return true;
    } catch (_) { }
    return false;
}

function isTrackingInline(scriptContent) {
    const s = (scriptContent || '').trim();
    if (!s) return false;
    return INLINE_TRACKING_SIGNATURES.some((sig) => s.includes(sig));
}

function stripTracking(html, pageUrl) {
    return html
        .replace(/<script\s[^>]*src\s*=\s*["']([^"']+)["'][^>]*>[\s\S]*?<\/script>/gi, (match, src) => {
            try {
                if (isTrackingUrl(new URL(src, pageUrl).href)) return '<!-- [WebForge] tracking script removed -->';
            } catch (_) { }
            return match;
        })
        .replace(/<script(?:\s[^>]*)?>([\s\S]*?)<\/script>/gi, (match, content) =>
            isTrackingInline(content) ? '<!-- [WebForge] tracking script removed -->' : match)
        .replace(/<noscript[^>]*>[\s\S]*?<\/noscript>/gi, (match) =>
            /googletagmanager\.com|facebook\.com\/tr/i.test(match)
                ? '<!-- [WebForge] tracking noscript removed -->'
                : match);
}

function createUrlMapper({ baseUrl, localPath, assetMap, pageMap, absolutize = true }) {
    return function mapUrl(raw) {
        if (raw == null) return null;
        const trimmed = String(raw).trim();
        if (!trimmed) return null;
        if (/^(data:|blob:|javascript:|mailto:|tel:|sms:|about:|#|\{)/i.test(trimmed)) return null;

        let absolute;
        if (trimmed.startsWith('webforge-inline:')) {
            absolute = trimmed;
        } else {
            try {
                absolute = new URL(trimmed, baseUrl).href;
            } catch (_) {
                return null;
            }
            if (!/^https?:/i.test(absolute)) return null;
        }

        const hashAt = absolute.indexOf('#');
        const bare = hashAt >= 0 ? absolute.slice(0, hashAt) : absolute;
        const hash = hashAt >= 0 ? absolute.slice(hashAt) : '';

        const asset = assetMap.get(bare);
        if (asset) return relativePath(localPath, asset.localPath) + hash;

        if (pageMap) {
            const page = pageMap.get(normalizePageUrl(bare));
            if (page) return relativePath(localPath, page) + hash;
        }

        // Not captured: absolutize relative URLs so they still resolve online
        if (absolutize && /^https?:/i.test(absolute) && absolute !== trimmed) return absolute;
        return null;
    };
}

function rewriteCssText(text, mapUrl) {
    let changed = false;

    let out = text.replace(/url\(\s*(['"]?)([^'")]*)\1\s*\)/gi, (match, quote, raw) => {
        const mapped = mapUrl(raw);
        if (!mapped) return match;
        changed = true;
        return `url(${quote}${mapped}${quote})`;
    });

    out = out.replace(/@import\s+(['"])([^'"]+)\1/gi, (match, quote, raw) => {
        const mapped = mapUrl(raw);
        if (!mapped) return match;
        changed = true;
        return `@import ${quote}${mapped}${quote}`;
    });

    return { text: out, changed };
}

const HTML_ATTR_RE = /\s(href|src|poster|data|action|formaction|xlink:href)\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s"'`=<>]+))/gi;
const HTML_SRCSET_RE = /\s(srcset|imagesrcset|data-srcset|data-lazy-srcset)\s*=\s*(?:"([^"]*)"|'([^']*)')/gi;
// Lazy loaders and animation players keep their real URLs in data attributes
const HTML_DATA_ATTR_RE = /\s(data-(?:src|lazy-src|original|poster|bg|background|background-image|image|img|url|video|audio|animation|animation-path|lottie|json|icon|sprite))\s*=\s*(?:"([^"]*)"|'([^']*)')/gi;
const HTML_STYLE_ATTR_RE = /\sstyle\s*=\s*(?:"([^"]*)"|'([^']*)')/gi;
const HTML_STYLE_BLOCK_RE = /(<style\b[^>]*>)([\s\S]*?)(<\/style>)/gi;

function rewriteHtml(html, { pageUrl, localPath, assetMap, pageMap }) {
    const mapUrl = createUrlMapper({ baseUrl: pageUrl, localPath, assetMap, pageMap });

    let out = html.replace(HTML_ATTR_RE, (match, attr, dq, sq, uq) => {
        const raw = dq !== undefined ? dq : sq !== undefined ? sq : uq;
        const mapped = mapUrl(raw);
        if (!mapped) return match;
        const quote = sq !== undefined ? "'" : '"';
        return ` ${attr}=${quote}${mapped}${quote}`;
    });

    out = out.replace(HTML_SRCSET_RE, (match, attr, dq, sq) => {
        const value = dq !== undefined ? dq : sq;
        let touched = false;
        const rebuilt = value.split(',').map((part) => {
            const chunk = part.trim();
            if (!chunk) return null;
            const [url, ...descriptors] = chunk.split(/\s+/);
            const mapped = mapUrl(url);
            if (mapped) touched = true;
            return [mapped || url, ...descriptors].join(' ');
        }).filter(Boolean).join(', ');
        if (!touched) return match;
        const quote = sq !== undefined ? "'" : '"';
        return ` ${attr}=${quote}${rebuilt}${quote}`;
    });

    out = out.replace(HTML_DATA_ATTR_RE, (match, attr, dq, sq) => {
        const raw = dq !== undefined ? dq : sq;
        const mapped = mapUrl(raw);
        if (!mapped) return match;
        const quote = sq !== undefined ? "'" : '"';
        return ` ${attr}=${quote}${mapped}${quote}`;
    });

    out = out.replace(HTML_STYLE_ATTR_RE, (match, dq, sq) => {
        const value = dq !== undefined ? dq : sq;
        const result = rewriteCssText(value, mapUrl);
        if (!result.changed) return match;
        const quote = sq !== undefined ? "'" : '"';
        return ` style=${quote}${result.text}${quote}`;
    });

    out = out.replace(HTML_STYLE_BLOCK_RE, (match, open, css, close) => {
        const result = rewriteCssText(css, mapUrl);
        return result.changed ? open + result.text + close : match;
    });

    out = out
        .replace(/<base\s[^>]*>/gi, '')
        .replace(/\s+crossorigin(?:\s*=\s*(?:"[^"]*"|'[^']*'|[^\s>]*))?/gi, '')
        .replace(/\s+integrity(?:\s*=\s*(?:"[^"]*"|'[^']*'|[^\s>]*))?/gi, '')
        .replace(/<meta\s+[^>]*http-equiv\s*=\s*["']Content-Security-Policy["'][^>]*>/gi, '');

    // Files are written as UTF-8 regardless of what the original page declared
    if (/<meta[^>]+charset\s*=/i.test(out)) {
        out = out.replace(/<meta[^>]+charset\s*=\s*["']?[\w-]+["']?[^>]*>/i, '<meta charset="utf-8">');
    } else if (/<head[^>]*>/i.test(out)) {
        out = out.replace(/<head[^>]*>/i, (m) => m + '\n<meta charset="utf-8">');
    }

    return out;
}

const JS_URL_RE = /(["'`])((?:https?:\/\/|\/)[^"'`\s<>]{2,})\1/g;

function rewriteJsText(text, mapUrl) {
    let changed = false;
    const out = text.replace(JS_URL_RE, (match, quote, raw) => {
        const mapped = mapUrl(raw);
        if (!mapped) return match;
        changed = true;
        return `${quote}${mapped}${quote}`;
    });
    return { text: out, changed };
}

async function capturePage(tabId) {
    const results = await chrome.scripting.executeScript({
        target: { tabId },
        files: ['content.js']
    });
    return results?.[0]?.result || null;
}

function sleep(ms) {
    return new Promise((r) => setTimeout(r, ms));
}

function waitForTabLoad(tabId) {
    let finish;
    const promise = new Promise((resolve, reject) => {
        let settled = false;
        const timer = setTimeout(() => finish(new Error('Page load timeout')), PAGE_LOAD_TIMEOUT_MS);

        finish = (err) => {
            if (settled) return;
            settled = true;
            clearTimeout(timer);
            chrome.tabs.onUpdated.removeListener(onUpdated);
            err ? reject(err) : resolve();
        };

        function onUpdated(id, info) {
            if (id === tabId && info.status === 'complete') finish();
        }

        chrome.tabs.onUpdated.addListener(onUpdated);
    });

    promise.catch(() => { });
    return { promise, cancel: () => finish(new Error('cancelled')) };
}

async function navigateTab(tabId, url) {
    const tab = await chrome.tabs.get(tabId);
    if (normalizePageUrl(tab.url || '') === normalizePageUrl(url)) return;

    const waiter = waitForTabLoad(tabId);
    try {
        await chrome.tabs.update(tabId, { url });
    } catch (err) {
        waiter.cancel();
        throw err;
    }
    await waiter.promise;
    await sleep(250);
}

async function collectAssets({ tabId, resources, inlineAssets, cleanTracking, onProgress }) {
    const assetMap = new Map();
    const failed = new Set();
    const nameCounters = new Map();

    function uniqueName(dir, baseName, ext) {
        const key = `${dir}/${baseName}.${ext}`.toLowerCase();
        const seen = nameCounters.get(key) || 0;
        nameCounters.set(key, seen + 1);
        return seen === 0 ? `${baseName}.${ext}` : `${baseName}_${seen}.${ext}`;
    }

    function store(url, requestedType, contentType, bytes) {
        let ext = getExtFromUrl(url) || getExtFromContentType(contentType);
        let type = requestedType && requestedType !== 'other' ? requestedType : guessTypeByExt(ext);
        if (type === 'other' && ext) type = guessTypeByExt(ext);
        if (!ext) ext = defaultExtForType(type);

        const dir = typeFolder(type);
        const baseName = (filenameFromUrl(url).replace(/\.[^.]+$/, '') || 'file');
        const fileName = uniqueName(dir, baseName, ext);
        const record = {
            url,
            type,
            dir,
            fileName,
            localPath: `assets/${dir}/${fileName}`,
            contentType,
            bytes
        };
        assetMap.set(url, record);
        return record;
    }

    for (const item of inlineAssets) {
        if (assetMap.has(item.url)) continue;
        store(item.url, item.type || 'img', item.contentType || '', base64ToUint8(item.base64));
    }

    let queue = [];
    const queued = new Set();
    for (const res of resources) {
        if (queued.has(res.url) || assetMap.has(res.url)) continue;
        if (cleanTracking && isTrackingUrl(res.url)) continue;
        queued.add(res.url);
        queue.push(res);
    }

    let totalDone = 0;
    let totalPlanned = queue.length;

    for (let round = 0; round < MAX_ASSET_ROUNDS && queue.length > 0; round++) {
        const urls = queue.map((r) => r.url);
        const fetched = await fetchAll(tabId, urls, (done) => {
            if (onProgress) onProgress(totalDone + done, Math.max(totalPlanned, totalDone + done));
        });
        totalDone += urls.length;

        const nextRound = [];
        const suspicious = [];

        for (const res of queue) {
            const payload = fetched[res.url];
            if (payload?.base64 && looksLikeDocument(payload.contentType, base64ToUint8(payload.base64))) {
                suspicious.push(res.url);
            }
        }

        // A document body can mean a bot challenge rather than a real page: ask the tab
        if (suspicious.length > 0) {
            for (const [url, value] of Object.entries(await fetchViaPage(tabId, suspicious))) {
                if (value?.base64 && !looksLikeDocument(value.contentType, base64ToUint8(value.base64))) {
                    fetched[url] = value;
                }
            }
        }

        for (const res of queue) {
            const payload = fetched[res.url];
            if (!payload?.base64) {
                failed.add(res.url);
                continue;
            }

            const bytes = base64ToUint8(payload.base64);
            if (looksLikeDocument(payload.contentType, bytes)) {
                // HTML masquerading as an asset: SPA prefetch or error page
                failed.add(res.url);
                continue;
            }

            const record = store(res.url, res.type, payload.contentType, bytes);

            if (record.type === 'css') {
                record.text = decodeText(bytes, payload.contentType);
                for (const nested of findCssUrls(record.text, res.url)) {
                    if (assetMap.has(nested.url) || queued.has(nested.url) || failed.has(nested.url)) continue;
                    if (cleanTracking && isTrackingUrl(nested.url)) continue;
                    queued.add(nested.url);
                    nextRound.push(nested);
                }
            }
        }

        queue = nextRound;
        totalPlanned += queue.length;
    }

    return { assetMap, failed };
}

function findCssUrls(cssText, cssUrl) {
    const found = [];
    const seen = new Set();

    function add(raw, type) {
        if (!raw || /^(data:|blob:|about:|#)/i.test(raw)) return;
        try {
            const absolute = new URL(raw, cssUrl).href;
            if (!/^https?:/i.test(absolute)) return;
            const bare = absolute.split('#')[0];
            if (seen.has(bare)) return;
            seen.add(bare);
            found.push({ url: bare, raw, type });
        } catch (_) { }
    }

    for (const m of cssText.matchAll(/url\(\s*(['"]?)([^'")]+)\1\s*\)/gi)) {
        add(m[2].trim(), guessTypeByExt(getExtFromUrl(m[2].trim().split('#')[0]) || ''));
    }
    for (const m of cssText.matchAll(/@import\s+(?:url\(\s*(['"]?)([^'")]+)\1\s*\)|(['"])([^'"]+)\3)/gi)) {
        add((m[2] || m[4] || '').trim(), 'css');
    }

    return found;
}

let cloning = false;

chrome.runtime.onMessage.addListener((msg) => {
    if (msg.action !== 'clonePage') return;
    if (cloning) {
        sendError('Another clone is already running.');
        return;
    }
    cloning = true;
    handleClone({
        tabId: msg.tabId,
        tabUrl: msg.tabUrl,
        tabTitle: msg.tabTitle,
        buildSitemap: !!msg.buildSitemap,
        cleanTracking: !!msg.cleanTracking,
        crawlSite: !!msg.crawlSite,
        maxPages: Math.max(1, Math.min(500, Number(msg.maxPages) || 10))
    }).finally(() => {
        cloning = false;
    });
});

async function crawlPages({ tabId, startUrl, host, limit, crawlSite }) {
    const queue = [startUrl];
    const queued = new Set([startUrl]);
    const visited = new Set();
    const pages = [];
    const allLinks = new Set();
    const resources = [];
    const resourceSeen = new Set();
    const inlineAssets = [];

    while (queue.length > 0 && pages.length < limit) {
        const target = queue.shift();
        if (visited.has(target)) continue;
        visited.add(target);

        const index = pages.length + 1;
        const pct = Math.round(2 + (pages.length / limit) * 33);
        sendProgress(pct, crawlSite ? `Page ${index}/${limit}: loading…` : 'Capturing page…');

        try {
            await navigateTab(tabId, target);
        } catch (_) {
            continue;
        }

        // A redirect can take us off-site (e.g. /discord -> discord.com)
        let currentUrl = '';
        try {
            currentUrl = (await chrome.tabs.get(tabId)).url || '';
        } catch (_) { }
        if (!currentUrl || new URL(currentUrl).hostname !== host) {
            sendProgress(pct, `Skipped off-site redirect: ${target}`);
            continue;
        }

        sendProgress(pct, crawlSite ? `Page ${index}/${limit}: waiting for dynamics…` : 'Waiting for lazy content…');

        let captured = null;
        try {
            captured = await capturePage(tabId);
        } catch (_) { }
        if (!captured?.html) continue;

        const finalUrl = normalizePageUrl(captured.pageUrl || currentUrl);
        try {
            if (new URL(finalUrl).hostname !== host) continue;
        } catch (_) {
            continue;
        }
        if (visited.has(finalUrl) && finalUrl !== target) continue;
        if (pages.some((p) => p.pageUrl === finalUrl)) continue;
        visited.add(finalUrl);

        pages.push({ pageUrl: finalUrl, html: captured.html, title: captured.title || '' });

        for (const res of captured.resources || []) {
            const bare = res.url.split('#')[0];
            if (resourceSeen.has(bare)) continue;
            resourceSeen.add(bare);
            resources.push({ ...res, url: bare });
        }

        for (const item of captured.inline || []) {
            if (item?.base64) inlineAssets.push(item);
        }

        for (const link of captured.links || []) {
            const normalized = normalizePageUrl(link);
            try {
                if (new URL(normalized).hostname !== host) continue;
            } catch (_) {
                continue;
            }
            allLinks.add(normalized);
            if (!crawlSite) continue;
            if (visited.has(normalized) || queued.has(normalized)) continue;
            queued.add(normalized);
            queue.push(normalized);
        }
    }

    return { pages, resources, inlineAssets, allLinks };
}

async function handleClone({ tabId, tabUrl, tabTitle, buildSitemap, cleanTracking, crawlSite, maxPages }) {
    const returnUrl = tabUrl;

    try {
        const startUrl = normalizePageUrl(tabUrl);
        let host;
        try {
            host = new URL(startUrl).hostname;
        } catch (_) {
            sendError('Invalid page URL.');
            return;
        }

        const limit = crawlSite ? maxPages : 1;
        const { pages, resources, inlineAssets, allLinks } =
            await crawlPages({ tabId, startUrl, host, limit, crawlSite });

        if (pages.length === 0) {
            sendError('Failed to capture page content.');
            return;
        }

        sendProgress(38, `Captured ${pages.length} page(s), ${resources.length} resources found.`);

        const { assetMap, failed } = await collectAssets({
            tabId,
            resources,
            inlineAssets,
            cleanTracking,
            onProgress: (done, total) => {
                sendProgress(
                    Math.round(38 + (done / Math.max(total, 1)) * 34),
                    `Downloaded ${done} of ${total} resources…`
                );
            }
        });

        sendProgress(74, `Saved ${assetMap.size} resources. Rewriting links…`);

        const zip = new JSZip();
        const domain = host || 'page';
        const zipName = crawlSite && pages.length > 1
            ? `${domain}-site`
            : sanitizeFilename(`${domain}-${tabTitle || pages[0].title || 'page'}`).substring(0, 80);

        const pageMap = new Map();
        const usedPaths = new Set();
        for (const page of pages) {
            let local = pageUrlToLocalPath(page.pageUrl);
            if (usedPaths.has(local)) {
                const base = local.replace(/\.html?$/i, '');
                let n = 2;
                while (usedPaths.has(`${base}_${n}.html`)) n++;
                local = `${base}_${n}.html`;
            }
            usedPaths.add(local);
            page.localPath = local;
            pageMap.set(page.pageUrl, local);
        }

        for (const asset of assetMap.values()) {
            if (asset.type !== 'css') continue;
            const text = asset.text ?? decodeText(asset.bytes, asset.contentType);
            const mapUrl = createUrlMapper({
                baseUrl: asset.url,
                localPath: asset.localPath,
                assetMap,
                pageMap: null
            });
            const result = rewriteCssText(text, mapUrl);
            let css = result.text;
            css = css.replace(/@charset\s+["'][^"']*["']\s*;/i, '');
            try {
                css = beautifyCss(css);
            } catch (_) { }
            asset.bytes = encodeText(css);
        }

        // Bundled JS resolves URLs against the document, and every page sits at the
        // archive root, so a root-relative asset path is correct for all of them.
        for (const asset of assetMap.values()) {
            if (asset.type !== 'js') continue;
            const text = decodeText(asset.bytes, asset.contentType);
            const mapUrl = createUrlMapper({
                baseUrl: asset.url,
                localPath: 'index.html',
                assetMap,
                pageMap: null,
                // Never absolutize here: router paths like "/pricing" are not URLs to fetch
                absolutize: false
            });
            const result = rewriteJsText(text, mapUrl);
            if (result.changed) asset.bytes = encodeText(result.text);
        }

        for (const asset of assetMap.values()) {
            zip.file(asset.localPath, asset.bytes, zipOptionsFor(asset.fileName));
        }

        sendProgress(84, `Writing ${pages.length} HTML page(s)…`);

        for (const page of pages) {
            let html = rewriteHtml(page.html, {
                pageUrl: page.pageUrl,
                localPath: page.localPath,
                assetMap,
                pageMap
            });
            if (cleanTracking) html = stripTracking(html, page.pageUrl);

            const banner = `<!-- Cloned by WebForge from ${page.pageUrl} on ${new Date().toISOString()} -->`;
            html = /<!DOCTYPE html>/i.test(html)
                ? html.replace(/<!DOCTYPE html>/i, (m) => `${m}\n${banner}`)
                : `${banner}\n${html}`;

            zip.file(page.localPath, html);
        }

        if (buildSitemap) {
            const links = crawlSite && pages.length > 1
                ? pages.map((p) => p.pageUrl)
                : [...allLinks];
            if (links.length > 0) {
                const today = new Date().toISOString().split('T')[0];
                let xml = '<?xml version="1.0" encoding="UTF-8"?>\n';
                xml += '<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n';
                for (const link of links) {
                    const loc = link.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
                    xml += `  <url>\n    <loc>${loc}</loc>\n    <lastmod>${today}</lastmod>\n  </url>\n`;
                }
                xml += '</urlset>\n';
                zip.file('sitemap.xml', xml);
            }
        }

        if (failed.size > 0) {
            zip.file(
                'webforge-missing.txt',
                `${failed.size} resource(s) could not be saved (blocked, gone, or served as HTML):\n\n` +
                [...failed].sort().join('\n') + '\n'
            );
        }

        try {
            await navigateTab(tabId, returnUrl);
        } catch (_) { }

        sendProgress(88, 'Compressing archive…');

        const blob = await zip.generateAsync({
            type: 'blob',
            compression: 'DEFLATE',
            compressionOptions: { level: 6 }
        }, (meta) => {
            sendProgress(Math.round(88 + (meta.percent / 100) * 11), `Compressing: ${Math.round(meta.percent)}%`);
        });

        sendProgress(99, 'Starting download…');

        const url = URL.createObjectURL(blob);
        chrome.downloads.download({
            url,
            filename: `${sanitizeFilename(zipName)}.zip`,
            saveAs: true
        }, () => {
            setTimeout(() => URL.revokeObjectURL(url), 60000);
            if (chrome.runtime.lastError) sendError('Download failed: ' + chrome.runtime.lastError.message);
            else sendDone();
        });
    } catch (err) {
        try { await navigateTab(tabId, returnUrl); } catch (_) { }
        sendError('Clone failed: ' + (err.message || String(err)));
    }
}
