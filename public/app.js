const PDFJS_URL = '/vendor/pdfjs/pdf.mjs';
const PDFJS_WORKER_URL = '/vendor/pdfjs/pdf.worker.mjs';
const UI_PREFS_KEY = 'aiPdfTutor.uiPrefs.v1';
const ANNOTATION_STORE_KEY = 'aiPdfTutor.annotations.v1';
const DEFAULT_SCALE = 2.32;
const DEFAULT_SCALE_PREF_VERSION = 3;
const DEFAULT_LAYOUT_PREF_VERSION = 2;
const MIN_SCALE = 0.05;
const MIN_INITIAL_SCALE = 0.8;
const MAX_SCALE = 5.0;
const VIEWER_MIN_AVAILABLE_WIDTH = 520;
const PDF_CONTEXT_RADIUS = 1;
const PAGE_CONTEXT_MAX_CHARS = 9000;
const PAGE_TURN_COOLDOWN_MS = 360;
const FILE_PANEL_TRANSITION_MS = 220;
const ACTION_MENU_GAP = 12;
const ACTION_MENU_EDGE_GAP = 8;
const MAX_IMAGE_ATTACHMENTS = 4;
const MAX_IMAGE_BYTES = 5 * 1024 * 1024;
const PAGE_IMAGE_MAX_EDGE = 1800;
const VISUAL_SELECTION_MIN_RATIO = 0.012;
const VISUAL_SELECTION_PADDING_RATIO = 0.012;
const READER_MODE_SINGLE = 'single';
const READER_MODE_CONTINUOUS = 'continuous';
const VISUAL_SELECTION_STYLE_BOX = 'box';
const VISUAL_SELECTION_STYLE_PATH = 'path';
const LEGACY_TRANSLATION_PANE_WIDTH = 320;
const LEGACY_ASSISTANT_PANE_WIDTH = 420;
const DEFAULT_TRANSLATION_PANE_RATIO = 0.22;
const DEFAULT_ASSISTANT_PANE_RATIO = 0.26;
const MIN_TRANSLATION_PANE_WIDTH = 220;
const MAX_TRANSLATION_PANE_WIDTH = 560;
const MIN_ASSISTANT_PANE_WIDTH = 300;
const MAX_ASSISTANT_PANE_WIDTH = 680;
const PROVIDER_PRESETS = {
    openai: {
        protocol: 'openai',
        endpoint: 'https://api.openai.com/v1/chat/completions',
        model: 'gpt-5',
        responseTextPath: 'choices.0.message.content'
    },
    deepseek: {
        protocol: 'openai',
        endpoint: 'https://api.deepseek.com/chat/completions',
        model: 'deepseek-v4-flash-vision-exp',
        responseTextPath: 'choices.0.message.content'
    }
};

class SelectionGate {
    constructor(config) {
        this.config = config;
        this.lastText = '';
        this.lastTriggeredAt = 0;
    }

    evaluate(rawText) {
        const normalizedText = normalizeSelectionText(rawText);
        const now = Date.now();
        const elapsedMs = this.lastTriggeredAt === 0 ? Number.POSITIVE_INFINITY : now - this.lastTriggeredAt;
        if (!normalizedText) {
            return { shouldTrigger: false, reason: 'empty', normalizedText, elapsedMs };
        }
        if (normalizedText.length < this.config.minLength) {
            return { shouldTrigger: false, reason: 'too-short', normalizedText, elapsedMs };
        }
        if (normalizedText === this.lastText) {
            return { shouldTrigger: false, reason: 'duplicate', normalizedText, elapsedMs };
        }
        if (elapsedMs < this.config.cooldownMs) {
            return { shouldTrigger: false, reason: 'cooldown', normalizedText, elapsedMs };
        }
        return { shouldTrigger: true, reason: 'ok', normalizedText, elapsedMs };
    }

    markTriggered(text) {
        this.lastText = normalizeSelectionText(text);
        this.lastTriggeredAt = Date.now();
    }

    reset() {
        this.lastText = '';
        this.lastTriggeredAt = 0;
    }
}

const elements = {
    appShell: document.getElementById('appShell'),
    translationPane: document.getElementById('translationPane'),
    assistantPane: document.getElementById('assistantPane'),
    leftPaneResizer: document.getElementById('leftPaneResizer'),
    rightPaneResizer: document.getElementById('rightPaneResizer'),
    collapseTranslation: document.getElementById('collapseTranslation'),
    restoreTranslation: document.getElementById('restoreTranslation'),
    collapseAssistant: document.getElementById('collapseAssistant'),
    restoreAssistant: document.getElementById('restoreAssistant'),
    paneRestoreBar: document.getElementById('paneRestoreBar'),
    settingsToggle: document.getElementById('settingsToggle'),
    settingsClose: document.getElementById('settingsClose'),
    settingsBackdrop: document.getElementById('settingsBackdrop'),
    providerKind: document.getElementById('providerKind'),
    protocol: document.getElementById('protocol'),
    endpoint: document.getElementById('endpoint'),
    model: document.getElementById('model'),
    apiKey: document.getElementById('apiKey'),
    apiKeyState: document.getElementById('apiKeyState'),
    clearApiKey: document.getElementById('clearApiKey'),
    apiKeyHeader: document.getElementById('apiKeyHeader'),
    apiKeyPrefix: document.getElementById('apiKeyPrefix'),
    responseTextPath: document.getElementById('responseTextPath'),
    maxSelectionChars: document.getElementById('maxSelectionChars'),
    visualSelectionStyle: document.getElementById('visualSelectionStyle'),
    anthropicVersion: document.getElementById('anthropicVersion'),
    anthropicMaxTokens: document.getElementById('anthropicMaxTokens'),
    extraHeadersJson: document.getElementById('extraHeadersJson'),
    extraBodyJson: document.getElementById('extraBodyJson'),
    systemPrompt: document.getElementById('systemPrompt'),
    explainPromptTemplate: document.getElementById('explainPromptTemplate'),
    translatePromptTemplate: document.getElementById('translatePromptTemplate'),
    followupPromptTemplate: document.getElementById('followupPromptTemplate'),
    settingsForm: document.getElementById('settingsForm'),
    settingsStatus: document.getElementById('settingsStatus'),
    filePanelToggle: document.getElementById('filePanelToggle'),
    filePanelBackdrop: document.getElementById('filePanelBackdrop'),
    filePanel: document.getElementById('filePanel'),
    filePanelBack: document.getElementById('filePanelBack'),
    importReadingFile: document.getElementById('importReadingFile'),
    readingFileList: document.getElementById('readingFileList'),
    readingFileContextMenu: document.getElementById('readingFileContextMenu'),
    deleteReadingFile: document.getElementById('deleteReadingFile'),
    pdfInput: document.getElementById('pdfInput'),
    annotationRibbon: document.getElementById('annotationRibbon'),
    prevPage: document.getElementById('prevPage'),
    nextPage: document.getElementById('nextPage'),
    pageJumpInput: document.getElementById('pageJumpInput'),
    pageSlider: document.getElementById('pageSlider'),
    readerMode: document.getElementById('readerMode'),
    pageInfo: document.getElementById('pageInfo'),
    autoTranslate: document.getElementById('autoTranslate'),
    autoExplain: document.getElementById('autoExplain'),
    addHighlight: document.getElementById('addHighlight'),
    undoHighlight: document.getElementById('undoHighlight'),
    addNote: document.getElementById('addNote'),
    noteFontDown: document.getElementById('noteFontDown'),
    noteFontUp: document.getElementById('noteFontUp'),
    noteFontInfo: document.getElementById('noteFontInfo'),
    deleteNote: document.getElementById('deleteNote'),
    lineMode: document.getElementById('lineMode'),
    eraserMode: document.getElementById('eraserMode'),
    clearPageAnnotations: document.getElementById('clearPageAnnotations'),
    connectionStatus: document.getElementById('connectionStatus'),
    viewer: document.getElementById('viewer'),
    emptyState: document.getElementById('emptyState'),
    page: document.getElementById('page'),
    selectionActions: document.getElementById('selectionActions'),
    selectionExplain: document.getElementById('selectionExplain'),
    selectionTranslate: document.getElementById('selectionTranslate'),
    visualActions: document.getElementById('visualActions'),
    visualExplain: document.getElementById('visualExplain'),
    visualTranslate: document.getElementById('visualTranslate'),
    manualTranslationForm: document.getElementById('manualTranslationForm'),
    manualTranslationInput: document.getElementById('manualTranslationInput'),
    manualTranslationSubmit: document.getElementById('manualTranslationSubmit'),
    translationOutput: document.getElementById('translationOutput'),
    clearTranslation: document.getElementById('clearTranslation'),
    messages: document.getElementById('messages'),
    cancelResponse: document.getElementById('cancelResponse'),
    clearConversation: document.getElementById('clearConversation'),
    questionForm: document.getElementById('questionForm'),
    questionInput: document.getElementById('questionInput'),
    attachImage: document.getElementById('attachImage'),
    imageInput: document.getElementById('imageInput'),
    imageAttachments: document.getElementById('imageAttachments'),
    clientLog: document.getElementById('clientLog')
};

const selectionGate = new SelectionGate({ minLength: 6, cooldownMs: 700 });
const initialUiPrefs = loadUiPrefs();
const state = {
    settings: null,
    apiKeyTouched: false,
    uiPrefs: initialUiPrefs,
    pdfjsLib: null,
    pdfDoc: null,
    currentPage: 1,
    scale: initialUiPrefs.scale || DEFAULT_SCALE,
    fileName: '',
    pageTextCache: new Map(),
    annotations: loadAnnotations(),
    annotationDocKey: '',
    readingFiles: [],
    activeReadingFileId: '',
    readingFileMenuId: '',
    readingFilePanelMessage: '',
    filePanelCloseTimer: 0,
    filePanelAnimationFrame: 0,
    pendingAnnotationSelection: null,
    selectionActionsSnapshot: null,
    visualSelection: null,
    visualSelectionDraft: null,
    notePlacementMode: false,
    selectedAnnotationId: '',
    editingNoteId: '',
    noteEditGuardUntil: 0,
    lineDraft: null,
    noteDrag: null,
    paneResize: null,
    lastPageTurnAt: 0,
    pageJumpTimer: 0,
    renderLock: false,
    selectionTimer: 0,
    annotationSaveTimer: 0,
    pendingAnnotationSave: null,
    translationAbort: null,
    explainAbort: null,
    activeAssistantNode: null,
    activeTranslationNode: null,
    lastSelection: '',
    explainHistory: [],
    imageAttachments: []
};

await boot();

async function boot() {
    wireEvents();
    setBusy(false, '初始化');
    setTranslationEmpty();
    applyUiPrefs();
    try {
        state.settings = await getJson('/api/settings');
        applySettingsToForm(state.settings);
        logClient('app.settings.loaded', publicSettingsLog(state.settings));
        state.pdfjsLib = await import(PDFJS_URL);
        state.pdfjsLib.GlobalWorkerOptions.workerSrc = PDFJS_WORKER_URL;
        await loadReadingFiles();
        updateToolbar();
        setBusy(false, providerLabel());
        await maybeOpenPdfFromQuery();
    } catch (error) {
        setBusy(false, '初始化失败');
        appendMessage('assistant', `初始化失败：${messageOf(error)}`);
        logClient('app.boot.error', { message: messageOf(error) });
    }
}

function wireEvents() {
    elements.settingsForm.addEventListener('submit', saveSettings);
    elements.settingsToggle.addEventListener('click', () => setSettingsOpen(!settingsOpen()));
    elements.settingsClose.addEventListener('click', () => setSettingsOpen(false));
    elements.settingsBackdrop.addEventListener('click', () => setSettingsOpen(false));
    elements.providerKind.addEventListener('change', onProviderKindChanged);
    elements.apiKey.addEventListener('input', () => {
        state.apiKeyTouched = true;
        updateApiKeyState();
    });
    elements.clearApiKey.addEventListener('change', updateApiKeyState);
    elements.protocol.addEventListener('change', updateProviderFields);
    elements.filePanelToggle.addEventListener('click', () => setFilePanelOpen(true));
    elements.filePanelBack.addEventListener('click', () => setFilePanelOpen(false));
    elements.filePanelBackdrop.addEventListener('click', () => setFilePanelOpen(false));
    elements.importReadingFile.addEventListener('click', () => elements.pdfInput.click());
    elements.pdfInput.addEventListener('change', onReadingFilePicked);
    elements.readingFileList.addEventListener('click', onReadingFileListClick);
    elements.readingFileList.addEventListener('contextmenu', onReadingFileContextMenu);
    elements.deleteReadingFile.addEventListener('click', deleteReadingFileFromContextMenu);
    elements.prevPage.addEventListener('click', () => gotoPage(state.currentPage - 1));
    elements.nextPage.addEventListener('click', () => gotoPage(state.currentPage + 1));
    elements.pageJumpInput.addEventListener('input', onPageJumpInput);
    elements.pageJumpInput.addEventListener('keydown', onPageJumpKeydown);
    elements.pageSlider.addEventListener('input', onPageSliderInput);
    elements.pageSlider.addEventListener('change', onPageSliderChange);
    elements.readerMode.addEventListener('change', onReaderModeChanged);
    elements.visualSelectionStyle.addEventListener('change', onVisualSelectionStyleChanged);
    elements.autoTranslate.addEventListener('change', onAutoTriggerChanged);
    elements.autoExplain.addEventListener('change', onAutoTriggerChanged);
    elements.addHighlight.addEventListener('click', addHighlightFromSelection);
    elements.undoHighlight.addEventListener('click', undoLastHighlight);
    elements.addNote.addEventListener('click', addNoteFromSelection);
    elements.noteFontDown.addEventListener('click', () => adjustSelectedNoteFont(-0.003));
    elements.noteFontUp.addEventListener('click', () => adjustSelectedNoteFont(0.003));
    elements.deleteNote.addEventListener('click', deleteSelectedNote);
    elements.lineMode.addEventListener('change', onLineModeChanged);
    elements.eraserMode.addEventListener('change', onEraserModeChanged);
    elements.clearPageAnnotations.addEventListener('click', clearCurrentPageAnnotations);
    elements.viewer.addEventListener('click', focusViewerUnlessInteractive);
    elements.viewer.addEventListener('contextmenu', onViewerContextMenu);
    elements.viewer.addEventListener('scroll', onViewerScroll, { passive: true });
    elements.viewer.addEventListener('wheel', onViewerWheel, { passive: false });
    elements.viewer.addEventListener('keydown', onPdfKeydown);
    elements.selectionExplain.addEventListener('click', explainSelectionFromAction);
    elements.selectionTranslate.addEventListener('click', translateSelectionFromAction);
    elements.visualExplain.addEventListener('click', explainVisualSelectionFromAction);
    elements.visualTranslate.addEventListener('click', translateVisualSelectionFromAction);
    elements.page.addEventListener('pointerdown', onPagePointerDown);
    elements.page.addEventListener('pointermove', onPagePointerMove);
    elements.page.addEventListener('pointerup', onPagePointerUp);
    elements.page.addEventListener('pointercancel', cancelLineDraft);
    elements.page.addEventListener('lostpointercapture', onPageLostPointerCapture);
    document.addEventListener('pointerdown', onDocumentPointerDown, true);
    document.addEventListener('mousedown', onDocumentPointerDown, true);
    document.addEventListener('pointerdown', onSelectionActionDocumentPointerDown, true);
    document.addEventListener('keydown', onPdfKeydown);
    document.addEventListener('keydown', onTextSubmitShortcut, true);
    document.addEventListener('pointerup', onDocumentSelectionPointerUp, true);
    window.addEventListener('resize', () => {
        positionSelectionActions();
        positionVisualActions();
    });
    elements.cancelResponse.addEventListener('click', cancelActiveResponses);
    elements.clearConversation.addEventListener('click', clearConversation);
    elements.clearTranslation.addEventListener('click', clearTranslation);
    elements.collapseTranslation.addEventListener('click', () => setPaneCollapsed('translation', true));
    elements.restoreTranslation.addEventListener('click', () => setPaneCollapsed('translation', false));
    elements.collapseAssistant.addEventListener('click', () => setPaneCollapsed('assistant', true));
    elements.restoreAssistant.addEventListener('click', () => setPaneCollapsed('assistant', false));
    elements.leftPaneResizer.addEventListener('pointerdown', (event) => startPaneResize('translation', event));
    elements.rightPaneResizer.addEventListener('pointerdown', (event) => startPaneResize('assistant', event));
    elements.leftPaneResizer.addEventListener('keydown', (event) => onPaneResizerKeydown('translation', event));
    elements.rightPaneResizer.addEventListener('keydown', (event) => onPaneResizerKeydown('assistant', event));
    elements.manualTranslationForm.addEventListener('submit', onManualTranslationSubmit);
    elements.questionForm.addEventListener('submit', onQuestionSubmit);
    elements.attachImage.addEventListener('click', () => elements.imageInput.click());
    elements.imageInput.addEventListener('change', onImagesPicked);
    elements.imageAttachments.addEventListener('click', onImageAttachmentClick);
    elements.questionInput.addEventListener('paste', onQuestionPaste);
    document.addEventListener('pointerdown', onReadingFileDocumentPointerDown, true);
    document.addEventListener('mouseup', (event) => queueTextSelectionProbe('mouseup', actionAnchorFromEvent(event)), true);
}

function focusViewerUnlessInteractive(event) {
    const target = event.target;
    if (isInteractiveTarget(target)) {
        return;
    }
    elements.viewer.focus();
}

function isInteractiveTarget(target) {
    return target instanceof HTMLElement
        && Boolean(target.closest('button, input, textarea, select, [contenteditable="true"], .annotation-note-box'));
}

function setPaneCollapsed(pane, collapsed) {
    if (pane === 'translation') {
        state.uiPrefs.translationPaneCollapsed = collapsed;
    } else {
        state.uiPrefs.assistantPaneCollapsed = collapsed;
    }
    applyPaneLayoutPrefs();
    saveUiPrefs();
    logClient('layout.pane.toggle', { pane, collapsed });
    window.setTimeout(positionSelectionActions, 0);
    window.setTimeout(positionVisualActions, 0);
}

function startPaneResize(pane, event) {
    if (event.button !== undefined && event.button !== 0) {
        return;
    }
    event.preventDefault();
    const key = pane === 'translation' ? 'translationPaneWidth' : 'assistantPaneWidth';
    const fallback = pane === 'translation' ? defaultTranslationPaneWidth() : defaultAssistantPaneWidth();
    state.paneResize = {
        pane,
        startX: event.clientX,
        startWidth: Number(state.uiPrefs[key]) || fallback
    };
    elements.appShell.classList.add('is-resizing');
    window.addEventListener('pointermove', onPaneResizeMove);
    window.addEventListener('pointerup', endPaneResize);
    window.addEventListener('pointercancel', endPaneResize);
    logClient('layout.resize.start', { pane, width: Math.round(state.paneResize.startWidth) });
}

function onPaneResizeMove(event) {
    if (!state.paneResize) {
        return;
    }
    const delta = event.clientX - state.paneResize.startX;
    const width = state.paneResize.pane === 'translation'
        ? state.paneResize.startWidth + delta
        : state.paneResize.startWidth - delta;
    setPaneWidth(state.paneResize.pane, width, false);
}

function endPaneResize() {
    if (!state.paneResize) {
        return;
    }
    const { pane } = state.paneResize;
    const width = pane === 'translation' ? state.uiPrefs.translationPaneWidth : state.uiPrefs.assistantPaneWidth;
    state.paneResize = null;
    elements.appShell.classList.remove('is-resizing');
    window.removeEventListener('pointermove', onPaneResizeMove);
    window.removeEventListener('pointerup', endPaneResize);
    window.removeEventListener('pointercancel', endPaneResize);
    saveUiPrefs();
    logClient('layout.resize.end', { pane, width: Math.round(width) });
    window.setTimeout(positionSelectionActions, 0);
    window.setTimeout(positionVisualActions, 0);
}

