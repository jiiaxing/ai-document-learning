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

test('front-end stylesheet keeps rule braces balanced', () => {
    assert.equal(stylesCss.match(/\{/g)?.length || 0, stylesCss.match(/\}/g)?.length || 0);
    const annotationInlineCheckCss = stylesCss.match(/\.annotation-ribbon \.inline-check \{[\s\S]*?\}/)?.[0] || '';
    assert.ok(annotationInlineCheckCss.includes('background: transparent;'));
    assert.equal(annotationInlineCheckCss.includes('background: var(--surface-3);'), false);
});

test('front-end keeps dark mode checkboxes visible', () => {
    const inlineCheckboxCss = stylesCss.match(/\.inline-check input\[type="checkbox"\] \{[\s\S]*?\}/)?.[0] || '';
    const darkCheckboxCss = stylesCss.match(/:root\[data-theme="dark"\] \.inline-check input\[type="checkbox"\] \{[\s\S]*?\}/)?.[0] || '';
    const darkCheckedCss = stylesCss.match(/:root\[data-theme="dark"\] \.inline-check input\[type="checkbox"\]:checked \{[\s\S]*?\}/)?.[0] || '';

    assert.ok(inlineCheckboxCss.includes('appearance: none;'));
    assert.ok(darkCheckboxCss.includes('border-color: #858585;'));
    assert.ok(darkCheckboxCss.includes('background-color: #252526;'));
    assert.ok(darkCheckedCss.includes('background-color: #3c3c3c;'));
    assert.ok(darkCheckedCss.includes('%23f3f3f3'));
});

test('front-end keeps dark PDF selections visible on white pages', () => {
    const darkTextSelectionCss = stylesCss.match(/:root\[data-theme="dark"\] \.textLayer ::selection \{[\s\S]*?\}/)?.[0] || '';
    const darkVisualBoxCss = stylesCss.match(/:root\[data-theme="dark"\] \.visual-selection-box \{[\s\S]*?\}/)?.[0] || '';
    const darkVisualPathCss = stylesCss.match(/:root\[data-theme="dark"\] \.visual-selection-path \{[\s\S]*?\}/)?.[0] || '';

    assert.ok(darkTextSelectionCss.includes('background: rgba(96, 94, 92, 0.3);'));
    assert.equal(darkTextSelectionCss.includes('rgba(255, 255, 255'), false);
    assert.ok(darkVisualBoxCss.includes('fill: rgba(96, 94, 92, 0.18);'));
    assert.ok(darkVisualBoxCss.includes('stroke: rgba(60, 60, 60, 0.92);'));
    assert.ok(darkVisualPathCss.includes('stroke: rgba(60, 60, 60, 0.95);'));
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
    assert.ok(appJs.includes('需重新配置 Key'));
    assert.ok(appJs.includes('state.apiKeyTouched && elements.providerKind.value !=='));
    assert.ok(appJs.includes('state.apiKeyTouched = false'));
    assert.equal(indexHtml.includes('留空则保留'), false);
    assert.equal(appJs.includes('留空则保留'), false);
});

test('front-end exposes prompt template settings', () => {
    assert.ok(appJs.includes('systemPrompt: document.getElementById'));
    assert.ok(appJs.includes('explainPromptTemplate: elements.explainPromptTemplate.value'));
    assert.ok(appJs.includes('translatePromptTemplate: elements.translatePromptTemplate.value'));
    assert.ok(appJs.includes('followupPromptTemplate: elements.followupPromptTemplate.value'));
});

test('front-end keeps provider settings in a drawer instead of the primary reader chrome', () => {
    const settingsHtml = indexHtml.slice(indexHtml.indexOf('<form id="settingsForm"'), indexHtml.indexOf('</form>') + '</form>'.length);
    const advancedSettingsHtml = indexHtml.slice(indexHtml.indexOf('<details class="advanced-settings">'), indexHtml.indexOf('</details>', indexHtml.indexOf('<details class="advanced-settings">')) + '</details>'.length);
    const topChromeHtml = indexHtml.slice(indexHtml.indexOf('<header class="top-chrome">'), indexHtml.indexOf('<main id="appShell"'));
    const assistantPaneStart = indexHtml.indexOf('<aside id="assistantPane"');
    const assistantPaneHtml = indexHtml.slice(assistantPaneStart, indexHtml.indexOf('</aside>', assistantPaneStart) + '</aside>'.length);

    assert.ok(indexHtml.includes('id="settingsToggle"'));
    assert.ok(indexHtml.includes('id="settingsBackdrop"'));
    assert.ok(indexHtml.includes('class="settings-drawer"'));
    assert.ok(settingsHtml.includes('id="clientLog"'));
    assert.ok(settingsHtml.includes('开发者日志'));
    assert.ok(advancedSettingsHtml.includes('id="clientLog"'));
    assert.ok(advancedSettingsHtml.includes('id="autoTranslate"'));
    assert.ok(advancedSettingsHtml.includes('id="autoExplain"'));
    assert.equal(topChromeHtml.includes('id="autoTranslate"'), false);
    assert.equal(topChromeHtml.includes('id="autoExplain"'), false);
    assert.equal(assistantPaneHtml.includes('id="clientLog"'), false);
    assert.equal(assistantPaneHtml.includes('开发者日志'), false);
    assert.ok(indexHtml.includes('class="toolbar-group'));
    assert.equal(indexHtml.includes('class="app-header"'), false);
    assert.equal(stylesCss.includes('.app-header'), false);
    assert.equal(stylesCss.includes('.header-actions'), false);
    assert.equal(indexHtml.includes('class="brand"'), false);
    assert.equal(indexHtml.includes('class="brand-mark"'), false);
    assert.ok(appJs.includes('function setSettingsOpen'));
    assert.ok(appJs.includes("elements.settingsToggle.addEventListener('click'"));
    assert.ok(stylesCss.includes('.settings-drawer'));
    assert.ok(stylesCss.includes('flex-direction: column'));
    assert.ok(stylesCss.includes('.toolbar-group'));
});

