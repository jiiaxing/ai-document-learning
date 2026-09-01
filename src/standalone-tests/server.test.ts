import assert from 'node:assert/strict';
import { createServer, Server } from 'node:http';
import { AddressInfo } from 'node:net';
import { copyFileSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import test from 'node:test';
import { loadConfig } from '../standalone/config';
import { DeveloperLogger } from '../standalone/logger';
import { createAppServer, startServer } from '../standalone/server';

test('config normalizes OpenAI base endpoints and bearer prefixes', () => {
    const config = loadConfig(resolve(__dirname, '../..'), {
        AI_TUTOR_PROVIDER: 'openaiCompatible',
        AI_TUTOR_API_KEY: 'unit-secret',
        AI_TUTOR_ENDPOINT: 'https://example.test/v1',
        AI_TUTOR_API_KEY_PREFIX: 'Bearer'
    });

    assert.equal(config.provider.endpoint, 'https://example.test/v1/chat/completions');
    assert.equal(config.provider.apiKeyPrefix, 'Bearer ');
});

test('config normalizes response paths when switching protocols', () => {
    const openAiConfig = loadConfig(resolve(__dirname, '../..'), {
        AI_TUTOR_PROVIDER: 'openaiCompatible',
        AI_TUTOR_API_KEY: 'unit-secret',
        AI_TUTOR_PROTOCOL: 'openai',
        AI_TUTOR_RESPONSE_TEXT_PATH: 'content.0.text'
    });
    const anthropicConfig = loadConfig(resolve(__dirname, '../..'), {
        AI_TUTOR_PROVIDER: 'openaiCompatible',
        AI_TUTOR_API_KEY: 'unit-secret',
        AI_TUTOR_PROTOCOL: 'anthropic',
        AI_TUTOR_RESPONSE_TEXT_PATH: 'choices.0.message.content'
    });

    assert.equal(openAiConfig.provider.responseTextPath, 'choices.0.message.content');
    assert.equal(anthropicConfig.provider.responseTextPath, 'content.0.text');
});

test('config supports OpenAI and DeepSeek provider presets', () => {
    const openAiConfig = loadConfig(resolve(__dirname, '../..'), {
        AI_TUTOR_PROVIDER_PRESET: 'openai',
        AI_TUTOR_API_KEY: 'unit-secret'
    });
    const deepSeekConfig = loadConfig(resolve(__dirname, '../..'), {
        AI_TUTOR_PROVIDER_PRESET: 'deepseek',
        AI_TUTOR_API_KEY: 'unit-secret'
    });

    assert.equal(openAiConfig.provider.preset, 'openai');
    assert.equal(openAiConfig.provider.kind, 'openaiCompatible');
    assert.equal(openAiConfig.provider.protocol, 'openai');
    assert.equal(openAiConfig.provider.endpoint, 'https://api.openai.com/v1/chat/completions');
    assert.equal(openAiConfig.provider.model, 'gpt-5');

    assert.equal(deepSeekConfig.provider.preset, 'deepseek');
    assert.equal(deepSeekConfig.provider.kind, 'openaiCompatible');
    assert.equal(deepSeekConfig.provider.protocol, 'openai');
    assert.equal(deepSeekConfig.provider.endpoint, 'https://api.deepseek.com/chat/completions');
    assert.equal(deepSeekConfig.provider.model, 'deepseek-v4-pro');
});

test('config migrates legacy prompt defaults for contextual explanation', () => {
    const tempDir = mkdtempSync(join(tmpdir(), 'ai-pdf-tutor-'));
    const configFile = join(tempDir, 'legacy-settings.json');
    try {
        writeFileSync(configFile, JSON.stringify({
            provider: { kind: 'mock' },
            systemPrompt: '你是计算机课程 PDF 助教。默认使用中文回答，保留关键英文术语，并给出术语对照。',
            explainPromptTemplate: '输出请包含：一句话总结、关键术语对照、分块解释、可追问的问题。',
            translatePromptTemplate: '不要扩写讲解，只做准确翻译。',
            followupPromptTemplate: '请结合原文回答，并标注引用到的关键英文短语。',
            maxSelectionChars: 1200
        }), 'utf8');

        const config = loadConfig(tempDir, {
            AI_TUTOR_CONFIG: configFile,
            AI_TUTOR_LOG_FILE: join(tempDir, 'app.log')
        });

        assert.match(config.systemPrompt, /完全基于/);
        assert.match(config.explainPromptTemplate, /周围页面上下文/);
        assert.match(config.translatePromptTemplate, /结构化翻译/);
        assert.match(config.followupPromptTemplate, /只回答用户追问/);
        assert.equal(config.maxSelectionChars, 6000);
    } finally {
        rmSync(tempDir, { recursive: true, force: true });
    }
});

test('standalone server streams mock explanation and writes workflow logs', async () => {
    const tempDir = mkdtempSync(join(tmpdir(), 'ai-pdf-tutor-'));
    const logFile = join(tempDir, 'app.log');
    const config = loadConfig(resolve(__dirname, '../..'), {
        AI_TUTOR_PROVIDER: 'mock',
        AI_TUTOR_PORT: '0',
        AI_TUTOR_LOG_LEVEL: 'debug',
        AI_TUTOR_LOG_FILE: logFile,
        AI_TUTOR_MOCK_DELAY_MS: '0'
    });
    const logger = new DeveloperLogger({ logFile, level: 'debug', echo: false });
    const server = createAppServer(config, logger);

    try {
        await new Promise<void>((resolveListen) => server.listen(0, '127.0.0.1', resolveListen));
        const port = getListeningPort(server);

        const response = await fetch(`http://127.0.0.1:${port}/api/explain`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                text: 'The operating system manages virtual memory with page tables and cache-friendly locality.',
                source: 'unit-test.pdf p.1'
            })
        });

        assert.equal(response.status, 200);
        assert.match(response.headers.get('content-type') ?? '', /text\/event-stream/);

        const streamText = await response.text();
        assert.match(streamText, /event: start/);
        assert.match(streamText, /event: delta/);
        assert.match(streamText, /event: done/);
        assert.match(extractDeltaText(streamText), /virtual memory/);

        await closeServer(server);

        const recentEvents = logger.recent(100).map((entry) => entry.event);
        assert.ok(recentEvents.includes('http.request'));
        assert.ok(recentEvents.includes('explain.request.received'));
        assert.ok(recentEvents.includes('provider.mock.start'));
        assert.ok(recentEvents.includes('provider.mock.chunk'));
        assert.ok(recentEvents.includes('explain.response.done'));

        const logText = readFileSync(logFile, 'utf8');
        assert.match(logText, /"event":"explain.request.received"/);
        assert.match(logText, /"event":"explain.response.done"/);
    } finally {
        await closeServer(server);
        rmSync(tempDir, { recursive: true, force: true });
    }
});