function onPaneResizerKeydown(pane, event) {
    if (event.key !== 'ArrowLeft' && event.key !== 'ArrowRight') {
        return;
    }
    event.preventDefault();
    const step = event.shiftKey ? 40 : 16;
    const current = pane === 'translation' ? state.uiPrefs.translationPaneWidth : state.uiPrefs.assistantPaneWidth;
    const direction = event.key === 'ArrowRight' ? 1 : -1;
    setPaneWidth(pane, current + direction * step, true);
    logClient('layout.resize.keyboard', { pane, width: Math.round(pane === 'translation' ? state.uiPrefs.translationPaneWidth : state.uiPrefs.assistantPaneWidth) });
}

function setPaneWidth(pane, value, persist) {
    if (pane === 'translation') {
        state.uiPrefs.translationPaneWidth = clamp(
            Number(value) || defaultTranslationPaneWidth(),
            MIN_TRANSLATION_PANE_WIDTH,
            MAX_TRANSLATION_PANE_WIDTH
        );
    } else {
        state.uiPrefs.assistantPaneWidth = clamp(
            Number(value) || defaultAssistantPaneWidth(),
            MIN_ASSISTANT_PANE_WIDTH,
            MAX_ASSISTANT_PANE_WIDTH
        );
    }
    applyPaneLayoutPrefs();
    if (persist) {
        saveUiPrefs();
    }
}

function onDocumentPointerDown(event) {
    if (!state.editingNoteId) {
        return;
    }
    if (performance.now() < state.noteEditGuardUntil) {
        return;
    }
    const target = event.target;
    if (target instanceof Node) {
        const activeNoteBox = elements.page.querySelector(`.annotation-note-box[data-annotation-id="${cssEscape(state.editingNoteId)}"]`);
        if (activeNoteBox?.contains(target)) {
            return;
        }
    }
    if (event.type === 'mousedown' && target instanceof HTMLElement && target.closest('button, input, textarea, select')) {
        finishActiveNoteEdit();
        return;
    }
    finishActiveNoteEdit();
}

function settingsOpen() {
    return !elements.settingsForm.hidden;
}

function setSettingsOpen(open) {
    elements.settingsForm.hidden = !open;
    elements.settingsBackdrop.hidden = !open;
    elements.settingsToggle.setAttribute('aria-expanded', String(open));
    document.body.classList.toggle('settings-open', open);
    if (open) {
        elements.providerKind.focus();
    } else if (document.activeElement && elements.settingsForm.contains(document.activeElement)) {
        elements.settingsToggle.focus();
    }
    logClient('settings.drawer.toggle', { open });
}

function onTextSubmitShortcut(event) {
    if (!(event.ctrlKey || event.metaKey) || event.key !== 'Enter') {
        return;
    }
    const target = event.target;
    if (target === elements.questionInput) {
        event.preventDefault();
        elements.questionForm.requestSubmit();
        logClient('shortcut.submit', { target: 'question' });
        return;
    }
    if (target === elements.manualTranslationInput) {
        event.preventDefault();
        elements.manualTranslationForm.requestSubmit();
        logClient('shortcut.submit', { target: 'translation' });
    }
}

function onDocumentSelectionPointerUp(event) {
    if (event.button !== undefined && event.button !== 0) {
        return;
    }
    queueTextSelectionProbe('pointerup', actionAnchorFromEvent(event));
}

function queueTextSelectionProbe(reason, actionAnchor = null) {
    if (elements.lineMode.checked || elements.eraserMode.checked || state.visualSelectionDraft) {
        return;
    }
    window.setTimeout(() => {
        if (getPdfSelectionText()) {
            queueSelectionProbe(reason, actionAnchor);
        }
    }, 0);
}

async function saveSettings(event) {
    event.preventDefault();
    elements.settingsStatus.textContent = '保存中...';
    const apiKey = state.apiKeyTouched && elements.providerKind.value !== 'mock'
        ? elements.apiKey.value.trim()
        : '';
    const payload = {
        provider: {
            preset: elements.providerKind.value,
            kind: elements.providerKind.value === 'mock' ? 'mock' : 'openaiCompatible',
            protocol: elements.protocol.value,
            endpoint: elements.endpoint.value.trim(),
            model: elements.model.value.trim(),
            apiKey,
            clearApiKey: elements.clearApiKey.checked,
            apiKeyHeader: elements.apiKeyHeader.value.trim(),
            apiKeyPrefix: elements.apiKeyPrefix.value,
            responseTextPath: elements.responseTextPath.value.trim(),
            anthropicVersion: elements.anthropicVersion.value.trim(),
            anthropicMaxTokens: Number(elements.anthropicMaxTokens.value),
            extraHeadersJson: elements.extraHeadersJson.value,
            extraBodyJson: elements.extraBodyJson.value
        },
        maxSelectionChars: Number(elements.maxSelectionChars.value),
        systemPrompt: elements.systemPrompt.value,
        explainPromptTemplate: elements.explainPromptTemplate.value,
        translatePromptTemplate: elements.translatePromptTemplate.value,
        followupPromptTemplate: elements.followupPromptTemplate.value
    };

    try {
        const response = await fetch('/api/settings', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(payload)
        });
        if (!response.ok) {
            const data = await response.json().catch(() => ({}));
            throw new Error(data.error || `HTTP ${response.status}`);
        }
        state.settings = await response.json();
        applySettingsToForm(state.settings);
        elements.settingsStatus.textContent = '已保存';
        logClient('settings.saved', publicSettingsLog(state.settings));
    } catch (error) {
        elements.settingsStatus.textContent = `保存失败：${messageOf(error)}`;
        logClient('settings.save.error', { message: messageOf(error) });
    }
}

function applySettingsToForm(settings) {
    elements.providerKind.value = providerPresetFromSettings(settings.provider);
    elements.protocol.value = settings.provider.protocol;
    elements.endpoint.value = settings.provider.endpoint;
    elements.model.value = settings.provider.model;
    elements.apiKey.value = '';
    state.apiKeyTouched = false;
    elements.apiKey.placeholder = '';
    elements.clearApiKey.checked = false;
    elements.apiKeyHeader.value = settings.provider.apiKeyHeader;
    elements.apiKeyPrefix.value = settings.provider.apiKeyPrefix;
    elements.responseTextPath.value = settings.provider.responseTextPath;
    elements.maxSelectionChars.value = String(settings.maxSelectionChars);
    elements.anthropicVersion.value = settings.provider.anthropicVersion;
    elements.anthropicMaxTokens.value = String(settings.provider.anthropicMaxTokens);
    elements.extraHeadersJson.value = settings.provider.extraHeadersJson;
    elements.extraBodyJson.value = settings.provider.extraBodyJson;
    elements.systemPrompt.value = settings.systemPrompt;
    elements.explainPromptTemplate.value = settings.explainPromptTemplate;
    elements.translatePromptTemplate.value = settings.translatePromptTemplate;
    elements.followupPromptTemplate.value = settings.followupPromptTemplate;
    elements.settingsStatus.textContent = '';
    updateProviderFields();
}

function providerPresetFromSettings(provider) {
    if (provider.preset === 'mock' || provider.preset === 'openai' || provider.preset === 'deepseek' || provider.preset === 'custom') {
        return provider.preset;
    }
    if (provider.kind === 'mock') {
        return 'mock';
    }
    try {
        const host = new URL(provider.endpoint || '').hostname.toLowerCase();
        if (host === 'api.openai.com') {
            return 'openai';
        }
        if (host.endsWith('deepseek.com')) {
            return 'deepseek';
        }
    } catch {
        return 'custom';
    }
    return 'custom';
}

function onProviderKindChanged() {
    applyProviderPresetDefaults(elements.providerKind.value);
    updateProviderFields();
}

function applyProviderPresetDefaults(preset) {
    const defaults = PROVIDER_PRESETS[preset];
    if (!defaults) {
        return;
    }
    elements.protocol.value = defaults.protocol;
    elements.endpoint.value = defaults.endpoint;
    elements.model.value = defaults.model;
    elements.apiKeyHeader.value = 'Authorization';
    elements.apiKeyPrefix.value = 'Bearer ';
    elements.responseTextPath.value = defaults.responseTextPath;
}

function updateProviderFields() {
    const preset = elements.providerKind.value;
    const isMock = preset === 'mock';
    const isManagedPreset = preset === 'openai' || preset === 'deepseek';
    elements.protocol.disabled = isMock || isManagedPreset;
    elements.endpoint.disabled = isMock || isManagedPreset;
    elements.model.disabled = isMock;
    elements.apiKey.disabled = isMock;
    elements.clearApiKey.disabled = isMock;
    elements.apiKeyHeader.disabled = isMock || isManagedPreset;
    elements.apiKeyPrefix.disabled = isMock || isManagedPreset;
    elements.responseTextPath.disabled = isMock || isManagedPreset;
    updateApiKeyState();
}

function updateApiKeyState() {
    const preset = elements.providerKind.value;
    const savedPreset = state.settings?.provider ? providerPresetFromSettings(state.settings.provider) : '';
    const hasSavedKey = Boolean(state.settings?.provider?.apiKeyConfigured);

    if (preset === 'mock') {
        setApiKeyState('Mock', 'muted');
        return;
    }
    if (elements.clearApiKey.checked) {
        setApiKeyState('将清除 Key', 'warning');
        return;
    }
    if (state.apiKeyTouched && elements.apiKey.value.trim()) {
        setApiKeyState('待保存', 'ready');
        return;
    }
    if (hasSavedKey && savedPreset === preset) {
        setApiKeyState('已配置 Key', 'ready');
        return;
    }
    if (hasSavedKey && savedPreset !== preset) {
        setApiKeyState('需重新配置 Key', 'warning');
        return;
    }

    setApiKeyState('未配置 Key', 'warning');
}

function setApiKeyState(message, tone) {
    elements.apiKeyState.textContent = message;
    elements.apiKeyState.classList.toggle('is-ready', tone === 'ready');
    elements.apiKeyState.classList.toggle('is-warning', tone === 'warning');
}

function setFilePanelOpen(open, options = {}) {
    window.clearTimeout(state.filePanelCloseTimer);
    window.cancelAnimationFrame(state.filePanelAnimationFrame);
    elements.filePanelToggle.setAttribute('aria-expanded', String(open));
    elements.filePanelToggle.classList.toggle('active-tool', open);
    hideReadingFileContextMenu();

    if (open) {
        elements.filePanel.hidden = false;
        elements.filePanelBackdrop.hidden = false;
        elements.filePanel.setAttribute('aria-hidden', 'false');
        elements.filePanelBackdrop.setAttribute('aria-hidden', 'false');
        state.filePanelAnimationFrame = window.requestAnimationFrame(() => {
            elements.filePanel.classList.add('is-open');
            elements.filePanelBackdrop.classList.add('is-open');
        });
        if (options.refresh !== false) {
            void loadReadingFiles();
        }
        return;
    }

    const wasVisible = !elements.filePanel.hidden;
    elements.filePanel.classList.remove('is-open');
    elements.filePanelBackdrop.classList.remove('is-open');
    elements.filePanel.setAttribute('aria-hidden', 'true');
    elements.filePanelBackdrop.setAttribute('aria-hidden', 'true');

    if (!wasVisible) {
        elements.filePanel.hidden = true;
        elements.filePanelBackdrop.hidden = true;
        return;
    }

    state.filePanelCloseTimer = window.setTimeout(() => {
        elements.filePanel.hidden = true;
        elements.filePanelBackdrop.hidden = true;
    }, FILE_PANEL_TRANSITION_MS);
}

async function loadReadingFiles() {
    try {
        const payload = await getJson('/api/reading-files');
        state.readingFiles = parseReadingFiles(payload.files);
        state.readingFilePanelMessage = '';
        renderReadingFileList();
        logClient('reading_file.list.loaded', { count: state.readingFiles.length });
    } catch (error) {
        showReadingFilePanelMessage(`阅读文件加载失败：${messageOf(error)}`);
        logClient('reading_file.list.error', { message: messageOf(error) });
    }
}

function parseReadingFiles(value) {
    return Array.isArray(value)
        ? value
            .map(parseReadingFile)
            .filter(Boolean)
        : [];
}

function parseReadingFile(value) {
    if (!value || typeof value !== 'object' || Array.isArray(value)) {
        return null;
    }
    const id = typeof value.id === 'string' ? value.id : '';
    const title = typeof value.title === 'string' ? value.title : '';
    const updatedAt = typeof value.updatedAt === 'string' ? value.updatedAt : '';
    return id && title ? { id, title, updatedAt } : null;
}

function renderReadingFileList(emptyMessage = '暂无阅读文件') {
    elements.readingFileList.innerHTML = '';
    const message = state.readingFilePanelMessage || (!state.readingFiles.length ? emptyMessage : '');
    if (message) {
        const messageNode = document.createElement('div');
        messageNode.className = 'reading-file-message';
        messageNode.textContent = message;
        elements.readingFileList.appendChild(messageNode);
    }

    if (state.readingFiles.length === 0) {
        return;
    }

    state.readingFiles.forEach((file) => {
        const item = document.createElement('button');
        item.type = 'button';
        item.className = 'reading-file-item';
        item.dataset.id = file.id;
        item.setAttribute('role', 'listitem');
        item.setAttribute('aria-current', String(state.activeReadingFileId === file.id));

        const title = document.createElement('span');
        title.className = 'reading-file-title';
        title.textContent = file.title;
        const time = document.createElement('time');
        time.className = 'reading-file-time';
        time.dateTime = file.updatedAt || '';
        time.textContent = formatReadingFileTime(file.updatedAt);

        item.append(title, time);
        elements.readingFileList.appendChild(item);
    });
}

function showReadingFilePanelMessage(message) {
    state.readingFilePanelMessage = message;
    renderReadingFileList('');
}

async function onReadingFilePicked(event) {
    const file = event.target.files?.[0];
    if (!file) {
        return;
    }

    if (!state.pdfjsLib) {
        showReadingFilePanelMessage('PDF 渲染器尚未加载完成');
        return;
    }

    setBusy(true, '导入 PDF');
    state.readingFilePanelMessage = '';
    renderReadingFileList();
    logClient('reading_file.import.start', { name: file.name, size: file.size });
    try {
        await flushPendingAnnotationSave();
        const dataBase64 = await readFileAsDataUrl(file);
        const response = await fetch('/api/reading-files/import', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                name: file.name,
                dataBase64
            })
        });
        const payload = await readJsonResponse(response);
        const importedFile = parseReadingFile(payload.file);
        if (!importedFile) {
            throw new Error('Invalid import response.');
        }
        upsertReadingFile(importedFile);
        await openReadingFileById(importedFile.id, { closePanelOnStart: true });
        logClient('reading_file.import.done', { id: importedFile.id, title: importedFile.title });
    } catch (error) {
        showReadingFilePanelMessage(`PDF 导入失败：${messageOf(error)}`);
        logClient('reading_file.import.error', { message: messageOf(error) });
    } finally {
        elements.pdfInput.value = '';
        setBusy(false);
        updateToolbar();
    }
}

function onReadingFileListClick(event) {
    const item = readingFileItemFromEvent(event);
    if (!item) {
        return;
    }
    hideReadingFileContextMenu();
    void openReadingFileById(item.dataset.id || '', { closePanelOnStart: true });
}

function onReadingFileContextMenu(event) {
    const item = readingFileItemFromEvent(event);
    if (!item) {
        return;
    }

    event.preventDefault();
    state.readingFileMenuId = item.dataset.id || '';
    elements.readingFileList.querySelectorAll('.reading-file-item').forEach((node) => {
        node.classList.toggle('is-menu-open', node === item);
    });

    const contentRect = elements.readingFileContextMenu.parentElement.getBoundingClientRect();
    const left = clamp(event.clientX - contentRect.left, 8, Math.max(8, contentRect.width - 110));
    const top = clamp(event.clientY - contentRect.top, 8, Math.max(8, contentRect.height - 46));
    elements.readingFileContextMenu.style.left = `${left}px`;
    elements.readingFileContextMenu.style.top = `${top}px`;
    elements.readingFileContextMenu.hidden = false;
    logClient('reading_file.context_menu', { id: state.readingFileMenuId });
}

function onReadingFileDocumentPointerDown(event) {
    const target = event.target;
    if (!(target instanceof Element)) {
        return;
    }
    if (target.closest('.reading-file-context-menu') || target.closest('.reading-file-item')) {
        return;
    }
    hideReadingFileContextMenu();
}

async function deleteReadingFileFromContextMenu() {
    const id = state.readingFileMenuId;
    const file = state.readingFiles.find((entry) => entry.id === id);
    if (!id || !file) {
        hideReadingFileContextMenu();
        return;
    }

    if (!window.confirm(`删除“${file.title}”？`)) {
        hideReadingFileContextMenu();
        return;
    }

    setBusy(true, '删除阅读文件');
    try {
        await flushPendingAnnotationSave();
        const response = await fetch(`/api/reading-files/${encodeURIComponent(id)}`, { method: 'DELETE' });
        await readJsonResponse(response);
        state.readingFiles = state.readingFiles.filter((entry) => entry.id !== id);
        if (state.activeReadingFileId === id) {
            resetReaderDocument();
        }
        hideReadingFileContextMenu();
        renderReadingFileList();
        flashStatus('已删除阅读文件');
        logClient('reading_file.delete.done', { id, title: file.title });
    } catch (error) {
        showReadingFilePanelMessage(`阅读文件删除失败：${messageOf(error)}`);
        logClient('reading_file.delete.error', { id, message: messageOf(error) });
    } finally {
        setBusy(false);
    }
}

function hideReadingFileContextMenu() {
    state.readingFileMenuId = '';
    elements.readingFileContextMenu.hidden = true;
    elements.readingFileList.querySelectorAll('.reading-file-item').forEach((node) => {
        node.classList.remove('is-menu-open');
    });
}

function readingFileItemFromEvent(event) {
    return event.target instanceof Element ? event.target.closest('.reading-file-item') : null;
}

async function openReadingFileById(id, options = {}) {
    const readingFileId = String(id || '').trim();
    if (!readingFileId) {
        return;
    }

    if (!state.pdfjsLib) {
        showReadingFilePanelMessage('PDF 渲染器尚未加载完成');
        return;
    }

    const file = state.readingFiles.find((entry) => entry.id === readingFileId) || {
        id: readingFileId,
        title: 'PDF',
        updatedAt: ''
    };
    setBusy(true, '打开阅读文件');
    logClient('reading_file.open.start', { id: readingFileId, title: file.title });
    const shouldReopenPanelOnError = options.closePanelOnStart === true && !elements.filePanel.hidden;
    if (options.closePanelOnStart === true) {
        setFilePanelOpen(false);
    }
    try {
        await flushPendingAnnotationSave();
        const [pdfResponse, notesResponse] = await Promise.all([
            fetch(`/reading-files/${encodeURIComponent(readingFileId)}/source.pdf`),
            fetch(`/api/reading-files/${encodeURIComponent(readingFileId)}/notes`)
        ]);
        if (!pdfResponse.ok) {
            throw new Error(`HTTP ${pdfResponse.status}`);
        }
        const notesPayload = notesResponse.ok ? await notesResponse.json() : { notes: {} };
        await loadPdfBytes(new Uint8Array(await pdfResponse.arrayBuffer()), file.title, {
            readingFileId,
            annotations: isPlainObject(notesPayload.notes) ? notesPayload.notes : {}
        });
        renderReadingFileList();
        logClient('reading_file.open.done', { id: readingFileId, title: file.title });
    } catch (error) {
        showReadingFilePanelMessage(`阅读文件打开失败：${messageOf(error)}`);
        if (shouldReopenPanelOnError) {
            setFilePanelOpen(true, { refresh: false });
        }
        logClient('reading_file.open.error', { id: readingFileId, message: messageOf(error) });
    } finally {
        setBusy(false);
        updateToolbar();
    }
}