test('front-end exposes OpenAI and DeepSeek provider presets', () => {
    assert.ok(indexHtml.includes('value="openai"'));
    assert.ok(indexHtml.includes('OpenAI / GPT'));
    assert.ok(indexHtml.includes('value="deepseek"'));
    assert.ok(indexHtml.includes('value="deepseek" selected'));
    assert.ok(indexHtml.includes('DeepSeek'));
    assert.ok(indexHtml.includes('value="custom"'));
    assert.ok(appJs.includes('const PROVIDER_PRESETS'));
    assert.ok(appJs.includes('https://api.openai.com/v1/chat/completions'));
    assert.ok(appJs.includes('https://api.deepseek.com/chat/completions'));
    assert.ok(appJs.includes('deepseek-v4-flash-vision-exp'));
    assert.ok(appJs.includes('function providerPresetFromSettings'));
    assert.ok(appJs.includes('preset: elements.providerKind.value'));
});

test('front-end exposes DeepSeek thinking toggles for translate and explain', () => {
    assert.ok(indexHtml.includes('id="deepSeekThinkingTranslate"'));
    assert.ok(indexHtml.includes('id="deepSeekThinkingExplain"'));
    assert.ok(indexHtml.includes('DeepSeek 翻译思考'));
    assert.ok(indexHtml.includes('DeepSeek 讲解思考'));
    assert.ok(appJs.includes('deepSeekThinkingTranslate: document.getElementById'));
    assert.ok(appJs.includes('deepSeekThinkingExplain: document.getElementById'));
    assert.ok(appJs.includes('deepSeekThinkingTranslate: elements.deepSeekThinkingTranslate.checked'));
    assert.ok(appJs.includes('deepSeekThinkingExplain: elements.deepSeekThinkingExplain.checked'));
    assert.ok(appJs.includes('elements.deepSeekThinkingTranslate.checked = Boolean(settings.provider.deepSeekThinkingTranslate)'));
    assert.ok(appJs.includes('elements.deepSeekThinkingExplain.checked = Boolean(settings.provider.deepSeekThinkingExplain)'));
    assert.ok(appJs.includes("const isDeepSeek = preset === 'deepseek'"));
    assert.ok(appJs.includes('elements.deepSeekThinkingTranslate.disabled = !isDeepSeek'));
    assert.ok(appJs.includes('elements.deepSeekThinkingExplain.disabled = !isDeepSeek'));
});

test('front-end builds hidden PDF context and anchors new assistant turns at the user question', () => {
    assert.ok(appJs.includes('buildSelectionPageContext(selectionSnapshot.page)'));
    assert.ok(appJs.includes('buildSelectionPageContext(selection.page)'));
    assert.ok(appJs.includes('buildPageContext(state.currentPage)'));
    assert.ok(appJs.includes('pageContextLength: pageContext.length'));
    assert.ok(appJs.includes('body: JSON.stringify({ mode, text, source, question, pageContext, selectionContext, history, images })'));
    assert.ok(appJs.includes('const userNode = appendMessage(\'user\', userVisibleText, source, { scroll: false, images });'));
    assert.ok(appJs.includes('preparePendingAssistantViewport(userNode, assistantNode)'));
    assert.ok(appJs.includes('clearPendingAssistantViewportFill()'));
    assert.ok(appJs.includes("scrollMessageToStart(userNode, 'conversation.scroll.user_start')"));
    assert.ok(appJs.includes("scrollMessageToStart(assistantNode, 'conversation.scroll.answer_start')"));
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
    assert.ok(appJs.includes('DEFAULT_AUTO_TRIGGER_PREF_VERSION'));
    assert.ok(appJs.includes('autoTriggerPreferenceVersion: DEFAULT_AUTO_TRIGGER_PREF_VERSION'));
});

test('front-end supports wheel and keyboard page navigation', () => {
    assert.ok(appJs.includes("elements.viewer.addEventListener('wheel', onViewerWheel"));
    assert.ok(appJs.includes("document.addEventListener('keydown', onPdfKeydown)"));
    assert.ok(appJs.includes("event.key === 'ArrowRight' || event.key === 'PageDown'"));
    assert.ok(appJs.includes("event.key === 'ArrowLeft' || event.key === 'PageUp'"));
    assert.ok(appJs.includes("turnPageFromInput(1, 'wheel', 'top')"));
    assert.ok(appJs.includes('event.ctrlKey || event.metaKey'));
    assert.ok(appJs.includes('function isZoomModifierWheel'));
    assert.ok(appJs.includes('function isZoomWheelGuardActive'));
    assert.ok(appJs.includes('event.preventDefault();'));
    assert.ok(appJs.includes("setScale(wheelZoomTargetScale(delta), 'ctrl-wheel', { zoomAnchor, smooth: true })"));
});