test('client log endpoint records browser-side workflow events', async () => {
    const tempDir = mkdtempSync(join(tmpdir(), 'ai-pdf-tutor-'));
    const logFile = join(tempDir, 'app.log');
    const config = loadConfig(resolve(__dirname, '../..'), {
        AI_TUTOR_PROVIDER: 'mock',
        AI_TUTOR_PORT: '0',
        AI_TUTOR_LOG_LEVEL: 'debug',
        AI_TUTOR_LOG_FILE: logFile
    });
    const logger = new DeveloperLogger({ logFile, level: 'debug', echo: false });
    const server = createAppServer(config, logger);

    try {
        await new Promise<void>((resolveListen) => server.listen(0, '127.0.0.1', resolveListen));
        const port = getListeningPort(server);

        const response = await fetch(`http://127.0.0.1:${port}/api/logs/client`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                event: 'selection.trigger',
                page: 2,
                textLength: 64
            })
        });

        assert.equal(response.status, 200);
        await response.json();
        await closeServer(server);

        assert.ok(logger.recent(20).some((entry) => entry.event === 'client.selection.trigger'));
        assert.match(readFileSync(logFile, 'utf8'), /client.selection.trigger/);
    } finally {
        await closeServer(server);
        rmSync(tempDir, { recursive: true, force: true });
    }
});

