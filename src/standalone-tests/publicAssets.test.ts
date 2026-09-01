import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import test from 'node:test';

const appJs = readFileSync(resolve(__dirname, '../../public/app.js'), 'utf8');
const indexHtml = readFileSync(resolve(__dirname, '../../public/index.html'), 'utf8');
const stylesCss = readFileSync(resolve(__dirname, '../../public/styles.css'), 'utf8');
const packageJson = readFileSync(resolve(__dirname, '../../package.json'), 'utf8');
const desktopMainTs = readFileSync(resolve(__dirname, '../../src/desktop/main.ts'), 'utf8');
const visualActionsSmoke = readFileSync(resolve(__dirname, '../../scripts/visual-actions-smoke.cjs'), 'utf8');

test('front-end selection gate is defined before it is instantiated', () => {
    const classIndex = appJs.indexOf('class SelectionGate');
    const instanceIndex = appJs.indexOf('new SelectionGate');

    assert.notEqual(classIndex, -1);
    assert.notEqual(instanceIndex, -1);
    assert.ok(classIndex < instanceIndex);
});

test('front-end script remains syntactically valid JavaScript', () => {
    assert.doesNotThrow(() => new Function(appJs.replace('await boot();', '')));
});

test('front-end auto explain only probes selection after mouse release', () => {
    assert.ok(appJs.includes("document.addEventListener('mouseup'"));
    assert.ok(appJs.includes("document.addEventListener('pointerup', onDocumentSelectionPointerUp"));
    assert.ok(appJs.includes('function queueTextSelectionProbe'));
    assert.ok(appJs.includes('if (getPdfSelectionText())'));
    assert.equal(appJs.includes("document.addEventListener('selectionchange'"), false);
});

test('front-end only submits API keys typed in the current session', () => {
    assert.ok(appJs.includes('apiKeyTouched: false'));
    assert.ok(indexHtml.includes('id="apiKeyState"'));
    assert.ok(appJs.includes("elements.apiKey.addEventListener('input'"));
    assert.ok(appJs.includes('function updateApiKeyState'));
    assert.ok(appJs.includes('切换服务商后需要输入对应 key'));
    assert.ok(appJs.includes('state.apiKeyTouched && elements.providerKind.value !=='));
    assert.ok(appJs.includes('state.apiKeyTouched = false'));
});

test('front-end exposes prompt template settings', () => {
    assert.ok(appJs.includes('systemPrompt: document.getElementById'));
    assert.ok(appJs.includes('explainPromptTemplate: elements.explainPromptTemplate.value'));
    assert.ok(appJs.includes('translatePromptTemplate: elements.translatePromptTemplate.value'));
    assert.ok(appJs.includes('followupPromptTemplate: elements.followupPromptTemplate.value'));
});

test('front-end keeps provider settings in a drawer instead of the primary reader chrome', () => {
    assert.ok(indexHtml.includes('id="settingsToggle"'));
    assert.ok(indexHtml.includes('id="settingsBackdrop"'));
    assert.ok(indexHtml.includes('class="settings-drawer"'));
    assert.ok(indexHtml.includes('class="toolbar-group'));
    assert.equal(indexHtml.includes('class="app-header"'), false);
    assert.equal(stylesCss.includes('.app-header'), false);
    assert.equal(stylesCss.includes('.header-actions'), false);
    assert.equal(indexHtml.includes('class="brand"'), false);
    assert.equal(indexHtml.includes('class="brand-mark"'), false);
    assert.ok(appJs.includes('function setSettingsOpen'));
    assert.ok(appJs.includes("elements.settingsToggle.addEventListener('click'"));
    assert.ok(stylesCss.includes('.settings-drawer'));
    assert.ok(stylesCss.includes('.toolbar-group'));
});