async function openWorkspacePdfByName(name) {
    const pdfName = String(name || '').trim();
    if (!pdfName) {
        return;
    }

    if (!state.pdfjsLib) {
        appendMessage('assistant', 'PDF 渲染器尚未加载完成。');
        return;
    }

    setBusy(true, '打开 PDF');
    logClient('workspace_pdf.open.start', { name: pdfName });
    try {
        await flushPendingAnnotationSave();
        const response = await fetch(`/local-pdfs/${encodeURIComponent(pdfName)}`);
        if (!response.ok) {
            throw new Error(`HTTP ${response.status}`);
        }
        await loadPdfBytes(new Uint8Array(await response.arrayBuffer()), pdfName);
    } catch (error) {
        appendMessage('assistant', `PDF 打开失败：${messageOf(error)}`);
        logClient('workspace_pdf.open.error', { name: pdfName, message: messageOf(error) });
    } finally {
        setBusy(false);
        updateToolbar();
    }
}

async function maybeOpenPdfFromQuery() {
    const query = new URLSearchParams(window.location.search);
    const readingFileId = query.get('file');
    if (readingFileId) {
        await openReadingFileById(readingFileId);
        return;
    }

    const name = query.get('pdf');
    if (!name) {
        return;
    }
    await openWorkspacePdfByName(name);
}

async function loadPdfBytes(bytes, name, options = {}) {
    state.pdfDoc = await state.pdfjsLib.getDocument({ data: bytes }).promise;
    state.fileName = name;
    state.currentPage = 1;
    state.lastSelection = '';
    state.explainHistory = [];
    state.pageTextCache.clear();
    state.activeReadingFileId = typeof options.readingFileId === 'string' ? options.readingFileId : '';
    state.annotationDocKey = state.activeReadingFileId
        ? `readingFile:${state.activeReadingFileId}`
        : annotationKeyFor(name, state.pdfDoc.numPages);
    if (state.activeReadingFileId) {
        state.annotations[state.annotationDocKey] = isPlainObject(options.annotations) ? options.annotations : {};
    }
    state.pendingAnnotationSelection = null;
    hideSelectionActions('pdf-open');
    state.notePlacementMode = false;
    state.selectedAnnotationId = '';
    state.editingNoteId = '';
    state.noteEditGuardUntil = 0;
    state.lineDraft = null;
    clearVisualSelection('pdf-open');
    state.noteDrag = null;
    resetTransientAnnotationTools();
    state.scale = await scaleForNewDocument();
    saveUiPrefs();
    selectionGate.reset();
    window.getSelection()?.removeAllRanges();
    elements.emptyState.hidden = true;
    elements.page.hidden = false;
    clearTranslation();
    clearConversation();
    await renderPage();
    logClient('pdf.open.done', { name, pages: state.pdfDoc.numPages });
}

function resetReaderDocument() {
    state.pdfDoc = null;
    state.currentPage = 1;
    state.fileName = '';
    state.activeReadingFileId = '';
    state.annotationDocKey = '';
    state.pageTextCache.clear();
    state.pendingAnnotationSelection = null;
    state.selectionActionsSnapshot = null;
    state.visualSelection = null;
    state.visualSelectionDraft = null;
    state.notePlacementMode = false;
    state.selectedAnnotationId = '';
    state.editingNoteId = '';
    state.lineDraft = null;
    state.noteDrag = null;
    selectionGate.reset();
    hideSelectionActions('reading-file-delete');
    clearVisualSelection('reading-file-delete');
    elements.page.innerHTML = '';
    elements.page.hidden = true;
    elements.emptyState.hidden = false;
    clearTranslation();
    clearConversation();
    updateToolbar();
}

async function renderPage(options = {}) {
    if (!state.pdfDoc || state.renderLock) {
        return;
    }

    state.renderLock = true;
    setBusy(true, '渲染页面');
    const mode = readerMode();
    logClient('pdf.page.render.start', { page: state.currentPage, scale: state.scale, mode });
    try {
        window.getSelection()?.removeAllRanges();
        if (mode === READER_MODE_CONTINUOUS) {
            await renderContinuousPages(options);
        } else {
            await renderSinglePage();
            if (options.scroll === 'current') {
                scrollToPage(state.currentPage, 'top');
            }
        }
    } finally {
        state.renderLock = false;
        setBusy(false);
        updateToolbar();
    }
}

async function renderSinglePage() {
    elements.page.className = 'page-wrap';
    elements.page.dataset.page = String(state.currentPage);
    const viewport = await renderPdfPage(state.currentPage, elements.page);
    logClient('pdf.page.render.done', {
        page: state.currentPage,
        width: Math.round(viewport.width),
        height: Math.round(viewport.height),
        mode: READER_MODE_SINGLE
    });
}

async function renderContinuousPages(options = {}) {
    const pageCount = state.pdfDoc.numPages;
    elements.page.className = 'page-stack';
    elements.page.removeAttribute('data-page');
    elements.page.style.width = '';
    elements.page.style.height = '';
    elements.page.innerHTML = '';
    logClient('pdf.continuous.render.start', { pages: pageCount, scale: state.scale });

    for (let pageNumber = 1; pageNumber <= pageCount; pageNumber += 1) {
        const pageNode = document.createElement('div');
        pageNode.className = 'page-wrap';
        pageNode.dataset.page = String(pageNumber);
        elements.page.appendChild(pageNode);
        await renderPdfPage(pageNumber, pageNode);
    }

    if (options.scroll === 'current') {
        scrollToPage(state.currentPage, 'top');
    } else if (options.scroll !== 'keep') {
        elements.viewer.scrollTop = 0;
    }
    logClient('pdf.continuous.render.done', { pages: pageCount, scale: state.scale });
}

async function renderPdfPage(pageNumber, pageNode) {
    const page = await state.pdfDoc.getPage(pageNumber);
    const viewport = page.getViewport({ scale: state.scale });
    pageNode.innerHTML = '';
    pageNode.style.width = `${viewport.width}px`;
    pageNode.style.height = `${viewport.height}px`;

    const canvas = document.createElement('canvas');
    canvas.width = Math.ceil(viewport.width);
    canvas.height = Math.ceil(viewport.height);
    pageNode.appendChild(canvas);

    const textLayer = document.createElement('div');
    textLayer.className = 'textLayer';
    textLayer.dataset.page = String(pageNumber);
    pageNode.appendChild(textLayer);

    const annotationLayer = document.createElement('div');
    annotationLayer.className = 'annotationLayer';
    annotationLayer.dataset.page = String(pageNumber);
    pageNode.appendChild(annotationLayer);

    const ctx = canvas.getContext('2d');
    await page.render({ canvasContext: ctx, viewport }).promise;
    await renderTextLayer(page, viewport, textLayer, pageNumber);
    renderAnnotationsForPage(annotationLayer, pageNumber);
    return viewport;
}

async function renderTextLayer(page, viewport, textLayer, pageNumber) {
    const textContent = await page.getTextContent();
    state.pageTextCache.set(pageNumber, textContentToPlainText(textContent));
    const styles = textContent.styles || {};

    for (const item of textContent.items) {
        if (!item.str || !item.str.trim()) {
            continue;
        }

        const tx = state.pdfjsLib.Util.transform(viewport.transform, item.transform);
        const angle = Math.atan2(tx[1], tx[0]);
        const fontHeight = Math.hypot(tx[2], tx[3]);
        const span = document.createElement('span');
        const style = styles[item.fontName] || {};

        span.textContent = item.str;
        span.style.left = `${tx[4]}px`;
        span.style.top = `${tx[5] - fontHeight}px`;
        span.style.fontSize = `${fontHeight}px`;
        span.style.transform = `rotate(${angle}rad)`;
        if (style.fontFamily) {
            span.style.fontFamily = style.fontFamily;
        }
        textLayer.appendChild(span);
    }
}

async function gotoPage(pageNumber, options = {}) {
    if (!state.pdfDoc) {
        return;
    }
    const bounded = Math.max(1, Math.min(state.pdfDoc.numPages, pageNumber));
    const samePage = bounded === state.currentPage;
    if (samePage && options.scroll !== 'top' && options.scroll !== 'bottom' && options.scroll !== 'current') {
        return;
    }
    state.currentPage = bounded;
    state.pendingAnnotationSelection = null;
    hideSelectionActions('page-change');
    clearVisualSelection('page-change');
    window.getSelection()?.removeAllRanges();

    if (readerMode() === READER_MODE_CONTINUOUS) {
        updateToolbar();
        scrollToPage(state.currentPage, options.scroll === 'bottom' ? 'bottom' : 'top');
    } else {
        await renderPage();
        if (options.scroll === 'bottom') {
            elements.viewer.scrollTop = elements.viewer.scrollHeight;
        } else if (options.scroll !== 'keep') {
            elements.viewer.scrollTop = 0;
        }
    }

    if (options.trigger) {
        logClient('pdf.page.turn', { trigger: options.trigger, page: state.currentPage });
    }
}

function scrollToPage(pageNumber, align = 'top') {
    const pageNode = pageElementForPage(pageNumber);
    if (!pageNode) {
        return;
    }
    const viewerRect = elements.viewer.getBoundingClientRect();
    const pageRect = pageNode.getBoundingClientRect();
    const top = elements.viewer.scrollTop + pageRect.top - viewerRect.top - 12;
    const bottom = elements.viewer.scrollTop + pageRect.bottom - viewerRect.bottom + 12;
    elements.viewer.scrollTop = align === 'bottom' ? Math.max(0, bottom) : Math.max(0, top);
}

function onPageJumpInput() {
    window.clearTimeout(state.pageJumpTimer);
    if (!state.pdfDoc || !elements.pageJumpInput.value.trim()) {
        return;
    }
    state.pageJumpTimer = window.setTimeout(() => {
        void jumpToTypedPage('page-input');
    }, 320);
}

async function jumpToTypedPage(trigger = 'page-input') {
    if (!state.pdfDoc) {
        return;
    }

    const requested = Number(elements.pageJumpInput.value.trim());
    if (!Number.isFinite(requested)) {
        flashStatus('请输入页码');
        elements.pageJumpInput.focus();
        logClient('pdf.page.jump_ignored', { reason: 'empty' });
        return;
    }

    await jumpToPageNumber(requested, trigger);
}

function onPageJumpKeydown(event) {
    if (event.key !== 'Enter') {
        return;
    }
    event.preventDefault();
    window.clearTimeout(state.pageJumpTimer);
    void jumpToTypedPage('page-input-enter');
}

function onPageSliderInput() {
    elements.pageJumpInput.value = elements.pageSlider.value;
}

function onPageSliderChange() {
    void jumpToPageNumber(Number(elements.pageSlider.value), 'page-slider');
}

async function onReaderModeChanged() {
    saveUiPrefs();
    logClient('pdf.reader_mode.change', { mode: readerMode() });
    if (!state.pdfDoc) {
        return;
    }
    await renderPage({ scroll: 'current' });
}

function onVisualSelectionStyleChanged() {
    saveUiPrefs();
    if (state.visualSelectionDraft) {
        renderVisualSelectionDraft();
    } else if (state.visualSelection) {
        renderVisualSelection();
        positionVisualActions();
    }
    logClient('visual.selection.style', { style: visualSelectionStyle() });
}

async function jumpToPageNumber(pageNumber, trigger) {
    if (!state.pdfDoc) {
        return;
    }

    const targetPage = Math.max(1, Math.min(state.pdfDoc.numPages, Math.round(pageNumber)));
    if (targetPage === state.currentPage) {
        updateToolbar();
        if (trigger !== 'page-input') {
            flashStatus(`已在第 ${state.currentPage} 页`);
        }
        logClient('pdf.page.jump_ignored', { reason: 'same-page', page: state.currentPage, trigger });
        return;
    }

    state.lastPageTurnAt = performance.now();
    await gotoPage(targetPage, { trigger, scroll: 'top' });
}

async function setScale(nextScale, trigger = 'zoom') {
    const previousScale = state.scale;
    state.scale = Math.max(MIN_SCALE, Math.min(MAX_SCALE, nextScale));
    if (Math.abs(state.scale - previousScale) < 0.001) {
        return;
    }
    saveUiPrefs();
    await renderPage({ scroll: 'current' });
    flashStatus(`${Math.round(state.scale * 100)}%`);
    logClient('pdf.zoom.change', { scale: state.scale, trigger });
}

function onAutoTriggerChanged() {
    saveUiPrefs();
    if (state.selectionActionsSnapshot) {
        showSelectionActions(state.selectionActionsSnapshot);
    }
}

function onLineModeChanged() {
    if (elements.lineMode.checked) {
        cancelNotePlacement('line-mode');
        elements.eraserMode.checked = false;
        elements.page.classList.add('line-drawing-active');
        flashStatus('线条模式：在 PDF 上拖动绘制自由线条');
    } else {
        elements.page.classList.remove('line-drawing-active');
        cancelLineDraft();
        flashStatus(providerLabel());
    }
    saveUiPrefs();
    updateAnnotationControls();
    logClient('annotation.line_mode', { enabled: elements.lineMode.checked });
}

function onEraserModeChanged() {
    if (elements.eraserMode.checked) {
        elements.lineMode.checked = false;
        cancelNotePlacement('eraser-mode');
        cancelLineDraft();
        flashStatus('橡皮：点击线条删除');
    } else {
        flashStatus(providerLabel());
    }
    saveUiPrefs();
    updateAnnotationControls();
    logClient('annotation.eraser_mode', { enabled: elements.eraserMode.checked });
}

function resetTransientAnnotationTools() {
    elements.lineMode.checked = false;
    elements.eraserMode.checked = false;
    elements.page.classList.remove('line-drawing-active', 'note-placement-active', 'eraser-active');
    state.uiPrefs.lineMode = false;
    state.uiPrefs.eraserMode = false;
    updateAnnotationControls();
}

function onViewerWheel(event) {
    if (event.ctrlKey || event.metaKey) {
        if (!state.pdfDoc) {
            return;
        }
        event.preventDefault();
        if (state.renderLock) {
            return;
        }
        const delta = Math.abs(event.deltaY) >= Math.abs(event.deltaX) ? event.deltaY : event.deltaX;
        if (delta === 0) {
            return;
        }
        const direction = delta < 0 ? 1 : -1;
        void setScale(state.scale + direction * zoomStep(), 'ctrl-wheel');
        return;
    }

    if (!state.pdfDoc || state.renderLock) {
        return;
    }

    if (readerMode() === READER_MODE_CONTINUOUS) {
        return;
    }

    if (event.deltaY > 0 && isViewerAtBottom()) {
        event.preventDefault();
        void turnPageFromInput(1, 'wheel', 'top');
    } else if (event.deltaY < 0 && isViewerAtTop()) {
        event.preventDefault();
        void turnPageFromInput(-1, 'wheel', 'bottom');
    }
}

function onViewerScroll() {
    positionSelectionActions();
    positionVisualActions();
    if (!state.pdfDoc || state.renderLock || readerMode() !== READER_MODE_CONTINUOUS) {
        return;
    }
    const pageNumber = visibleContinuousPage();
    if (!pageNumber || pageNumber === state.currentPage) {
        return;
    }
    state.currentPage = pageNumber;
    updateToolbar();
}

function visibleContinuousPage() {
    const pages = Array.from(elements.page.querySelectorAll('.page-wrap'));
    if (!pages.length) {
        return 0;
    }
    const viewerRect = elements.viewer.getBoundingClientRect();
    const targetY = viewerRect.top + viewerRect.height * 0.35;
    let bestPage = 0;
    let bestDistance = Number.POSITIVE_INFINITY;
    for (const pageNode of pages) {
        const rect = pageNode.getBoundingClientRect();
        const center = Math.max(rect.top, Math.min(targetY, rect.bottom));
        const distance = Math.abs(center - targetY);
        if (distance < bestDistance) {
            bestDistance = distance;
            bestPage = Number(pageNode.dataset.page || 0);
        }
    }
    return bestPage;
}

function onPdfKeydown(event) {
    if (event.key === 'Escape' && settingsOpen()) {
        event.preventDefault();
        setSettingsOpen(false);
        return;
    }
    if (event.key === 'Escape' && state.notePlacementMode) {
        event.preventDefault();
        cancelNotePlacement('escape');
        return;
    }
    if (event.key === 'Escape' && (state.visualSelection || state.visualSelectionDraft)) {
        event.preventDefault();
        clearVisualSelection('escape');
        return;
    }
    if (event.defaultPrevented || shouldIgnorePdfShortcut(event) || !state.pdfDoc) {
        return;
    }

    if (event.key === 'ArrowRight' || event.key === 'PageDown') {
        event.preventDefault();
        void turnPageFromInput(1, `key:${event.key}`, 'top');
    } else if (event.key === 'ArrowLeft' || event.key === 'PageUp') {
        event.preventDefault();
        void turnPageFromInput(-1, `key:${event.key}`, 'top');
    } else if (event.key === 'ArrowDown') {
        event.preventDefault();
        scrollViewerByKeyboard(120);
    } else if (event.key === 'ArrowUp') {
        event.preventDefault();
        scrollViewerByKeyboard(-120);
    }
}

function shouldIgnorePdfShortcut(event) {
    if (event.altKey || event.ctrlKey || event.metaKey) {
        return true;
    }
    const target = event.target;
    return target instanceof HTMLElement
        && Boolean(target.closest('input, textarea, select, button, [contenteditable="true"]'));
}

async function scrollViewerByKeyboard(delta) {
    if (readerMode() === READER_MODE_CONTINUOUS) {
        elements.viewer.scrollTop += delta;
        return;
    }
    if (delta > 0 && isViewerAtBottom()) {
        await turnPageFromInput(1, 'key:ArrowDown', 'top');
        return;
    }
    if (delta < 0 && isViewerAtTop()) {
        await turnPageFromInput(-1, 'key:ArrowUp', 'bottom');
        return;
    }
    elements.viewer.scrollTop += delta;
}

async function turnPageFromInput(delta, trigger, scroll) {
    if (!state.pdfDoc) {
        return;
    }
    const now = performance.now();
    if (now - state.lastPageTurnAt < PAGE_TURN_COOLDOWN_MS) {
        return;
    }
    const targetPage = state.currentPage + delta;
    if (targetPage < 1 || targetPage > state.pdfDoc.numPages) {
        return;
    }
    state.lastPageTurnAt = now;
    await gotoPage(targetPage, { trigger, scroll });
}

function isViewerAtTop() {
    return elements.viewer.scrollTop <= 2;
}

function isViewerAtBottom() {
    return elements.viewer.scrollTop + elements.viewer.clientHeight >= elements.viewer.scrollHeight - 2;
}

function queueSelectionProbe(reason, actionAnchor = null) {
    if (!state.pdfDoc) {
        return;
    }
    window.clearTimeout(state.selectionTimer);
    state.selectionTimer = window.setTimeout(() => {
        void probeSelection(reason, actionAnchor);
    }, 260);
}