test('front-end supports visible PDF reader scrollbars and direct page jumping', () => {
    const toolbarHtml = indexHtml.slice(indexHtml.indexOf('<section class="file-toolbar">'), indexHtml.indexOf('<main id="appShell"'));
    const readerPaneHtml = indexHtml.slice(indexHtml.indexOf('<section class="reader-pane">'));
    const pageSliderCss = stylesCss.match(/\.page-slider \{[\s\S]*?\}/)?.[0] || '';

    assert.ok(indexHtml.includes('id="pageJumpInput"'));
    assert.equal(indexHtml.includes('id="pageJumpButton"'), false);
    assert.ok(indexHtml.includes('id="pageSlider"'));
    assert.equal(toolbarHtml.includes('id="pageJumpInput"'), false);
    assert.equal(toolbarHtml.includes('id="readerMode"'), false);
    assert.equal(toolbarHtml.includes('id="workspacePdfSelect"'), false);
    assert.equal(toolbarHtml.includes('id="openWorkspacePdf"'), false);
    assert.ok(readerPaneHtml.includes('class="reader-footer"'));
    assert.ok(readerPaneHtml.includes('id="readerMode"'));
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
    assert.ok(pageSliderCss.includes('accent-color: #9aa1aa;'));
    assert.ok(pageSliderCss.includes('appearance: none;'));
    assert.ok(stylesCss.includes('.page-slider::-webkit-slider-runnable-track'));
    assert.ok(stylesCss.includes('background: #eef1f4;'));
    assert.equal(pageSliderCss.includes('accent-color: var(--accent);'), false);
});

test('front-end uses a minimal reading file panel for imports and document list', () => {
    const topChromeHtml = indexHtml.slice(indexHtml.indexOf('<header class="top-chrome">'), indexHtml.indexOf('<main id="appShell"'));
    const filePanelHtml = indexHtml.slice(indexHtml.indexOf('<section id="filePanel"'), indexHtml.indexOf('</section>', indexHtml.indexOf('<section id="filePanel"')) + '</section>'.length);
    const navHtml = indexHtml.slice(indexHtml.indexOf('<nav class="file-panel-nav"'), indexHtml.indexOf('</nav>', indexHtml.indexOf('<nav class="file-panel-nav"')) + '</nav>'.length);
    const navButtonCount = (navHtml.match(/<button /g) || []).length;

    assert.ok(indexHtml.includes('id="filePanelToggle"'));
    assert.ok(topChromeHtml.includes('>文件</button>'));
    assert.equal(indexHtml.includes('id="openPdf"'), false);
    assert.equal(indexHtml.includes('打开 PDF</button>'), false);
    assert.ok(filePanelHtml.includes('id="filePanelBack"'));
    assert.ok(filePanelHtml.includes('id="importReadingFile"'));
    assert.ok(filePanelHtml.includes('id="readingFileList"'));
    assert.ok(filePanelHtml.includes('id="readingFileContextMenu"'));
    assert.ok(filePanelHtml.includes('id="deleteReadingFile"'));
    assert.equal(navButtonCount, 2);
    assert.equal(filePanelHtml.includes('搜索'), false);
    assert.equal(filePanelHtml.includes('新建'), false);
    assert.equal(filePanelHtml.includes('分享'), false);
    assert.ok(appJs.includes("elements.filePanelToggle.addEventListener('click', () => setFilePanelOpen(true))"));
    assert.ok(appJs.includes("elements.importReadingFile.addEventListener('click', () => elements.pdfInput.click())"));
    assert.ok(appJs.includes("elements.readingFileList.addEventListener('contextmenu', onReadingFileContextMenu)"));
    assert.ok(appJs.includes('function deleteReadingFileFromContextMenu'));
    assert.ok(appJs.includes('function showReadingFilePanelMessage'));
    assert.ok(appJs.includes("fetch('/api/reading-files/import'"));
    assert.ok(appJs.includes("fetch(`/api/reading-files/${encodeURIComponent(id)}`, { method: 'DELETE' })"));
    assert.ok(appJs.includes('reading-file-title'));
    assert.ok(appJs.includes('reading-file-time'));
    assert.ok(appJs.includes('reading-file-message'));
    assert.equal(appJs.includes("appendMessage('assistant', `PDF 导入失败"), false);
    assert.equal(appJs.includes("appendMessage('assistant', `阅读文件打开失败"), false);
    assert.equal(appJs.includes("appendMessage('assistant', `阅读文件删除失败"), false);
    assert.ok(stylesCss.includes('.file-panel'));
    assert.ok(stylesCss.includes('.file-panel-nav'));
    assert.ok(stylesCss.includes('.reading-file-item'));
    assert.ok(stylesCss.includes('.reading-file-message'));
    assert.ok(stylesCss.includes('.reading-file-context-menu'));
});

test('front-end slides the file panel away before loading a selected reading file', () => {
    assert.ok(appJs.includes('const FILE_PANEL_TRANSITION_MS = 220'));
    assert.ok(appJs.includes('window.requestAnimationFrame'));
    assert.ok(appJs.includes("elements.filePanel.classList.add('is-open')"));
    assert.ok(appJs.includes("elements.filePanel.classList.remove('is-open')"));
    assert.ok(appJs.includes("void openReadingFileById(item.dataset.id || '', { closePanelOnStart: true })"));
    assert.ok(appJs.includes("await openReadingFileById(importedFile.id, { closePanelOnStart: true })"));
    assert.ok(appJs.includes("setFilePanelOpen(true, { refresh: false })"));
    assert.ok(stylesCss.includes('.file-panel.is-open'));
    assert.ok(stylesCss.includes('.file-panel-backdrop.is-open'));
    assert.ok(stylesCss.includes('transform: translateX(calc(-100% - 16px));'));
    assert.ok(stylesCss.includes('transition:'));
});