test('front-end exposes OpenAI and DeepSeek provider presets', () => {
    assert.ok(indexHtml.includes('value="openai"'));
    assert.ok(indexHtml.includes('OpenAI / GPT'));
    assert.ok(indexHtml.includes('value="deepseek"'));
    assert.ok(indexHtml.includes('DeepSeek'));
    assert.ok(indexHtml.includes('value="custom"'));
    assert.ok(appJs.includes('const PROVIDER_PRESETS'));
    assert.ok(appJs.includes('https://api.openai.com/v1/chat/completions'));
    assert.ok(appJs.includes('https://api.deepseek.com/chat/completions'));
    assert.ok(appJs.includes('deepseek-v4-pro'));
    assert.ok(appJs.includes('function providerPresetFromSettings'));
    assert.ok(appJs.includes('preset: elements.providerKind.value'));
});

test('front-end builds hidden PDF context and anchors new assistant replies at their start', () => {
    assert.ok(appJs.includes('buildPageContext(selectionSnapshot.page)'));
    assert.ok(appJs.includes('buildPageContext(state.currentPage)'));
    assert.ok(appJs.includes('pageContextLength: pageContext.length'));
    assert.ok(appJs.includes('body: JSON.stringify({ mode, text, source, question, pageContext, selectionContext, history, images })'));
    assert.ok(appJs.includes('scrollMessageToStart(assistantNode)'));
    assert.equal(appJs.includes('scrollMessagesToLatest()'), false);
});

test('front-end renders markdown and persists reader preferences', () => {
    assert.ok(appJs.includes('function renderMarkdown'));
    assert.ok(appJs.includes('updateMarkdownNode(assistantBody, assistantText)'));
    assert.ok(appJs.includes('updateMarkdownNode(node, rawText)'));
    assert.ok(appJs.includes("node.classList.add('markdown-content')"));
    assert.ok(appJs.includes('function renderMarkdownTable'));
    assert.ok(stylesCss.includes('.markdown-content table'));
    assert.ok(stylesCss.includes('.markdown-content blockquote'));
    assert.ok(appJs.includes('localStorage.setItem(UI_PREFS_KEY'));
    assert.ok(appJs.includes('const DEFAULT_SCALE = 2.32'));
    assert.ok(appJs.includes('DEFAULT_SCALE_PREF_VERSION'));
    assert.ok(appJs.includes('DEFAULT_LAYOUT_PREF_VERSION'));
});

test('front-end supports wheel and keyboard page navigation', () => {
    assert.ok(appJs.includes("elements.viewer.addEventListener('wheel', onViewerWheel"));
    assert.ok(appJs.includes("document.addEventListener('keydown', onPdfKeydown)"));
    assert.ok(appJs.includes("event.key === 'ArrowRight' || event.key === 'PageDown'"));
    assert.ok(appJs.includes("event.key === 'ArrowLeft' || event.key === 'PageUp'"));
    assert.ok(appJs.includes("turnPageFromInput(1, 'wheel', 'top')"));
});

test('front-end supports visible PDF reader scrollbars and direct page jumping', () => {
    const toolbarHtml = indexHtml.slice(indexHtml.indexOf('<section class="file-toolbar">'), indexHtml.indexOf('<main id="appShell"'));
    const readerPaneHtml = indexHtml.slice(indexHtml.indexOf('<section class="reader-pane">'));

    assert.ok(indexHtml.includes('id="pageJumpInput"'));
    assert.equal(indexHtml.includes('id="pageJumpButton"'), false);
    assert.ok(indexHtml.includes('id="pageSlider"'));
    assert.equal(toolbarHtml.includes('id="pageJumpInput"'), false);
    assert.ok(readerPaneHtml.includes('class="reader-footer"'));
    assert.ok(appJs.includes('pageJumpInput: document.getElementById'));
    assert.ok(appJs.includes("elements.pageJumpInput.addEventListener('input', onPageJumpInput)"));
    assert.ok(appJs.includes('function onPageJumpInput'));
    assert.ok(appJs.includes('jumpToTypedPage'));
    assert.ok(appJs.includes('onPageSliderChange'));
    assert.ok(appJs.includes("gotoPage(targetPage, { trigger, scroll: 'top' })"));
    assert.ok(appJs.includes("logClient('pdf.page.jump_ignored'"));
    assert.ok(stylesCss.includes('.viewer::-webkit-scrollbar'));
    assert.ok(stylesCss.includes('scrollbar-gutter: stable both-edges'));
    assert.ok(stylesCss.includes('.reader-footer'));
    assert.ok(stylesCss.includes('.page-slider'));
});