async function probeSelection(reason, actionAnchor = null) {
    const selectionSnapshot = getPdfSelectionSnapshot(actionAnchor);
    const autoTranslateEnabled = elements.autoTranslate.checked;
    const autoExplainEnabled = elements.autoExplain.checked;
    if (selectionSnapshot) {
        state.pendingAnnotationSelection = selectionSnapshot;
        state.currentPage = selectionSnapshot.page;
        updateToolbar();
    }
    const selectedText = selectionSnapshot?.text || '';
    if (selectionSnapshot) {
        state.lastSelection = selectedText;
        if (showSelectionActions(selectionSnapshot)) {
            logClient('selection.manual.ready', {
                trigger: reason,
                page: selectionSnapshot.page,
                textLength: selectedText.length,
                rects: selectionSnapshot.rects.length,
                explainButton: !autoExplainEnabled,
                translateButton: !autoTranslateEnabled
            });
        }
        if (!autoTranslateEnabled && !autoExplainEnabled) {
            return;
        }
    } else {
        hideSelectionActions('empty-selection');
    }

    const gate = selectionGate.evaluate(selectedText);
    if (!gate.shouldTrigger) {
        if (gate.reason !== 'empty') {
            logClient('selection.ignored', {
                reason: gate.reason,
                textLength: gate.normalizedText.length,
                trigger: reason
            });
        }
        return;
    }

    selectionGate.markTriggered(gate.normalizedText);
    state.lastSelection = gate.normalizedText;
    logClient('selection.trigger', {
        trigger: reason,
        page: selectionSnapshot.page,
        textLength: gate.normalizedText.length,
        autoTranslate: autoTranslateEnabled,
        autoExplain: autoExplainEnabled
    });

    const source = `${state.fileName || 'PDF'} p.${selectionSnapshot.page}`;
    if (autoTranslateEnabled) {
        fillTranslationInput(gate.normalizedText);
        void translateSelection(gate.normalizedText, source);
    }
    if (autoExplainEnabled) {
        const pageContext = await buildPageContext(selectionSnapshot.page);
        void explainSelection(gate.normalizedText, source, pageContext);
    }
    window.getSelection()?.removeAllRanges();
}

function getPdfSelectionText() {
    return getPdfSelectionSnapshot()?.text || '';
}

function showSelectionActions(selectionSnapshot) {
    state.selectionActionsSnapshot = selectionSnapshot;
    const canExplain = Boolean(selectionSnapshot?.text) && !elements.autoExplain.checked;
    const canTranslate = Boolean(selectionSnapshot?.text) && !elements.autoTranslate.checked;
    elements.selectionExplain.hidden = !canExplain;
    elements.selectionTranslate.hidden = !canTranslate;
    elements.selectionExplain.disabled = !canExplain;
    elements.selectionTranslate.disabled = !canTranslate;
    if (!canExplain && !canTranslate) {
        hideSelectionActions('all-auto-enabled');
        return false;
    }
    elements.selectionActions.hidden = false;
    positionSelectionActions();
    return true;
}

function hideSelectionActions(reason = 'hide') {
    const wasVisible = !elements.selectionActions.hidden;
    state.selectionActionsSnapshot = null;
    elements.selectionActions.hidden = true;
    elements.selectionExplain.hidden = false;
    elements.selectionTranslate.hidden = false;
    elements.selectionActions.style.left = '';
    elements.selectionActions.style.top = '';
    if (wasVisible) {
        logClient('selection.action.hide', { reason });
    }
}

function clearVisualSelection(reason = 'clear') {
    const hadSelection = Boolean(state.visualSelection || state.visualSelectionDraft);
    state.visualSelection = null;
    state.visualSelectionDraft = null;
    elements.visualActions.hidden = true;
    elements.visualActions.style.left = '';
    elements.visualActions.style.top = '';
    removeVisualSelectionNodes();
    if (hadSelection) {
        logClient('visual.selection.clear', { reason });
    }
}

function positionSelectionActions() {
    const selectionSnapshot = state.selectionActionsSnapshot;
    if (elements.selectionActions.hidden || !selectionSnapshot?.rects?.length) {
        return;
    }
    const pageNode = pageElementForPage(selectionSnapshot.page);
    if (!pageNode) {
        hideSelectionActions('page-missing');
        return;
    }
    const point = clientPointForActionAnchor(selectionSnapshot.actionAnchor)
        || clientPointForTextSelection(selectionSnapshot, pageNode);
    if (!point) {
        hideSelectionActions('anchor-missing');
        return;
    }
    placeActionMenuAtPoint(elements.selectionActions, point);
}

function positionVisualActions() {
    const selection = state.visualSelection;
    if (elements.visualActions.hidden || !selection?.rect) {
        return;
    }
    const pageNode = pageElementForPage(selection.page);
    if (!pageNode) {
        clearVisualSelection('page-missing');
        return;
    }
    const point = clientPointForActionAnchor(selection.actionAnchor)
        || clientPointForVisualSelection(selection, pageNode);
    if (!point) {
        clearVisualSelection('anchor-missing');
        return;
    }
    placeActionMenuAtPoint(elements.visualActions, point);
}

function actionAnchorFromEvent(event, pageNumber = null) {
    if (!Number.isFinite(event.clientX) || !Number.isFinite(event.clientY)) {
        return null;
    }
    const pageNode = pageNumber ? pageElementForPage(pageNumber) : pageElementFromEvent(event);
    const resolvedPage = pageNumber || Number(pageNode?.dataset.page || 0);
    const anchor = {
        clientX: event.clientX,
        clientY: event.clientY
    };
    if (pageNode && Number.isFinite(resolvedPage) && resolvedPage > 0) {
        const pageRect = pageNode.getBoundingClientRect();
        if (pageRect.width && pageRect.height) {
            anchor.page = resolvedPage;
            anchor.x = clamp((event.clientX - pageRect.left) / pageRect.width, 0, 1);
            anchor.y = clamp((event.clientY - pageRect.top) / pageRect.height, 0, 1);
        }
    }
    return anchor;
}

function actionAnchorForSelection(actionAnchor, pageNumber, pageNode) {
    if (!actionAnchor) {
        return null;
    }
    const anchor = { ...actionAnchor };
    if (Number.isFinite(anchor.page) && Number(anchor.page) !== pageNumber) {
        return Number.isFinite(anchor.clientX) && Number.isFinite(anchor.clientY)
            ? { clientX: anchor.clientX, clientY: anchor.clientY }
            : null;
    }
    if ((!Number.isFinite(anchor.page) || !Number.isFinite(anchor.x) || !Number.isFinite(anchor.y))
        && Number.isFinite(anchor.clientX) && Number.isFinite(anchor.clientY)) {
        const pageRect = pageNode.getBoundingClientRect();
        if (pageRect.width && pageRect.height) {
            anchor.page = pageNumber;
            anchor.x = clamp((anchor.clientX - pageRect.left) / pageRect.width, 0, 1);
            anchor.y = clamp((anchor.clientY - pageRect.top) / pageRect.height, 0, 1);
        }
    }
    return anchor;
}

function clientPointForActionAnchor(anchor) {
    if (!anchor) {
        return null;
    }
    if (Number.isFinite(anchor.page) && Number.isFinite(anchor.x) && Number.isFinite(anchor.y)) {
        const pageNode = pageElementForPage(Number(anchor.page));
        const pageRect = pageNode?.getBoundingClientRect();
        if (pageRect?.width && pageRect.height) {
            return {
                x: pageRect.left + Number(anchor.x) * pageRect.width,
                y: pageRect.top + Number(anchor.y) * pageRect.height
            };
        }
    }
    if (Number.isFinite(anchor.clientX) && Number.isFinite(anchor.clientY)) {
        return { x: Number(anchor.clientX), y: Number(anchor.clientY) };
    }
    return null;
}

function clientPointForTextSelection(selectionSnapshot, pageNode) {
    const pageRect = pageNode.getBoundingClientRect();
    const sortedRects = [...selectionSnapshot.rects].sort((a, b) => a.y - b.y || a.x - b.x);
    const lastRect = sortedRects[sortedRects.length - 1];
    if (!lastRect || !pageRect.width || !pageRect.height) {
        return null;
    }
    return {
        x: pageRect.left + (lastRect.x + lastRect.width) * pageRect.width,
        y: pageRect.top + (lastRect.y + lastRect.height / 2) * pageRect.height
    };
}

function clientPointForVisualSelection(selection, pageNode) {
    const pageRect = pageNode.getBoundingClientRect();
    const rect = selection.rect;
    if (!rect || !pageRect.width || !pageRect.height) {
        return null;
    }
    return {
        x: pageRect.left + (rect.x + rect.width) * pageRect.width,
        y: pageRect.top + (rect.y + rect.height / 2) * pageRect.height
    };
}

function placeActionMenuAtPoint(actionNode, point) {
    const actionRect = actionNode.getBoundingClientRect();
    const width = actionRect.width || 132;
    const height = actionRect.height || 42;
    const rightSpace = window.innerWidth - point.x - ACTION_MENU_EDGE_GAP;
    const leftSpace = point.x - ACTION_MENU_EDGE_GAP;
    let left = point.x + ACTION_MENU_GAP;
    if (rightSpace < width + ACTION_MENU_GAP && leftSpace >= width + ACTION_MENU_GAP) {
        left = point.x - width - ACTION_MENU_GAP;
    }
    let top = point.y - height / 2;
    if (top < ACTION_MENU_EDGE_GAP) {
        top = point.y + ACTION_MENU_GAP;
    } else if (top + height > window.innerHeight - ACTION_MENU_EDGE_GAP) {
        top = point.y - height - ACTION_MENU_GAP;
    }
    actionNode.style.left = `${clamp(left, ACTION_MENU_EDGE_GAP, window.innerWidth - width - ACTION_MENU_EDGE_GAP)}px`;
    actionNode.style.top = `${clamp(top, ACTION_MENU_EDGE_GAP, window.innerHeight - height - ACTION_MENU_EDGE_GAP)}px`;
}

function onSelectionActionDocumentPointerDown(event) {
    const target = event.target;
    if (!elements.selectionActions.hidden) {
        if (target instanceof Node && elements.selectionActions.contains(target)) {
            return;
        }
        hideSelectionActions('document-pointer');
    }
    if (elements.visualActions.hidden) {
        return;
    }
    if (target instanceof Node && elements.visualActions.contains(target)) {
        return;
    }
    clearVisualSelection('document-pointer');
}

async function explainSelectionFromAction(event) {
    event.preventDefault();
    const selection = state.selectionActionsSnapshot || state.pendingAnnotationSelection || getPdfSelectionSnapshot();
    if (!selection?.text) {
        hideSelectionActions('empty-explain');
        flashStatus('请先在 PDF 中选中文本');
        return;
    }
    state.currentPage = selection.page;
    state.lastSelection = selection.text;
    const source = `${state.fileName || 'PDF'} p.${selection.page}`;
    hideSelectionActions('manual-explain');
    window.getSelection()?.removeAllRanges();
    updateToolbar();
    logClient('selection.action.explain', {
        page: selection.page,
        textLength: selection.text.length
    });
    const pageContext = await buildPageContext(selection.page);
    await explainSelection(selection.text, source, pageContext);
}

async function translateSelectionFromAction(event) {
    event.preventDefault();
    const selection = state.selectionActionsSnapshot || state.pendingAnnotationSelection || getPdfSelectionSnapshot();
    if (!selection?.text) {
        hideSelectionActions('empty-translate');
        flashStatus('请先在 PDF 中选中文本');
        return;
    }
    state.currentPage = selection.page;
    state.lastSelection = selection.text;
    fillTranslationInput(selection.text);
    const source = `${state.fileName || 'PDF'} p.${selection.page}`;
    hideSelectionActions('manual-translate');
    window.getSelection()?.removeAllRanges();
    updateToolbar();
    logClient('selection.action.translate', {
        page: selection.page,
        textLength: selection.text.length
    });
    await translateSelection(selection.text, source);
}

function getPdfSelectionSnapshot(actionAnchor = null) {
    const selection = window.getSelection();
    if (!selection || selection.rangeCount === 0 || selection.isCollapsed) {
        return null;
    }

    if (!nodeInsideTextLayer(selection.anchorNode) || !nodeInsideTextLayer(selection.focusNode)) {
        return null;
    }
    const pageNode = pageElementFromNode(selection.anchorNode) || pageElementFromNode(selection.focusNode);
    const pageNumber = Number(pageNode?.dataset.page || state.currentPage);
    if (!pageNode || !Number.isFinite(pageNumber)) {
        return null;
    }

    const text = normalizeSelectionText(selection.toString());
    if (!text) {
        return null;
    }

    const pageRect = pageNode.getBoundingClientRect();
    const rects = [];
    for (let index = 0; index < selection.rangeCount; index += 1) {
        const range = selection.getRangeAt(index);
        for (const rect of Array.from(range.getClientRects())) {
            const clipped = rectToPageRatio(rect, pageRect);
            if (clipped) {
                rects.push(clipped);
            }
        }
    }

    if (rects.length === 0) {
        return null;
    }

    return {
        page: pageNumber,
        text,
        rects: compactAnnotationRects(rects),
        actionAnchor: actionAnchorForSelection(actionAnchor, pageNumber, pageNode)
    };
}

function nodeInsideTextLayer(node) {
    if (!node) {
        return false;
    }
    const element = node.nodeType === Node.TEXT_NODE ? node.parentElement : node;
    return element instanceof Element && Boolean(element.closest('.textLayer'));
}

function pageElementFromNode(node) {
    if (!node) {
        return null;
    }
    const element = node.nodeType === Node.TEXT_NODE ? node.parentElement : node;
    return element instanceof Element ? element.closest('.page-wrap') : null;
}

function pageElementFromEvent(event) {
    const fromTarget = pageElementFromNode(event.target);
    if (fromTarget) {
        return fromTarget;
    }
    const fromPoint = document.elementFromPoint(event.clientX, event.clientY);
    return pageElementFromNode(fromPoint);
}

function pageElementForPage(pageNumber) {
    const pageKey = String(pageNumber);
    if (elements.page.classList.contains('page-wrap') && elements.page.dataset.page === pageKey) {
        return elements.page;
    }
    return elements.page.querySelector(`.page-wrap[data-page="${cssEscape(pageKey)}"]`);
}

function canvasForPage(pageNumber) {
    return pageElementForPage(pageNumber)?.querySelector('canvas') || null;
}

function annotationLayerForPage(pageNumber) {
    return pageElementForPage(pageNumber)?.querySelector('.annotationLayer') || null;
}

function rectToPageRatio(rect, pageRect) {
    if (!pageRect.width || !pageRect.height || rect.width < 1 || rect.height < 1) {
        return null;
    }

    const left = Math.max(rect.left, pageRect.left);
    const right = Math.min(rect.right, pageRect.right);
    const top = Math.max(rect.top, pageRect.top);
    const bottom = Math.min(rect.bottom, pageRect.bottom);
    const width = right - left;
    const height = bottom - top;
    if (width < 2 || height < 2) {
        return null;
    }

    return {
        x: (left - pageRect.left) / pageRect.width,
        y: (top - pageRect.top) / pageRect.height,
        width: width / pageRect.width,
        height: height / pageRect.height
    };
}

function compactAnnotationRects(rects) {
    const seen = new Set();
    return rects.filter((rect) => {
        const key = [
            Math.round(rect.x * 1000),
            Math.round(rect.y * 1000),
            Math.round(rect.width * 1000),
            Math.round(rect.height * 1000)
        ].join(':');
        if (seen.has(key)) {
            return false;
        }
        seen.add(key);
        return true;
    }).slice(0, 80);
}

function onViewerContextMenu(event) {
    if (isInteractiveTarget(event.target)) {
        return;
    }
    if (state.visualSelectionDraft || pageElementFromEvent(event)) {
        event.preventDefault();
    }
}

function onPagePointerDown(event) {
    if (!state.pdfDoc || state.renderLock) {
        return;
    }
    if (isInteractiveTarget(event.target)) {
        return;
    }
    if (event.button === 2) {
        startVisualSelection(event);
        return;
    }
    if (event.button !== 0) {
        return;
    }
    const point = pointToPageRatio(event);
    if (!point) {
        return;
    }
    if (state.notePlacementMode && !elements.lineMode.checked && !elements.eraserMode.checked) {
        event.preventDefault();
        state.notePlacementMode = false;
        updateAnnotationControls();
        addTextBoxAnnotation(point);
        return;
    }
    if (!elements.lineMode.checked || elements.eraserMode.checked) {
        return;
    }
    event.preventDefault();
    elements.page.setPointerCapture?.(event.pointerId);
    window.getSelection()?.removeAllRanges();
    state.lineDraft = {
        pointerId: event.pointerId,
        page: point.page,
        points: [{ x: point.x, y: point.y }]
    };
    renderLineDraft();
    logClient('annotation.line.start', { page: point.page });
}

function onPagePointerMove(event) {
    if (state.visualSelectionDraft && state.visualSelectionDraft.pointerId === event.pointerId) {
        updateVisualSelectionDraft(event);
        return;
    }
    if (!state.lineDraft || state.lineDraft.pointerId !== event.pointerId) {
        return;
    }
    const point = pointToPageRatio(event);
    if (!point) {
        return;
    }
    event.preventDefault();
    if (point.page === state.lineDraft.page) {
        pushLinePoint(state.lineDraft.points, point);
    }
}

function onPagePointerUp(event) {
    if (state.visualSelectionDraft && state.visualSelectionDraft.pointerId === event.pointerId) {
        finishVisualSelection(event);
        return;
    }
    if (!state.lineDraft || state.lineDraft.pointerId !== event.pointerId) {
        return;
    }
    const point = pointToPageRatio(event);
    if (point && point.page === state.lineDraft.page) {
        pushLinePoint(state.lineDraft.points, point, true);
    }
    event.preventDefault();
    elements.page.releasePointerCapture?.(event.pointerId);
    const points = state.lineDraft.points;
    const pageNumber = state.lineDraft.page;
    cancelLineDraft();
    if (lineLength(points) < 0.008) {
        logClient('annotation.line.ignored', { reason: 'too-short' });
        return;
    }
    addLineAnnotation(points, pageNumber);
}

function cancelLineDraft() {
    const draftPage = state.lineDraft?.page;
    state.lineDraft = null;
    if (draftPage) {
        annotationLayerForPage(draftPage)?.querySelector('.annotation-line-preview')?.remove();
        return;
    }
    elements.page.querySelectorAll('.annotation-line-preview').forEach((node) => node.remove());
}

function onPageLostPointerCapture(event) {
    if (state.visualSelectionDraft?.pointerId === event.pointerId) {
        finishVisualSelection(event);
    }
}

function startVisualSelection(event) {
    const point = pointToPageRatio(event);
    if (!point) {
        return;
    }
    event.preventDefault();
    event.stopPropagation();
    hideSelectionActions('visual-start');
    clearVisualSelection('visual-start');
    window.getSelection()?.removeAllRanges();
    elements.page.setPointerCapture?.(event.pointerId);
    state.visualSelectionDraft = {
        pointerId: event.pointerId,
        page: point.page,
        style: visualSelectionStyle(),
        start: point,
        end: point,
        points: [{ x: point.x, y: point.y }],
        actionAnchor: actionAnchorFromEvent(event, point.page)
    };
    renderVisualSelectionDraft();
    logClient('visual.selection.start', { page: point.page });
}

function updateVisualSelectionDraft(event) {
    const point = pointToPageRatioForPage(event, state.visualSelectionDraft.page);
    if (!point || point.page !== state.visualSelectionDraft.page) {
        return;
    }
    event.preventDefault();
    state.visualSelectionDraft.end = point;
    pushVisualSelectionPoint(state.visualSelectionDraft.points, point);
    renderVisualSelectionDraft();
}

