import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import test from 'node:test';
import { runInNewContext } from 'node:vm';

const source = readFileSync(resolve(__dirname, '../../public/app.js'), 'utf8');
function readerFunction(name: string, context: Record<string, unknown>) {
    const code = source.match(new RegExp(`^(?:async )?function ${name}\\([^]*?^\\}`, 'm'))?.[0];
    assert.ok(code, `Missing reader function: ${name}`);
    return runInNewContext(`(${code})`, context);
}
const clamp = (value: number, min: number, max: number) => Math.max(min, Math.min(max, value));

test('available PDF width uses the reader content box even below 520px', () => {
    const viewer = { clientWidth: 320 };
    const width = readerFunction('availableViewerWidth', {
        elements: { viewer },
        window: { innerWidth: 1440, getComputedStyle: () => ({ paddingLeft: '24px', paddingRight: '24px' }) }
    });
    assert.equal(width(), 270);
    viewer.clientWidth = 1200;
    assert.equal(width(), 1150);
});

test('opening a PDF caps saved zoom at the actual fit width and retains a smaller zoom', async () => {
    const state = { uiPrefs: { scale: 2.32 } };
    const scale = readerFunction('scaleForNewDocument', {
        state, MIN_SCALE: 0.05, MAX_SCALE: 5, clamp,
        computeInitialScale: async () => 0.45
    });
    assert.equal(await scale(), 0.45);
    state.uiPrefs.scale = 0.2;
    assert.equal(await scale(), 0.2);
    state.uiPrefs.scale = NaN;
    assert.equal(await scale(), 0.45);
});

test('fitting a narrow reader can scale below the legacy initial minimum', async () => {
    const fit = readerFunction('computeInitialScale', { computeFitWidthScale: async () => 0.32 });
    assert.equal(await fit(), 0.32);
});

test('sidebars share the remaining width without overwriting preferred sizes', () => {
    const style = new Map<string, string>();
    const element = () => ({ setAttribute() {}, hidden: false });
    const state = { uiPrefs: { translationPaneWidth: 560, assistantPaneWidth: 680, translationPaneCollapsed: false, assistantPaneCollapsed: false } };
    const shell = { clientWidth: 900, style: { setProperty: (key: string, value: string) => style.set(key, value) }, classList: { toggle() {} } };
    const apply = readerFunction('applyPaneLayoutPrefs', {
        state, clamp, window: { innerWidth: 900 },
        MIN_TRANSLATION_PANE_WIDTH: 220, MAX_TRANSLATION_PANE_WIDTH: 560,
        MIN_ASSISTANT_PANE_WIDTH: 300, MAX_ASSISTANT_PANE_WIDTH: 680,
        elements: { appShell: shell, translationPane: element(), assistantPane: element(), leftPaneResizer: element(), rightPaneResizer: element(), restoreTranslation: element(), restoreAssistant: element(), paneRestoreBar: element() }
    });
    apply();
    const total = () => parseFloat(style.get('--translation-pane-width')!) + parseFloat(style.get('--assistant-pane-width')!);
    assert.ok(Math.abs(total() + 16 + 405 - 900) < 0.01);
    assert.equal(state.uiPrefs.translationPaneWidth, 560);
    assert.equal(state.uiPrefs.assistantPaneWidth, 680);
    shell.clientWidth = 1920;
    apply();
    assert.equal(total(), 1240);
    state.uiPrefs.translationPaneCollapsed = true;
    shell.clientWidth = 900;
    apply();
    assert.equal(parseFloat(style.get('--assistant-pane-width')!), 487);
});