test('front-end keeps open zoom readable while retaining fit-width zoom out', () => {
    assert.ok(appJs.includes('const MIN_SCALE = 0.05'));
    assert.ok(appJs.includes('const MIN_INITIAL_SCALE = 0.8'));
    assert.ok(appJs.includes('const VIEWER_MIN_AVAILABLE_WIDTH = 520'));
    assert.ok(appJs.includes('async function scaleForNewDocument'));
    assert.ok(appJs.includes('saved >= MIN_INITIAL_SCALE'));
    assert.ok(appJs.includes('return Math.max(MIN_INITIAL_SCALE, fitScale);'));
    assert.ok(appJs.includes('async function computeFitWidthScale'));
    assert.ok(appJs.includes('state.scale = await computeFitWidthScale();'));
    assert.ok(appJs.includes('return scale >= MIN_INITIAL_SCALE ? scale : null;'));
    assert.ok(appJs.includes('function availableViewerWidth'));
    assert.ok(appJs.includes('elements.zoomInfo.addEventListener'));
    assert.ok(appJs.includes('resetScaleToFit'));
    assert.ok(appJs.includes('function zoomStep'));
});

test('front-end supports selectable continuous PDF reading', () => {
    assert.ok(indexHtml.includes('id="readerMode"'));
    assert.ok(indexHtml.includes('value="continuous"'));
    assert.ok(appJs.includes("const READER_MODE_CONTINUOUS = 'continuous'"));
    assert.ok(appJs.includes('onReaderModeChanged'));
    assert.ok(appJs.includes('renderContinuousPages'));
    assert.ok(appJs.includes("logClient('pdf.continuous.render.done'"));
    assert.ok(appJs.includes('visibleContinuousPage'));
    assert.ok(appJs.includes('pageElementForPage'));
    assert.ok(stylesCss.includes('.page-stack'));
    assert.ok(stylesCss.includes('.page-stack.line-drawing-active .annotationLayer'));
});

test('front-end exposes local PDF annotation tools', () => {
    assert.ok(appJs.includes("const ANNOTATION_STORE_KEY = 'aiPdfTutor.annotations.v1'"));
    assert.ok(appJs.includes('addHighlightFromSelection'));
    assert.ok(indexHtml.includes('id="undoHighlight"'));
    assert.ok(appJs.includes('undoLastHighlight'));
    assert.ok(appJs.includes("annotation.highlight.undo"));
    assert.ok(appJs.includes('addNoteFromSelection'));
    assert.ok(appJs.includes('renderAnnotationsForPage'));
    assert.ok(appJs.includes('localStorage.setItem(ANNOTATION_STORE_KEY'));
});

test('front-end supports manual text translation without PDF selection', () => {
    assert.ok(indexHtml.includes('id="manualTranslationForm"'));
    assert.ok(indexHtml.includes('id="manualTranslationInput"'));
    assert.ok(indexHtml.includes('id="manualTranslationSubmit"'));
    assert.ok(appJs.includes('manualTranslationInput: document.getElementById'));
    assert.ok(appJs.includes('onManualTranslationSubmit'));
    assert.ok(appJs.includes("translateSelection(text, '手动输入')"));
    assert.ok(appJs.includes("logClient('translate.manual.submit'"));
});