test('startServer falls back to the next port when configured port is busy', async () => {
    const tempDir = mkdtempSync(join(tmpdir(), 'ai-pdf-tutor-'));
    const logFile = join(tempDir, 'app.log');
    const blocker = createServer((_req, res) => {
        res.end('occupied');
    });
    let started: Awaited<ReturnType<typeof startServer>> | undefined;

    try {
        await new Promise<void>((resolveListen) => blocker.listen(0, '127.0.0.1', resolveListen));
        const blockedPort = getListeningPort(blocker);
        const config = loadConfig(resolve(__dirname, '../..'), {
            AI_TUTOR_PROVIDER: 'mock',
            AI_TUTOR_PORT: String(blockedPort),
            AI_TUTOR_LOG_LEVEL: 'debug',
            AI_TUTOR_LOG_FILE: logFile
        });
        const logger = new DeveloperLogger({ logFile, level: 'debug', echo: false });

        started = await startServer(config, logger);
        const actualPort = Number(new URL(started.url).port);

        assert.notEqual(actualPort, blockedPort);
        assert.ok(logger.recent(100).some((entry) => entry.event === 'app.port.in_use'));
        assert.ok(logger.recent(100).some((entry) => entry.event === 'app.start'));
    } finally {
        if (started) {
            await closeServer(started.server);
        }
        await closeServer(blocker);
        rmSync(tempDir, { recursive: true, force: true });
    }
});

test('server exposes local PDF.js assets and workspace PDF test file', async () => {
    const tempDir = mkdtempSync(join(tmpdir(), 'ai-pdf-tutor-'));
    const logFile = join(tempDir, 'app.log');
    writeFileSync(join(tempDir, 'sample.pdf'), minimalPdfFixture());
    const config = loadConfig(tempDir, {
        AI_TUTOR_PROVIDER: 'mock',
        AI_TUTOR_PORT: '0',
        AI_TUTOR_LOG_LEVEL: 'debug',
        AI_TUTOR_LOG_FILE: logFile
    });
    const pdfJsDir = join(tempDir, 'node_modules/pdfjs-dist/build');
    mkdirSync(pdfJsDir, { recursive: true });
    copyFileSync(join(resolve(__dirname, '../..'), 'node_modules/pdfjs-dist/build/pdf.mjs'), join(pdfJsDir, 'pdf.mjs'));
    const logger = new DeveloperLogger({ logFile, level: 'debug', echo: false });
    const server = createAppServer(config, logger);

    try {
        await new Promise<void>((resolveListen) => server.listen(0, '127.0.0.1', resolveListen));
        const port = getListeningPort(server);
        const baseUrl = `http://127.0.0.1:${port}`;

        const vendorResponse = await fetch(`${baseUrl}/vendor/pdfjs/pdf.mjs`);
        assert.equal(vendorResponse.status, 200);
        assert.match(vendorResponse.headers.get('content-type') ?? '', /javascript/);
        assert.match(await vendorResponse.text(), /getDocument/);

        const pdfListResponse = await fetch(`${baseUrl}/api/local-pdfs`);
        assert.equal(pdfListResponse.status, 200);
        const pdfList = await pdfListResponse.json() as { files?: Array<{ name?: string }> };
        assert.ok(pdfList.files?.some((file) => file.name === 'sample.pdf'));

        const pdfResponse = await fetch(`${baseUrl}/local-pdfs/sample.pdf`);
        assert.equal(pdfResponse.status, 200);
        assert.match(pdfResponse.headers.get('content-type') ?? '', /application\/pdf/);
        assert.ok((await pdfResponse.arrayBuffer()).byteLength > 100);
    } finally {
        await closeServer(server);
        rmSync(tempDir, { recursive: true, force: true });
    }
});

