(() => {
    const cloneBtn = document.getElementById('cloneBtn');
    const btnText = document.getElementById('btnText');
    const progressArea = document.getElementById('progressArea');
    const progressFill = document.getElementById('progressFill');
    const statusText = document.getElementById('statusText');
    const successArea = document.getElementById('successArea');
    const errorArea = document.getElementById('errorArea');
    const errorText = document.getElementById('errorText');
    const crawlToggle = document.getElementById('crawlToggle');
    const crawlLimitRow = document.getElementById('crawlLimitRow');
    const maxPagesInput = document.getElementById('maxPages');

    let working = false;

    function actionLabel() {
        return crawlToggle.checked ? 'Clone Site' : 'Clone Page';
    }

    function syncCrawlUi() {
        crawlLimitRow.classList.toggle('hidden', !crawlToggle.checked);
        if (!working) btnText.textContent = actionLabel();
    }

    function resolveMaxPages() {
        const raw = (maxPagesInput.value || '').trim();
        if (!raw) return 10;
        const n = parseInt(raw, 10);
        if (!Number.isFinite(n) || n < 1) return 10;
        return Math.min(n, 500);
    }

    crawlToggle.addEventListener('change', syncCrawlUi);
    syncCrawlUi();

    function setProgress(pct, msg) {
        progressFill.style.width = pct + '%';
        if (msg) statusText.textContent = msg;
    }

    function showError(msg) {
        progressArea.classList.add('hidden');
        errorArea.classList.remove('hidden');
        errorText.textContent = msg;
        resetBtn();
    }

    function showSuccess() {
        progressArea.classList.add('hidden');
        successArea.classList.remove('hidden');
        resetBtn();
        setTimeout(() => window.close(), 2000);
    }

    function resetBtn() {
        working = false;
        cloneBtn.disabled = false;
        btnText.textContent = actionLabel();
        cloneBtn.classList.remove('pulsing');
    }

    chrome.runtime.onMessage.addListener((msg) => {
        if (msg.type === 'progress') {
            setProgress(msg.percent, msg.status);
        } else if (msg.type === 'done') {
            showSuccess();
        } else if (msg.type === 'error') {
            showError(msg.message);
        }
    });

    cloneBtn.addEventListener('click', async () => {
        if (working) return;
        working = true;

        successArea.classList.add('hidden');
        errorArea.classList.add('hidden');
        progressArea.classList.remove('hidden');
        cloneBtn.disabled = true;
        btnText.textContent = crawlToggle.checked ? 'Crawling...' : 'Cloning...';
        cloneBtn.classList.add('pulsing');
        setProgress(0, crawlToggle.checked ? 'Starting crawl...' : 'Capturing page...');

        try {
            const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });

            if (!tab || !tab.url || tab.url.startsWith('chrome://') || tab.url.startsWith('about:') || tab.url.startsWith('chrome-extension://') || tab.url.startsWith('moz-extension://')) {
                showError('Cannot clone browser internal pages.');
                return;
            }

            chrome.runtime.sendMessage({
                action: 'clonePage',
                tabId: tab.id,
                tabUrl: tab.url,
                tabTitle: tab.title,
                buildSitemap: document.getElementById('sitemapToggle').checked,
                cleanTracking: document.getElementById('cleanToggle').checked,
                crawlSite: crawlToggle.checked,
                maxPages: resolveMaxPages()
            });
        } catch (err) {
            showError('Failed: ' + err.message);
        }
    });
})();
