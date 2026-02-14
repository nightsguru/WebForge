(() => {
    const pageUrl = location.href;
    const resources = [];
    const seen = new Set();

    function addResource(rawUrl, type) {
        if (!rawUrl || rawUrl.startsWith('data:') || rawUrl.startsWith('blob:') || rawUrl.startsWith('javascript:') || rawUrl.startsWith('#')) return;
        rawUrl = rawUrl.trim();
        if (!rawUrl) return;
        try {
            const absolute = new URL(rawUrl, pageUrl).href;
            if (seen.has(absolute)) return;
            seen.add(absolute);
            resources.push({ url: absolute, raw: rawUrl, type });
        } catch (_) { }
    }

    document.querySelectorAll('link[rel="stylesheet"][href]').forEach(el => {
        addResource(el.getAttribute('href'), 'css');
    });

    document.querySelectorAll('link[rel*="icon"][href]').forEach(el => {
        addResource(el.getAttribute('href'), 'img');
    });

    document.querySelectorAll('link[rel="preload"][href]').forEach(el => {
        const as = el.getAttribute('as') || '';
        const t = as === 'font' ? 'font' : as === 'style' ? 'css' : as === 'script' ? 'js' : 'img';
        addResource(el.getAttribute('href'), t);
    });

    document.querySelectorAll('link[rel="modulepreload"][href]').forEach(el => {
        addResource(el.getAttribute('href'), 'js');
    });

    document.querySelectorAll('script[src]').forEach(el => {
        addResource(el.getAttribute('src'), 'js');
    });

    document.querySelectorAll('img[src]').forEach(el => {
        addResource(el.getAttribute('src'), 'img');
    });
    document.querySelectorAll('[srcset]').forEach(el => {
        (el.getAttribute('srcset') || '').split(',').forEach(entry => {
            const url = entry.trim().split(/\s+/)[0];
            addResource(url, 'img');
        });
    });

    document.querySelectorAll('video[src], video[poster], audio[src], source[src]').forEach(el => {
        if (el.hasAttribute('src')) addResource(el.getAttribute('src'), 'media');
        if (el.hasAttribute('poster')) addResource(el.getAttribute('poster'), 'img');
    });

    document.querySelectorAll('[style]').forEach(el => {
        const style = el.getAttribute('style') || '';
        for (const m of style.matchAll(/url\(\s*['"]?([^'")]+)['"]?\s*\)/gi)) {
            addResource(m[1], 'img');
        }
    });

    document.querySelectorAll('style').forEach(el => {
        for (const m of (el.textContent || '').matchAll(/url\(\s*['"]?([^'")]+)['"]?\s*\)/gi)) {
            addResource(m[1], 'img');
        }
    });

    try {
        for (const sheet of document.styleSheets) {
            try {
                for (const rule of (sheet.cssRules || sheet.rules || [])) {
                    for (const m of (rule.cssText || '').matchAll(/url\(\s*['"]?([^'")]+)['"]?\s*\)/gi)) {
                        const raw = m[1].trim();
                        if (raw.startsWith('data:') || raw.startsWith('blob:')) continue;
                        const base = sheet.href || pageUrl;
                        addResource(new URL(raw, base).href, guessType(raw));
                    }
                }
            } catch (_) { }
        }
    } catch (_) { }

    function guessType(url) {
        const ext = url.split('?')[0].split('#')[0].split('.').pop().toLowerCase();
        if (['css'].includes(ext)) return 'css';
        if (['js', 'mjs'].includes(ext)) return 'js';
        if (['woff', 'woff2', 'ttf', 'otf', 'eot'].includes(ext)) return 'font';
        if (['png', 'jpg', 'jpeg', 'gif', 'svg', 'webp', 'avif', 'ico', 'bmp'].includes(ext)) return 'img';
        if (['mp4', 'webm', 'mp3', 'ogg'].includes(ext)) return 'media';
        return 'other';
    }

    const staticExts = new Set(['css', 'js', 'mjs', 'png', 'jpg', 'jpeg', 'gif', 'svg', 'webp', 'avif', 'ico', 'bmp',
        'woff', 'woff2', 'ttf', 'otf', 'eot', 'mp4', 'webm', 'mp3', 'ogg', 'wav', 'pdf', 'zip', 'rar', 'json', 'xml', 'txt', 'map']);
    const pageLinks = new Set();
    const origin = location.origin;

    document.querySelectorAll('a[href]').forEach(el => {
        const href = el.getAttribute('href');
        if (!href || href.startsWith('#') || href.startsWith('javascript:') || href.startsWith('mailto:') || href.startsWith('tel:')) return;
        try {
            const u = new URL(href, pageUrl);
            if (u.origin !== origin) return;
            const ext = u.pathname.split('.').pop().toLowerCase();
            if (staticExts.has(ext)) return;
            const clean = u.origin + u.pathname + u.search;
            pageLinks.add(clean);
        } catch (_) { }
    });

    const html = '<!DOCTYPE html>\n' + document.documentElement.outerHTML;

    return { html, pageUrl, resources, links: [...pageLinks] };
})();