function finishVisualSelection(event) {
    const draft = state.visualSelectionDraft;
    if (!draft) {
        return;
    }
    const point = pointToPageRatioForPage(event, draft.page);
    if (point && point.page === draft.page) {
        draft.end = point;
        pushVisualSelectionPoint(draft.points, point, true);
    }
    event.preventDefault();
    elements.page.releasePointerCapture?.(event.pointerId);
    const rawRect = rawRectFromVisualDraft(draft);
    const rect = rawRect ? padVisualSelectionRect(rawRect) : null;
    const actionAnchor = actionAnchorFromEvent(event, draft.page) || draft.actionAnchor;
    state.visualSelectionDraft = null;
    removeVisualSelectionNodes();
    if (!rawRect || Math.max(rawRect.width, rawRect.height) < VISUAL_SELECTION_MIN_RATIO) {
        const page = point?.page || draft.page;
        state.visualSelection = {
            page,
            rect: { x: 0, y: 0, width: 1, height: 1 },
            kind: 'page',
            style: draft.style || visualSelectionStyle(),
            actionAnchor
        };
        showVisualActions('context-page-menu');
        logClient('visual.selection.context_menu', { page });
        return;
    }
    state.visualSelection = {
        page: draft.page,
        rect,
        kind: 'region',
        style: draft.style || visualSelectionStyle(),
        points: draft.points,
        actionAnchor
    };
    renderVisualSelection();
    showVisualActions('region');
    logClient('visual.selection.ready', {
        page: draft.page,
        width: Number(rect.width.toFixed(4)),
        height: Number(rect.height.toFixed(4))
    });
}

function rectFromVisualDraft(draft) {
    const rawRect = rawRectFromVisualDraft(draft);
    return rawRect ? padVisualSelectionRect(rawRect) : null;
}

function rawRectFromVisualDraft(draft) {
    if ((draft.style || visualSelectionStyle()) === VISUAL_SELECTION_STYLE_BOX) {
        return rawRectFromCorners(draft.start, draft.end);
    }
    return rawRectFromPoints(draft.points?.length ? draft.points : [draft.start, draft.end]);
}

function rawRectFromCorners(start, end) {
    const left = Math.max(0, Math.min(start.x, end.x));
    const top = Math.max(0, Math.min(start.y, end.y));
    const right = Math.min(1, Math.max(start.x, end.x));
    const bottom = Math.min(1, Math.max(start.y, end.y));
    const width = right - left;
    const height = bottom - top;
    if (width <= 0 || height <= 0) {
        return null;
    }
    return { x: left, y: top, width, height };
}

function rawRectFromPoints(points) {
    const left = Math.max(0, Math.min(...points.map((point) => point.x)));
    const top = Math.max(0, Math.min(...points.map((point) => point.y)));
    const right = Math.min(1, Math.max(...points.map((point) => point.x)));
    const bottom = Math.min(1, Math.max(...points.map((point) => point.y)));
    const width = right - left;
    const height = bottom - top;
    if (width <= 0 || height <= 0) {
        return null;
    }
    return { x: left, y: top, width, height };
}

function padVisualSelectionRect(rect) {
    const left = Math.max(0, rect.x - VISUAL_SELECTION_PADDING_RATIO);
    const top = Math.max(0, rect.y - VISUAL_SELECTION_PADDING_RATIO);
    const right = Math.min(1, rect.x + rect.width + VISUAL_SELECTION_PADDING_RATIO);
    const bottom = Math.min(1, rect.y + rect.height + VISUAL_SELECTION_PADDING_RATIO);
    return {
        x: left,
        y: top,
        width: right - left,
        height: bottom - top
    };
}

function pushVisualSelectionPoint(points, point, force = false) {
    const last = points[points.length - 1];
    if (force || !last || Math.hypot(point.x - last.x, point.y - last.y) >= 0.004) {
        points.push({ x: point.x, y: point.y });
    }
}

function showVisualActions(reason) {
    elements.visualActions.hidden = false;
    positionVisualActions();
    logClient('visual.action.show', { reason, kind: state.visualSelection?.kind, page: state.visualSelection?.page });
}

function renderVisualSelectionDraft() {
    const draft = state.visualSelectionDraft;
    const layer = draft ? annotationLayerForPage(draft.page) : null;
    if (!draft || !layer) {
        return;
    }
    layer.querySelector('.visual-selection-rect')?.remove();
    const rect = rectFromVisualDraft(draft) || { x: draft.start.x, y: draft.start.y, width: 0, height: 0 };
    const node = createVisualSelectionSvg(rect, draft.points || [draft.start, draft.end], draft.style || visualSelectionStyle());
    layer.appendChild(node);
}

function renderVisualSelection() {
    const selection = state.visualSelection;
    const layer = selection?.kind === 'region' ? annotationLayerForPage(selection.page) : null;
    if (!selection || !layer) {
        return;
    }
    layer.querySelector('.visual-selection-rect')?.remove();
    layer.appendChild(createVisualSelectionSvg(selection.rect, selection.points || [], selection.style || visualSelectionStyle()));
}

function removeVisualSelectionNodes() {
    elements.page.querySelectorAll('.visual-selection-rect').forEach((node) => node.remove());
}

function createVisualSelectionSvg(rect, points, style = visualSelectionStyle()) {
    const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
    svg.classList.add('visual-selection-rect');
    svg.classList.toggle('path-only', style === VISUAL_SELECTION_STYLE_PATH);
    svg.classList.toggle('box-only', style === VISUAL_SELECTION_STYLE_BOX);
    svg.setAttribute('viewBox', '0 0 1 1');
    svg.setAttribute('preserveAspectRatio', 'none');
    svg.style.left = `${rect.x * 100}%`;
    svg.style.top = `${rect.y * 100}%`;
    svg.style.width = `${rect.width * 100}%`;
    svg.style.height = `${rect.height * 100}%`;

    const box = document.createElementNS('http://www.w3.org/2000/svg', 'rect');
    box.setAttribute('x', '0');
    box.setAttribute('y', '0');
    box.setAttribute('width', '1');
    box.setAttribute('height', '1');
    box.classList.add('visual-selection-box');
    if (style === VISUAL_SELECTION_STYLE_BOX) {
        svg.appendChild(box);
        return svg;
    }

    const halo = document.createElementNS('http://www.w3.org/2000/svg', 'polyline');
    halo.setAttribute('points', visualSelectionPolylinePoints(points, rect));
    halo.classList.add('visual-selection-path-halo');
    svg.appendChild(halo);

    const polyline = document.createElementNS('http://www.w3.org/2000/svg', 'polyline');
    polyline.setAttribute('points', visualSelectionPolylinePoints(points, rect));
    polyline.classList.add('visual-selection-path');
    svg.appendChild(polyline);
    return svg;
}

function visualSelectionPolylinePoints(points, rect) {
    return points.map((point) => {
        const x = rect.width ? (point.x - rect.x) / rect.width : 0;
        const y = rect.height ? (point.y - rect.y) / rect.height : 0;
        return `${clamp(x, 0, 1)},${clamp(y, 0, 1)}`;
    }).join(' ');
}

function renderLineDraft() {
    const layer = state.lineDraft ? annotationLayerForPage(state.lineDraft.page) : null;
    if (!layer || !state.lineDraft) {
        return;
    }
    layer.querySelector('.annotation-line-preview')?.remove();
    layer.appendChild(createLineSvg(state.lineDraft.points, 'annotation-line annotation-line-preview'));
}

function pushLinePoint(points, point, force = false) {
    const last = points[points.length - 1];
    if (force || !last || Math.hypot(point.x - last.x, point.y - last.y) >= 0.003) {
        points.push({ x: point.x, y: point.y });
        renderLineDraft();
    }
}

function pointToPageRatio(event) {
    const pageNode = pageElementFromEvent(event);
    if (!pageNode) {
        return null;
    }
    const pageNumber = Number(pageNode.dataset.page || state.currentPage);
    return pointToPageRatioInNode(event, pageNode, pageNumber);
}

function pointToPageRatioForPage(event, pageNumber) {
    const pageNode = pageElementForPage(pageNumber);
    return pageNode ? pointToPageRatioInNode(event, pageNode, pageNumber) : null;
}

function pointToPageRatioInNode(event, pageNode, pageNumber) {
    const pageRect = pageNode.getBoundingClientRect();
    if (!pageRect.width || !pageRect.height) {
        return null;
    }
    if (Number.isFinite(pageNumber) && pageNumber !== state.currentPage) {
        state.currentPage = pageNumber;
        updateToolbar();
    }
    return {
        page: Number.isFinite(pageNumber) ? pageNumber : state.currentPage,
        x: clamp((event.clientX - pageRect.left) / pageRect.width, 0, 1),
        y: clamp((event.clientY - pageRect.top) / pageRect.height, 0, 1)
    };
}

function lineLength(points) {
    return points.slice(1).reduce((total, point, index) => {
        const previous = points[index];
        return total + Math.hypot(point.x - previous.x, point.y - previous.y);
    }, 0);
}

function addHighlightFromSelection() {
    addAnnotationFromSelection('highlight');
}

function undoLastHighlight() {
    const highlights = annotationsForPage(state.currentPage)
        .filter((annotation) => annotation.type === 'highlight');
    if (!highlights.length) {
        flashStatus('本页没有可撤销的高亮');
        logClient('annotation.highlight.undo_ignored', {
            page: state.currentPage,
            reason: 'no-highlight'
        });
        return;
    }

    const latest = highlights.reduce((current, annotation) => (
        new Date(annotation.createdAt || 0).getTime() >= new Date(current.createdAt || 0).getTime()
            ? annotation
            : current
    ));
    deleteAnnotation(latest.id, 'annotation.highlight.undo');
    flashStatus('已撤销最近一次高亮');
}

function addNoteFromSelection() {
    if (state.notePlacementMode) {
        cancelNotePlacement('toggle');
        return;
    }
    const selection = getPdfSelectionSnapshot() || state.pendingAnnotationSelection;
    if (selection && selection.rects.length) {
        addAnnotationFromSelection('note', '', selection);
        return;
    }
    state.notePlacementMode = true;
    if (elements.lineMode.checked) {
        elements.lineMode.checked = false;
        cancelLineDraft();
    }
    elements.eraserMode.checked = false;
    saveUiPrefs();
    updateAnnotationControls();
    flashStatus('文本框工具：点击 PDF 页面放置，再点“笔记”或按 Esc 退出');
    logClient('annotation.note.place_pending', { page: state.currentPage });
}

function cancelNotePlacement(reason = 'cancel') {
    if (!state.notePlacementMode) {
        return false;
    }
    state.notePlacementMode = false;
    updateAnnotationControls();
    flashStatus(providerLabel());
    logClient('annotation.note.place_cancel', { page: state.currentPage, reason });
    return true;
}

function addAnnotationFromSelection(type, note = '', preparedSelection = null) {
    const selection = preparedSelection || getPdfSelectionSnapshot() || state.pendingAnnotationSelection;
    if (!selection || selection.rects.length === 0) {
        flashStatus('请先在 PDF 中选中文本');
        logClient('annotation.add.ignored', { reason: 'no-selection', type });
        return;
    }
    state.currentPage = selection.page;

    const docAnnotations = annotationsForDocument();
    const pageKey = String(selection.page);
    const pageAnnotations = docAnnotations[pageKey] || [];
    const annotation = {
        id: `${Date.now()}-${Math.random().toString(16).slice(2)}`,
        type,
        page: selection.page,
        text: selection.text,
        note,
        box: type === 'note' ? noteBoxForSelection(selection) : undefined,
        fontSizeRatio: type === 'note' ? 0.026 : undefined,
        rects: selection.rects,
        createdAt: new Date().toISOString()
    };
    docAnnotations[pageKey] = [...pageAnnotations, annotation];
    state.annotations[state.annotationDocKey] = docAnnotations;
    saveAnnotations();
    state.pendingAnnotationSelection = null;
    window.getSelection()?.removeAllRanges();
    if (type === 'note') {
        state.selectedAnnotationId = annotation.id;
        state.editingNoteId = annotation.id;
        armNoteEditGuard();
    }
    renderAnnotationsForCurrentPage();
    updateAnnotationControls();
    if (type === 'note') {
        focusNoteInput(annotation.id);
    }
    flashStatus(type === 'note' ? '已添加笔记' : '已高亮选区');
    logClient('annotation.add', {
        type,
        page: annotation.page,
        rects: annotation.rects.length,
        textLength: annotation.text.length,
        hasNote: Boolean(note)
    });
}

function addLineAnnotation(points, pageNumber = state.currentPage) {
    state.currentPage = pageNumber;
    const docAnnotations = annotationsForDocument();
    const pageKey = String(pageNumber);
    const pageAnnotations = docAnnotations[pageKey] || [];
    const annotation = {
        id: `${Date.now()}-${Math.random().toString(16).slice(2)}`,
        type: 'line',
        page: pageNumber,
        points,
        createdAt: new Date().toISOString()
    };
    docAnnotations[pageKey] = [...pageAnnotations, annotation];
    state.annotations[state.annotationDocKey] = docAnnotations;
    saveAnnotations();
    renderAnnotationsForCurrentPage();
    updateAnnotationControls();
    flashStatus('已添加线条');
    logClient('annotation.line.add', {
        page: annotation.page,
        points: annotation.points.length,
        length: Number(lineLength(points).toFixed(4))
    });
}

function addTextBoxAnnotation(point, initialText = '') {
    const pageNumber = Number(point.page || state.currentPage);
    state.currentPage = pageNumber;
    const docAnnotations = annotationsForDocument();
    const pageKey = String(pageNumber);
    const pageAnnotations = docAnnotations[pageKey] || [];
    const annotation = {
        id: `${Date.now()}-${Math.random().toString(16).slice(2)}`,
        type: 'note',
        page: pageNumber,
        text: '',
        note: initialText,
        box: {
            x: point.x,
            y: point.y,
            width: 0.28,
            height: 0.08
        },
        fontSizeRatio: 0.026,
        rects: [],
        createdAt: new Date().toISOString()
    };
    docAnnotations[pageKey] = [...pageAnnotations, annotation];
    state.annotations[state.annotationDocKey] = docAnnotations;
    state.selectedAnnotationId = annotation.id;
    state.editingNoteId = annotation.id;
    armNoteEditGuard();
    saveAnnotations();
    renderAnnotationsForCurrentPage();
    updateAnnotationControls();
    focusNoteInput(annotation.id);
    flashStatus('已添加文本框');
    logClient('annotation.note.add_box', {
        page: annotation.page,
        x: Number(point.x.toFixed(4)),
        y: Number(point.y.toFixed(4))
    });
}

function clearCurrentPageAnnotations() {
    const docAnnotations = annotationsForDocument();
    const pageKey = String(state.currentPage);
    const count = docAnnotations[pageKey]?.length || 0;
    if (!count) {
        flashStatus('本页没有批注');
        return;
    }

    if (!window.confirm(`清除当前第 ${state.currentPage} 页的 ${count} 条批注？`)) {
        return;
    }
    delete docAnnotations[pageKey];
    state.annotations[state.annotationDocKey] = docAnnotations;
    saveAnnotations();
    renderAnnotationsForCurrentPage();
    updateAnnotationControls();
    flashStatus('已清除本页批注');
    logClient('annotation.page.clear', { page: state.currentPage, count });
}

function renderAnnotationsForCurrentPage() {
    const layers = elements.page.querySelectorAll('.annotationLayer');
    layers.forEach((layer) => {
        const pageNumber = Number(layer.dataset.page || state.currentPage);
        renderAnnotationsForPage(layer, pageNumber);
    });
}

function renderAnnotationsForPage(layer, pageNumber = state.currentPage) {
    layer.innerHTML = '';
    const annotations = annotationsForPage(pageNumber);
    annotations.forEach((annotation) => {
        if (annotation.type === 'line' && annotation.points?.length >= 2) {
            layer.appendChild(createLineSvg(annotation.points, 'annotation-line', annotation));
            return;
        }
        if (annotation.type === 'note') {
            renderInlineNote(layer, annotation);
            return;
        }
        (annotation.rects || []).forEach((rect) => renderHighlightRect(layer, rect, annotation));
    });
}

function renderHighlightRect(layer, rect, annotation) {
    const mark = document.createElement('div');
    mark.className = 'annotation-mark highlight';
    mark.style.left = `${rect.x * 100}%`;
    mark.style.top = `${rect.y * 100}%`;
    mark.style.width = `${rect.width * 100}%`;
    mark.style.height = `${rect.height * 100}%`;
    mark.title = annotationTitle(annotation);
    layer.appendChild(mark);
}

function renderInlineNote(layer, annotation) {
    if (annotation.box) {
        renderNoteBox(layer, annotation);
        return;
    }
    const anchor = annotation.anchor || noteAnchorForRects(annotation.rects || []);
    if (!anchor) {
        return;
    }
    const noteText = document.createElement('div');
    noteText.className = `annotation-note-text ${anchor.placement || 'above'}`;
    noteText.textContent = annotation.note || '笔记';
    noteText.title = annotationTitle(annotation);
    noteText.style.left = `${anchor.x * 100}%`;
    noteText.style.top = `${anchor.y * 100}%`;
    noteText.style.fontSize = `${Math.max(13, layer.clientWidth * (annotation.fontSizeRatio || 0.026))}px`;
    layer.appendChild(noteText);
}

function renderNoteBox(layer, annotation) {
    const box = annotation.box;
    const noteBox = document.createElement('div');
    const selected = state.selectedAnnotationId === annotation.id;
    const editing = state.editingNoteId === annotation.id;
    noteBox.className = `annotation-note-box${selected ? ' selected' : ''}${editing ? ' editing' : ''}`;
    noteBox.dataset.annotationId = annotation.id;
    noteBox.tabIndex = -1;
    noteBox.style.left = `${box.x * 100}%`;
    noteBox.style.top = `${box.y * 100}%`;
    noteBox.style.width = `${box.width * 100}%`;
    noteBox.style.height = `${box.height * 100}%`;
    noteBox.style.fontSize = `${Math.max(13, layer.clientWidth * (annotation.fontSizeRatio || 0.026))}px`;
    noteBox.title = editing ? '拖动左侧手柄移动，右下角拉伸大小' : '双击编辑笔记';
    noteBox.addEventListener('pointerdown', (event) => {
        event.stopPropagation();
        selectAnnotation(annotation.id);
    });
    noteBox.addEventListener('dblclick', (event) => {
        event.preventDefault();
        event.stopPropagation();
        beginNoteEdit(annotation.id);
    });
    noteBox.addEventListener('pointerup', () => persistNoteBoxGeometry(annotation.id, noteBox));

    if (!editing) {
        if (!annotation.note) {
            return;
        }
        const display = document.createElement('div');
        display.className = 'annotation-note-display';
        display.textContent = annotation.note;
        display.addEventListener('pointerdown', (event) => {
            event.preventDefault();
            event.stopPropagation();
            beginNoteEdit(annotation.id);
        });
        display.addEventListener('click', (event) => {
            event.preventDefault();
            event.stopPropagation();
            beginNoteEdit(annotation.id);
        });
        display.addEventListener('dblclick', (event) => {
            event.preventDefault();
            event.stopPropagation();
            beginNoteEdit(annotation.id);
        });
        noteBox.appendChild(display);
        layer.appendChild(noteBox);
        return;
    }

    const handle = document.createElement('div');
    handle.className = 'annotation-note-handle';
    handle.textContent = '⋮⋮';
    handle.contentEditable = 'false';
    handle.addEventListener('pointerdown', (event) => startNoteDrag(event, annotation.id, noteBox));

    const input = document.createElement('textarea');
    input.className = 'annotation-note-input';
    input.spellcheck = false;
    input.placeholder = '';
    input.value = annotation.note || '';
    input.addEventListener('pointerdown', (event) => {
        event.stopPropagation();
        selectAnnotation(annotation.id);
    });
    input.addEventListener('input', () => {
        updateAnnotation(annotation.id, { note: input.value }, { render: false });
    });
    input.addEventListener('blur', () => {
        handleNoteInputBlur(annotation.id, input, noteBox);
    });
    input.addEventListener('keydown', (event) => {
        if (event.key === 'Escape') {
            event.preventDefault();
            finishNoteEdit(annotation.id, input, noteBox);
        }
    });

    noteBox.appendChild(handle);
    noteBox.appendChild(input);
    layer.appendChild(noteBox);
}

