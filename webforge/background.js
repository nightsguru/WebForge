
try {
    importScripts('lib/jszip.min.js');
} catch (_) {
}

function sanitizeFilename(name) {
    return name
        .replace(/[<>:"/\\|?*#]/g, '_')
        .replace(/\s+/g, '_')
        .replace(/_+/g, '_')
        .substring(0, 120);
}

function escapeRegExp(str) {
    return str.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function getExtFromUrl(url) {
    try {
        const basename = new URL(url).pathname.split('/').pop() || '';
        const lastDot = basename.lastIndexOf('.');
        if (lastDot !== -1) {
            const ext = basename.substring(lastDot + 1).toLowerCase();
            if (ext.length <= 10 && /^[a-z0-9]+$/.test(ext)) return ext;
        }
    } catch (_) { }
    return '';
}

function getExtFromContentType(ct) {
    if (!ct) return '';
    const map = {
        'text/css': 'css', 'text/javascript': 'js', 'application/javascript': 'js',
        'application/x-javascript': 'js', 'image/png': 'png', 'image/jpeg': 'jpg',
        'image/gif': 'gif', 'image/svg+xml': 'svg', 'image/webp': 'webp',
        'image/avif': 'avif', 'image/x-icon': 'ico', 'image/vnd.microsoft.icon': 'ico',
        'font/woff': 'woff', 'font/woff2': 'woff2', 'font/ttf': 'ttf', 'font/otf': 'otf',
        'application/font-woff': 'woff', 'application/font-woff2': 'woff2',
        'application/x-font-woff': 'woff', 'application/x-font-ttf': 'ttf',
        'application/vnd.ms-fontobject': 'eot', 'video/mp4': 'mp4', 'video/webm': 'webm',
        'audio/mpeg': 'mp3', 'audio/ogg': 'ogg', 'application/json': 'json'
    };
    return map[(ct.split(';')[0].trim().toLowerCase())] || '';
}

function typeFolder(type) {
    return { css: 'css', js: 'js', img: 'img', font: 'fonts', media: 'media' }[type] || 'other';
}

function guessTypeByExt(ext) {
    if (['css'].includes(ext)) return 'css';
    if (['js', 'mjs'].includes(ext)) return 'js';
    if (['png', 'jpg', 'jpeg', 'gif', 'svg', 'webp', 'avif', 'ico', 'bmp'].includes(ext)) return 'img';
    if (['woff', 'woff2', 'ttf', 'otf', 'eot'].includes(ext)) return 'font';
    if (['mp4', 'webm', 'mp3', 'ogg', 'wav'].includes(ext)) return 'media';
    return 'other';
}

function filenameFromUrl(url) {
    try {
        let name = new URL(url).pathname.split('/').filter(Boolean).pop() || 'file';
        name = name.split('?')[0].split('#')[0];
        return sanitizeFilename(decodeURIComponent(name));
    } catch (_) { return 'file'; }
}

function extractCssUrls(cssText, cssFileUrl) {
    const urls = [];
    const regex = /url\(\s*['"]?([^'")]+?)['"]?\s*\)/gi;
    let m;
    while ((m = regex.exec(cssText)) !== null) {
        const raw = m[1].trim();
        if (raw.startsWith('data:') || raw.startsWith('blob:')) continue;
        try {
            urls.push({ raw, absolute: new URL(raw, cssFileUrl).href });
        } catch (_) { }
    }
    return urls;
}

function dataUrlToUint8(dataUrl) {
    const base64 = dataUrl.split(',')[1];
    const binary = atob(base64);
    const bytes = new Uint8Array(binary.length);
    for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
    return bytes;
}

function isCssMinified(css) {
    if (css.length < 100) return false;
    const lines = css.split('\n');
    const avgLen = css.length / lines.length;
    return avgLen > 200 || (lines.length < css.length / 500);
}

function beautifyCss(css) {
    if (!isCssMinified(css)) return css;

    let result = '';
    let indent = 0;
    let inString = false;
    let stringChar = '';
    let i = 0;

    const ind = () => '  '.repeat(indent);

    while (i < css.length) {
        const ch = css[i];

        if (inString) {
            result += ch;
            if (ch === stringChar && css[i - 1] !== '\\') inString = false;
            i++;
            continue;
        }
        if (ch === '"' || ch === "'") {
            inString = true;
            stringChar = ch;
            result += ch;
            i++;
            continue;
        }

        if (ch === '/' && css[i + 1] === '*') {
            const end = css.indexOf('*/', i + 2);
            if (end === -1) { result += css.substring(i); break; }
            result += '\n' + ind() + css.substring(i, end + 2) + '\n';
            i = end + 2;
            continue;
        }

        if (ch === '{') {
            result = result.trimEnd();
            result += ' {\n';
            indent++;
            result += ind();
            i++;
            while (i < css.length && (css[i] === ' ' || css[i] === '\t' || css[i] === '\n' || css[i] === '\r')) i++;
            continue;
        }

        if (ch === '}') {
            result = result.trimEnd();
            result += '\n';
            indent = Math.max(0, indent - 1);
            result += ind() + '}\n\n' + ind();
            i++;
            while (i < css.length && (css[i] === ' ' || css[i] === '\t' || css[i] === '\n' || css[i] === '\r')) i++;
            continue;
        }

        if (ch === ';') {
            result += ';\n' + ind();
            i++;
            while (i < css.length && (css[i] === ' ' || css[i] === '\t' || css[i] === '\n' || css[i] === '\r')) i++;
            continue;
        }

        if (ch === ':' && indent > 0) {
            const before = result.trimEnd();
            const afterColon = css.substring(i + 1, i + 3);
            if (css[i + 1] === ':' || /[a-z-]$/i.test(before) && /^[a-z]/i.test(afterColon) && !before.endsWith(' ')) {
                const lastNewline = result.lastIndexOf('\n');
                const lineContent = result.substring(lastNewline + 1).trim();
                if (!lineContent.includes('{') && /^[a-z-]+$/i.test(lineContent)) {
                    result += ': ';
                    i++;
                    while (i < css.length && css[i] === ' ') i++;
                    continue;
                }
            }
            result += ch;
            i++;
            continue;
        }

        result += ch;
        i++;
    }

    return result
        .split('\n')
        .map(line => line.trimEnd())
        .join('\n')
        .replace(/\n{3,}/g, '\n\n')
        .trim() + '\n';
}

function formatHtml(html) {
    const blockTags = ['<html', '</html>', '<head', '</head>', '<body', '</body>',
        '<div', '</div>', '<section', '</section>', '<header', '</header>',
        '<footer', '</footer>', '<nav', '</nav>', '<main', '</main>',
        '<article', '</article>', '<table', '</table>', '<tr', '</tr>',
        '<script', '</script>', '<link ', '<meta ', '<title', '</title>',
        '<style', '</style>'];

    let result = html;
    for (const tag of blockTags) {
        result = result.split(tag).join('\n' + tag);
    }
    result = result.replace(/\n{3,}/g, '\n\n');
    return result.trim();
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
    const BATCH = 6;

    for (let i = 0; i < urls.length; i += BATCH) {
        const batch = urls.slice(i, i + BATCH);
        await Promise.all(batch.map(async (url) => {
            try {
                const resp = await fetch(url, { credentials: 'same-origin', cache: 'force-cache' });
                if (!resp.ok) { results[url] = null; return; }
                const ct = resp.headers.get('content-type') || '';
                const blob = await resp.blob();

                const dataUrl = await new Promise((resolve, reject) => {
                    const reader = new FileReader();
                    reader.onloadend = () => resolve(reader.result);
                    reader.onerror = reject;
                    reader.readAsDataURL(blob);
                });

                results[url] = { dataUrl, contentType: ct };
            } catch (_) {
                results[url] = null;
            }
        }));
    }
    return results;
}

const TRACKING_DOMAINS = [
    'google-analytics.com', 'googletagmanager.com', 'www.google-analytics.com',
    'analytics.google.com', 'stats.g.doubleclick.net',
    'connect.facebook.net', 'pixel.facebook.com',
    'embed.tawk.to', 'va.tawk.to',
    'static.hotjar.com', 'script.hotjar.com',
    'mc.yandex.ru', 'cdn.mouseflow.com',
    'cdn.heapanalytics.com', 'cdn.segment.com',
    'cdn.mxpnl.com', 'js.intercomcdn.com',
    'widget.intercom.io', 'snap.licdn.com',
    'bat.bing.com', 'clarity.ms',
    'static.cloudflareinsights.com',
    'challenges.cloudflare.com',
    'plausible.io', 'cdn.amplitude.com'
];

const TRACKING_PATH_PATTERNS = [
    /\/gtag\/js/i, /\/ga\.js/i, /\/analytics\.js/i,
    /\/twk-/i, /\/tawk/i,
    /\/beacon\.min\.js/i,
    /\/fbevents?\.js/i,
    /\/pixel\.js/i
];

const INLINE_TRACKING_SIGNATURES = [
    'gtag(', 'GoogleAnalyticsObject', '__gaTracker', 'ga("create"', "ga('create'",
    'fbq(', 'Tawk_API', 'Tawk_LoadStart', 'tawk.to',
    'hotjar.com', '_hjSettings', 'hj(',
    'ym(', 'mc.yandex.ru',
    '__CF$cv$params', 'data-cf-beacon',
    'mouseflow', 'heapanalytics', 'intercomSettings',
    'clarity(', 'clarity.ms'
];

function isTrackingUrl(url) {
    try {
        const u = new URL(url);
        if (TRACKING_DOMAINS.some(d => u.hostname === d || u.hostname.endsWith('.' + d))) return true;
        if (TRACKING_PATH_PATTERNS.some(p => p.test(u.pathname))) return true;
    } catch (_) { }
    return false;
}

function isTrackingInline(scriptContent) {
    const s = scriptContent.trim();
    if (!s) return false;
    return INLINE_TRACKING_SIGNATURES.some(sig => s.includes(sig));
}

chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
    if (msg.action === 'clonePage') {
        handleClone(msg.tabId, msg.tabUrl, msg.tabTitle, msg.buildSitemap, msg.cleanTracking);
    }
});

async function handleClone(tabId, tabUrl, tabTitle, buildSitemap, cleanTracking) {
    try {
        sendProgress(5, 'Capturing page...');

        const captureResults = await chrome.scripting.executeScript({
            target: { tabId },
            files: ['content.js']
        });

        if (!captureResults?.[0]?.result) {
            sendError('Failed to capture page content.');
            return;
        }

        const { html, pageUrl, resources, links } = captureResults[0].result;

        sendProgress(10, `Found ${resources.length} resources.`);

        let downloadResources = resources;
        const blockedUrls = new Set();
        if (cleanTracking) {
            downloadResources = resources.filter(r => {
                if (isTrackingUrl(r.url)) {
                    blockedUrls.add(r.url);
                    if (r.raw) blockedUrls.add(r.raw);
                    return false;
                }
                return true;
            });
            if (blockedUrls.size > 0) {
                sendProgress(11, `Filtered ${blockedUrls.size} tracking resources. Downloading ${downloadResources.length}...`);
            }
        }

        const resourceUrls = downloadResources.map(r => r.url);
        const CHUNK = 15;
        const fetchedMap = {};

        for (let i = 0; i < resourceUrls.length; i += CHUNK) {
            const chunk = resourceUrls.slice(i, i + CHUNK);

            const fetchResults = await chrome.scripting.executeScript({
                target: { tabId },
                func: fetchInPageContext,
                args: [chunk]
            });

            if (fetchResults?.[0]?.result) {
                Object.assign(fetchedMap, fetchResults[0].result);
            }

            const done = Math.min(i + CHUNK, resourceUrls.length);
            const pct = Math.round(10 + (done / resourceUrls.length) * 50);
            sendProgress(pct, `Downloaded ${done} of ${resourceUrls.length} resources...`);
        }

        sendProgress(62, 'Building file structure...');

        const zip = new JSZip();
        let domain = 'page';
        try { domain = new URL(pageUrl).hostname; } catch (_) { }
        const safeTitle = sanitizeFilename(tabTitle || 'page').substring(0, 60);
        const folderName = `${domain} (${safeTitle})`;

        const folder = zip.folder(folderName);
        const assetsFolder = folder.folder('assets');

        const urlToLocal = new Map();
        const nameCounters = {};
        const cssContents = [];

        function uniqueName(dir, baseName, ext) {
            const key = `${dir}/${baseName}.${ext}`;
            if (!nameCounters[key]) { nameCounters[key] = 0; return `${baseName}.${ext}`; }
            nameCounters[key]++;
            return `${baseName}_${nameCounters[key]}.${ext}`;
        }

        function registerUrl(absoluteUrl, rawAttr, localPath) {
            urlToLocal.set(absoluteUrl, localPath);
            if (rawAttr && rawAttr !== absoluteUrl) urlToLocal.set(rawAttr, localPath);
            try {
                const u = new URL(absoluteUrl);
                const relPath = u.pathname + (u.search || '');
                if (relPath && relPath !== '/') urlToLocal.set(relPath, localPath);
                if (u.search && u.pathname !== '/') urlToLocal.set(u.pathname, localPath);
            } catch (_) { }
        }

        let successCount = 0;
        for (const res of downloadResources) {
            const fetched = fetchedMap[res.url];
            if (!fetched) continue;

            let ext = getExtFromUrl(res.url) || getExtFromContentType(fetched.contentType);
            let type = res.type || guessTypeByExt(ext);
            if (!ext) ext = type === 'css' ? 'css' : type === 'js' ? 'js' : 'bin';

            const dir = typeFolder(type);
            const baseName = filenameFromUrl(res.url).replace(/\.[^.]+$/, '') || 'file';
            const fileName = uniqueName(dir, baseName, ext);
            const localPath = `assets/${dir}/${fileName}`;

            const data = dataUrlToUint8(fetched.dataUrl);
            registerUrl(res.url, res.raw, localPath);
            assetsFolder.folder(dir).file(fileName, data);
            successCount++;

            if (type === 'css') {
                try {
                    const text = new TextDecoder('utf-8').decode(data);
                    cssContents.push({ url: res.url, text, fileName });
                } catch (_) { }
            }
        }

        sendProgress(68, `Saved ${successCount} resources. Scanning CSS for nested assets...`);

        const nestedUrls = [];
        const nestedSeen = new Set([...urlToLocal.keys()]);

        for (const css of cssContents) {
            for (const u of extractCssUrls(css.text, css.url)) {
                if (!nestedSeen.has(u.absolute)) {
                    nestedSeen.add(u.absolute);
                    nestedUrls.push(u);
                }
            }
        }

        if (nestedUrls.length > 0) {
            sendProgress(70, `Downloading ${nestedUrls.length} nested CSS resources...`);
            const nestedUrlList = nestedUrls.map(u => u.absolute);

            for (let i = 0; i < nestedUrlList.length; i += CHUNK) {
                const chunk = nestedUrlList.slice(i, i + CHUNK);
                const fetchResults = await chrome.scripting.executeScript({
                    target: { tabId },
                    func: fetchInPageContext,
                    args: [chunk]
                });

                if (fetchResults?.[0]?.result) {
                    for (const [url, fetched] of Object.entries(fetchResults[0].result)) {
                        if (!fetched) continue;
                        const ext = getExtFromUrl(url) || getExtFromContentType(fetched.contentType) || 'bin';
                        const type = guessTypeByExt(ext);
                        const dir = typeFolder(type);
                        const baseName = filenameFromUrl(url).replace(/\.[^.]+$/, '') || 'file';
                        const fileName = uniqueName(dir, baseName, ext);
                        const localPath = `assets/${dir}/${fileName}`;

                        const nestedEntry = nestedUrls.find(u => u.absolute === url);
                        registerUrl(url, nestedEntry?.raw, localPath);
                        assetsFolder.folder(dir).file(fileName, dataUrlToUint8(fetched.dataUrl));
                    }
                }
            }
        }

        sendProgress(80, 'Rewriting CSS paths...');

        for (const css of cssContents) {
            let rewritten = css.text;
            for (const u of extractCssUrls(css.text, css.url)) {
                const localPath = urlToLocal.get(u.absolute);
                if (localPath) {
                    const rel = '../' + localPath.replace('assets/', '');
                    rewritten = rewritten.replace(new RegExp(escapeRegExp(u.raw), 'g'), rel);
                }
            }
            const cssLocal = urlToLocal.get(css.url);
            if (cssLocal) {
                const parts = cssLocal.split('/');
                rewritten = beautifyCss(rewritten);
                assetsFolder.folder(parts[1]).file(parts.slice(2).join('/'), rewritten);
            }
        }

        sendProgress(88, 'Rewriting HTML paths...');

        let rewrittenHtml = html;

        const sorted = [...urlToLocal.entries()].sort((a, b) => b[0].length - a[0].length);

        for (const [original, local] of sorted) {
            if (original.length < 3) continue;
            const escaped = escapeRegExp(original);
            rewrittenHtml = rewrittenHtml.replace(
                new RegExp(`((?:href|src|srcset|content|action|poster)\\s*=\\s*["'])${escaped}`, 'gi'),
                (match, prefix) => prefix + local
            );
            rewrittenHtml = rewrittenHtml.replace(
                new RegExp(`(url\\(\\s*['"]?)${escaped}`, 'gi'),
                (match, prefix) => prefix + local
            );
        }

        rewrittenHtml = rewrittenHtml.replace(/<base\s[^>]*>/gi, '');

        rewrittenHtml = rewrittenHtml.replace(/\s+crossorigin(?:\s*=\s*(?:"[^"]*"|'[^']*'|[^\s>]*))?/gi, '');

        rewrittenHtml = rewrittenHtml.replace(/\s+integrity(?:\s*=\s*(?:"[^"]*"|'[^']*'|[^\s>]*))?/gi, '');

        rewrittenHtml = rewrittenHtml.replace(/<meta\s+[^>]*http-equiv\s*=\s*["']Content-Security-Policy["'][^>]*>/gi, '');

        if (cleanTracking) {
            rewrittenHtml = rewrittenHtml.replace(
                /<script\s[^>]*src\s*=\s*["']([^"']+)["'][^>]*>[\s\S]*?<\/script>/gi,
                (match, src) => {
                    try {
                        const absolute = new URL(src, pageUrl).href;
                        if (isTrackingUrl(absolute) || blockedUrls.has(src) || blockedUrls.has(absolute)) {
                            return '<!-- [WebForge] tracking script removed -->';
                        }
                    } catch (_) { }
                    return match;
                }
            );

            rewrittenHtml = rewrittenHtml.replace(
                /<script(?:\s[^>]*)?>([\s\S]*?)<\/script>/gi,
                (match, content) => {
                    if (isTrackingInline(content)) {
                        return '<!-- [WebForge] tracking script removed -->';
                    }
                    return match;
                }
            );

            rewrittenHtml = rewrittenHtml.replace(
                /<noscript[^>]*>[\s\S]*?<\/noscript>/gi,
                (match) => {
                    if (/googletagmanager\.com|facebook\.com\/tr/i.test(match)) {
                        return '<!-- [WebForge] tracking noscript removed -->';
                    }
                    return match;
                }
            );
        }
        rewrittenHtml = formatHtml(rewrittenHtml);

        const comment = `<!-- Cloned by WebForge from ${pageUrl} on ${new Date().toISOString()} -->`;
        rewrittenHtml = rewrittenHtml.replace('<!DOCTYPE html>', `<!DOCTYPE html>\n${comment}`);

        folder.file('index.html', rewrittenHtml);

        if (buildSitemap && links && links.length > 0) {
            sendProgress(91, `Building sitemap.xml with ${links.length} links...`);
            const today = new Date().toISOString().split('T')[0];
            let xml = '<?xml version="1.0" encoding="UTF-8"?>\n';
            xml += '<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n';
            for (const link of links) {
                xml += '  <url>\n';
                xml += `    <loc>${link.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')}</loc>\n`;
                xml += `    <lastmod>${today}</lastmod>\n`;
                xml += '  </url>\n';
            }
            xml += '</urlset>\n';
            folder.file('sitemap.xml', xml);
        }

        sendProgress(92, 'Compressing archive...');

        const blob = await zip.generateAsync({
            type: 'blob',
            compression: 'DEFLATE',
            compressionOptions: { level: 6 }
        }, (meta) => {
            sendProgress(Math.round(92 + (meta.percent / 100) * 7), `Compressing: ${Math.round(meta.percent)}%`);
        });

        sendProgress(99, 'Starting download...');

        const url = URL.createObjectURL(blob);
        chrome.downloads.download({
            url: url,
            filename: `${sanitizeFilename(folderName)}.zip`,
            saveAs: true
        }, () => {
            setTimeout(() => URL.revokeObjectURL(url), 60000);
            if (chrome.runtime.lastError) {
                sendError('Download failed: ' + chrome.runtime.lastError.message);
            } else {
                sendDone();
            }
        });

    } catch (err) {
        sendError('Clone failed: ' + (err.message || String(err)));
    }
}