test('front-end shows only manual selection actions whose auto trigger is off', () => {
    assert.ok(indexHtml.includes('id="selectionActions"'));
    assert.ok(indexHtml.includes('id="selectionExplain"'));
    assert.ok(indexHtml.includes('id="selectionTranslate"'));
    assert.ok(appJs.includes('selectionActionsSnapshot'));
    assert.ok(appJs.includes('const canExplain = Boolean(selectionSnapshot?.text) && !elements.autoExplain.checked'));
    assert.ok(appJs.includes('const canTranslate = Boolean(selectionSnapshot?.text) && !elements.autoTranslate.checked'));
    assert.ok(appJs.includes('elements.selectionExplain.hidden = !canExplain'));
    assert.ok(appJs.includes('elements.selectionTranslate.hidden = !canTranslate'));
    assert.ok(appJs.includes('if (!autoTranslateEnabled && !autoExplainEnabled)'));
    assert.ok(appJs.includes("logClient('selection.manual.ready'"));
    assert.ok(appJs.includes('explainSelectionFromAction'));
    assert.ok(appJs.includes('translateSelectionFromAction'));
    assert.ok(appJs.includes("logClient('selection.action.explain'"));
    assert.ok(appJs.includes("logClient('selection.action.translate'"));
    assert.ok(stylesCss.includes('.selection-actions'));
});

test('front-end supports resizable and collapsible side panes', () => {
    assert.ok(indexHtml.includes('id="appShell"'));
    assert.ok(indexHtml.includes('id="leftPaneResizer"'));
    assert.ok(indexHtml.includes('id="rightPaneResizer"'));
    assert.ok(indexHtml.includes('id="collapseTranslation"'));
    assert.ok(indexHtml.includes('id="collapseAssistant"'));
    assert.ok(indexHtml.includes('id="restoreTranslation"'));
    assert.ok(indexHtml.includes('id="restoreAssistant"'));
    assert.ok(appJs.includes('function startPaneResize'));
    assert.ok(appJs.includes('function setPaneCollapsed'));
    assert.ok(appJs.includes('translationPaneWidth'));
    assert.ok(appJs.includes('assistantPaneCollapsed'));
    assert.ok(appJs.includes("logClient('layout.resize.end'"));
    assert.ok(appJs.includes("logClient('layout.pane.toggle'"));
    assert.ok(stylesCss.includes('--translation-pane-width'));
    assert.ok(stylesCss.includes('22vw'));
    assert.ok(stylesCss.includes('26vw'));
    assert.ok(appJs.includes('DEFAULT_TRANSLATION_PANE_RATIO = 0.22'));
    assert.ok(appJs.includes('DEFAULT_ASSISTANT_PANE_RATIO = 0.26'));
    assert.ok(appJs.includes('savedPaneWidthPreference'));
    assert.ok(stylesCss.includes('grid-column: 3;'));
    assert.ok(stylesCss.includes('grid-column: 5;'));
    assert.ok(stylesCss.includes('.pane-resizer'));
    assert.ok(stylesCss.includes('.app-shell.translation-collapsed'));
    assert.ok(stylesCss.includes('.app-shell.assistant-collapsed'));
});

test('front-end renders editable note boxes and erasable freehand lines', () => {
    assert.ok(appJs.includes('annotation-note-text'));
    assert.ok(appJs.includes('annotation-note-box'));
    assert.ok(appJs.includes('annotation-note-input'));
    assert.ok(appJs.includes("document.createElement('textarea')"));
    assert.ok(appJs.includes('finishNoteEdit'));
    assert.ok(appJs.includes('deleteSelectedNote'));
    assert.ok(appJs.includes('annotation.note.delete'));
    assert.ok(appJs.includes('annotation.note.empty_delete'));
    assert.ok(appJs.includes('notePlacementMode'));
    assert.ok(appJs.includes('addTextBoxAnnotation'));
    assert.ok(appJs.includes('focusNoteInput(annotation.id)'));
    assert.ok(appJs.includes('adjustSelectedNoteFont'));
    assert.ok(appJs.includes('noteBoxForSelection'));
    assert.equal(appJs.includes('window.prompt'), false);
    assert.equal(appJs.includes('openNoteComposer'), false);
    assert.equal(appJs.includes('pendingFreeNoteText'), false);
    assert.ok(appJs.includes('lineMode: document.getElementById'));
    assert.ok(appJs.includes('eraserMode: document.getElementById'));
    assert.ok(appJs.includes('function resetTransientAnnotationTools'));
    assert.ok(appJs.includes('editMode: false'));
    assert.ok(appJs.includes('saveUiPrefs();'));
    assert.ok(appJs.includes("elements.page.addEventListener('pointerdown', onPagePointerDown)"));
    assert.ok(appJs.includes("type: 'line'"));
    assert.ok(appJs.includes("document.createElementNS('http://www.w3.org/2000/svg', 'polyline')"));
    assert.ok(appJs.includes('annotation.line.add'));
    assert.ok(appJs.includes('annotation.line.erase'));
    assert.ok(stylesCss.includes('.page-stack.eraser-active .annotation-line'));
});

