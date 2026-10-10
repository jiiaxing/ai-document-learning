import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import test from 'node:test';
import { runInNewContext } from 'node:vm';

const appJs = readFileSync(resolve(__dirname, '../../public/app.js'), 'utf8');

function readerFunction(name: string, context: Record<string, unknown>) {
    const source = appJs.match(new RegExp(`^(?:async )?function ${name}\\([^]*?^\\}`, 'm'))?.[0];
    assert.ok(source, `Missing reader function: ${name}`);
    return runInNewContext(`(${source})`, context);
}

test('reader coalesces scroll work and uses the latest page when the frame runs', () => {
    const frames: Array<() => void> = [];
    const state = { pdfDoc: {}, renderLock: false, currentPage: 1, viewerScrollFrame: 0 };
    let visiblePage = 2;
    let pageReads = 0;
    let menuUpdates = 0;
    let toolbarUpdates = 0;
    const onScroll = readerFunction('onViewerScroll', {
        state,
        window: { requestAnimationFrame: (callback: () => void) => frames.push(callback) },
        readerMode: () => 'continuous',
        READER_MODE_CONTINUOUS: 'continuous',
        visibleContinuousPage: () => { pageReads += 1; return visiblePage; },
        positionSelectionActions: () => { menuUpdates += 1; },
        positionVisualActions: () => { menuUpdates += 1; },
        updateToolbar: () => { toolbarUpdates += 1; }
    });

    onScroll();
    onScroll();
    visiblePage = 4;
    onScroll();
    assert.equal(frames.length, 1);
    assert.equal(pageReads, 0);
    assert.equal(menuUpdates, 0);
    frames.shift()!();
    assert.equal(state.currentPage, 4);
    assert.equal(pageReads, 1);
    assert.equal(menuUpdates, 2);
    assert.equal(toolbarUpdates, 1);
    assert.equal(state.viewerScrollFrame, 0);

    onScroll();
    frames.shift()!();
    assert.equal(pageReads, 2);
    assert.equal(toolbarUpdates, 1, 'The same page does not rewrite the toolbar');
});

test('queued scroll updates respect render locks and reader mode at frame time', () => {
    const frames: Array<() => void> = [];
    const state = { pdfDoc: {} as object | null, renderLock: false, currentPage: 1, viewerScrollFrame: 0 };
    let mode = 'continuous';
    let menuUpdates = 0;
    const onScroll = readerFunction('onViewerScroll', {
        state,
        window: { requestAnimationFrame: (callback: () => void) => frames.push(callback) },
        readerMode: () => mode,
        READER_MODE_CONTINUOUS: 'continuous',
        visibleContinuousPage: () => assert.fail('Page detection must be skipped'),
        positionSelectionActions: () => { menuUpdates += 1; },
        positionVisualActions: () => { menuUpdates += 1; },
        updateToolbar: () => assert.fail('The toolbar must not change')
    });

    onScroll();
    state.renderLock = true;
    frames.shift()!();
    state.renderLock = false;
    onScroll();
    mode = 'single';
    frames.shift()!();
    mode = 'continuous';
    onScroll();
    state.pdfDoc = null;
    frames.shift()!();
    assert.equal(menuUpdates, 6);
    assert.equal(state.viewerScrollFrame, 0);
});

function pageLookup(rects: Array<{ top: number; bottom: number }>) {
    let reads = 0;
    let targetY = 0;
    const pages = rects.map((rect, index) => ({
        dataset: { page: String(index + 1) },
        getBoundingClientRect: () => { reads += 1; return rect; }
    }));
    const lookup = readerFunction('visibleContinuousPage', {
        elements: {
            page: { children: pages, querySelectorAll: () => pages },
            viewer: { getBoundingClientRect: () => ({ top: targetY - 350, height: 1000 }) }
        }
    });
    return {
        at: (y: number) => { targetY = y; reads = 0; return lookup(); },
        reads: () => reads
    };
}

