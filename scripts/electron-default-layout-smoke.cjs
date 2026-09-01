const wsUrl = process.env.CDP_WS;

if (!wsUrl) {
    console.error('CDP_WS is required.');
    process.exit(1);
}

let nextId = 0;
const pending = new Map();
const ws = new WebSocket(wsUrl);
const timer = setTimeout(() => {
    console.error('CDP default layout smoke test timed out.');
    process.exit(1);
}, 25000);

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
    return send('Runtime.evaluate', { expression, returnByValue: true });
}

async function waitUntil(expression, timeoutMs = 18000) {
    const deadline = Date.now() + timeoutMs;
    while (Date.now() < deadline) {
        const result = await evaluate(expression);
        if (result.result?.result?.value === true) {
            return;
        }
        await new Promise((resolve) => setTimeout(resolve, 250));
    }
    throw new Error(`Timed out waiting for: ${expression}`);
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
        await waitUntil('Boolean(document.getElementById("appShell"))');
        await evaluate(`
            localStorage.removeItem('aiPdfTutor.uiPrefs.v1');
            location.href = location.origin + '/?pdf=test.pdf&layoutSmoke=' + Date.now();
            true;
        `);
        await waitUntil('document.getElementById("clientLog")?.textContent.includes(\'"scale":2.32\')');
        await waitUntil('document.getElementById("pageInfo")?.textContent?.includes("/") && !document.getElementById("pageInfo").textContent.startsWith("-")');
        await waitUntil('Boolean(document.querySelector(".page-wrap[data-page=\\"1\\"] canvas"))');

        const result = await evaluate(`(() => {
            const shell = document.getElementById('appShell').getBoundingClientRect();
            const translation = document.getElementById('translationPane').getBoundingClientRect();
            const reader = document.querySelector('.reader-pane').getBoundingClientRect();
            const assistant = document.getElementById('assistantPane').getBoundingClientRect();
            return {
                defaultScaleLogged: document.getElementById('clientLog').textContent.includes('"scale":2.32'),
                shellWidth: Math.round(shell.width),
                translationWidth: Math.round(translation.width),
                readerWidth: Math.round(reader.width),
                assistantWidth: Math.round(assistant.width),
                translationRatio: Number((translation.width / shell.width).toFixed(3)),
                readerRatio: Number((reader.width / shell.width).toFixed(3)),
                assistantRatio: Number((assistant.width / shell.width).toFixed(3))
            };
        })()`);
        const value = result.result?.result?.value;
        if (!value) {
            throw new Error(`Unexpected CDP result: ${JSON.stringify(result)}`);
        }
        if (
            value.defaultScaleLogged !== true
            || value.translationRatio < 0.20
            || value.translationRatio > 0.24
            || value.readerRatio < 0.48
            || value.readerRatio > 0.54
            || value.assistantRatio < 0.24
            || value.assistantRatio > 0.28
        ) {
            throw new Error(`Unexpected default layout: ${JSON.stringify(value)}`);
        }
        console.log(JSON.stringify(value));
        finish(0);
    } catch (error) {
        console.error(error);
        finish(1);
    }
});