function createLineSvg(points, className, annotation = null) {
    const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
    svg.classList.add(...className.split(' '));
    if (annotation) {
        svg.dataset.annotationId = annotation.id;
        svg.addEventListener('pointerdown', (event) => eraseLineIfActive(event, annotation.id));
    }
    svg.setAttribute('viewBox', '0 0 1 1');
    svg.setAttribute('preserveAspectRatio', 'none');
    const polyline = document.createElementNS('http://www.w3.org/2000/svg', 'polyline');
    polyline.setAttribute('points', points.map((point) => `${point.x},${point.y}`).join(' '));
    svg.appendChild(polyline);
    return svg;
}

function startNoteDrag(event, annotationId, noteBox) {
    event.preventDefault();
    event.stopPropagation();
    selectAnnotation(annotationId);
    const annotation = findAnnotation(annotationId);
    if (!annotation?.box) {
        return;
    }
    noteBox.setPointerCapture?.(event.pointerId);
    state.noteDrag = {
        pointerId: event.pointerId,
        annotationId,
        startX: event.clientX,
        startY: event.clientY,
        box: { ...annotation.box }
    };
    window.addEventListener('pointermove', onNoteDragMove);
    window.addEventListener('pointerup', onNoteDragEnd, { once: true });
    window.addEventListener('pointercancel', onNoteDragEnd, { once: true });
}

function onNoteDragMove(event) {
    if (!state.noteDrag || state.noteDrag.pointerId !== event.pointerId) {
        return;
    }
    const annotation = findAnnotation(state.noteDrag.annotationId);
    const pageNode = annotation ? pageElementForPage(annotation.page) : null;
    const pageRect = pageNode?.getBoundingClientRect();
    if (!annotation?.box || !pageRect?.width || !pageRect?.height) {
        return;
    }
    const x = clamp(state.noteDrag.box.x + (event.clientX - state.noteDrag.startX) / pageRect.width, 0, 1 - annotation.box.width);
    const y = clamp(state.noteDrag.box.y + (event.clientY - state.noteDrag.startY) / pageRect.height, 0, 1 - annotation.box.height);
    updateAnnotation(annotation.id, { box: { ...annotation.box, x, y } }, { render: false });
    const node = pageNode.querySelector(`.annotation-note-box[data-annotation-id="${cssEscape(annotation.id)}"]`);
    if (node instanceof HTMLElement) {
        node.style.left = `${x * 100}%`;
        node.style.top = `${y * 100}%`;
    }
}

function onNoteDragEnd(event) {
    if (state.noteDrag) {
        const annotationId = state.noteDrag.annotationId;
        const noteBox = elements.page.querySelector(`.annotation-note-box[data-annotation-id="${cssEscape(annotationId)}"]`);
        if (noteBox instanceof HTMLElement) {
            persistNoteBoxGeometry(annotationId, noteBox);
        }
    }
    window.removeEventListener('pointermove', onNoteDragMove);
    window.removeEventListener('pointercancel', onNoteDragEnd);
    state.noteDrag = null;
}

function persistNoteBoxGeometry(annotationId, noteBox) {
    const annotation = findAnnotation(annotationId);
    const pageRect = annotation ? pageElementForPage(annotation.page)?.getBoundingClientRect() : null;
    if (!annotation?.box || !pageRect?.width || !pageRect?.height) {
        return;
    }
    const boxRect = noteBox.getBoundingClientRect();
    const nextBox = {
        x: clamp((boxRect.left - pageRect.left) / pageRect.width, 0, 0.98),
        y: clamp((boxRect.top - pageRect.top) / pageRect.height, 0, 0.98),
        width: clamp(boxRect.width / pageRect.width, 0.06, 0.95),
        height: clamp(boxRect.height / pageRect.height, 0.035, 0.9)
    };
    nextBox.x = clamp(nextBox.x, 0, 1 - nextBox.width);
    nextBox.y = clamp(nextBox.y, 0, 1 - nextBox.height);
    updateAnnotation(annotationId, { box: nextBox }, { render: false });
}

function beginNoteEdit(annotationId) {
    state.selectedAnnotationId = annotationId;
    state.editingNoteId = annotationId;
    armNoteEditGuard();
    renderAnnotationsForCurrentPage();
    updateAnnotationControls();
    focusNoteInput(annotationId);
}

function armNoteEditGuard() {
    state.noteEditGuardUntil = performance.now() + 350;
}

function handleNoteInputBlur(annotationId, input, noteBox) {
    if (state.editingNoteId !== annotationId) {
        return;
    }
    const waitMs = state.noteEditGuardUntil - performance.now();
    if (waitMs > 0) {
        window.setTimeout(() => {
            if (state.editingNoteId === annotationId && noteBox.isConnected && document.activeElement !== input) {
                input.focus();
                placeCaretAtEnd(input);
            }
        }, waitMs + 20);
        return;
    }
    finishNoteEdit(annotationId, input, noteBox);
}

function finishActiveNoteEdit() {
    const annotationId = state.editingNoteId;
    if (!annotationId) {
        return;
    }
    const noteBox = elements.page.querySelector(`.annotation-note-box[data-annotation-id="${cssEscape(annotationId)}"]`);
    const input = noteBox instanceof HTMLElement ? noteBox.querySelector('.annotation-note-input') : null;
    if (noteBox instanceof HTMLElement && input instanceof HTMLTextAreaElement) {
        finishNoteEdit(annotationId, input, noteBox);
        return;
    }
    state.editingNoteId = '';
    updateAnnotationControls();
}

function finishNoteEdit(annotationId, input, noteBox) {
    if (state.editingNoteId !== annotationId) {
        return;
    }
    if (!input.value.trim()) {
        state.editingNoteId = '';
        deleteAnnotation(annotationId, 'annotation.note.empty_delete');
        return;
    }
    updateAnnotation(annotationId, { note: input.value }, { render: false });
    persistNoteBoxGeometry(annotationId, noteBox);
    if (state.editingNoteId === annotationId) {
        state.editingNoteId = '';
    }
    renderAnnotationsForCurrentPage();
    updateAnnotationControls();
    logClient('annotation.note.edit_done', {
        page: state.currentPage,
        textLength: input.value.length
    });
}

function deleteSelectedNote() {
    const annotation = findAnnotation(state.selectedAnnotationId);
    if (!annotation || annotation.type !== 'note') {
        return;
    }
    deleteAnnotation(annotation.id, 'annotation.note.delete');
}

function selectAnnotation(annotationId, options = {}) {
    const annotation = findAnnotation(annotationId);
    if (annotation?.page) {
        state.currentPage = annotation.page;
    }
    state.selectedAnnotationId = annotationId;
    applySelectedAnnotationClass(annotationId);
    updateAnnotationControls();
    if (options.render) {
        renderAnnotationsForCurrentPage();
    }
    if (options.focus) {
        state.editingNoteId = annotationId;
        armNoteEditGuard();
        renderAnnotationsForCurrentPage();
        updateAnnotationControls();
        focusNoteInput(annotationId);
    }
}

function focusNoteInput(annotationId) {
    requestAnimationFrame(() => {
        const noteBox = elements.page.querySelector(`.annotation-note-box[data-annotation-id="${cssEscape(annotationId)}"]`);
        const input = noteBox instanceof HTMLElement ? noteBox.querySelector('.annotation-note-input') : null;
        if (input instanceof HTMLTextAreaElement) {
            input.focus();
            placeCaretAtEnd(input);
        }
    });
}

function applySelectedAnnotationClass(annotationId) {
    elements.page.querySelectorAll('.annotation-note-box').forEach((node) => {
        if (node instanceof HTMLElement) {
            node.classList.toggle('selected', node.dataset.annotationId === annotationId);
            node.classList.toggle('editing', node.dataset.annotationId === state.editingNoteId);
        }
    });
}

function adjustSelectedNoteFont(delta) {
    const annotation = findAnnotation(state.selectedAnnotationId);
    if (!annotation || annotation.type !== 'note') {
        return;
    }
    const nextSize = clamp((annotation.fontSizeRatio || 0.026) + delta, 0.014, 0.07);
    updateAnnotation(annotation.id, { fontSizeRatio: nextSize });
    logClient('annotation.note.font', {
        page: annotation.page,
        fontSizeRatio: Number(nextSize.toFixed(4))
    });
}

function updateAnnotation(annotationId, patch, options = {}) {
    const docAnnotations = annotationsForDocument();
    const entry = findAnnotationEntry(annotationId);
    if (!entry) {
        return;
    }
    const pageKey = entry.pageKey;
    const pageAnnotations = docAnnotations[pageKey] || [];
    const index = entry.index;
    pageAnnotations[index] = { ...pageAnnotations[index], ...patch };
    docAnnotations[pageKey] = pageAnnotations;
    state.annotations[state.annotationDocKey] = docAnnotations;
    saveAnnotations();
    if (options.render !== false) {
        renderAnnotationsForCurrentPage();
    }
    updateAnnotationControls();
}

function findAnnotation(annotationId) {
    return findAnnotationEntry(annotationId)?.annotation || null;
}

function findAnnotationEntry(annotationId) {
    if (!annotationId) {
        return null;
    }
    const docAnnotations = annotationsForDocument();
    const currentPageKey = String(state.currentPage);
    const currentPageAnnotations = docAnnotations[currentPageKey] || [];
    const currentIndex = currentPageAnnotations.findIndex((annotation) => annotation.id === annotationId);
    if (currentIndex !== -1) {
        return {
            pageKey: currentPageKey,
            index: currentIndex,
            annotation: currentPageAnnotations[currentIndex]
        };
    }
    for (const [pageKey, pageAnnotations] of Object.entries(docAnnotations)) {
        const index = pageAnnotations.findIndex((annotation) => annotation.id === annotationId);
        if (index !== -1) {
            return { pageKey, index, annotation: pageAnnotations[index] };
        }
    }
    return null;
}

function eraseLineIfActive(event, annotationId) {
    if (!elements.eraserMode.checked) {
        return;
    }
    event.preventDefault();
    event.stopPropagation();
    deleteAnnotation(annotationId, 'annotation.line.erase');
}

function deleteAnnotation(annotationId, eventName = 'annotation.delete') {
    const docAnnotations = annotationsForDocument();
    const entry = findAnnotationEntry(annotationId);
    if (!entry) {
        return;
    }
    const pageKey = entry.pageKey;
    const before = docAnnotations[pageKey] || [];
    const after = before.filter((annotation) => annotation.id !== annotationId);
    if (after.length === before.length) {
        return;
    }
    docAnnotations[pageKey] = after;
    state.annotations[state.annotationDocKey] = docAnnotations;
    if (state.selectedAnnotationId === annotationId) {
        state.selectedAnnotationId = '';
    }
    if (state.editingNoteId === annotationId) {
        state.editingNoteId = '';
    }
    saveAnnotations();
    renderAnnotationsForCurrentPage();
    updateAnnotationControls();
    logClient(eventName, { page: Number(pageKey) });
}

function noteBoxForSelection(selection) {
    const rects = selection.rects || [];
    if (!rects.length) {
        return null;
    }
    const left = Math.min(...rects.map((rect) => rect.x));
    const top = Math.min(...rects.map((rect) => rect.y));
    const right = Math.max(...rects.map((rect) => rect.x + rect.width));
    const bottom = Math.max(...rects.map((rect) => rect.y + rect.height));
    const width = clamp(Math.max(right - left, 0.22), 0.12, 0.55);
    const height = clamp(Math.max(bottom - top + 0.04, 0.075), 0.05, 0.28);
    return {
        x: clamp(left, 0, 1 - width),
        y: clamp(bottom + 0.012, 0, 1 - height),
        width,
        height
    };
}

function placeCaretAtEnd(node) {
    if (node instanceof HTMLTextAreaElement || node instanceof HTMLInputElement) {
        const end = node.value.length;
        node.setSelectionRange(end, end);
        return;
    }
    const range = document.createRange();
    range.selectNodeContents(node);
    range.collapse(false);
    const selection = window.getSelection();
    selection?.removeAllRanges();
    selection?.addRange(range);
}

function cssEscape(value) {
    return String(value).replace(/["\\]/g, '\\$&');
}

function noteAnchorForSelection(selection) {
    return noteAnchorForRects(selection.rects || []);
}

function noteAnchorForRects(rects) {
    if (!rects.length) {
        return null;
    }
    const firstRect = [...rects].sort((a, b) => a.y - b.y || a.x - b.x)[0];
    const canPlaceAbove = firstRect.y > 0.06;
    return {
        x: clamp(firstRect.x + firstRect.width / 2, 0.05, 0.95),
        y: canPlaceAbove
            ? clamp(firstRect.y - 0.018, 0.02, 0.98)
            : clamp(firstRect.y + firstRect.height + 0.018, 0.02, 0.98),
        placement: canPlaceAbove ? 'above' : 'below'
    };
}

function annotationTitle(annotation) {
    const parts = annotation.text ? [annotation.text] : [];
    if (annotation.note) {
        parts.push(`笔记：${annotation.note}`);
    }
    return parts.join('\n');
}

function annotationsForDocument() {
    if (!state.annotationDocKey) {
        return {};
    }
    if (!state.annotations[state.annotationDocKey]) {
        state.annotations[state.annotationDocKey] = {};
    }
    return state.annotations[state.annotationDocKey];
}

function annotationsForPage(pageNumber) {
    return annotationsForDocument()[String(pageNumber)] || [];
}

function annotationKeyFor(name, pages) {
    return `${name || 'unnamed.pdf'}::${pages || 0}`;
}

async function translateSelection(text, source, options = {}) {
    if (state.translationAbort) {
        state.translationAbort.abort();
    }
    const controller = new AbortController();
    state.translationAbort = controller;
    const pageContext = options.pageContext || '';
    const images = options.images || [];
    elements.translationOutput.innerHTML = '';
    const node = document.createElement('div');
    node.className = 'translation-result';
    updateMarkdownNode(node, '');
    elements.translationOutput.appendChild(node);
    state.activeTranslationNode = node;
    logClient('translate.fetch.start', {
        source,
        textLength: text.length,
        pageContextLength: pageContext.length,
        imageCount: images.length
    });

    try {
        let rawText = '';
        await streamAi({
            mode: 'translate',
            text,
            source,
            pageContext,
            images,
            signal: controller.signal,
            onFirstToken: (elapsedMs) => logClient('translate.first_token', { elapsedMs }),
            onDelta: (chunk) => {
                rawText += chunk;
                updateMarkdownNode(node, rawText);
            },
            onDone: (data) => logClient('translate.done', data)
        });
    } catch (error) {
        if (controller.signal.aborted) {
            logClient('translate.fetch.aborted');
        } else {
            updateMarkdownNode(node, `${node.dataset.rawText || ''}\n\n翻译失败：${messageOf(error)}`);
            logClient('translate.fetch.error', { message: messageOf(error) });
        }
    } finally {
        if (state.translationAbort === controller) {
            state.translationAbort = null;
            state.activeTranslationNode = null;
        }
        setBusy(false);
    }
}

async function onManualTranslationSubmit(event) {
    event.preventDefault();
    const text = elements.manualTranslationInput.value.trim();
    if (!text) {
        elements.manualTranslationInput.focus();
        flashStatus('请输入要翻译的文本');
        logClient('translate.manual.ignored', { reason: 'empty' });
        return;
    }

    logClient('translate.manual.submit', { textLength: text.length });
    await translateSelection(text, '手动输入');
}

async function explainCurrentPage() {
    const pageNumber = state.currentPage;
    if (!state.pdfDoc) {
        flashStatus('请先打开 PDF');
        logClient('page.action.ignored', { action: 'explain', reason: 'no-pdf' });
        return;
    }
    setPaneCollapsed('assistant', false);
    const source = `${state.fileName || 'PDF'} p.${pageNumber} 全页`;
    logClient('page.explain.start', { page: pageNumber });
    try {
        const image = await capturePageImage(pageNumber, { kind: 'page', namePrefix: 'page-explain' });
        await explainText('请根据图片和页面上下文，结构化讲解当前整页内容。', {
            mode: 'ask',
            source,
            pageContext: await buildPageContext(pageNumber),
            selectionContext: await getPageText(pageNumber),
            history: state.explainHistory,
            userVisibleText: `讲解本页：${source}`,
            images: [image]
        });
    } catch (error) {
        appendMessage('assistant', `讲解本页失败：${messageOf(error)}`);
        logClient('page.explain.error', { page: pageNumber, message: messageOf(error) });
    }
}

async function translateCurrentPage() {
    const pageNumber = state.currentPage;
    if (!state.pdfDoc) {
        flashStatus('请先打开 PDF');
        logClient('page.action.ignored', { action: 'translate', reason: 'no-pdf' });
        return;
    }
    setPaneCollapsed('translation', false);
    const source = `${state.fileName || 'PDF'} p.${pageNumber} 全页`;
    logClient('page.translate.start', { page: pageNumber });
    try {
        const [image, pageText, pageContext] = await Promise.all([
            capturePageImage(pageNumber, { kind: 'page', namePrefix: 'page-translate' }),
            getPageText(pageNumber),
            buildPageContext(pageNumber)
        ]);
        const text = pageText || '请 OCR 当前页图片并翻译整页内容。';
        fillTranslationInput(pageText || `翻译本页：${source}`);
        await translateSelection(text, source, {
            pageContext,
            images: [image]
        });
    } catch (error) {
        setTranslationError(`翻译本页失败：${messageOf(error)}`);
        logClient('page.translate.error', { page: pageNumber, message: messageOf(error) });
    }
}

async function explainVisualSelectionFromAction(event) {
    event.preventDefault();
    const selection = state.visualSelection;
    if (!selection) {
        clearVisualSelection('empty-explain');
        return;
    }
    const pageNumber = selection.page;
    setPaneCollapsed('assistant', false);
    clearVisualSelection('visual-explain');
    try {
        const [image, pageContext] = await Promise.all([
            capturePageImage(pageNumber, {
                rect: selection.kind === 'region' ? selection.rect : null,
                kind: selection.kind,
                namePrefix: 'visual-explain'
            }),
            buildPageContext(pageNumber)
        ]);
        const label = selection.kind === 'region' ? '右键圈选区域' : '当前页';
        const source = `${state.fileName || 'PDF'} p.${pageNumber} ${label}`;
        logClient('visual.selection.explain', { page: pageNumber, kind: selection.kind });
        await explainText(`请识别并讲解${label}中的内容。`, {
            mode: 'ask',
            source,
            pageContext,
            selectionContext: await getPageText(pageNumber),
            history: state.explainHistory,
            userVisibleText: `讲解${label}：${source}`,
            images: [image]
        });
    } catch (error) {
        appendMessage('assistant', `截图讲解失败：${messageOf(error)}`);
        logClient('visual.selection.explain_error', { page: pageNumber, message: messageOf(error) });
    }
}

async function translateVisualSelectionFromAction(event) {
    event.preventDefault();
    const selection = state.visualSelection;
    if (!selection) {
        clearVisualSelection('empty-translate');
        return;
    }
    const pageNumber = selection.page;
    setPaneCollapsed('translation', false);
    clearVisualSelection('visual-translate');
    try {
        const [image, pageContext] = await Promise.all([
            capturePageImage(pageNumber, {
                rect: selection.kind === 'region' ? selection.rect : null,
                kind: selection.kind,
                namePrefix: 'visual-translate'
            }),
            buildPageContext(pageNumber)
        ]);
        const label = selection.kind === 'region' ? '右键圈选区域' : '当前页';
        const source = `${state.fileName || 'PDF'} p.${pageNumber} ${label}`;
        fillTranslationInput(`翻译${label}：${source}`);
        logClient('visual.selection.translate', { page: pageNumber, kind: selection.kind });
        await translateSelection(`请 OCR 并结构化翻译${label}图片内容。`, source, {
            pageContext,
            images: [image]
        });
    } catch (error) {
        setTranslationError(`截图翻译失败：${messageOf(error)}`);
        logClient('visual.selection.translate_error', { page: pageNumber, message: messageOf(error) });
    }
}

async function explainSelection(text, source, pageContext = '') {
    state.explainHistory = [];
    await explainText(text, {
        source,
        userVisibleText: text,
        pageContext,
        history: []
    });
}

async function explainText(text, options = {}) {
    if (state.explainAbort) {
        state.explainAbort.abort();
    }
    const controller = new AbortController();
    state.explainAbort = controller;
    const source = options.source || `${state.fileName || 'PDF'} p.${state.currentPage}`;
    const mode = options.mode || 'explain';
    const question = options.question || '';
    const pageContext = options.pageContext || '';
    const selectionContext = options.selectionContext || '';
    const images = options.images || [];
    const userVisibleText = options.userVisibleText || question || text;
    appendMessage('user', userVisibleText, source, { scroll: false, images });
    const assistantNode = appendMessage('assistant', '', 'AI', { scroll: false });
    const assistantBody = assistantNode.querySelector('.body');
    state.activeAssistantNode = assistantBody;
    scrollMessageToStart(assistantNode);
    setBusy(true, '生成中');
    logClient('explain.fetch.start', {
        source,
        mode,
        textLength: text.length,
        pageContextLength: pageContext.length,
        selectionContextLength: selectionContext.length,
        imageCount: images.length,
        hasQuestion: Boolean(question),
        historyLength: options.history?.length || 0
    });

    let assistantText = '';
    try {
        await streamAi({
            mode,
            text,
            source,
            question,
            pageContext,
            selectionContext,
            history: options.history || [],
            images,
            signal: controller.signal,
            onFirstToken: (elapsedMs) => logClient('explain.first_token', { elapsedMs }),
            onDelta: (chunk) => {
                assistantText += chunk;
                updateMarkdownNode(assistantBody, assistantText);
            },
            onDone: (data) => logClient('explain.done', data)
        });

        const imageHistorySuffix = images.length ? `\n[附图：${images.map((image) => image.name).join(', ')}]` : '';
        const userHistoryContent = `${question || text}${imageHistorySuffix}`;
        state.explainHistory = [
            ...(options.history || []),
            { role: 'user', content: userHistoryContent },
            { role: 'assistant', content: assistantText }
        ].slice(-8);
    } catch (error) {
        if (controller.signal.aborted) {
            logClient('explain.fetch.aborted');
        } else {
            assistantText += `\n\n请求失败：${messageOf(error)}`;
            updateMarkdownNode(assistantBody, assistantText);
            scrollMessageToStart(assistantNode);
            logClient('explain.fetch.error', { message: messageOf(error) });
        }
    } finally {
        if (state.explainAbort === controller) {
            state.explainAbort = null;
            state.activeAssistantNode = null;
        }
        setBusy(false);
    }
}

async function streamAi({ mode, text, source, question = '', pageContext = '', selectionContext = '', history = [], images = [], signal, onFirstToken, onDelta, onDone }) {
    const startedAt = performance.now();
    let firstTokenSeen = false;
    setBusy(true, mode === 'translate' ? '翻译中' : '生成中');

    const response = await fetch('/api/explain', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ mode, text, source, question, pageContext, selectionContext, history, images }),
        signal
    });

    if (!response.ok || !response.body) {
        const data = await response.json().catch(() => ({}));
        throw new Error(data.error || `HTTP ${response.status}`);
    }

    await readEventStream(response.body, (event, data) => {
        if (event === 'delta') {
            if (!firstTokenSeen) {
                firstTokenSeen = true;
                onFirstToken?.(Math.round(performance.now() - startedAt));
            }
            onDelta(String(data.text || ''));
        }
        if (event === 'done') {
            onDone?.(data);
        }
        if (event === 'error') {
            throw new Error(data.message || 'unknown error');
        }
    });
}

