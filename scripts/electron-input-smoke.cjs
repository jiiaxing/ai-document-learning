const wsUrl = process.env.CDP_WS;

if (!wsUrl) {
    console.error('CDP_WS is required.');
    process.exit(1);
}

let nextId = 0;
const pending = new Map();
const ws = new WebSocket(wsUrl);
const timer = setTimeout(() => {
    console.error('CDP input smoke test timed out.');
    process.exit(1);
}, 20000);

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

async function waitForElement(id) {
    const quotedId = JSON.stringify(id);
    const deadline = Date.now() + 15000;
    while (Date.now() < deadline) {
        const result = await evaluate(`Boolean(document.getElementById(${quotedId}))`);
        if (result.result?.result?.value === true) {
            return;
        }
        await new Promise((resolve) => setTimeout(resolve, 200));
    }
    const debug = await evaluate(`({
        url: location.href,
        readyState: document.readyState,
        title: document.title,
        bodyText: document.body ? document.body.innerText.slice(0, 240) : '',
        htmlPrefix: document.documentElement ? document.documentElement.outerHTML.slice(0, 240) : ''
    })`);
    throw new Error(`Element was not found: ${id}; debug=${JSON.stringify(debug.result?.result?.value)}`);
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
        await new Promise((resolve) => setTimeout(resolve, 1500));
        await waitForElement('apiKey');

        const inputs = [
            { id: 'apiKey', text: 'desktop-key-test' },
            { id: 'manualTranslationInput', text: 'manual translation input ok' },
            { id: 'questionInput', text: 'chat input ok' }
        ];

        for (const input of inputs) {
            const id = JSON.stringify(input.id);
            await evaluate(`document.getElementById(${id}).focus(); document.getElementById(${id}).value = ''; undefined`);
            await send('Input.insertText', { text: input.text });
        }

        await evaluate(`
            document.getElementById('restoreTranslation').click();
            document.getElementById('restoreAssistant').click();
            undefined;
        `);
        await evaluate(`document.getElementById('collapseTranslation').click(); undefined;`);
        const translationOnlyLayout = (await evaluate(`(() => {
            const reader = document.querySelector('.reader-pane').getBoundingClientRect();
            const assistant = document.getElementById('assistantPane').getBoundingClientRect();
            return {
                readerLeft: reader.left,
                readerRight: reader.right,
                readerWidth: reader.width,
                assistantLeft: assistant.left,
                assistantWidth: assistant.width,
                translationCollapsed: document.getElementById('appShell').classList.contains('translation-collapsed')
            };
        })()`)).result?.result?.value;
        if (
            !translationOnlyLayout
            || translationOnlyLayout.translationCollapsed !== true
            || translationOnlyLayout.readerWidth < 420
            || translationOnlyLayout.assistantWidth < 250
            || translationOnlyLayout.readerLeft >= translationOnlyLayout.assistantLeft
            || translationOnlyLayout.readerRight > translationOnlyLayout.assistantLeft + 2
        ) {
            throw new Error(`Unexpected translation-collapse layout: ${JSON.stringify(translationOnlyLayout)}`);
        }

        await evaluate(`
            document.getElementById('restoreTranslation').click();
            document.getElementById('restoreAssistant').click();
            document.getElementById('collapseTranslation').click();
            document.getElementById('collapseAssistant').click();
            undefined;
        `);

        const result = await evaluate(`({
            apiKey: document.getElementById('apiKey').value,
            manual: document.getElementById('manualTranslationInput').value,
            question: document.getElementById('questionInput').value,
            translationCollapsed: document.getElementById('appShell').classList.contains('translation-collapsed'),
            assistantCollapsed: document.getElementById('appShell').classList.contains('assistant-collapsed')
        })`);

        const value = result.result?.result?.value;
        if (!value) {
            throw new Error(`Unexpected CDP result: ${JSON.stringify(result)}`);
        }
        if (
            value.apiKey !== 'desktop-key-test'
            || value.manual !== 'manual translation input ok'
            || value.question !== 'chat input ok'
            || value.translationCollapsed !== true
            || value.assistantCollapsed !== true
        ) {
            throw new Error(`Unexpected smoke result: ${JSON.stringify(value)}`);
        }
        await evaluate(`
            document.getElementById('restoreTranslation').click();
            document.getElementById('restoreAssistant').click();
            undefined;
        `);
        console.log(JSON.stringify(value));
        finish(0);
    } catch (error) {
        console.error(error);
        finish(1);
    }
});