test('front-end keeps zoom lightweight through Ctrl wheel', () => {
    assert.ok(appJs.includes('const MIN_SCALE = 0.05'));
    assert.ok(appJs.includes('const MAX_SCALE = 5.0'));
    assert.ok(appJs.includes('const MIN_INITIAL_SCALE = 0.8'));
    assert.ok(appJs.includes('const VIEWER_MIN_AVAILABLE_WIDTH = 520'));
    assert.ok(appJs.includes('async function scaleForNewDocument'));
    assert.ok(appJs.includes('saved >= MIN_INITIAL_SCALE'));
    assert.ok(appJs.includes('return Math.max(MIN_INITIAL_SCALE, fitScale);'));
    assert.ok(appJs.includes('async function computeFitWidthScale'));
    assert.ok(appJs.includes('async function setScale(nextScale, trigger ='));
    assert.ok(appJs.includes('return scale >= MIN_INITIAL_SCALE ? scale : null;'));
    assert.ok(appJs.includes('function availableViewerWidth'));
    assert.ok(appJs.includes('const SMOOTH_ZOOM_RENDER_DELAY_MS = 180'));
    assert.ok(appJs.includes('const SMOOTH_ZOOM_SENSITIVITY = 0.001'));
    assert.ok(appJs.includes('const CTRL_ZOOM_WHEEL_GUARD_MS = 320'));
    assert.ok(appJs.includes('function wheelZoomTargetScale'));
    assert.ok(appJs.includes('function queueSmoothZoomPreview'));
    assert.ok(appJs.includes('function commitSmoothZoomRender'));
    assert.ok(appJs.includes('function restoreSmoothZoomPreviewAnchor'));
    assert.ok(appJs.includes('document.addEventListener(\'keydown\', onZoomModifierKeydown, true)'));
    assert.ok(appJs.includes('document.addEventListener(\'keyup\', onZoomModifierKeyup, true)'));
    assert.ok(appJs.includes('window.addEventListener(\'blur\', resetZoomModifierState)'));
    assert.ok(appJs.includes('ctrlZoomKeyDown'));
    assert.ok(appJs.includes('function zoomAnchorFromWheelEvent'));
    assert.ok(appJs.includes('function restoreZoomAnchor'));
    assert.ok(appJs.includes('restoreZoomAnchor(options.zoomAnchor)'));
    assert.ok(appJs.includes('options.smooth === true'));
    assert.ok(appJs.includes("logClient('pdf.zoom.preview'"));
    assert.ok(appJs.includes("logClient('pdf.zoom.commit'"));
    assert.ok(appJs.includes("logClient('pdf.zoom.change'"));
    assert.ok(appJs.includes('pageNode.style.width = `${baseWidth * previewRatio}px`;'));
    assert.ok(appJs.includes('pageNode.style.height = `${baseHeight * previewRatio}px`;'));
    assert.ok(stylesCss.includes('.page-content'));
    assert.ok(stylesCss.includes('.viewer.smooth-zooming'));
    assert.equal(indexHtml.includes('id="zoomOut"'), false);
    assert.equal(indexHtml.includes('id="zoomIn"'), false);
    assert.equal(indexHtml.includes('id="zoomInfo"'), false);
    assert.equal(appJs.includes('zoomOut'), false);
    assert.equal(appJs.includes('zoomIn'), false);
    assert.equal(appJs.includes('zoomInfo'), false);
    assert.equal(stylesCss.includes('#zoomInfo'), false);
});