test('settings endpoint saves provider config without echoing API key', async () => {
    const tempDir = mkdtempSync(join(tmpdir(), 'ai-pdf-tutor-'));
    const logFile = join(tempDir, 'app.log');
    const configFile = join(tempDir, 'custom-settings.json');
    const config = loadConfig(tempDir, {
        AI_TUTOR_CONFIG: configFile,
        AI_TUTOR_PROVIDER: 'mock',
        AI_TUTOR_PORT: '0',
        AI_TUTOR_LOG_LEVEL: 'debug',
        AI_TUTOR_LOG_FILE: logFile,
        AI_TUTOR_PUBLIC_DIR: join(tempDir, 'public')
    });
    const logger = new DeveloperLogger({ logFile, level: 'debug', echo: false });
    const server = createAppServer(config, logger);

    try {
        await new Promise<void>((resolveListen) => server.listen(0, '127.0.0.1', resolveListen));
        const port = getListeningPort(server);
        const response = await fetch(`http://127.0.0.1:${port}/api/settings`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                provider: {
                    kind: 'openaiCompatible',
                    protocol: 'openai',
                    endpoint: 'https://example.test/v1',
                    model: 'unit-model',
                    apiKey: 'unit-secret',
                    apiKeyHeader: 'Authorization',
                    apiKeyPrefix: 'Bearer',
                    responseTextPath: 'choices.0.message.content',
                    extraHeadersJson: '{}',
                    extraBodyJson: '{}'
                },
                systemPrompt: 'system unit prompt',
                explainPromptTemplate: 'explain {{text}}',
                translatePromptTemplate: 'translate {{text}}',
                followupPromptTemplate: 'follow {{question}}',
                maxSelectionChars: 900
            })
        });

        assert.equal(response.status, 200);
        const settingsText = await response.text();
        assert.match(settingsText, /"apiKeyConfigured":true/);
        assert.doesNotMatch(settingsText, /unit-secret/);

        const settingsResponse = await fetch(`http://127.0.0.1:${port}/api/settings`);
        const savedText = await settingsResponse.text();
        assert.match(savedText, /unit-model/);
        assert.match(savedText, /example\.test\/v1\/chat\/completions/);
        assert.match(savedText, /system unit prompt/);
        assert.doesNotMatch(savedText, /unit-secret/);

        const persistedText = readFileSync(configFile, 'utf8');
        assert.match(persistedText, /unit-secret/);
        assert.match(persistedText, /"apiKeyPrefix": "Bearer "/);
        assert.match(persistedText, /"port": 5178/);
        assert.equal(existsSync(join(tempDir, 'ai-tutor.config.json')), false);
    } finally {
        await closeServer(server);
        rmSync(tempDir, { recursive: true, force: true });
    }
});

test('settings endpoint rejects obviously mismatched protocol and endpoint pairs', async () => {
    const tempDir = mkdtempSync(join(tmpdir(), 'ai-pdf-tutor-'));
    const logFile = join(tempDir, 'app.log');
    const configFile = join(tempDir, 'custom-settings.json');
    const config = loadConfig(tempDir, {
        AI_TUTOR_CONFIG: configFile,
        AI_TUTOR_PROVIDER: 'mock',
        AI_TUTOR_PORT: '0',
        AI_TUTOR_LOG_FILE: logFile,
        AI_TUTOR_PUBLIC_DIR: join(tempDir, 'public')
    });
    const logger = new DeveloperLogger({ logFile, level: 'debug', echo: false });
    const server = createAppServer(config, logger);

    try {
        await new Promise<void>((resolveListen) => server.listen(0, '127.0.0.1', resolveListen));
        const port = getListeningPort(server);
        const response = await fetch(`http://127.0.0.1:${port}/api/settings`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                provider: {
                    kind: 'openaiCompatible',
                    protocol: 'anthropic',
                    endpoint: 'https://example.test/v1/chat/completions',
                    model: 'unit-model',
                    apiKey: 'unit-secret'
                }
            })
        });

        assert.equal(response.status, 400);
        assert.match(await response.text(), /协议和 Endpoint 不匹配/);
        assert.equal(existsSync(configFile), false);
    } finally {
        await closeServer(server);
        rmSync(tempDir, { recursive: true, force: true });
    }
});

