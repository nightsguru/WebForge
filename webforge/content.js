(async () => {
    const pageUrl = location.href;
    const host = location.hostname;
    const resources = [];
    const inline = [];
    const seen = new Set();
    const token = Math.random().toString(36).slice(2, 8);

    const MAX_SCROLL_STEPS = 14;
    const SCROLL_DELAY = 90;

    // Extensions that are safe to treat as assets even when fetched by JS
    const ASSET_EXTS = new Set([
        'css', 'js', 'mjs', 'cjs', 'map',
        'png', 'jpg', 'jpeg', 'gif', 'svg', 'webp', 'avif', 'ico', 'bmp', 'apng',
        'woff', 'woff2', 'ttf', 'otf', 'eot',
        'mp4', 'webm', 'mp3', 'ogg', 'oga', 'wav', 'm4a', 'mov',
        'json', 'lottie', 'wasm', 'glb', 'gltf', 'bin', 'ktx2', 'basis', 'hdr', 'exr',
        'xml', 'txt', 'csv', 'vtt', 'srt'
    ]);

    // Never crawl these as pages
    const PAGE_SKIP_EXTS = new Set([...ASSET_EXTS, 'zip', 'rar', '7z', 'dmg', 'exe', 'pdf', 'doc', 'docx', 'xls', 'xlsx', 'ppt', 'pptx', 'odt', 'ods', 'odp', 'mstsream', 'mstsc']);

    const DATA_URL_ATTRS = [
        'data-src', 'data-srcset', 'data-lazy-src', 'data-lazy-srcset', 'data-original',
        'data-poster', 'data-bg', 'data-background', 'data-background-image',
        'data-image', 'data-img', 'data-url', 'data-video', 'data-audio',
        'data-animation', 'data-animation-path', 'data-lottie', 'data-json',
        'data-icon', 'data-sprite'
    ];
    const DATA_URL_SELECTOR = DATA_URL_ATTRS.map((a) => `[${a}]`).join(',');

    function sleep(ms) {
        return new Promise((r) => setTimeout(r, ms));
    }

    function extOf(url) {
        try {
            const path = new URL(url, pageUrl).pathname;
            const last = path.split('/').pop() || '';
            if (!last.includes('.')) return '';
            return last.split('.').pop().toLowerCase();
        } catch (_) {
            return '';
        }
    }

    function guessType(url) {
        const ext = extOf(url);
        if (ext === 'css') return 'css';
        if (['js', 'mjs', 'cjs'].includes(ext)) return 'js';
        if (['woff', 'woff2', 'ttf', 'otf', 'eot'].includes(ext)) return 'font';
        if (['png', 'jpg', 'jpeg', 'gif', 'svg', 'webp', 'avif', 'ico', 'bmp', 'apng'].includes(ext)) return 'img';
        if (['mp4', 'webm', 'mp3', 'ogg', 'oga', 'wav', 'm4a', 'mov'].includes(ext)) return 'media';
        return 'other';
    }

    function isRscLike(url) {
        return /[?&](_rsc|__flight__|_next_data_)=/i.test(url) || /\/__nextjs/i.test(url);
    }

    function addResource(rawUrl, type) {
        if (!rawUrl) return;
        rawUrl = String(rawUrl).trim();
        if (!rawUrl) return;
        if (/^(data:|blob:|javascript:|mailto:|tel:|about:|#)/i.test(rawUrl)) return;
        try {
            const absolute = new URL(rawUrl, pageUrl).href;
            if (!/^https?:/i.test(absolute)) return;
            if (isRscLike(absolute)) return;
            if (seen.has(absolute)) return;
            seen.add(absolute);
            resources.push({ url: absolute, raw: rawUrl, type: type || guessType(absolute) });
        } catch (_) { }
    }

    function waitForNetworkQuiet(quietMs, maxMs) {
        return new Promise((resolve) => {
            let last = Date.now();
            let obs;
            try {
                obs = new PerformanceObserver(() => { last = Date.now(); });
                obs.observe({ entryTypes: ['resource'] });
            } catch (_) {
                setTimeout(resolve, Math.min(quietMs, maxMs));
                return;
            }
            const start = Date.now();
            const iv = setInterval(() => {
                if (Date.now() - last >= quietMs || Date.now() - start >= maxMs) {
                    clearInterval(iv);
                    try { obs.disconnect(); } catch (_) { }
                    resolve();
                }
            }, 100);
        });
    }

    function withTimeout(promise, ms) {
        return Promise.race([promise, sleep(ms)]);
    }

    function unlazy() {
        document.querySelectorAll('img[loading="lazy"], iframe[loading="lazy"]').forEach((el) => {
            el.loading = 'eager';
        });
        document.querySelectorAll('[data-src], [data-lazy-src], [data-original]').forEach((el) => {
            const tag = el.tagName;
            if (!['IMG', 'VIDEO', 'AUDIO', 'SOURCE', 'IFRAME'].includes(tag)) return;
            const src = el.getAttribute('data-src') || el.getAttribute('data-lazy-src') || el.getAttribute('data-original');
            if (src && !el.getAttribute('src')) el.setAttribute('src', src);
        });
        document.querySelectorAll('[data-srcset], [data-lazy-srcset]').forEach((el) => {
            const set = el.getAttribute('data-srcset') || el.getAttribute('data-lazy-srcset');
            if (set && !el.getAttribute('srcset')) el.setAttribute('srcset', set);
        });
        document.querySelectorAll('[data-background], [data-bg], [data-background-image]').forEach((el) => {
            const bg = el.getAttribute('data-background') || el.getAttribute('data-bg') || el.getAttribute('data-background-image');
            if (bg && !el.style.backgroundImage) el.style.backgroundImage = `url("${bg}")`;
        });
    }

    async function preparePage() {
        unlazy();

        const startY = window.scrollY;
        const height = Math.max(
            document.body?.scrollHeight || 0,
            document.documentElement?.scrollHeight || 0,
            window.innerHeight
        );
        const step = Math.max(Math.ceil(height / MAX_SCROLL_STEPS), Math.floor(window.innerHeight * 0.9));

        for (let y = step; y < height; y += step) {
            window.scrollTo(0, y);
            await sleep(SCROLL_DELAY);
        }
        window.scrollTo(0, height);
        await sleep(150);
        window.scrollTo(0, startY);

        unlazy();
        window.dispatchEvent(new Event('resize'));

        await withTimeout(Promise.allSettled(
            [...document.images].slice(0, 80).map((img) => (img.decode ? img.decode().catch(() => { }) : null))
        ), 2000);

        await withTimeout(document.fonts?.ready || Promise.resolve(), 2000);

        document.querySelectorAll('details:not([open])').forEach((d) => { d.open = true; });

        await sleep(120);
        await waitForNetworkQuiet(500, 2000);
    }

    function extractUrlsFromCssText(cssText, base) {
        const text = cssText || '';
        for (const m of text.matchAll(/url\(\s*(['"]?)([^'")]+)\1\s*\)/gi)) {
            const raw = m[2].trim();
            if (!raw || raw.startsWith('data:') || raw.startsWith('blob:')) continue;
            try {
                addResource(new URL(raw, base).href, guessType(raw));
            } catch (_) { }
        }
        for (const m of text.matchAll(/@import\s+(['"])([^'"]+)\1/gi)) {
            try {
                addResource(new URL(m[2], base).href, 'css');
            } catch (_) { }
        }
    }

    function collectFromRoot(root) {
        root.querySelectorAll('link[href]').forEach((el) => {
            const rel = (el.getAttribute('rel') || '').toLowerCase();
            const href = el.getAttribute('href');
            const as = (el.getAttribute('as') || '').toLowerCase();
            if (rel.includes('stylesheet')) return addResource(href, 'css');
            if (rel.includes('icon')) return addResource(href, 'img');
            if (rel === 'modulepreload') return addResource(href, 'js');
            if (rel === 'preload') {
                const type = as === 'font' ? 'font'
                    : as === 'style' ? 'css'
                        : as === 'script' || as === 'worker' ? 'js'
                            : as === 'image' ? 'img'
                                : as === 'video' || as === 'audio' ? 'media'
                                    : guessType(href);
                // preload as=fetch is often a page prefetch on SPA frameworks
                if (as === 'fetch' && !ASSET_EXTS.has(extOf(href))) return;
                return addResource(href, type);
            }
            if (rel === 'manifest' || rel === 'apple-touch-icon') return addResource(href, 'other');
        });

        root.querySelectorAll('script[src]').forEach((el) => addResource(el.getAttribute('src'), 'js'));
        root.querySelectorAll('img[src]').forEach((el) => addResource(el.getAttribute('src'), 'img'));
        root.querySelectorAll('object[data]').forEach((el) => addResource(el.getAttribute('data'), 'other'));
        root.querySelectorAll('embed[src]').forEach((el) => addResource(el.getAttribute('src'), 'other'));

        root.querySelectorAll('[srcset], [imagesrcset]').forEach((el) => {
            const set = el.getAttribute('srcset') || el.getAttribute('imagesrcset') || '';
            set.split(',').forEach((entry) => addResource(entry.trim().split(/\s+/)[0], 'img'));
        });

        root.querySelectorAll('video, audio, source, track').forEach((el) => {
            if (el.hasAttribute('src')) {
                const inPicture = el.tagName === 'SOURCE' && el.parentElement?.tagName === 'PICTURE';
                addResource(el.getAttribute('src'), inPicture ? 'img' : el.tagName === 'TRACK' ? 'other' : 'media');
            }
            if (el.hasAttribute('poster')) addResource(el.getAttribute('poster'), 'img');
        });

        root.querySelectorAll('use, image').forEach((el) => {
            const href = el.getAttribute('href') || el.getAttribute('xlink:href');
            if (href && !href.startsWith('#')) addResource(href.split('#')[0], 'img');
        });

        // Lazy loaders and animation players hide the real URL in data attributes
        root.querySelectorAll(DATA_URL_SELECTOR).forEach((el) => {
            for (const attr of DATA_URL_ATTRS) {
                const value = el.getAttribute(attr);
                if (!value) continue;
                const candidates = attr.endsWith('srcset')
                    ? value.split(',').map((p) => p.trim().split(/\s+/)[0])
                    : [value.trim()];
                for (const candidate of candidates) {
                    if (!candidate || !ASSET_EXTS.has(extOf(candidate))) continue;
                    addResource(candidate);
                }
            }
        });

        root.querySelectorAll('[style]').forEach((el) => extractUrlsFromCssText(el.getAttribute('style'), pageUrl));
        root.querySelectorAll('style').forEach((el) => extractUrlsFromCssText(el.textContent, pageUrl));
    }

    function walkShadow(root, depth) {
        if (depth > 6) return;
        root.querySelectorAll('*').forEach((el) => {
            if (el.shadowRoot) {
                collectFromRoot(el.shadowRoot);
                walkShadow(el.shadowRoot, depth + 1);
            }
        });
    }

    function collectShadowRoots(root, acc, depth) {
        if (depth > 6) return acc;
        root.querySelectorAll('*').forEach((el) => {
            if (el.shadowRoot) {
                acc.push(el.shadowRoot);
                collectShadowRoots(el.shadowRoot, acc, depth + 1);
            }
        });
        return acc;
    }

    function snapshotCanvases() {
        const touched = [];
        const canvases = [...document.querySelectorAll('canvas')].slice(0, 8);
        canvases.forEach((canvas, i) => {
            if (canvas.width < 64 || canvas.height < 64) return;
            let dataUrl;
            try {
                dataUrl = canvas.toDataURL('image/png');
            } catch (_) {
                return;
            }
            const base64 = (dataUrl.split(',')[1] || '');
            // Blank WebGL buffers compress to almost nothing — not worth keeping
            if (base64.length < 2000) return;
            const name = `webforge-inline:${token}-canvas-${i}.png`;
            inline.push({ url: name, base64, contentType: 'image/png', type: 'img' });
            const prev = canvas.getAttribute('style');
            touched.push([canvas, prev]);
            canvas.setAttribute(
                'style',
                `${prev ? prev + ';' : ''}background-image:url("${name}");background-size:100% 100%;background-repeat:no-repeat`
            );
        });
        return touched;
    }

    function serializeHtml() {
        const shadowRoots = collectShadowRoots(document, [], 0);
        let markup = '';
        if (shadowRoots.length > 0 && typeof document.documentElement.getHTML === 'function') {
            try {
                markup = document.documentElement.getHTML({ serializableShadowRoots: true, shadowRoots });
            } catch (_) { }
        }
        if (!markup) markup = document.documentElement.outerHTML;

        // Constructable stylesheets never appear in serialized markup
        const adopted = [];
        try {
            for (const sheet of document.adoptedStyleSheets || []) {
                const css = [...(sheet.cssRules || [])].map((r) => r.cssText).join('\n');
                if (css.trim()) adopted.push(css);
            }
        } catch (_) { }

        if (adopted.length > 0) {
            const block = adopted.map((css) => `<style data-webforge="adopted">\n${css}\n</style>`).join('\n');
            markup = markup.includes('</head>')
                ? markup.replace('</head>', `${block}\n</head>`)
                : block + markup;
        }

        return '<!DOCTYPE html>\n' + markup;
    }

    await preparePage();

    collectFromRoot(document);
    walkShadow(document, 0);

    try {
        for (const sheet of document.styleSheets) {
            try {
                for (const rule of (sheet.cssRules || sheet.rules || [])) {
                    extractUrlsFromCssText(rule.cssText || '', sheet.href || pageUrl);
                }
            } catch (_) {
                // Cross-origin stylesheet — the file itself is still fetched and parsed later
                if (sheet.href) addResource(sheet.href, 'css');
            }
        }
    } catch (_) { }

    try {
        for (const sheet of document.adoptedStyleSheets || []) {
            for (const rule of sheet.cssRules || []) {
                extractUrlsFromCssText(rule.cssText || '', pageUrl);
            }
        }
    } catch (_) { }

    // Anything the page actually loaded at runtime (lottie json, wasm, textures, ...)
    try {
        for (const entry of performance.getEntriesByType('resource')) {
            const name = entry.name;
            if (!name) continue;
            const initiator = entry.initiatorType;
            if (initiator === 'beacon' || initiator === 'ping' || initiator === 'navigation') continue;
            if (initiator === 'fetch' || initiator === 'xmlhttprequest') {
                // These are usually API/prefetch calls; keep only real files
                if (!ASSET_EXTS.has(extOf(name))) continue;
            }
            addResource(name, guessType(name));
        }
    } catch (_) { }

    const pageLinks = new Set();
    document.querySelectorAll('a[href]').forEach((el) => {
        const href = el.getAttribute('href');
        if (!href || /^(#|javascript:|mailto:|tel:|sms:|data:)/i.test(href)) return;
        if (el.hasAttribute('download')) return;
        try {
            const u = new URL(href, pageUrl);
            if (u.hostname !== host) return;
            if (!/^https?:$/i.test(u.protocol)) return;
            const last = u.pathname.split('/').pop() || '';
            const ext = last.includes('.') ? last.split('.').pop().toLowerCase() : '';
            if (ext && PAGE_SKIP_EXTS.has(ext)) return;
            u.hash = '';
            pageLinks.add(u.href);
        } catch (_) { }
    });

    const restore = snapshotCanvases();
    const html = serializeHtml();
    restore.forEach(([canvas, prev]) => {
        if (prev === null) canvas.removeAttribute('style');
        else canvas.setAttribute('style', prev);
    });

    return {
        html,
        pageUrl: location.href,
        title: document.title || '',
        resources,
        inline,
        links: [...pageLinks]
    };
})();