test('front-end supports selectable continuous PDF reading', () => {
    const toolbarHtml = indexHtml.slice(indexHtml.indexOf('<section class="file-toolbar">'), indexHtml.indexOf('<main id="appShell"'));
    const readerFooterHtml = indexHtml.slice(indexHtml.indexOf('<footer class="reader-footer"'), indexHtml.indexOf('</footer>', indexHtml.indexOf('<footer class="reader-footer"')));

    assert.ok(indexHtml.includes('id="readerMode"'));
    assert.equal(toolbarHtml.includes('id="readerMode"'), false);
    assert.ok(readerFooterHtml.includes('id="readerMode"'));
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
    const topChromeHtml = indexHtml.slice(indexHtml.indexOf('<header class="top-chrome">'), indexHtml.indexOf('<main id="appShell"'));
    const annotationRibbonHtml = indexHtml.slice(indexHtml.indexOf('<section id="annotationRibbon"'), indexHtml.indexOf('</section>', indexHtml.indexOf('<section id="annotationRibbon"')) + '</section>'.length);
    const annotationRibbonCss = stylesCss.match(/\.annotation-ribbon \{[\s\S]*?\}/)?.[0] || '';

    assert.ok(appJs.includes("const ANNOTATION_STORE_KEY = 'aiPdfTutor.annotations.v1'"));
    assert.equal(topChromeHtml.includes('id="annotationToggle"'), false);
    assert.equal(topChromeHtml.includes('>批注工具</button>'), false);
    assert.equal(annotationRibbonHtml.includes('id="editMode"'), false);
    assert.equal(annotationRibbonHtml.includes('<span>批注</span>'), false);
    assert.equal(annotationRibbonHtml.includes('hidden'), false);
    assert.equal(annotationRibbonHtml.includes('id="addHighlight"'), false);
    assert.equal(indexHtml.includes('id="selectionAddHighlight"'), false);
    assert.equal(indexHtml.includes('id="selectionRemoveHighlight"'), false);
    assert.equal(indexHtml.includes('id="markerMode"'), false);
    assert.ok(annotationRibbonHtml.includes('id="clearPageAnnotations"'));
    assert.ok(annotationRibbonHtml.includes('id="lineMode"'));
    assert.ok(annotationRibbonHtml.includes('>绘制</button>'));
    assert.ok(annotationRibbonHtml.includes('id="eraserMode"'));
    assert.equal(annotationRibbonHtml.includes('type="checkbox"'), false);
    assert.equal(annotationRibbonHtml.includes('<span>线条</span>'), false);
    assert.equal(indexHtml.includes('annotation-popover'), false);
    assert.equal(indexHtml.includes('toolbar-menu'), false);
    assert.equal(appJs.includes("elements.annotationToggle.addEventListener('click', toggleAnnotationRibbon)"), false);
    assert.equal(appJs.includes('function setAnnotationRibbonOpen'), false);
    assert.equal(stylesCss.includes('.annotation-ribbon[hidden]'), false);
    assert.ok(annotationRibbonCss.includes('display: flex'));
    assert.ok(annotationRibbonCss.includes('border-bottom: 1px solid var(--line)'));
    assert.ok(annotationRibbonCss.includes('overflow-x: auto'));
    assert.equal(appJs.includes('toggleHighlightFromSelection'), false);
    assert.equal(appJs.includes('selectionFullyHighlighted'), false);
    assert.equal(appJs.includes('selectionIntersectsHighlights'), false);
    assert.ok(appJs.includes('selectedTextNodeRectsForPage'));
    assert.equal(appJs.includes('highlightRenderRects'), false);
    assert.equal(appJs.includes('renderHighlightAnnotations'), false);
    assert.equal(appJs.includes('addHighlightAnnotation'), false);
    assert.equal(appJs.includes('annotation-marker'), false);
    assert.equal(indexHtml.includes('id="undoHighlight"'), false);
    assert.equal(appJs.includes('undoLastHighlight'), false);
    assert.equal(appJs.includes("annotation.highlight.undo"), false);
    assert.equal(appJs.includes("annotation.highlight.add_selection"), false);
    assert.equal(appJs.includes("annotation.highlight.remove_selection"), false);
    assert.equal(appJs.includes("annotation.highlight.toggle_add"), false);
    assert.equal(appJs.includes("annotation.highlight.toggle_remove"), false);
    assert.ok(appJs.includes('addNoteFromSelection'));
    assert.ok(appJs.includes('renderAnnotationsForPage'));
    assert.ok(appJs.includes('localStorage.setItem(ANNOTATION_STORE_KEY'));
    assert.ok(appJs.includes('queueReadingFileNotesSave(state.activeReadingFileId, notes)'));
    assert.ok(appJs.includes("fetch(`/api/reading-files/${encodeURIComponent(pending.id)}/notes`"));
    assert.ok(stylesCss.includes('line-height: 0.92;'));
    assert.equal(stylesCss.includes('--highlight'), false);
    assert.equal(stylesCss.includes('.annotation-mark.highlight'), false);
});

test('front-end supports manual text translation without PDF selection', () => {
    const topChromeHtml = indexHtml.slice(indexHtml.indexOf('<header class="top-chrome">'), indexHtml.indexOf('<main id="appShell"'));
    const translationFormHtml = indexHtml.slice(indexHtml.indexOf('<form id="manualTranslationForm"'), indexHtml.indexOf('</form>', indexHtml.indexOf('<form id="manualTranslationForm"')) + '</form>'.length);
    const advancedSettingsHtml = indexHtml.slice(indexHtml.indexOf('<details class="advanced-settings">'), indexHtml.indexOf('</details>', indexHtml.indexOf('<details class="advanced-settings">')) + '</details>'.length);

    assert.ok(indexHtml.includes('id="manualTranslationForm"'));
    assert.ok(indexHtml.includes('id="manualTranslationInput"'));
    assert.ok(indexHtml.includes('id="manualTranslationSubmit"'));
    assert.ok(indexHtml.includes('class="translation-form"'));
    assert.equal(topChromeHtml.includes('id="autoTranslate"'), false);
    assert.ok(advancedSettingsHtml.includes('id="autoTranslate"'));
    assert.ok(advancedSettingsHtml.includes('自动翻译'));
    assert.ok(advancedSettingsHtml.includes('id="autoExplain"'));
    assert.equal(indexHtml.includes('id="autoTranslate" type="checkbox" checked'), false);
    assert.equal(indexHtml.includes('id="autoExplain" type="checkbox" checked'), false);
    assert.ok(appJs.includes('autoTranslate: hasCurrentAutoTriggerPrefs && typeof parsed.autoTranslate === \'boolean\' ? parsed.autoTranslate : false'));
    assert.ok(appJs.includes('autoExplain: hasCurrentAutoTriggerPrefs && typeof parsed.autoExplain === \'boolean\' ? parsed.autoExplain : false'));
    assert.ok(appJs.includes('elements.autoTranslate.checked = state.uiPrefs.autoTranslate === true'));
    assert.ok(appJs.includes('elements.autoExplain.checked = state.uiPrefs.autoExplain === true'));
    assert.equal(translationFormHtml.includes('id="autoTranslate"'), false);
    assert.equal(indexHtml.includes('placeholder="输入文本'), false);
    assert.equal(appJs.includes('translation-empty'), false);
    assert.equal(appJs.includes('这里会显示翻译'), false);
    assert.equal(indexHtml.includes('id="selectionPreview"'), false);
    assert.equal(indexHtml.includes('当前选区'), false);
    assert.ok(appJs.includes('manualTranslationInput: document.getElementById'));
    assert.ok(appJs.includes('onManualTranslationSubmit'));
    assert.ok(appJs.includes('function fillTranslationInput'));
    assert.ok(appJs.includes('fillTranslationInput(gate.normalizedText)'));
    assert.equal(appJs.includes('selectionPreview'), false);
    assert.ok(appJs.includes("translateSelection(text, '手动输入')"));
    assert.ok(appJs.includes("logClient('translate.manual.submit'"));
});