test('front-end supports sending image attachments to AI', () => {
    assert.ok(indexHtml.includes('id="attachImage"'));
    assert.ok(indexHtml.includes('id="imageInput"'));
    assert.ok(indexHtml.includes('id="imageAttachments"'));
    assert.ok(indexHtml.includes('向 AI 提问，可附图'));
    assert.ok(appJs.includes('MAX_IMAGE_ATTACHMENTS'));
    assert.ok(appJs.includes("elements.attachImage.addEventListener('click'"));
    assert.ok(appJs.includes("elements.questionInput.addEventListener('paste', onQuestionPaste)"));
    assert.ok(appJs.includes('function addImageFiles'));
    assert.ok(appJs.includes('function publicImagesForRequest'));
    assert.ok(appJs.includes("logClient('image.attach.add'"));
    assert.ok(appJs.includes("logClient('image.send'"));
    assert.ok(appJs.includes('imageCount: images.length'));
    assert.ok(appJs.includes('message-images'));
});

test('front-end supports page image actions and right-click visual selection', () => {
    assert.ok(indexHtml.includes('id="explainPage"'));
    assert.ok(indexHtml.includes('id="translatePage"'));
    assert.ok(indexHtml.includes('id="visualActions"'));
    assert.ok(indexHtml.includes('id="visualExplain"'));
    assert.ok(indexHtml.includes('id="visualTranslate"'));
    assert.ok(indexHtml.includes('id="visualSelectionStyle"'));
    assert.ok(appJs.includes('PAGE_IMAGE_MAX_EDGE'));
    assert.ok(appJs.includes("elements.explainPage.addEventListener('click'"));
    assert.ok(appJs.includes("elements.viewer.addEventListener('contextmenu', onViewerContextMenu)"));
    assert.ok(appJs.includes('function capturePageImage'));
    assert.equal(appJs.includes('function drawVisualSelectionPath'), false);
    assert.ok(appJs.includes('function explainCurrentPage'));
    assert.ok(appJs.includes('function translateCurrentPage'));
    assert.ok(appJs.includes('function startVisualSelection'));
    assert.ok(appJs.includes('function onVisualSelectionStyleChanged'));
    assert.ok(appJs.includes('function visualSelectionStyle'));
    assert.ok(appJs.includes('VISUAL_SELECTION_STYLE_BOX'));
    assert.ok(appJs.includes('VISUAL_SELECTION_STYLE_PATH'));
    assert.ok(appJs.includes('function renderVisualSelection'));
    assert.ok(appJs.includes('function rawRectFromVisualDraft'));
    assert.ok(appJs.includes('function rawRectFromCorners'));
    assert.ok(appJs.includes('pointToPageRatioForPage(event, draft.page)'));
    assert.ok(appJs.includes('function padVisualSelectionRect'));
    assert.ok(appJs.includes('pushVisualSelectionPoint'));
    assert.ok(appJs.includes('function explainVisualSelectionFromAction'));
    assert.ok(appJs.includes('function translateVisualSelectionFromAction'));
    assert.ok(appJs.includes("logClient('pdf.image.capture'"));
    assert.ok(appJs.includes("logClient('visual.selection.ready'"));
    assert.ok(stylesCss.includes('.visual-selection-rect'));
    assert.ok(stylesCss.includes('.visual-selection-rect.path-only'));
    assert.ok(stylesCss.includes('.visual-selection-path'));
    assert.ok(stylesCss.includes('.visual-selection-path-halo'));
    assert.ok(stylesCss.includes('stroke-width: 5px'));
    assert.ok(stylesCss.includes('stroke-width: 4px'));
    assert.ok(appJs.includes('function visualSelectionPolylinePoints'));
    assert.ok(visualActionsSmoke.includes("clickVisualAction('visualExplain')"));
    assert.ok(visualActionsSmoke.includes("clickVisualAction('visualTranslate')"));
    assert.ok(visualActionsSmoke.includes('process.env.VISUAL_STYLE'));
    assert.ok(visualActionsSmoke.includes("visualStyle === 'box'"));
    assert.ok(visualActionsSmoke.includes('rootHasPathOnly'));
    assert.ok(visualActionsSmoke.includes('rootHasBoxOnly'));
    assert.ok(visualActionsSmoke.includes('process.env.PDF_FILE'));
    assert.ok(visualActionsSmoke.includes('DOM.setFileInputFiles'));
    assert.ok(visualActionsSmoke.includes('client.visual.selection.explain'));
    assert.ok(visualActionsSmoke.includes('client.visual.selection.translate'));
    assert.ok(visualActionsSmoke.includes('client.pdf.image.capture'));
});