test('stream endpoint supports translate mode', async () => {
    const tempDir = mkdtempSync(join(tmpdir(), 'ai-pdf-tutor-'));
    const logFile = join(tempDir, 'app.log');
    const config = loadConfig(resolve(__dirname, '../..'), {
        AI_TUTOR_PROVIDER: 'mock',
        AI_TUTOR_PORT: '0',
        AI_TUTOR_LOG_LEVEL: 'debug',
        AI_TUTOR_LOG_FILE: logFile,
        AI_TUTOR_MOCK_DELAY_MS: '0'
    });
    const logger = new DeveloperLogger({ logFile, level: 'debug', echo: false });
    const server = createAppServer(config, logger);

    try {
        await new Promise<void>((resolveListen) => server.listen(0, '127.0.0.1', resolveListen));
        const port = getListeningPort(server);
        const response = await fetch(`http://127.0.0.1:${port}/api/explain`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                mode: 'translate',
                text: 'Operating systems provide abstraction for hardware resources.',
                pageContext: '[Page 2] Operating systems sit between applications and hardware.',
                source: 'unit-test.pdf p.2'
            })
        });

        assert.equal(response.status, 200);
        const streamText = await response.text();
        assert.match(streamText, /event: delta/);
        assert.match(extractDeltaText(streamText), /翻译/);
        assert.ok(logger.recent(100).some((entry) => {
            const data = entry.data as { mode?: string; pageContextLength?: number };
            return entry.event === 'explain.request.received'
                && data.mode === 'translate'
                && Number(data.pageContextLength) > 0;
        }));
    } finally {
        await closeServer(server);
        rmSync(tempDir, { recursive: true, force: true });
    }
});

test('stream endpoint accepts image attachments and writes image workflow logs', async () => {
    const tempDir = mkdtempSync(join(tmpdir(), 'ai-pdf-tutor-'));
    const logFile = join(tempDir, 'app.log');
    const config = loadConfig(resolve(__dirname, '../..'), {
        AI_TUTOR_PROVIDER: 'mock',
        AI_TUTOR_PORT: '0',
        AI_TUTOR_LOG_LEVEL: 'debug',
        AI_TUTOR_LOG_FILE: logFile,
        AI_TUTOR_MOCK_DELAY_MS: '0'
    });
    const logger = new DeveloperLogger({ logFile, level: 'debug', echo: false });
    const server = createAppServer(config, logger);

    try {
        await new Promise<void>((resolveListen) => server.listen(0, '127.0.0.1', resolveListen));
        const port = getListeningPort(server);
        const response = await fetch(`http://127.0.0.1:${port}/api/explain`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                text: '请结合图片讲解 virtual memory diagram.',
                source: 'unit-test.pdf p.3 · 图片 1 张',
                images: [{
                    name: 'pixel.png',
                    mimeType: 'image/png',
                    dataUrl: 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+/p9sAAAAASUVORK5CYII='
                }]
            })
        });

        assert.equal(response.status, 200);
        const streamText = await response.text();
        assert.match(extractDeltaText(streamText), /已收到 1 张图片/);

        const requestEvent = logger.recent(100).find((entry) => entry.event === 'explain.request.received');
        const providerEvent = logger.recent(100).find((entry) => entry.event === 'provider.mock.start');
        assert.equal((requestEvent?.data as { imageCount?: number } | undefined)?.imageCount, 1);
        assert.equal((providerEvent?.data as { imageCount?: number } | undefined)?.imageCount, 1);
        assert.match(readFileSync(logFile, 'utf8'), /"imageCount":1/);
    } finally {
        await closeServer(server);
        rmSync(tempDir, { recursive: true, force: true });
    }
});