async function onImagesPicked(event) {
    const files = Array.from(event.target.files || []);
    await addImageFiles(files);
    event.target.value = '';
}

async function onQuestionPaste(event) {
    const files = Array.from(event.clipboardData?.files || [])
        .filter((file) => file.type.startsWith('image/'));
    if (!files.length) {
        return;
    }

    event.preventDefault();
    await addImageFiles(files);
}

function onImageAttachmentClick(event) {
    if (!(event.target instanceof Element)) {
        return;
    }
    const button = event.target.closest('[data-image-id]');
    if (!button) {
        return;
    }
    removeImageAttachment(button.dataset.imageId || '');
}

async function addImageFiles(files) {
    const imageFiles = files.filter((file) => /^image\/(png|jpe?g|webp|gif)$/i.test(file.type));
    if (!imageFiles.length) {
        appendMessage('assistant', '仅支持 PNG、JPG、WebP 或 GIF 图片。');
        logClient('image.attach.rejected', { reason: 'type' });
        return;
    }

    const remaining = MAX_IMAGE_ATTACHMENTS - state.imageAttachments.length;
    if (remaining <= 0) {
        appendMessage('assistant', `最多同时发送 ${MAX_IMAGE_ATTACHMENTS} 张图片。`);
        logClient('image.attach.rejected', { reason: 'count' });
        return;
    }

    const accepted = [];
    for (const file of imageFiles.slice(0, remaining)) {
        if (file.size > MAX_IMAGE_BYTES) {
            logClient('image.attach.rejected', {
                reason: 'size',
                name: file.name,
                size: file.size
            });
            continue;
        }

        accepted.push({
            id: createLocalId(),
            name: file.name || 'image',
            mimeType: file.type,
            size: file.size,
            dataUrl: await fileToDataUrl(file)
        });
    }

    if (!accepted.length) {
        appendMessage('assistant', `图片不能超过 ${formatBytes(MAX_IMAGE_BYTES)}。`);
        return;
    }

    state.imageAttachments = [...state.imageAttachments, ...accepted].slice(0, MAX_IMAGE_ATTACHMENTS);
    renderImageAttachments();
    logClient('image.attach.add', {
        count: accepted.length,
        total: state.imageAttachments.length,
        names: accepted.map((image) => image.name),
        sizes: accepted.map((image) => image.size)
    });
}

function removeImageAttachment(id) {
    const before = state.imageAttachments.length;
    state.imageAttachments = state.imageAttachments.filter((image) => image.id !== id);
    renderImageAttachments();
    if (state.imageAttachments.length !== before) {
        logClient('image.attach.remove', { total: state.imageAttachments.length });
    }
}

function renderImageAttachments() {
    elements.imageAttachments.innerHTML = '';
    elements.imageAttachments.hidden = state.imageAttachments.length === 0;
    for (const image of state.imageAttachments) {
        const item = document.createElement('div');
        item.className = 'image-chip';
        item.title = `${image.name} · ${formatBytes(image.size)}`;

        const preview = document.createElement('img');
        preview.src = image.dataUrl;
        preview.alt = image.name;

        const remove = document.createElement('button');
        remove.type = 'button';
        remove.dataset.imageId = image.id;
        remove.setAttribute('aria-label', `移除图片 ${image.name}`);
        remove.textContent = '×';

        item.append(preview, remove);
        elements.imageAttachments.appendChild(item);
    }
}

function clearImageAttachments() {
    state.imageAttachments = [];
    renderImageAttachments();
}

function publicImagesForRequest() {
    return state.imageAttachments.map((image) => ({
        name: image.name,
        mimeType: image.mimeType,
        dataUrl: image.dataUrl
    }));
}

function fileToDataUrl(file) {
    return new Promise((resolve, reject) => {
        const reader = new FileReader();
        reader.addEventListener('load', () => resolve(String(reader.result || '')));
        reader.addEventListener('error', () => reject(reader.error || new Error('Failed to read image.')));
        reader.readAsDataURL(file);
    });
}

function createLocalId() {
    return `${Date.now()}-${Math.random().toString(36).slice(2)}`;
}

function formatBytes(value) {
    if (value < 1024 * 1024) {
        return `${Math.max(1, Math.round(value / 1024))} KB`;
    }
    return `${(value / (1024 * 1024)).toFixed(1)} MB`;
}

async function capturePageImage(pageNumber, options = {}) {
    const sourceCanvas = canvasForPage(pageNumber);
    if (!sourceCanvas) {
        throw new Error(`Page ${pageNumber} is not rendered.`);
    }
    const rect = options.rect || { x: 0, y: 0, width: 1, height: 1 };
    const sx = clamp(Math.floor(rect.x * sourceCanvas.width), 0, sourceCanvas.width - 1);
    const sy = clamp(Math.floor(rect.y * sourceCanvas.height), 0, sourceCanvas.height - 1);
    const sw = clamp(Math.ceil(rect.width * sourceCanvas.width), 1, sourceCanvas.width - sx);
    const sh = clamp(Math.ceil(rect.height * sourceCanvas.height), 1, sourceCanvas.height - sy);
    const maxEdge = Number(options.maxEdge) || PAGE_IMAGE_MAX_EDGE;
    const scale = Math.min(1, maxEdge / Math.max(sw, sh));
    const targetWidth = Math.max(1, Math.round(sw * scale));
    const targetHeight = Math.max(1, Math.round(sh * scale));
    const canvas = document.createElement('canvas');
    canvas.width = targetWidth;
    canvas.height = targetHeight;
    const ctx = canvas.getContext('2d');
    if (!ctx) {
        throw new Error('Canvas is unavailable.');
    }
    ctx.drawImage(sourceCanvas, sx, sy, sw, sh, 0, 0, targetWidth, targetHeight);
    const dataUrl = canvas.toDataURL('image/png');
    const size = dataUrlByteLength(dataUrl);
    const name = `${options.namePrefix || 'page'}-p${pageNumber}-${options.kind || 'page'}.png`;
    logClient('pdf.image.capture', {
        page: pageNumber,
        kind: options.kind || 'page',
        width: targetWidth,
        height: targetHeight,
        size
    });
    return {
        name,
        mimeType: 'image/png',
        dataUrl,
        size
    };
}

function dataUrlByteLength(dataUrl) {
    const base64 = String(dataUrl || '').split(',')[1] || '';
    return Math.floor(base64.length * 3 / 4);
}

async function onQuestionSubmit(event) {
    event.preventDefault();
    const question = elements.questionInput.value.trim();
    const images = publicImagesForRequest();
    if (!question && !images.length) {
        return;
    }
    elements.questionInput.value = '';
    const selectionContext = getPdfSelectionText();
    clearImageAttachments();
    logClient('image.send', {
        count: images.length,
        names: images.map((image) => image.name)
    });
    const text = question || '请理解并讲解图片内容。';
    const sourceParts = [`${state.fileName || 'PDF'} p.${state.currentPage}`];
    if (selectionContext) {
        sourceParts.push('含当前选区参考');
    }
    if (images.length) {
        sourceParts.push(`图片 ${images.length} 张`);
    }
    await explainText(text, {
        mode: 'ask',
        source: sourceParts.join(' · '),
        pageContext: await buildPageContext(state.currentPage),
        selectionContext,
        history: state.explainHistory,
        userVisibleText: question || `发送图片：${images.map((image) => image.name).join(', ')}`,
        images
    });
}

function cancelActiveResponses() {
    if (state.translationAbort) {
        state.translationAbort.abort();
    }
    if (state.explainAbort) {
        state.explainAbort.abort();
    }
    logClient('response.cancel');
    setBusy(false);
}

async function readEventStream(body, onEvent) {
    const reader = body.getReader();
    const decoder = new TextDecoder();
    let buffer = '';
    while (true) {
        const { value, done } = await reader.read();
        if (done) {
            break;
        }
        buffer += decoder.decode(value, { stream: true });
        const events = buffer.split(/\r?\n\r?\n/);
        buffer = events.pop() || '';
        for (const eventText of events) {
            const parsed = parseSseEvent(eventText);
            if (parsed) {
                onEvent(parsed.event, parsed.data);
            }
        }
    }
}

function parseSseEvent(eventText) {
    let event = 'message';
    const dataLines = [];
    for (const line of eventText.split(/\r?\n/)) {
        if (line.startsWith('event:')) {
            event = line.slice(6).trim();
        } else if (line.startsWith('data:')) {
            dataLines.push(line.slice(5).trim());
        }
    }
    if (!dataLines.length) {
        return null;
    }
    return {
        event,
        data: JSON.parse(dataLines.join('\n'))
    };
}

function appendMessage(role, text, meta = '', options = {}) {
    const node = document.createElement('div');
    node.className = `message ${role}`;
    const metaNode = document.createElement('div');
    metaNode.className = 'meta';
    metaNode.textContent = meta || (role === 'user' ? '选区' : 'AI');
    const bodyNode = document.createElement('div');
    bodyNode.className = 'body';
    updateMarkdownNode(bodyNode, text);
    node.append(metaNode, bodyNode);
    if (options.images?.length) {
        const imagesNode = document.createElement('div');
        imagesNode.className = 'message-images';
        for (const image of options.images) {
            const preview = document.createElement('img');
            preview.src = image.dataUrl;
            preview.alt = image.name || 'attached image';
            imagesNode.appendChild(preview);
        }
        node.appendChild(imagesNode);
    }
    elements.messages.appendChild(node);
    if (options.scroll === 'start') {
        scrollMessageToStart(node);
    } else if (options.scroll !== false) {
        scrollMessagesToEnd();
    }
    return node;
}

function clearConversation() {
    elements.messages.innerHTML = '';
    state.explainHistory = [];
    logClient('conversation.clear');
}

function clearTranslation() {
    fillTranslationInput('');
    elements.translationOutput.innerHTML = '';
    setTranslationEmpty();
    logClient('translation.clear');
}

function setTranslationEmpty() {
    elements.translationOutput.innerHTML = '';
}

function setTranslationError(message) {
    elements.translationOutput.innerHTML = '';
    const node = document.createElement('div');
    node.className = 'translation-result';
    updateMarkdownNode(node, message);
    elements.translationOutput.appendChild(node);
}

function fillTranslationInput(text) {
    elements.manualTranslationInput.value = text;
}

function updateToolbar() {
    const pages = state.pdfDoc?.numPages || 0;
    elements.pageInfo.textContent = pages ? `/ ${pages}` : '/ -';
    elements.pageJumpInput.disabled = !pages;
    elements.pageJumpInput.max = pages ? String(pages) : '';
    elements.pageJumpInput.value = pages ? String(state.currentPage) : '';
    elements.pageSlider.disabled = !pages;
    elements.pageSlider.max = pages ? String(pages) : '1';
    elements.pageSlider.value = pages ? String(state.currentPage) : '1';
    elements.prevPage.disabled = !pages || state.currentPage <= 1;
    elements.nextPage.disabled = !pages || state.currentPage >= pages;
    updateAnnotationControls();
}

function updateAnnotationControls() {
    const hasPdf = Boolean(state.pdfDoc);
    const hasSelection = Boolean(
        state.pendingAnnotationSelection
        && state.pendingAnnotationSelection.page === state.currentPage
        && state.pendingAnnotationSelection.rects.length
    );
    const pageAnnotations = annotationsForPage(state.currentPage);
    const hasPageAnnotations = pageAnnotations.length > 0;
    const hasHighlights = pageAnnotations.some((annotation) => annotation.type === 'highlight');
    const selectedNote = findAnnotation(state.selectedAnnotationId);
    elements.addHighlight.disabled = !hasPdf || !hasSelection;
    elements.undoHighlight.disabled = !hasPdf || !hasHighlights;
    elements.addNote.disabled = !hasPdf;
    elements.addNote.classList.toggle('active-tool', hasPdf && state.notePlacementMode);
    elements.addNote.setAttribute('aria-pressed', String(hasPdf && state.notePlacementMode));
    elements.addNote.textContent = hasPdf && state.notePlacementMode ? '退出笔记' : '笔记';
    elements.lineMode.disabled = !hasPdf;
    elements.eraserMode.disabled = !hasPdf;
    elements.noteFontDown.disabled = !selectedNote || selectedNote.type !== 'note';
    elements.noteFontUp.disabled = !selectedNote || selectedNote.type !== 'note';
    elements.deleteNote.disabled = !selectedNote || selectedNote.type !== 'note';
    elements.noteFontInfo.textContent = selectedNote?.type === 'note'
        ? `${Math.round((selectedNote.fontSizeRatio || 0.026) * 1000)}`
        : '字号';
    elements.clearPageAnnotations.disabled = !hasPdf || !hasPageAnnotations;
    elements.page.classList.toggle('line-drawing-active', hasPdf && elements.lineMode.checked);
    elements.page.classList.toggle('note-placement-active', hasPdf && state.notePlacementMode);
    elements.page.classList.toggle('eraser-active', hasPdf && elements.eraserMode.checked);
}

function zoomStep() {
    if (state.scale <= 0.35) {
        return 0.05;
    }
    if (state.scale <= 0.8) {
        return 0.1;
    }
    return 0.15;
}

async function scaleForNewDocument() {
    const saved = Number(state.uiPrefs.scale);
    if (Number.isFinite(saved) && saved >= MIN_INITIAL_SCALE) {
        return clamp(saved, MIN_SCALE, MAX_SCALE);
    }
    return computeInitialScale();
}

async function computeInitialScale() {
    const fitScale = await computeFitWidthScale();
    return Math.max(MIN_INITIAL_SCALE, fitScale);
}

async function computeFitWidthScale() {
    if (!state.pdfDoc) {
        return DEFAULT_SCALE;
    }

    const page = await state.pdfDoc.getPage(1);
    const viewport = page.getViewport({ scale: 1 });
    const availableWidth = availableViewerWidth();
    const fitScale = availableWidth / viewport.width;
    return clamp(fitScale, MIN_SCALE, MAX_SCALE);
}

function availableViewerWidth() {
    return Math.max(
        VIEWER_MIN_AVAILABLE_WIDTH,
        (elements.viewer?.clientWidth || 0) - 56,
        Math.round((window.innerWidth || 0) * 0.42)
    );
}

async function buildPageContext(pageNumber) {
    if (!state.pdfDoc) {
        return '';
    }

    const from = Math.max(1, pageNumber - PDF_CONTEXT_RADIUS);
    const to = Math.min(state.pdfDoc.numPages, pageNumber + PDF_CONTEXT_RADIUS);
    const chunks = [];
    for (let page = from; page <= to; page += 1) {
        const text = await getPageText(page);
        if (text) {
            chunks.push(`[Page ${page}]\n${text}`);
        }
    }

    const context = chunks.join('\n\n');
    const trimmed = context.length > PAGE_CONTEXT_MAX_CHARS
        ? `${context.slice(0, PAGE_CONTEXT_MAX_CHARS)}\n...[context truncated]`
        : context;
    logClient('pdf.context.built', {
        page: pageNumber,
        from,
        to,
        contextLength: trimmed.length
    });
    return trimmed;
}

async function getPageText(pageNumber) {
    if (state.pageTextCache.has(pageNumber)) {
        return state.pageTextCache.get(pageNumber);
    }
    if (!state.pdfDoc) {
        return '';
    }

    const page = await state.pdfDoc.getPage(pageNumber);
    const textContent = await page.getTextContent();
    const text = textContentToPlainText(textContent);
    state.pageTextCache.set(pageNumber, text);
    return text;
}

function textContentToPlainText(textContent) {
    return (textContent.items || [])
        .map((item) => String(item.str || '').trim())
        .filter(Boolean)
        .join(' ')
        .replace(/\s+/g, ' ')
        .trim();
}

function scrollMessagesToEnd() {
    requestAnimationFrame(() => {
        elements.messages.scrollTop = elements.messages.scrollHeight;
    });
}

