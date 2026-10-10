const updates = window.desktopUpdates;

if (updates) {
    const toggle = document.getElementById('desktopUpdateToggle');
    const dialog = document.getElementById('desktopUpdateDialog');
    const close = document.getElementById('desktopUpdateClose');
    const currentVersion = document.getElementById('desktopUpdateCurrentVersion');
    const versionRow = document.getElementById('desktopUpdateVersionRow');
    const version = document.getElementById('desktopUpdateVersion');
    const statusText = document.getElementById('desktopUpdateStatus');
    const progressRow = document.getElementById('desktopUpdateProgressRow');
    const progress = document.getElementById('desktopUpdateProgress');
    const progressLabel = document.getElementById('desktopUpdateProgressLabel');
    const portableNote = document.getElementById('desktopUpdatePortableNote');
    const notesSection = document.getElementById('desktopUpdateNotesSection');
    const notes = document.getElementById('desktopUpdateNotes');
    const releaseDate = document.getElementById('desktopUpdateReleaseDate');
    const check = document.getElementById('desktopUpdateCheck');
    const action = document.getElementById('desktopUpdateAction');
    let status = { phase: 'idle', currentVersion: '—', installMode: 'unsupported' };
    let pending = false;
    let preparing = false;
    let localError = '';
    let eventRevision = 0;
    let previousNotes;

    function releaseNotesText(value) {
        const source = typeof value === 'string' ? value.trim() : '';
        if (!source) return '此版本未提供更新说明。';
        if (!/<\/?(?:html|body|p|div|h[1-6]|ul|ol|li|br|a|strong|em|pre|code|span|table|article|section|details|summary|img|script|style)\b/i.test(source)) {
            return source;
        }
        // Parse in an inert document, then copy only plain text to the live page.
        const parsed = new DOMParser().parseFromString(source, 'text/html');
        parsed.querySelectorAll('script, style, template, noscript, iframe, object, embed, img, link').forEach((node) => node.remove());
        parsed.querySelectorAll('br').forEach((node) => node.replaceWith(parsed.createTextNode('\n')));
        parsed.querySelectorAll('li').forEach((node) => node.prepend(parsed.createTextNode('• ')));
        parsed.querySelectorAll('p, div, h1, h2, h3, h4, h5, h6, ul, ol, li, pre, blockquote, tr').forEach((node) => node.append(parsed.createTextNode('\n\n')));
        return parsed.body.textContent.replace(/\n[ \t]+/g, '\n').replace(/\n{3,}/g, '\n\n').trim() || '此版本未提供更新说明。';
    }

    function render() {
        const phase = status.phase;
        const portable = status.installMode === 'portable';
        const busy = pending || ['checking', 'downloading', 'installing'].includes(phase);
        const hasUpdate = Boolean(status.version) && ['available', 'downloading', 'downloaded', 'installing', 'error'].includes(phase);
        toggle.classList.toggle('has-update', hasUpdate);
        toggle.textContent = phase === 'downloaded' ? '更新已就绪' : hasUpdate ? '发现新版本' : phase === 'checking' ? '正在检查更新' : '检查更新';
        toggle.title = hasUpdate ? `查看 v${status.version} 的更新说明` : '检查软件更新';
        currentVersion.textContent = status.currentVersion === '—' ? '—' : `v${status.currentVersion}`;
        versionRow.hidden = !hasUpdate;
        version.textContent = hasUpdate ? `v${status.version}` : '';
        const messages = {
            unavailable: '当前运行方式暂不支持自动更新。',
            idle: '可以检查 GitHub 上是否有新版本。',
            checking: '正在检查新版本…',
            'not-available': '已是最新版本。',
            available: '发现新版本，请查看更新说明后下载。',
            downloading: '正在下载更新，可以关闭此窗口继续阅读。',
            downloaded: '更新已下载。安装前会自动保存当前批注。',
            installing: '正在退出并启动安装程序…',
            error: '更新失败，请重试。'
        };
        statusText.textContent = localError || (preparing ? '正在保存批注，请稍候…' : status.message || messages[phase] || '');
        statusText.classList.toggle('is-error', Boolean(localError) || phase === 'error');
        progressRow.hidden = phase !== 'downloading';
        const percent = Number.isFinite(status.percent) ? Math.max(0, Math.min(100, status.percent)) : 0;
        progress.value = percent;
        progressLabel.textContent = `${Math.round(percent)}%`;
        portableNote.hidden = !portable;
        notesSection.hidden = !hasUpdate;
        if (status.releaseNotes !== previousNotes) {
            notes.textContent = releaseNotesText(status.releaseNotes);
            previousNotes = status.releaseNotes;
        } else if (!notes.textContent) {
            notes.textContent = releaseNotesText(status.releaseNotes);
        }
        const date = status.releaseDate ? new Date(status.releaseDate) : null;
        releaseDate.textContent = date && !Number.isNaN(date.getTime()) ? date.toLocaleDateString('zh-CN') : '';
        check.textContent = phase === 'error' || localError ? '重试检查' : '重新检查';
        check.disabled = busy || phase === 'unavailable';
        action.hidden = !hasUpdate;
        action.disabled = busy;
        close.disabled = preparing || phase === 'installing';
        action.textContent = phase === 'downloaded' ? (portable ? '退出并安装新版' : '重启安装')
            : phase === 'installing' ? '正在安装…'
                : phase === 'downloading' ? '正在下载…'
                    : portable ? '下载安装版' : '下载更新';
    }

    async function run(operation, prepare = false) {
        if (pending) return;
        pending = true;
        preparing = prepare;
        localError = '';
        render();
        const revision = eventRevision;
        try {
            if (prepare) await window.prepareForDesktopUpdate?.();
            const result = await operation();
            // Status events can arrive before an older IPC response.
            if (eventRevision === revision && result) status = result;
        } catch (error) {
            const message = error instanceof Error ? error.message : '';
            localError = prepare ? `无法安装更新：${message || '保存批注或启动安装失败，请重试。'}`
                : `更新操作失败：${message || '请检查网络连接后重试。'}`;
        } finally {
            pending = false;
            preparing = false;
            render();
        }
    }

    toggle.addEventListener('click', () => {
        if (!dialog.open) dialog.showModal();
        toggle.setAttribute('aria-expanded', 'true');
        if (['idle', 'not-available'].includes(status.phase)) void run(() => updates.check());
    });
    close.addEventListener('click', () => dialog.close());
    dialog.addEventListener('cancel', (event) => {
        if (preparing || status.phase === 'installing') event.preventDefault();
    });
    dialog.addEventListener('close', () => {
        toggle.setAttribute('aria-expanded', 'false');
        toggle.focus();
    });
    dialog.addEventListener('keydown', (event) => event.stopPropagation());
    check.addEventListener('click', () => void run(() => updates.check()));
    action.addEventListener('click', () => {
        if (status.phase === 'downloaded') void run(() => updates.install(), true);
        else if (['available', 'error'].includes(status.phase)) void run(() => updates.download());
    });
    const unsubscribe = updates.onStatus((nextStatus) => {
        eventRevision += 1;
        status = nextStatus;
        localError = '';
        render();
    });
    window.addEventListener('pagehide', () => unsubscribe(), { once: true });
    toggle.hidden = false;
    render();
    void run(() => updates.getStatus()).then(() => {
        if (dialog.open && status.phase === 'idle' && !localError) void run(() => updates.check());
    });
}