test('continuous page detection handles mixed page sizes, gaps, ties and document edges', () => {
    assert.equal(pageLookup([]).at(10), 0);
    const lookup = pageLookup([
        { top: 0, bottom: 600 },
        { top: 622, bottom: 1422 },
        { top: 1444, bottom: 1844 }
    ]);
    for (const [y, expected] of [
        [-100, 1], [0, 1], [600, 1], [610, 1], [611, 1], [612, 2],
        [622, 2], [1000, 2], [1422, 2], [1433, 2], [1434, 3], [1844, 3], [2000, 3]
    ]) {
        assert.equal(lookup.at(y), expected, `Reader reference point at ${y}`);
    }
});

test('continuous page lookup bounds geometry reads on long documents', () => {
    const lookup = pageLookup(Array.from({ length: 4096 }, (_, index) => ({
        top: index * 1022,
        bottom: index * 1022 + 1000
    })));
    assert.equal(lookup.at(4000 * 1022 + 500), 4001);
    assert.ok(lookup.reads() <= 14, `Expected logarithmic geometry reads, got ${lookup.reads()}`);
});

class PageNode {
    className = '';
    dataset: Record<string, string> = {};
    style = { width: '', height: '' };
    childNodes: object[] = [];

    replaceChildren(...nodes: object[]) {
        this.childNodes = nodes;
    }
}

test('single-page rendering keeps the current page until the replacement is ready', async () => {
    const page = new PageNode();
    const oldContent = {};
    page.className = 'page-wrap';
    page.dataset = { page: '1', renderedWidth: '400', renderedHeight: '600', renderScale: '1' };
    page.style = { width: '400px', height: '600px' };
    page.childNodes = [oldContent];
    const elements = { page };
    const canvas = {};
    const textLayer = {};
    const annotationLayer = {};
    let finishRender!: () => void;
    const ready = new Promise<void>((resolveRender) => { finishRender = resolveRender; });
    const render = readerFunction('renderSinglePage', {
        state: { currentPage: 2, scale: 2 },
        elements,
        document: { createElement: () => new PageNode() },
        renderPdfPage: async (pageNumber: number, pendingPage: PageNode, scale: number) => {
            assert.equal(pageNumber, 2);
            assert.equal(scale, 2);
            assert.notEqual(pendingPage, page);
            assert.equal(pendingPage.className, 'page-wrap');
            assert.equal(pendingPage.dataset.page, '2');
            pendingPage.style = { width: '800px', height: '1200px' };
            Object.assign(pendingPage.dataset, { renderedWidth: '800', renderedHeight: '1200', renderScale: '2' });
            pendingPage.childNodes = [canvas, textLayer, annotationLayer];
            await ready;
            return { width: 800, height: 1200 };
        },
        logClient: () => {},
        READER_MODE_SINGLE: 'single'
    });

    const rendering = render();
    try {
        assert.deepEqual(page.childNodes, [oldContent]);
        assert.equal(page.dataset.page, '1');
        assert.equal(page.style.width, '400px');
    } finally {
        finishRender();
        await rendering;
    }
    assert.equal(elements.page, page, 'The event-listening page element keeps its identity');
    assert.deepEqual(page.childNodes, [canvas, textLayer, annotationLayer]);
    assert.deepEqual(page.dataset, { page: '2', renderedWidth: '800', renderedHeight: '1200', renderScale: '2' });
    assert.deepEqual(page.style, { width: '800px', height: '1200px' });
});

test('failed single-page rendering leaves the visible content and dimensions intact', async () => {
    const page = new PageNode();
    page.className = 'page-stack';
    page.childNodes = [{ previousPage: true }];
    page.style = { width: '600px', height: '900px' };
    const originalContent = page.childNodes;
    const failure = new Error('PDF rendering failed');
    const render = readerFunction('renderSinglePage', {
        state: { currentPage: 2, scale: 2 },
        elements: { page },
        document: { createElement: () => new PageNode() },
        renderPdfPage: async () => { throw failure; },
        logClient: () => assert.fail('Failed render must not be reported complete'),
        READER_MODE_SINGLE: 'single'
    });

    await assert.rejects(render(), failure);
    assert.equal(page.childNodes, originalContent);
    assert.equal(page.className, 'page-stack');
    assert.deepEqual(page.dataset, {});
    assert.deepEqual(page.style, { width: '600px', height: '900px' });
});