test('front-end renders translation and AI answers as plain text flow', () => {
    const translationResultCss = stylesCss.match(/\.translation-result \{[\s\S]*?\}/)?.[0] || '';
    const messageCss = stylesCss.match(/\.message \{[\s\S]*?\}/)?.[0] || '';
    const userMessageCss = stylesCss.match(/\.message\.user \{[\s\S]*?\}/)?.[0] || '';
    const assistantMessageCss = stylesCss.match(/\.message\.assistant \{[\s\S]*?\}/)?.[0] || '';

    assert.ok(translationResultCss.includes('background: transparent;'));
    assert.ok(translationResultCss.includes('border: 0;'));
    assert.ok(translationResultCss.includes('box-shadow: none;'));
    assert.ok(messageCss.includes('background: transparent;'));
    assert.ok(messageCss.includes('border: 0;'));
    assert.ok(messageCss.includes('box-shadow: none;'));
    assert.ok(userMessageCss.includes('background: #f6f7f9;'));
    assert.ok(userMessageCss.includes('border: 1px solid #dde2e8;'));
    assert.ok(userMessageCss.includes('border-radius: 8px;'));
    assert.ok(assistantMessageCss.includes('background: transparent;'));
    assert.equal(userMessageCss.includes('border-left: 4px solid var(--accent);'), false);
    assert.equal(assistantMessageCss.includes('border-left: 4px solid var(--accent-2);'), false);
});

test('front-end shows only manual selection actions whose auto trigger is off', () => {
    assert.ok(indexHtml.includes('id="selectionActions"'));
    assert.ok(indexHtml.includes('id="selectionExplain"'));
    assert.ok(indexHtml.includes('id="selectionTranslate"'));
    assert.equal(indexHtml.includes('id="selectionAddHighlight"'), false);
    assert.equal(indexHtml.includes('id="selectionRemoveHighlight"'), false);
    assert.ok(appJs.includes('selectionActionsSnapshot'));
    assert.ok(appJs.includes('const canExplain = hasTextSelection && !elements.autoExplain.checked'));
    assert.ok(appJs.includes('const canTranslate = hasTextSelection && !elements.autoTranslate.checked'));
    assert.equal(appJs.includes('const canAddHighlight = hasTextSelection && !hasHighlightedSelection'), false);
    assert.equal(appJs.includes('const canRemoveHighlight = hasTextSelection && overlapsHighlightedSelection'), false);
    assert.ok(appJs.includes('elements.selectionExplain.hidden = !canExplain'));
    assert.ok(appJs.includes('elements.selectionTranslate.hidden = !canTranslate'));
    assert.equal(appJs.includes('elements.selectionAddHighlight.hidden = !hasTextSelection'), false);
    assert.equal(appJs.includes('elements.selectionRemoveHighlight.hidden = !hasTextSelection'), false);
    assert.ok(appJs.includes('selectionContainsPdfText'));
    assert.ok(appJs.includes('if (!autoTranslateEnabled && !autoExplainEnabled)'));
    assert.equal(appJs.includes("hideSelectionActions('edit-mode')"), false);
    assert.ok(appJs.includes("document.addEventListener('mouseup', (event) => queueTextSelectionProbe('mouseup', actionAnchorFromEvent(event)), true)"));
    assert.ok(appJs.includes("queueTextSelectionProbe('pointerup', actionAnchorFromEvent(event))"));
    assert.ok(appJs.includes('function actionAnchorFromEvent'));
    assert.ok(appJs.includes('function actionAnchorForSelection'));
    assert.ok(appJs.includes('function clientPointForActionAnchor'));
    assert.ok(appJs.includes('function placeActionMenuAtPoint'));
    assert.ok(appJs.includes('actionAnchor: actionAnchorForSelection(actionAnchor, pageNumber, pageNode)'));
    assert.ok(appJs.includes("logClient('selection.manual.ready'"));
    assert.ok(appJs.includes('explainSelectionFromAction'));
    assert.ok(appJs.includes('translateSelectionFromAction'));
    assert.ok(appJs.includes("logClient('selection.action.explain'"));
    assert.ok(appJs.includes("logClient('selection.action.translate'"));
    assert.ok(stylesCss.includes('.selection-actions'));
});