test('stream endpoint supports free ask mode without forcing a selection', async () => {
    const tempDir = mkdtempSync(join(tmpdir(), 'ai-pdf-tutor-'));
    const logFile = join(tempDir, 'app.log');
    const config = loadConfig(resolve(__dirname, '../..'), {
        AI_TUTOR_PROVIDER: 'mock',
        AI_TUTOR_PORT: '0',
        AI_TUTOR_LOG_LEVEL: 'debug',
        AI_TUTOR_LOG_FILE: logFile,
        AI_TUTOR_MOCK_DELAY_MS: '0'
    });
    const logger = new DeveloperLogger({ logFile, level: 'debug', echo: false });
    const server = createAppServer(config, logger);

    try {
        await new Promise<void>((resolveListen) => server.listen(0, '127.0.0.1', resolveListen));
        const port = getListeningPort(server);
        const response = await fetch(`http://127.0.0.1:${port}/api/explain`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                mode: 'ask',
                text: '这张封面页说明了什么？',
                pageContext: '[Page 1] OPERATING SYSTEM CONCEPTS Chapter 1. Introduction',
                selectionContext: 'OPERATING SYSTEM CONCEPTS',
                source: 'unit-test.pdf p.1 · 含当前选区参考'
            })
        });

        assert.equal(response.status, 200);
        const streamText = await response.text();
        assert.match(extractDeltaText(streamText), /自由提问回答/);
        assert.ok(logger.recent(100).some((entry) => {
            const data = entry.data as { mode?: string; selectionContextLength?: number };
            return entry.event === 'explain.request.received'
                && data.mode === 'ask'
                && Number(data.selectionContextLength) > 0;
        }));
    } finally {
        await closeServer(server);
        rmSync(tempDir, { recursive: true, force: true });
    }
});

function getListeningPort(server: Server): number {
    const address = server.address();
    assert.notEqual(address, null);
    assert.notEqual(typeof address, 'string');
    return (address as AddressInfo).port;
}

function closeServer(server: Server): Promise<void> {
    if (!server.listening) {
        return Promise.resolve();
    }

    return new Promise((resolveClose, rejectClose) => {
        server.close((error) => {
            if (error) {
                rejectClose(error);
                return;
            }
            resolveClose();
        });
    });
}

function minimalPdfFixture(): string {
    return [
        '%PDF-1.4',
        '1 0 obj<</Type/Catalog/Pages 2 0 R>>endobj',
        '2 0 obj<</Type/Pages/Count 1/Kids[3 0 R]>>endobj',
        '3 0 obj<</Type/Page/Parent 2 0 R/MediaBox[0 0 200 200]/Contents 4 0 R>>endobj',
        '4 0 obj<</Length 44>>stream',
        'BT /F1 12 Tf 36 120 Td (AI PDF Tutor) Tj ET',
        'endstream endobj',
        'xref',
        '0 5',
        '0000000000 65535 f ',
        '0000000009 00000 n ',
        '0000000056 00000 n ',
        '0000000111 00000 n ',
        '0000000190 00000 n ',
        'trailer<</Root 1 0 R/Size 5>>',
        'startxref',
        '284',
        '%%EOF'
    ].join('\n');
}

function extractDeltaText(streamText: string): string {
    return streamText
        .split(/\r?\n\r?\n/)
        .map((eventText) => {
            if (!eventText.includes('event: delta')) {
                return '';
            }
            const data = eventText
                .split(/\r?\n/)
                .filter((line) => line.startsWith('data:'))
                .map((line) => line.slice(5).trim())
                .join('\n');
            return data ? String((JSON.parse(data) as { text?: unknown }).text ?? '') : '';
        })
        .join('');
}