test('front-end supports Ctrl Enter submit shortcuts for text inputs', () => {
    assert.ok(appJs.includes("document.addEventListener('keydown', onTextSubmitShortcut, true)"));
    assert.ok(appJs.includes('function onTextSubmitShortcut'));
    assert.ok(appJs.includes('elements.questionForm.requestSubmit()'));
    assert.ok(appJs.includes('elements.manualTranslationForm.requestSubmit()'));
    assert.ok(appJs.includes("logClient('shortcut.submit'"));
});

test('front-end chat input sends free ask requests instead of forcing selection follow-up', () => {
    assert.ok(appJs.includes("mode: 'ask'"));
    assert.ok(appJs.includes('const selectionContext = getPdfSelectionText();'));
    assert.ok(appJs.includes("sourceParts.push('含当前选区参考')"));
    assert.equal(appJs.includes('state.lastSelection || getPdfSelectionText()'), false);
    assert.equal(appJs.includes('当前没有可追问的选区'), false);
});
test('desktop wrapper is configured for packaged Electron builds', () => {
    assert.ok(packageJson.includes('"main": "./out/desktop/main.js"'));
    assert.ok(packageJson.includes('"desktop": "npm.cmd run compile && electron out/desktop/main.js"'));
    assert.ok(packageJson.includes('"dist:win": "npm.cmd run compile && electron-builder --win nsis"'));
    assert.ok(packageJson.includes('"electron"'));
    assert.ok(packageJson.includes('"electron-builder"'));
    assert.ok(packageJson.includes('"appId": "com.local.aipdftutor"'));
    assert.ok(desktopMainTs.includes('BrowserWindow'));
    assert.ok(desktopMainTs.includes('startServer(desktopConfig, logger)'));
    assert.ok(desktopMainTs.includes("process.argv.includes('--smoke-test')"));
    assert.ok(desktopMainTs.includes('fetch(serverHandle.url)'));
    assert.ok(desktopMainTs.includes("fetch(`${serverHandle.url}/api/settings`)"));
    assert.ok(desktopMainTs.includes("AI_TUTOR_PORT: process.env.AI_TUTOR_DESKTOP_PORT ?? '0'"));
    assert.ok(desktopMainTs.includes('AI_TUTOR_CONFIG: configFile'));
    assert.ok(desktopMainTs.includes("AI_TUTOR_PUBLIC_DIR: join(root, 'public')"));
    assert.ok(desktopMainTs.includes("app.getPath('userData')"));
    assert.ok(desktopMainTs.includes("label: '编辑'"));
    assert.ok(desktopMainTs.includes("role: 'paste'"));
    assert.equal(desktopMainTs.includes('sandbox: true'), false);
});
