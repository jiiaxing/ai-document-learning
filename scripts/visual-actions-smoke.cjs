const wsUrl = process.env.CDP_WS;
const pdfFile = process.env.PDF_FILE;
const visualStyle = process.env.VISUAL_STYLE === 'box' ? 'box' : 'path';

if (!wsUrl) {
    console.error('CDP_WS is required.');
    process.exit(1);
}

let nextId = 0;
const pending = new Map();
const ws = new WebSocket(wsUrl);
const timer = setTimeout(() => {
    console.error('CDP visual actions smoke test timed out.');
    process.exit(1);
}, 60000);

function finish(code) {
    clearTimeout(timer);
    ws.close();
    process.exit(code);
}

function send(method, params = {}) {
    return new Promise((resolve, reject) => {
        const message = { id: ++nextId, method, params };
        pending.set(message.id, { resolve, reject });
        ws.send(JSON.stringify(message));
    });
}

function evaluate(expression) {
    return send('Runtime.evaluate', {
        expression,
        awaitPromise: true,
        returnByValue: true
    });
}

async function waitUntil(expression, timeoutMs = 20000) {
    const deadline = Date.now() + timeoutMs;
    while (Date.now() < deadline) {
        const result = await evaluate(expression);
        if (result.result?.result?.value === true) {
            return;
        }
        await new Promise((resolve) => setTimeout(resolve, 250));
    }
    const debug = await evaluate(`({
        url: location.href,
        readyState: document.readyState,
        title: document.title,
        bodyText: document.body ? document.body.innerText.slice(0, 320) : '',
        visualHidden: document.getElementById('visualActions')?.hidden,
        pageInfo: document.getElementById('pageInfo')?.textContent
    })`);
    throw new Error(`Timed out waiting for: ${expression}; debug=${JSON.stringify(debug.result?.result?.value)}`);
}

async function maybeLoadPdfFile() {
    if (!pdfFile) {
        return;
    }
    await send('DOM.enable');
    const documentResult = await send('DOM.getDocument');
    const rootNodeId = documentResult.result?.root?.nodeId;
    if (!rootNodeId) {
        throw new Error(`Unable to inspect DOM: ${JSON.stringify(documentResult)}`);
    }
    const inputResult = await send('DOM.querySelector', {
        nodeId: rootNodeId,
        selector: '#pdfInput'
    });
    const inputNodeId = inputResult.result?.nodeId;
    if (!inputNodeId) {
        throw new Error('Unable to find #pdfInput for PDF file smoke input.');
    }
    await send('DOM.setFileInputFiles', {
        nodeId: inputNodeId,
        files: [pdfFile]
    });
    const fileCount = await getValue('document.getElementById("pdfInput")?.files?.length || 0');
    if (fileCount !== 1) {
        throw new Error(`PDF file was not attached to #pdfInput: ${pdfFile}`);
    }
    await evaluate('document.getElementById("pdfInput").dispatchEvent(new Event("change", { bubbles: true })); true');
}

async function getValue(expression) {
    const result = await evaluate(expression);
    return result.result?.result?.value;
}

async function mouse(type, x, y, button = 'left', buttons = 0) {
    await send('Input.dispatchMouseEvent', {
        type,
        x,
        y,
        button: type === 'mouseMoved' ? 'none' : button,
        buttons,
        clickCount: 1
    });
}

async function rightDrag(points) {
    const [first, ...rest] = points;
    await mouse('mouseMoved', first.x, first.y);
    await mouse('mousePressed', first.x, first.y, 'right', 2);
    for (const point of rest.slice(0, -1)) {
        await mouse('mouseMoved', point.x, point.y, 'right', 2);
    }
    const last = rest[rest.length - 1];
    await mouse('mouseMoved', last.x, last.y, 'right', 2);
    await mouse('mouseReleased', last.x, last.y, 'right');
}

async function rightClick(x, y) {
    await mouse('mouseMoved', x, y);
    await mouse('mousePressed', x, y, 'right', 2);
    await mouse('mouseReleased', x, y, 'right');
}

async function leftClick(x, y) {
    await mouse('mouseMoved', x, y);
    await mouse('mousePressed', x, y, 'left', 1);
    await mouse('mouseReleased', x, y, 'left');
}