test('front-end supports resizable and collapsible side panes', () => {
    const topChromeHtml = indexHtml.slice(indexHtml.indexOf('<header class="top-chrome">'), indexHtml.indexOf('<main id="appShell"'));
    const appShellHtml = indexHtml.slice(indexHtml.indexOf('<main id="appShell"'));
    const paneRestoreCss = stylesCss.match(/\.pane-restore-bar \{[\s\S]*?\}/)?.[0] || '';

    assert.ok(indexHtml.includes('id="appShell"'));
    assert.ok(indexHtml.includes('id="leftPaneResizer"'));
    assert.ok(indexHtml.includes('id="rightPaneResizer"'));
    assert.ok(indexHtml.includes('id="collapseTranslation"'));
    assert.ok(indexHtml.includes('id="collapseAssistant"'));
    assert.ok(indexHtml.includes('id="restoreTranslation"'));
    assert.ok(indexHtml.includes('id="restoreAssistant"'));
    assert.ok(topChromeHtml.includes('id="paneRestoreBar"'));
    assert.ok(topChromeHtml.includes('id="restoreTranslation"'));
    assert.ok(topChromeHtml.includes('id="restoreAssistant"'));
    assert.equal(appShellHtml.includes('id="paneRestoreBar"'), false);
    assert.equal(paneRestoreCss.includes('position:'), false);
    assert.equal(paneRestoreCss.includes('right:'), false);
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
    assert.ok(appJs.includes('annotation-note-toolbar'));
    assert.ok(appJs.includes('annotation-note-input'));
    assert.ok(appJs.includes("document.createElement('textarea')"));
    assert.ok(appJs.includes('finishNoteEdit'));
    assert.equal(appJs.includes('deleteSelectedNote'), false);
    assert.ok(appJs.includes('annotation.note.delete'));
    assert.ok(appJs.includes('annotation.note.empty_delete'));
    assert.ok(appJs.includes('notePlacementMode'));
    assert.ok(stylesCss.includes('--note-content-padding'));
    assert.ok(stylesCss.includes('padding: var(--note-content-padding);'));
    assert.ok(stylesCss.includes('--pdf-zoom-ratio'));
    assert.ok(stylesCss.includes('--note-handle-width: calc(10px * var(--pdf-zoom-ratio))'));
    assert.ok(stylesCss.includes('.annotation-note-toolbar'));
    assert.ok(stylesCss.includes('.note-toolbar-font-input'));
    assert.ok(stylesCss.includes('inset: 0 auto 0 0'));
    assert.ok(stylesCss.includes('overflow: hidden'));
    assert.equal(stylesCss.includes('grid-template-columns: 28px minmax(0, 1fr)'), false);
    assert.equal(indexHtml.includes('id="noteFontInput"'), false);
    assert.equal(indexHtml.includes('id="noteFontInfo"'), false);
    assert.ok(appJs.includes('const NOTE_DEFAULT_FONT_SIZE = 15'));
    assert.ok(appJs.includes('const NOTE_MIN_FONT_SIZE = 6'));
    assert.ok(appJs.includes('const NOTE_MAX_FONT_SIZE = 72'));
    assert.equal(appJs.includes("elements.noteFontDown.addEventListener('click', () => adjustSelectedNoteFont(-1))"), false);
    assert.equal(appJs.includes("elements.noteFontUp.addEventListener('click', () => adjustSelectedNoteFont(1))"), false);
    assert.equal(appJs.includes("elements.noteFontInput.addEventListener('change', applyTypedNoteFont)"), false);
    assert.ok(appJs.includes('fontSize: type === \'note\' ? NOTE_DEFAULT_FONT_SIZE : undefined'));
    assert.ok(appJs.includes('fontSize: NOTE_DEFAULT_FONT_SIZE'));
    assert.ok(appJs.includes('function noteFontSize'));
    assert.ok(appJs.includes('function noteRenderFontSize'));
    assert.ok(appJs.includes('fontSizeRatio: null'));
    assert.ok(appJs.includes('addTextBoxAnnotation'));
    assert.ok(appJs.includes('focusNoteInput(annotation.id)'));
    assert.ok(appJs.includes('adjustNoteFont'));
    assert.ok(appJs.includes('applyNoteToolbarFontInput'));
    assert.ok(appJs.includes('function wireNoteToolbarButton'));
    assert.ok(appJs.includes("button.addEventListener('pointerdown'"));
    assert.ok(appJs.includes('noteBoxForSelection'));
    assert.ok(stylesCss.includes('--note-content-padding-left'));
    assert.ok(stylesCss.includes('margin: var(--note-content-padding-top) 0 0 var(--note-content-padding-left);'));
    assert.ok(stylesCss.includes('max-width: calc(100% - var(--note-content-padding-left) - var(--note-content-padding-right));'));
    assert.equal(stylesCss.includes('padding: calc(1px * var(--pdf-zoom-ratio)) calc(2px * var(--pdf-zoom-ratio));'), false);
    assert.equal(appJs.includes('window.prompt'), false);
    assert.equal(appJs.includes('openNoteComposer'), false);
    assert.equal(appJs.includes('pendingFreeNoteText'), false);
    assert.equal(appJs.includes('editMode'), false);
    assert.ok(appJs.includes('lineMode: document.getElementById'));
    assert.ok(appJs.includes('eraserMode: document.getElementById'));
    assert.ok(appJs.includes('function resetTransientAnnotationTools'));
    assert.ok(appJs.includes('saveUiPrefs();'));
    assert.ok(appJs.includes("elements.page.addEventListener('pointerdown', onPagePointerDown)"));
    assert.ok(appJs.includes("type: 'line'"));
    assert.ok(appJs.includes("document.createElementNS('http://www.w3.org/2000/svg', 'polyline')"));
    assert.ok(appJs.includes('annotation.line.add'));
    assert.ok(appJs.includes('annotation.line.erase'));
    assert.ok(stylesCss.includes('.page-stack.eraser-active .annotation-line'));
});

