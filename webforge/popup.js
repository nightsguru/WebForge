(() => {
    const cloneBtn = document.getElementById('cloneBtn');
    const btnText = document.getElementById('btnText');
    const progressArea = document.getElementById('progressArea');
    const progressFill = document.getElementById('progressFill');
    const statusText = document.getElementById('statusText');
    const successArea = document.getElementById('successArea');
    const errorArea = document.getElementById('errorArea');
    const errorText = document.getElementById('errorText');

    let working = false;

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
        btnText.textContent = 'Clone Page';
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
        btnText.textContent = 'Cloning...';
        cloneBtn.classList.add('pulsing');
        setProgress(0, 'Capturing page...');

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
                cleanTracking: document.getElementById('cleanToggle').checked
            });
        } catch (err) {
            showError('Failed: ' + err.message);
        }
    });
})();