async function waitForRecentEvents(required, timeoutMs = 20000) {
    const deadline = Date.now() + timeoutMs;
    let events = [];
    while (Date.now() < deadline) {
        const result = await evaluate(`fetch('/api/logs/recent').then((response) => response.json()).then((data) => data.entries.map((entry) => entry.event).filter((event) => event.startsWith('client.')))`);
        events = result.result?.result?.value || [];
        if (required.every((event) => events.includes(event))) {
            return events;
        }
        await new Promise((resolve) => setTimeout(resolve, 300));
    }
    throw new Error(`Missing log events: ${required.filter((event) => !events.includes(event)).join(', ')}; recent=${JSON.stringify(events.slice(-40))}`);
}

async function selectVisualRegion() {
    const pageRect = await getValue(`(() => {
        const canvas = document.querySelector('.page-wrap[data-page="1"] canvas');
        if (!canvas) {
            return null;
        }
        const rect = canvas.getBoundingClientRect();
        return { left: rect.left, top: rect.top, width: rect.width, height: rect.height };
    })()`);
    if (!pageRect || pageRect.width < 100 || pageRect.height < 100) {
        throw new Error(`Unexpected page rect: ${JSON.stringify(pageRect)}`);
    }

    const points = (visualStyle === 'box'
        ? [
            { x: pageRect.left + pageRect.width * 0.24, y: pageRect.top + pageRect.height * 0.20 },
            { x: pageRect.left + pageRect.width * 0.41, y: pageRect.top + pageRect.height * 0.29 },
            { x: pageRect.left + pageRect.width * 0.52, y: pageRect.top + pageRect.height * 0.40 }
        ]
        : [
            { x: pageRect.left + pageRect.width * 0.24, y: pageRect.top + pageRect.height * 0.20 },
            { x: pageRect.left + pageRect.width * 0.38, y: pageRect.top + pageRect.height * 0.17 },
            { x: pageRect.left + pageRect.width * 0.50, y: pageRect.top + pageRect.height * 0.25 },
            { x: pageRect.left + pageRect.width * 0.47, y: pageRect.top + pageRect.height * 0.38 },
            { x: pageRect.left + pageRect.width * 0.28, y: pageRect.top + pageRect.height * 0.37 },
            { x: pageRect.left + pageRect.width * 0.24, y: pageRect.top + pageRect.height * 0.20 }
        ]).map((point) => ({ x: Math.round(point.x), y: Math.round(point.y) }));

    await rightDrag(points);
    await waitUntil('!document.getElementById("visualActions").hidden && Boolean(document.querySelector(".visual-selection-rect"))');
    const selection = await getValue(`(() => {
        const action = document.getElementById('visualActions').getBoundingClientRect();
        const box = document.querySelector('.visual-selection-rect').getBoundingClientRect();
        return {
            actionLeft: Math.round(action.left),
            actionTop: Math.round(action.top),
            actionWidth: Math.round(action.width),
            actionHeight: Math.round(action.height),
            boxWidth: Math.round(box.width),
            boxHeight: Math.round(box.height)
        };
    })()`);
    if (!selection || selection.boxWidth < 20 || selection.boxHeight < 20) {
        throw new Error(`Visual region did not render: ${JSON.stringify(selection)}`);
    }
    const styleState = await getValue(`(() => ({
        selected: document.getElementById('visualSelectionStyle')?.value,
        rootHasPathOnly: document.querySelector('.visual-selection-rect')?.classList.contains('path-only') || false,
        rootHasBoxOnly: document.querySelector('.visual-selection-rect')?.classList.contains('box-only') || false,
        boxCount: document.querySelectorAll('.visual-selection-rect .visual-selection-box').length,
        pathCount: document.querySelectorAll('.visual-selection-rect .visual-selection-path').length
    }))()`);
    if (
        styleState?.selected !== visualStyle
        || (visualStyle === 'path' && (styleState.pathCount !== 1 || styleState.rootHasPathOnly !== true))
        || (visualStyle === 'box' && (styleState.boxCount !== 1 || styleState.pathCount !== 0 || styleState.rootHasBoxOnly !== true))
    ) {
        throw new Error(`Unexpected visual selection style state: ${JSON.stringify(styleState)}`);
    }
    return selection;
}