function scrollMessageToStart(node) {
    requestAnimationFrame(() => {
        const containerRect = elements.messages.getBoundingClientRect();
        const nodeRect = node.getBoundingClientRect();
        const top = Math.max(0, elements.messages.scrollTop + nodeRect.top - containerRect.top - 8);
        elements.messages.scrollTop = top;
        logClient('conversation.scroll.answer_start', { scrollTop: Math.round(top) });
    });
}

function updateMarkdownNode(node, rawText) {
    node.classList.add('markdown-content');
    node.dataset.rawText = String(rawText || '');
    node.innerHTML = renderMarkdown(node.dataset.rawText);
}

function renderMarkdown(rawText) {
    const codeBlocks = [];
    const text = String(rawText || '').replace(/```([^\n`]*)\n?([\s\S]*?)```/g, (_match, language, code) => {
        const index = codeBlocks.push({
            language: String(language || '').trim(),
            code: String(code || '')
        }) - 1;
        return `\u0000CODE${index}\u0000`;
    });
    const lines = text.replace(/\r\n/g, '\n').split('\n');
    const html = [];
    let paragraph = [];
    let listType = '';

    const flushParagraph = () => {
        if (!paragraph.length) {
            return;
        }
        html.push(`<p>${paragraph.map(formatInlineMarkdown).join('<br>')}</p>`);
        paragraph = [];
    };
    const closeList = () => {
        if (!listType) {
            return;
        }
        html.push(`</${listType}>`);
        listType = '';
    };
    const openList = (type) => {
        if (listType === type) {
            return;
        }
        closeList();
        listType = type;
        html.push(`<${type}>`);
    };

    for (let index = 0; index < lines.length; index += 1) {
        const line = lines[index];
        const trimmed = line.trim();
        const codeMatch = trimmed.match(/^\u0000CODE(\d+)\u0000$/);
        if (codeMatch) {
            flushParagraph();
            closeList();
            const block = codeBlocks[Number(codeMatch[1])] || { language: '', code: '' };
            const languageClass = block.language ? ` class="language-${escapeAttribute(block.language)}"` : '';
            html.push(`<pre><code${languageClass}>${escapeHtml(block.code)}</code></pre>`);
            continue;
        }
        if (!trimmed) {
            flushParagraph();
            closeList();
            continue;
        }

        const heading = trimmed.match(/^(#{1,3})\s+(.+)$/);
        if (heading) {
            flushParagraph();
            closeList();
            const level = heading[1].length + 2;
            html.push(`<h${level}>${formatInlineMarkdown(heading[2])}</h${level}>`);
            continue;
        }

        if (trimmed.startsWith('> ')) {
            flushParagraph();
            closeList();
            html.push(`<blockquote>${formatInlineMarkdown(trimmed.slice(2))}</blockquote>`);
            continue;
        }

        if (isMarkdownTableStart(lines, index)) {
            flushParagraph();
            closeList();
            const table = renderMarkdownTable(lines, index);
            html.push(table.html);
            index = table.endIndex;
            continue;
        }

        const unordered = trimmed.match(/^[-*]\s+(.+)$/);
        if (unordered) {
            flushParagraph();
            openList('ul');
            html.push(`<li>${formatInlineMarkdown(unordered[1])}</li>`);
            continue;
        }

        const ordered = trimmed.match(/^\d+[.)]\s+(.+)$/);
        if (ordered) {
            flushParagraph();
            openList('ol');
            html.push(`<li>${formatInlineMarkdown(ordered[1])}</li>`);
            continue;
        }

        paragraph.push(trimmed);
    }

    flushParagraph();
    closeList();
    return html.join('') || '';
}

function formatInlineMarkdown(text) {
    const links = [];
    const source = String(text || '').replace(/\[([^\]]+)\]\((https?:\/\/[^)\s]+)\)/g, (_match, label, href) => {
        const index = links.push({
            label: String(label || ''),
            href: String(href || '')
        }) - 1;
        return `\u0000LINK${index}\u0000`;
    });
    return escapeHtml(source)
        .replace(/\u0000LINK(\d+)\u0000/g, (_match, index) => {
            const link = links[Number(index)];
            if (!link) {
                return '';
            }
            return `<a href="${escapeAttribute(link.href)}" target="_blank" rel="noreferrer">${escapeHtml(link.label)}</a>`;
        })
        .replace(/`([^`]+)`/g, '<code>$1</code>')
        .replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>')
        .replace(/\*([^*]+)\*/g, '<em>$1</em>');
}

function isMarkdownTableStart(lines, index) {
    if (index + 1 >= lines.length) {
        return false;
    }
    const header = lines[index].trim();
    const separator = lines[index + 1].trim();
    return header.includes('|') && markdownTableSeparatorRegex().test(separator);
}

function markdownTableSeparatorRegex() {
    return /^\|?\s*:?-{3,}:?\s*(\|\s*:?-{3,}:?\s*)+\|?$/;
}

function renderMarkdownTable(lines, startIndex) {
    const headers = splitMarkdownTableRow(lines[startIndex]);
    const alignments = splitMarkdownTableRow(lines[startIndex + 1]).map(markdownTableAlignment);
    const rows = [];
    let endIndex = startIndex + 1;

    for (let index = startIndex + 2; index < lines.length; index += 1) {
        const trimmed = lines[index].trim();
        if (!trimmed || !trimmed.includes('|') || markdownTableSeparatorRegex().test(trimmed)) {
            break;
        }
        rows.push(splitMarkdownTableRow(lines[index]));
        endIndex = index;
    }

    const columnCount = Math.max(headers.length, ...rows.map((row) => row.length));
    const tableHead = headers.slice(0, columnCount).map((cell, index) => (
        `<th${markdownTableAlignAttribute(alignments[index])}>${formatInlineMarkdown(cell)}</th>`
    )).join('');
    const tableRows = rows.map((row) => {
        const cells = Array.from({ length: columnCount }, (_unused, index) => row[index] || '');
        return `<tr>${cells.map((cell, index) => (
            `<td${markdownTableAlignAttribute(alignments[index])}>${formatInlineMarkdown(cell)}</td>`
        )).join('')}</tr>`;
    }).join('');

    return {
        html: `<div class="markdown-table-wrap"><table><thead><tr>${tableHead}</tr></thead><tbody>${tableRows}</tbody></table></div>`,
        endIndex
    };
}

function splitMarkdownTableRow(row) {
    return String(row || '')
        .trim()
        .replace(/^\|/, '')
        .replace(/\|$/, '')
        .split('|')
        .map((cell) => cell.trim());
}

function markdownTableAlignment(cell) {
    const value = String(cell || '').trim();
    if (value.startsWith(':') && value.endsWith(':')) {
        return 'center';
    }
    if (value.endsWith(':')) {
        return 'right';
    }
    if (value.startsWith(':')) {
        return 'left';
    }
    return '';
}

function markdownTableAlignAttribute(alignment) {
    return alignment ? ` style="text-align: ${alignment}"` : '';
}

function escapeHtml(value) {
    return String(value)
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;');
}

function escapeAttribute(value) {
    return escapeHtml(value).replace(/"/g, '&quot;').replace(/'/g, '&#39;');
}

function loadUiPrefs() {
    try {
        const parsed = JSON.parse(localStorage.getItem(UI_PREFS_KEY) || '{}');
        return {
            autoTranslate: typeof parsed.autoTranslate === 'boolean' ? parsed.autoTranslate : true,
            autoExplain: typeof parsed.autoExplain === 'boolean' ? parsed.autoExplain : true,
            lineMode: false,
            eraserMode: false,
            visualSelectionStyle: parsed.visualSelectionStyle === VISUAL_SELECTION_STYLE_BOX
                ? VISUAL_SELECTION_STYLE_BOX
                : VISUAL_SELECTION_STYLE_PATH,
            readerMode: parsed.readerMode === READER_MODE_CONTINUOUS ? READER_MODE_CONTINUOUS : READER_MODE_SINGLE,
            scale: savedScalePreference(parsed),
            translationPaneWidth: savedPaneWidthPreference(
                parsed,
                'translationPaneWidth',
                LEGACY_TRANSLATION_PANE_WIDTH,
                defaultTranslationPaneWidth(),
                MIN_TRANSLATION_PANE_WIDTH,
                MAX_TRANSLATION_PANE_WIDTH
            ),
            assistantPaneWidth: savedPaneWidthPreference(
                parsed,
                'assistantPaneWidth',
                LEGACY_ASSISTANT_PANE_WIDTH,
                defaultAssistantPaneWidth(),
                MIN_ASSISTANT_PANE_WIDTH,
                MAX_ASSISTANT_PANE_WIDTH
            ),
            translationPaneCollapsed: typeof parsed.translationPaneCollapsed === 'boolean' ? parsed.translationPaneCollapsed : false,
            assistantPaneCollapsed: typeof parsed.assistantPaneCollapsed === 'boolean' ? parsed.assistantPaneCollapsed : false
        };
    } catch {
        return {
            autoTranslate: true,
            autoExplain: true,
            lineMode: false,
            eraserMode: false,
            visualSelectionStyle: VISUAL_SELECTION_STYLE_PATH,
            readerMode: READER_MODE_SINGLE,
            scale: null,
            translationPaneWidth: defaultTranslationPaneWidth(),
            assistantPaneWidth: defaultAssistantPaneWidth(),
            translationPaneCollapsed: false,
            assistantPaneCollapsed: false
        };
    }
}

function applyUiPrefs() {
    elements.autoTranslate.checked = state.uiPrefs.autoTranslate !== false;
    elements.autoExplain.checked = state.uiPrefs.autoExplain !== false;
    elements.lineMode.checked = state.uiPrefs.lineMode === true;
    elements.eraserMode.checked = state.uiPrefs.eraserMode === true;
    elements.visualSelectionStyle.value = state.uiPrefs.visualSelectionStyle === VISUAL_SELECTION_STYLE_BOX
        ? VISUAL_SELECTION_STYLE_BOX
        : VISUAL_SELECTION_STYLE_PATH;
    elements.readerMode.value = state.uiPrefs.readerMode === READER_MODE_CONTINUOUS
        ? READER_MODE_CONTINUOUS
        : READER_MODE_SINGLE;
    applyPaneLayoutPrefs();
    updateAnnotationControls();
}

function applyPaneLayoutPrefs() {
    const translationWidth = clamp(
        Number(state.uiPrefs.translationPaneWidth) || defaultTranslationPaneWidth(),
        MIN_TRANSLATION_PANE_WIDTH,
        MAX_TRANSLATION_PANE_WIDTH
    );
    const assistantWidth = clamp(
        Number(state.uiPrefs.assistantPaneWidth) || defaultAssistantPaneWidth(),
        MIN_ASSISTANT_PANE_WIDTH,
        MAX_ASSISTANT_PANE_WIDTH
    );
    const translationCollapsed = state.uiPrefs.translationPaneCollapsed === true;
    const assistantCollapsed = state.uiPrefs.assistantPaneCollapsed === true;

    state.uiPrefs.translationPaneWidth = translationWidth;
    state.uiPrefs.assistantPaneWidth = assistantWidth;
    elements.appShell.style.setProperty('--translation-pane-width', `${translationWidth}px`);
    elements.appShell.style.setProperty('--assistant-pane-width', `${assistantWidth}px`);
    elements.appShell.classList.toggle('translation-collapsed', translationCollapsed);
    elements.appShell.classList.toggle('assistant-collapsed', assistantCollapsed);
    elements.translationPane.setAttribute('aria-hidden', String(translationCollapsed));
    elements.assistantPane.setAttribute('aria-hidden', String(assistantCollapsed));
    elements.leftPaneResizer.setAttribute('aria-valuenow', String(Math.round(translationWidth)));
    elements.rightPaneResizer.setAttribute('aria-valuenow', String(Math.round(assistantWidth)));
    elements.restoreTranslation.hidden = !translationCollapsed;
    elements.restoreAssistant.hidden = !assistantCollapsed;
    elements.paneRestoreBar.hidden = !translationCollapsed && !assistantCollapsed;
}

function saveUiPrefs() {
    state.uiPrefs = {
        autoTranslate: elements.autoTranslate.checked,
        autoExplain: elements.autoExplain.checked,
        lineMode: elements.lineMode.checked,
        eraserMode: elements.eraserMode.checked,
        visualSelectionStyle: visualSelectionStyle(),
        readerMode: readerMode(),
        scale: state.scale,
        scalePreferenceVersion: DEFAULT_SCALE_PREF_VERSION,
        layoutPreferenceVersion: DEFAULT_LAYOUT_PREF_VERSION,
        translationPaneWidth: state.uiPrefs.translationPaneWidth || defaultTranslationPaneWidth(),
        assistantPaneWidth: state.uiPrefs.assistantPaneWidth || defaultAssistantPaneWidth(),
        translationPaneCollapsed: state.uiPrefs.translationPaneCollapsed === true,
        assistantPaneCollapsed: state.uiPrefs.assistantPaneCollapsed === true
    };
    localStorage.setItem(UI_PREFS_KEY, JSON.stringify(state.uiPrefs));
}

function visualSelectionStyle() {
    return elements.visualSelectionStyle.value === VISUAL_SELECTION_STYLE_BOX
        ? VISUAL_SELECTION_STYLE_BOX
        : VISUAL_SELECTION_STYLE_PATH;
}

function savedScalePreference(parsed) {
    const scale = Number(parsed.scale);
    if (!Number.isFinite(scale) || scale < MIN_SCALE || scale > MAX_SCALE) {
        return null;
    }
    if (Number(parsed.scalePreferenceVersion) === DEFAULT_SCALE_PREF_VERSION) {
        return scale;
    }
    return scale >= MIN_INITIAL_SCALE ? scale : null;
}

function savedPaneWidthPreference(parsed, key, legacyWidth, fallbackWidth, minWidth, maxWidth) {
    const width = Number(parsed[key]);
    if (!Number.isFinite(width)) {
        return fallbackWidth;
    }
    if (Number(parsed.layoutPreferenceVersion) === DEFAULT_LAYOUT_PREF_VERSION) {
        return clamp(width, minWidth, maxWidth);
    }
    if (Math.abs(width - legacyWidth) > 2) {
        return clamp(width, minWidth, maxWidth);
    }
    return fallbackWidth;
}

function defaultTranslationPaneWidth() {
    return clamp(Math.round(layoutBaseWidth() * DEFAULT_TRANSLATION_PANE_RATIO), MIN_TRANSLATION_PANE_WIDTH, MAX_TRANSLATION_PANE_WIDTH);
}

function defaultAssistantPaneWidth() {
    return clamp(Math.round(layoutBaseWidth() * DEFAULT_ASSISTANT_PANE_RATIO), MIN_ASSISTANT_PANE_WIDTH, MAX_ASSISTANT_PANE_WIDTH);
}

function layoutBaseWidth() {
    return Math.max(1100, elements.appShell?.clientWidth || window.innerWidth || 1440);
}

function readerMode() {
    return elements.readerMode?.value === READER_MODE_CONTINUOUS ? READER_MODE_CONTINUOUS : READER_MODE_SINGLE;
}

function upsertReadingFile(file) {
    state.readingFiles = [
        file,
        ...state.readingFiles.filter((entry) => entry.id !== file.id)
    ].sort((left, right) => String(right.updatedAt || '').localeCompare(String(left.updatedAt || '')));
    renderReadingFileList();
}

function formatReadingFileTime(value) {
    const date = new Date(value);
    if (!Number.isFinite(date.getTime())) {
        return '';
    }
    return date.toLocaleString('zh-CN', {
        year: 'numeric',
        month: '2-digit',
        day: '2-digit',
        hour: '2-digit',
        minute: '2-digit'
    });
}

function readFileAsDataUrl(file) {
    return new Promise((resolveRead, rejectRead) => {
        const reader = new FileReader();
        reader.addEventListener('load', () => resolveRead(String(reader.result || '')));
        reader.addEventListener('error', () => rejectRead(reader.error || new Error('File read failed.')));
        reader.readAsDataURL(file);
    });
}

function loadAnnotations() {
    try {
        const parsed = JSON.parse(localStorage.getItem(ANNOTATION_STORE_KEY) || '{}');
        return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed : {};
    } catch {
        return {};
    }
}

function saveAnnotations() {
    if (state.activeReadingFileId) {
        const notes = state.annotationDocKey ? state.annotations[state.annotationDocKey] || {} : {};
        queueReadingFileNotesSave(state.activeReadingFileId, notes);
        return;
    }

    try {
        localStorage.setItem(ANNOTATION_STORE_KEY, JSON.stringify(state.annotations));
    } catch (error) {
        logClient('annotation.save.error', { message: messageOf(error) });
    }
}

function queueReadingFileNotesSave(id, notes) {
    window.clearTimeout(state.annotationSaveTimer);
    state.pendingAnnotationSave = { id, notes };
    state.annotationSaveTimer = window.setTimeout(() => {
        void flushPendingAnnotationSave();
    }, 260);
}

async function flushPendingAnnotationSave() {
    window.clearTimeout(state.annotationSaveTimer);
    state.annotationSaveTimer = 0;
    const pending = state.pendingAnnotationSave;
    if (!pending) {
        return;
    }
    state.pendingAnnotationSave = null;

    try {
        const response = await fetch(`/api/reading-files/${encodeURIComponent(pending.id)}/notes`, {
            method: 'PUT',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ notes: pending.notes })
        });
        const payload = await readJsonResponse(response);
        const file = parseReadingFile(payload.file);
        if (file) {
            upsertReadingFile(file);
        }
        logClient('reading_file.notes.saved', { id: pending.id });
    } catch (error) {
        flashStatus('批注保存失败');
        logClient('reading_file.notes.save_error', { id: pending.id, message: messageOf(error) });
    }
}

function flashStatus(label) {
    elements.connectionStatus.textContent = label;
    window.setTimeout(() => {
        if (!state.translationAbort && !state.explainAbort) {
            elements.connectionStatus.textContent = providerLabel();
        }
    }, 1600);
}

function setBusy(busy, label = '') {
    elements.connectionStatus.textContent = label || (busy ? '处理中' : providerLabel());
    elements.connectionStatus.classList.toggle('busy', busy);
    elements.cancelResponse.disabled = !state.translationAbort && !state.explainAbort;
}

function providerLabel() {
    if (!state.settings) {
        return '就绪';
    }
    const provider = state.settings.provider;
    return `${provider.preset || provider.kind} / ${provider.model}${provider.apiKeyConfigured ? '' : ' / no key'}`;
}

async function getJson(url) {
    const response = await fetch(url);
    return readJsonResponse(response);
}

async function readJsonResponse(response) {
    if (!response.ok) {
        let detail = '';
        try {
            detail = String((await response.json()).error || '');
        } catch {
            detail = '';
        }
        throw new Error(detail || `HTTP ${response.status}`);
    }
    return response.json();
}

function isPlainObject(value) {
    return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

function logClient(event, data = {}) {
    const line = `[${new Date().toISOString()}] ${event} ${JSON.stringify(data)}`;
    elements.clientLog.textContent = `${line}\n${elements.clientLog.textContent}`.slice(0, 14000);
    console.debug(`[AI PDF Tutor] ${event}`, data);
    fetch('/api/logs/client', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ event, ...data })
    }).catch(() => undefined);
}

function publicSettingsLog(settings) {
    return {
        providerKind: settings.provider.kind,
        providerPreset: settings.provider.preset,
        protocol: settings.provider.protocol,
        endpoint: settings.provider.endpoint,
        model: settings.provider.model,
        apiKeyConfigured: settings.provider.apiKeyConfigured
    };
}

function messageOf(error) {
    return error instanceof Error ? error.message : String(error);
}

function clamp(value, min, max) {
    return Math.max(min, Math.min(max, value));
}

function normalizeSelectionText(rawText) {
    return String(rawText || '').replace(/\s+/g, ' ').trim();
}