test('front-end uses frameless tool buttons instead of heavy button blocks', () => {
    const primaryCss = stylesCss.match(/button\.primary \{[\s\S]*?\}/)?.[0] || '';
    const activeToolCss = stylesCss.match(/button\.active-tool \{[\s\S]*?\}/)?.[0] || '';

    assert.ok(primaryCss.includes('background: transparent;'));
    assert.equal(primaryCss.includes('background: var(--accent);'), false);
    assert.equal(primaryCss.includes('color: var(--accent);'), false);
    assert.ok(activeToolCss.includes('background: var(--tool-selected);'));
    assert.ok(activeToolCss.includes('font-weight: 600;'));
    assert.equal(activeToolCss.includes('color: var(--accent);'), false);
    assert.equal(activeToolCss.includes('box-shadow: inset 0 -2px 0 var(--accent);'), false);
    assert.ok(indexHtml.includes('title="翻译左侧输入框中的文本"'));
    assert.ok(appJs.includes("elements.lineMode.addEventListener('click'"));
    assert.ok(appJs.includes("elements.eraserMode.addEventListener('click'"));
    assert.ok(appJs.includes("elements.lineMode.textContent = '绘制'"));
});

test('front-end supports sending image attachments to AI', () => {
    assert.ok(indexHtml.includes('id="attachImage"'));
    assert.ok(indexHtml.includes('id="imageInput"'));
    assert.ok(indexHtml.includes('id="imageAttachments"'));
    assert.ok(indexHtml.includes('id="questionInput"'));
    assert.equal(indexHtml.includes('向 AI 提问，可附图'), false);
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

test('front-end keeps empty reader and text inputs visually quiet', () => {
    assert.ok(indexHtml.includes('id="emptyState"'));
    assert.equal(indexHtml.includes('打开 PDF 开始'), false);
    assert.equal(indexHtml.includes('placeholder="https://api.openai.com'), false);
    assert.equal(indexHtml.includes('placeholder="gpt-4o-mini'), false);
    assert.equal(indexHtml.includes('placeholder="向 AI'), false);
    assert.equal(indexHtml.includes('placeholder="输入文本'), false);
    assert.equal(appJs.includes('在此处开始键入'), false);
});

test('front-end supports page image actions and right-click visual selection', () => {
    const topChromeHtml = indexHtml.slice(indexHtml.indexOf('<header class="top-chrome">'), indexHtml.indexOf('<main id="appShell"'));
    const explainCurrentPageJs = appJs.slice(appJs.indexOf('async function explainCurrentPage'), appJs.indexOf('async function translateCurrentPage'));
    const explainVisualSelectionJs = appJs.slice(appJs.indexOf('async function explainVisualSelectionFromAction'), appJs.indexOf('async function translateVisualSelectionFromAction'));

    assert.equal(indexHtml.includes('id="explainPage"'), false);
    assert.equal(indexHtml.includes('id="translatePage"'), false);
    assert.equal(topChromeHtml.includes('讲解页'), false);
    assert.equal(topChromeHtml.includes('翻译页'), false);
    assert.ok(indexHtml.includes('id="visualActions"'));
    assert.ok(indexHtml.includes('id="visualExplain"'));
    assert.ok(indexHtml.includes('id="visualTranslate"'));
    assert.ok(indexHtml.includes('id="visualSelectionStyle"'));
    assert.ok(appJs.includes('PAGE_IMAGE_MAX_EDGE'));
    assert.equal(appJs.includes('explainPage: document.getElementById'), false);
    assert.equal(appJs.includes('translatePage: document.getElementById'), false);
    assert.equal(appJs.includes("elements.explainPage.addEventListener('click'"), false);
    assert.equal(appJs.includes("elements.translatePage.addEventListener('click'"), false);
    assert.ok(appJs.includes("elements.viewer.addEventListener('contextmenu', onViewerContextMenu)"));
    assert.ok(appJs.includes('function capturePageImage'));
    assert.equal(appJs.includes('function drawVisualSelectionPath'), false);
    assert.ok(appJs.includes('function explainCurrentPage'));
    assert.ok(appJs.includes('function translateCurrentPage'));
    assert.ok(explainCurrentPageJs.includes("mode: 'explain'"));
    assert.equal(explainCurrentPageJs.includes("mode: 'ask'"), false);
    assert.equal(explainCurrentPageJs.includes('请根据图片和页面上下文'), false);
    assert.ok(appJs.includes('function startVisualSelection'));
    assert.ok(appJs.includes('function onVisualSelectionStyleChanged'));
    assert.ok(appJs.includes('function visualSelectionStyle'));
    assert.ok(appJs.includes('VISUAL_SELECTION_STYLE_BOX'));
    assert.ok(appJs.includes('VISUAL_SELECTION_STYLE_PATH'));
    assert.ok(appJs.includes('function renderVisualSelection'));
    assert.ok(appJs.includes('function rawRectFromVisualDraft'));
    assert.ok(appJs.includes('function rawRectFromCorners'));
    assert.ok(appJs.includes('pointToPageRatioForPage(event, draft.page)'));
    assert.ok(appJs.includes('actionAnchor: actionAnchorFromEvent(event, point.page)'));
    assert.ok(appJs.includes('const actionAnchor = actionAnchorFromEvent(event, draft.page) || draft.actionAnchor'));
    assert.ok(appJs.includes('function padVisualSelectionRect'));
    assert.ok(appJs.includes('pushVisualSelectionPoint'));
    assert.ok(appJs.includes('function explainVisualSelectionFromAction'));
    assert.ok(appJs.includes('function translateVisualSelectionFromAction'));
    assert.ok(explainVisualSelectionJs.includes("mode: 'explain'"));
    assert.equal(explainVisualSelectionJs.includes("mode: 'ask'"), false);
    assert.equal(explainVisualSelectionJs.includes('请识别并讲解${label}中的内容'), false);
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