async function clickVisualAction(buttonId) {
    const rect = await getValue(`(() => {
        const button = document.getElementById(${JSON.stringify(buttonId)});
        if (!button) {
            return null;
        }
        const rect = button.getBoundingClientRect();
        return { x: Math.round(rect.left + rect.width / 2), y: Math.round(rect.top + rect.height / 2) };
    })()`);
    if (!rect) {
        throw new Error(`Missing action button: ${buttonId}`);
    }
    await leftClick(rect.x, rect.y);
}

ws.addEventListener('message', (event) => {
    const message = JSON.parse(event.data);
    if (!message.id || !pending.has(message.id)) {
        return;
    }
    const callbacks = pending.get(message.id);
    pending.delete(message.id);
    if (message.error) {
        callbacks.reject(new Error(JSON.stringify(message.error)));
        return;
    }
    callbacks.resolve(message);
});

ws.addEventListener('open', async () => {
    try {
        await send('Runtime.enable');
        await send('Page.enable');
        await send('Input.setIgnoreInputEvents', { ignore: false });

        await waitUntil('Boolean(document.getElementById("appShell"))');
        const targetUrl = pdfFile
            ? "location.origin + '/?visualSmoke=' + Date.now()"
            : "location.origin + '/?pdf=test.pdf&visualSmoke=' + Date.now()";
        await evaluate(`
            localStorage.removeItem('aiPdfTutor.uiPrefs.v1');
            location.href = ${targetUrl};
            true;
        `);
        await waitUntil('Boolean(document.getElementById("pdfInput"))', 30000);
        await maybeLoadPdfFile();
        await waitUntil('document.getElementById("pageInfo")?.textContent?.includes("/") && !document.getElementById("pageInfo").textContent.startsWith("-")', 30000);
        await waitUntil('Boolean(document.querySelector(".page-wrap[data-page=\\"1\\"] canvas"))', 30000);
        await evaluate(`
            document.getElementById('visualSelectionStyle').value = ${JSON.stringify(visualStyle)};
            document.getElementById('visualSelectionStyle').dispatchEvent(new Event('change', { bubbles: true }));
            undefined;
        `);
        await evaluate(`document.getElementById('restoreTranslation').click(); document.getElementById('restoreAssistant').click(); undefined;`);

        const tapRect = await getValue(`(() => {
            const canvas = document.querySelector('.page-wrap[data-page="1"] canvas');
            const rect = canvas.getBoundingClientRect();
            return { x: Math.round(rect.left + rect.width * 0.58), y: Math.round(rect.top + rect.height * 0.26) };
        })()`);
        await rightClick(tapRect.x, tapRect.y);
        await waitUntil('!document.getElementById("visualActions").hidden');
        await waitForRecentEvents(['client.visual.selection.context_menu', 'client.visual.action.show']);
        await evaluate(`document.getElementById('viewer').dispatchEvent(new PointerEvent('pointerdown', { bubbles: true, clientX: 1, clientY: 1 })); undefined;`);

        const explainSelection = await selectVisualRegion();
        await clickVisualAction('visualExplain');
        await waitForRecentEvents([
            'client.visual.selection.ready',
            'client.visual.selection.explain',
            'client.pdf.image.capture',
            'client.explain.first_token',
            'client.explain.done'
        ], 30000);
        await waitUntil('document.querySelectorAll("#messages .message.assistant .body").length > 0');

        const translateSelection = await selectVisualRegion();
        await clickVisualAction('visualTranslate');
        await waitForRecentEvents([
            'client.visual.selection.translate',
            'client.pdf.image.capture',
            'client.translate.first_token',
            'client.translate.done'
        ], 30000);
        await waitUntil('Boolean(document.querySelector("#translationOutput .translation-result"))');

        const pageState = await getValue(`(() => ({
            pageInfo: document.getElementById('pageInfo').textContent,
            visualHidden: document.getElementById('visualActions').hidden,
            assistantMessages: document.querySelectorAll('#messages .message.assistant').length,
            translationTextLength: document.getElementById('translationOutput').innerText.length
        }))()`);
        const result = {
            ...pageState,
            visualStyle,
            explainSelection,
            translateSelection
        };
        console.log(JSON.stringify(result));
        finish(0);
    } catch (error) {
        console.error(error);
        finish(1);
    }
});