test('reader resize coalesces events, preserves an anchor and waits for an active render', () => {
    const frames: Array<() => void> = [];
    const state = { viewerResizeFrame: 0, viewerResizePending: false, viewerAvailableWidth: 1000, pdfDoc: {}, renderLock: false, scale: 1.5, currentPage: 3 };
    let width = 400;
    const changes: Array<{ scale: number; options: { zoomAnchor: unknown; smooth: boolean } }> = [];
    const anchor = { page: 3, y: 0.4 };
    const queue = readerFunction('queueViewerLayout', {
        state,
        window: { requestAnimationFrame: (callback: () => void) => frames.push(callback) },
        availableViewerWidth: () => width,
        pageNodesForCurrentRender: () => [{ dataset: { renderedWidth: '900', renderScale: '1.5' } }],
        elements: { viewer: { getBoundingClientRect: () => ({ left: 200, top: 100, width: 450, height: 700 }) } },
        readerMode: () => 'single', READER_MODE_CONTINUOUS: 'continuous',
        actionAnchorFromEvent: () => anchor,
        setScale: (scale: number, _trigger: string, options: { zoomAnchor: unknown; smooth: boolean }) => changes.push({ scale, options })
    });
    queue(); queue();
    assert.equal(frames.length, 1);
    state.renderLock = true;
    frames.shift()!();
    assert.equal(changes.length, 0);
    assert.equal(state.viewerResizePending, true);
    assert.equal(state.viewerAvailableWidth, 1000);
    state.renderLock = false;
    queue(); frames.shift()!();
    assert.equal(changes[0].scale, 0.6);
    assert.equal(changes[0].options.zoomAnchor, anchor);
    assert.equal(changes[0].options.smooth, true);
    assert.equal(state.viewerResizePending, false);
    queue(); frames.shift()!();
    assert.equal(changes.length, 1, 'Height-only changes do not re-render a PDF');
    state.scale = 0.6;
    width = 1000;
    queue(); frames.shift()!();
    assert.equal(changes[1].scale, 1.5, 'Closing sidebars restores proportional zoom');
});

test('render completion automatically resumes a resize received during rendering', async () => {
    const state = { pdfDoc: {}, renderLock: false, scale: 1, currentPage: 1, renderedScale: 0, viewerResizePending: false, zoomRenderTimer: 0 };
    let releaseRender: () => void = () => {};
    let resizeCalls = 0;
    const render = readerFunction('renderPage', {
        state, ZOOM_PREVIEW_EPSILON: 0.001, READER_MODE_CONTINUOUS: 'continuous',
        window: { clearTimeout() {}, getSelection: () => null },
        cancelQueuedZoomPreviewFrame() {}, setBusy() {}, logClient() {}, updateToolbar() {}, clearSmoothZoomPreviewStyles() {},
        readerMode: () => 'single', restoreZoomAnchor: () => false,
        renderSinglePage: () => new Promise<void>(resolve => { releaseRender = resolve; }),
        queueViewerLayout: () => {
            assert.equal(state.renderLock, false, 'Resize must run after the render lock is released');
            resizeCalls++;
        }
    });
    const pending = render();
    assert.equal(state.renderLock, true);
    state.viewerResizePending = true;
    releaseRender();
    await pending;
    assert.equal(resizeCalls, 1);
});

test('dragging a compressed sidebar starts in preference coordinates without jumping backwards', () => {
    const state = { uiPrefs: { translationPaneWidth: 550, assistantPaneWidth: 680 }, paneResize: null as null | { pane: string; startX: number; startWidth: number } };
    const context = {
        state, clamp, logClient() {},
        MIN_TRANSLATION_PANE_WIDTH: 220, MAX_TRANSLATION_PANE_WIDTH: 560,
        MIN_ASSISTANT_PANE_WIDTH: 300, MAX_ASSISTANT_PANE_WIDTH: 680,
        defaultTranslationPaneWidth: () => 242, defaultAssistantPaneWidth: () => 300,
        applyPaneLayoutPrefs() {}, onPaneResizeMove() {}, endPaneResize() {},
        window: { addEventListener() {} },
        elements: { appShell: { classList: { add() {} } } }
    };
    const start = readerFunction('startPaneResize', context);
    const setWidth = readerFunction('setPaneWidth', context);
    const move = readerFunction('onPaneResizeMove', { state, setPaneWidth: setWidth });
    const displayedWidth = () => 479 * state.uiPrefs.translationPaneWidth / (state.uiPrefs.translationPaneWidth + state.uiPrefs.assistantPaneWidth);
    const before = displayedWidth();
    start('translation', { button: 0, clientX: 300, preventDefault() {} });
    move({ clientX: 301 });
    const after = displayedWidth();
    assert.equal(state.uiPrefs.translationPaneWidth, 551);
    assert.ok(after > before && after - before < 1, 'The first movement must be small and follow the pointer');
});
