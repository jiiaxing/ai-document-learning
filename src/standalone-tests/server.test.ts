import assert from 'node:assert/strict';
import { createServer, IncomingMessage, Server } from 'node:http';
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

test('config defaults to the DeepSeek vision preset for fresh installs', () => {
    const tempDir = mkdtempSync(join(tmpdir(), 'ai-pdf-tutor-'));
    try {
        const config = loadConfig(tempDir, {
            AI_TUTOR_LOG_FILE: join(tempDir, 'app.log')
        });

        assert.equal(config.provider.preset, 'deepseek');
        assert.equal(config.provider.kind, 'openaiCompatible');
        assert.equal(config.provider.protocol, 'openai');
        assert.equal(config.provider.endpoint, 'https://api.deepseek.com/chat/completions');
        assert.equal(config.provider.model, 'deepseek-v4-flash-vision-exp');
    } finally {
        rmSync(tempDir, { recursive: true, force: true });
    }
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
    assert.equal(deepSeekConfig.provider.model, 'deepseek-v4-flash-vision-exp');
});

test('config lets explicit environment provider override saved provider presets', () => {
    const tempDir = mkdtempSync(join(tmpdir(), 'ai-pdf-tutor-'));
    const configFile = join(tempDir, 'saved-settings.json');
    try {
        writeFileSync(configFile, JSON.stringify({
            provider: {
                preset: 'deepseek',
                kind: 'openaiCompatible',
                protocol: 'openai',
                endpoint: 'https://api.deepseek.com/chat/completions',
                model: 'deepseek-v4-flash-vision-exp',
                apiKey: 'saved-secret'
            }
        }), 'utf8');

        const config = loadConfig(tempDir, {
            AI_TUTOR_CONFIG: configFile,
            AI_TUTOR_PROVIDER: 'mock',
            AI_TUTOR_LOG_FILE: join(tempDir, 'app.log')
        });

        assert.equal(config.provider.preset, 'mock');
        assert.equal(config.provider.kind, 'mock');
    } finally {
        rmSync(tempDir, { recursive: true, force: true });
    }
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

        assert.match(config.systemPrompt, /必须基于/);
        assert.match(config.systemPrompt, /页面截图/);
        assert.match(config.systemPrompt, /不要主动描述页面出处/);
        assert.match(config.explainPromptTemplate, /必要上下文/);
        assert.match(config.translatePromptTemplate, /只输出译文/);
        assert.match(config.followupPromptTemplate, /只回答用户追问/);
        assert.equal(config.maxSelectionChars, 6000);
    } finally {
        rmSync(tempDir, { recursive: true, force: true });
    }
});

test('config migrates old visual-blind system prompt defaults', () => {
    const tempDir = mkdtempSync(join(tmpdir(), 'ai-pdf-tutor-'));
    const configFile = join(tempDir, 'old-visual-settings.json');
    try {
        writeFileSync(configFile, JSON.stringify({
            provider: { kind: 'mock' },
            systemPrompt: '你是计算机课程 PDF 助教。回答必须完全基于用户提供的 PDF 选区与周围页面上下文，不要编造外部资料。默认使用中英双语：中文解释为主，关键术语保留英文原词。只解释用户选中的内容或追问的问题，周围页面上下文只用于消歧、定位定义和补足前后逻辑。'
        }), 'utf8');

        const config = loadConfig(tempDir, {
            AI_TUTOR_CONFIG: configFile,
            AI_TUTOR_LOG_FILE: join(tempDir, 'app.log')
        });

        assert.match(config.systemPrompt, /页面截图/);
        assert.match(config.systemPrompt, /圈选截图/);
        assert.match(config.systemPrompt, /不要主动描述页面出处/);
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

test('reading file library imports PDFs and persists annotation notes', async () => {
    const tempDir = mkdtempSync(join(tmpdir(), 'ai-pdf-tutor-'));
    const logFile = join(tempDir, 'app.log');
    const libraryDir = join(tempDir, 'library');
    const config = loadConfig(tempDir, {
        AI_TUTOR_PROVIDER: 'mock',
        AI_TUTOR_PORT: '0',
        AI_TUTOR_LOG_FILE: logFile,
        AI_TUTOR_LIBRARY_DIR: libraryDir,
        AI_TUTOR_PUBLIC_DIR: join(tempDir, 'public')
    });
    const logger = new DeveloperLogger({ logFile, level: 'debug', echo: false });
    const server = createAppServer(config, logger);

    try {
        await new Promise<void>((resolveListen) => server.listen(0, '127.0.0.1', resolveListen));
        const port = getListeningPort(server);
        const baseUrl = `http://127.0.0.1:${port}`;

        const emptyListResponse = await fetch(`${baseUrl}/api/reading-files`);
        assert.equal(emptyListResponse.status, 200);
        assert.deepEqual(await emptyListResponse.json(), { files: [] });

        const importResponse = await fetch(`${baseUrl}/api/reading-files/import`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                name: 'unit lecture.pdf',
                dataBase64: Buffer.from(minimalPdfFixture()).toString('base64')
            })
        });

        assert.equal(importResponse.status, 201);
        const imported = await importResponse.json() as { file: { id: string; title: string; updatedAt: string } };
        assert.match(imported.file.id, /^doc_[0-9a-f-]{36}$/);
        assert.equal(imported.file.title, 'unit lecture.pdf');
        assert.match(imported.file.updatedAt, /^\d{4}-\d{2}-\d{2}T/);

        const listResponse = await fetch(`${baseUrl}/api/reading-files`);
        const list = await listResponse.json() as { files: Array<{ id: string; title: string; updatedAt: string }> };
        assert.deepEqual(list.files, [imported.file]);

        const pdfResponse = await fetch(`${baseUrl}/reading-files/${imported.file.id}/source.pdf`);
        assert.equal(pdfResponse.status, 200);
        assert.match(pdfResponse.headers.get('content-type') ?? '', /application\/pdf/);
        assert.ok((await pdfResponse.arrayBuffer()).byteLength > 100);

        const initialNotesResponse = await fetch(`${baseUrl}/api/reading-files/${imported.file.id}/notes`);
        assert.equal(initialNotesResponse.status, 200);
        assert.deepEqual(await initialNotesResponse.json(), { notes: {} });

        const notes = {
            1: [{
                id: 'note-1',
                type: 'highlight',
                page: 1,
                text: 'Operating systems',
                rects: [{ x: 0.1, y: 0.2, width: 0.3, height: 0.04 }],
                createdAt: new Date('2026-09-01T00:00:00.000Z').toISOString()
            }]
        };
        const saveNotesResponse = await fetch(`${baseUrl}/api/reading-files/${imported.file.id}/notes`, {
            method: 'PUT',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ notes })
        });
        assert.equal(saveNotesResponse.status, 200);

        const savedNotesResponse = await fetch(`${baseUrl}/api/reading-files/${imported.file.id}/notes`);
        assert.deepEqual(await savedNotesResponse.json(), { notes });

        const documentDir = join(libraryDir, 'documents', imported.file.id);
        assert.equal(existsSync(join(documentDir, 'source.pdf')), true);
        assert.equal(existsSync(join(documentDir, 'notes.json')), true);
        assert.match(readFileSync(join(libraryDir, 'library.json'), 'utf8'), /unit lecture\.pdf/);
        assert.match(readFileSync(join(documentDir, 'notes.json'), 'utf8'), /Operating systems/);

        const deleteResponse = await fetch(`${baseUrl}/api/reading-files/${imported.file.id}`, {
            method: 'DELETE'
        });
        assert.equal(deleteResponse.status, 200);
        assert.equal(existsSync(documentDir), false);

        const emptyAfterDelete = await fetch(`${baseUrl}/api/reading-files`);
        assert.deepEqual(await emptyAfterDelete.json(), { files: [] });
        assert.doesNotMatch(readFileSync(join(libraryDir, 'library.json'), 'utf8'), /unit lecture\.pdf/);

        const missingPdfResponse = await fetch(`${baseUrl}/reading-files/${imported.file.id}/source.pdf`);
        assert.equal(missingPdfResponse.status, 404);
        const missingNotesResponse = await fetch(`${baseUrl}/api/reading-files/${imported.file.id}/notes`);
        assert.equal(missingNotesResponse.status, 404);
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
                    extraBodyJson: '{}',
                    deepSeekThinkingTranslate: true,
                    deepSeekThinkingExplain: true
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
        assert.match(settingsText, /"deepSeekThinkingTranslate":true/);
        assert.match(settingsText, /"deepSeekThinkingExplain":true/);
        assert.doesNotMatch(settingsText, /unit-secret/);

        const settingsResponse = await fetch(`http://127.0.0.1:${port}/api/settings`);
        const savedText = await settingsResponse.text();
        assert.match(savedText, /unit-model/);
        assert.match(savedText, /example\.test\/v1\/chat\/completions/);
        assert.match(savedText, /system unit prompt/);
        assert.match(savedText, /"deepSeekThinkingTranslate":true/);
        assert.match(savedText, /"deepSeekThinkingExplain":true/);
        assert.doesNotMatch(savedText, /unit-secret/);

        const persistedText = readFileSync(configFile, 'utf8');
        assert.match(persistedText, /unit-secret/);
        assert.match(persistedText, /"apiKeyPrefix": "Bearer "/);
        assert.match(persistedText, /"deepSeekThinkingTranslate": true/);
        assert.match(persistedText, /"deepSeekThinkingExplain": true/);
        assert.match(persistedText, /"port": 5178/);
        assert.equal(existsSync(join(tempDir, 'ai-tutor.config.json')), false);

        const preserveResponse = await fetch(`http://127.0.0.1:${port}/api/settings`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                provider: {
                    preset: 'custom',
                    kind: 'openaiCompatible',
                    protocol: 'openai',
                    endpoint: 'https://example.test/v1',
                    model: 'unit-model-again',
                    apiKey: ''
                }
            })
        });

        assert.equal(preserveResponse.status, 200);
        const preservedSettings = await preserveResponse.json() as { provider: { apiKeyConfigured?: boolean; model?: string } };
        assert.equal(preservedSettings.provider.apiKeyConfigured, true);
        assert.equal(preservedSettings.provider.model, 'unit-model-again');

        const reloadedConfig = loadConfig(tempDir, {
            AI_TUTOR_CONFIG: configFile,
            AI_TUTOR_LOG_FILE: logFile,
            AI_TUTOR_PUBLIC_DIR: join(tempDir, 'public')
        });
        assert.equal(reloadedConfig.provider.apiKey, 'unit-secret');
        assert.equal(reloadedConfig.provider.model, 'unit-model-again');

        const switchResponse = await fetch(`http://127.0.0.1:${port}/api/settings`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                provider: {
                    preset: 'deepseek',
                    kind: 'openaiCompatible',
                    model: 'deepseek-v4-flash-vision-exp',
                    apiKey: ''
                }
            })
        });

        assert.equal(switchResponse.status, 200);
        const switchedSettings = await switchResponse.json() as { provider: { apiKeyConfigured?: boolean; preset?: string; endpoint?: string } };
        assert.equal(switchedSettings.provider.preset, 'deepseek');
        assert.equal(switchedSettings.provider.apiKeyConfigured, false);
        assert.match(switchedSettings.provider.endpoint ?? '', /api\.deepseek\.com/);

        const switchedText = readFileSync(configFile, 'utf8');
        assert.doesNotMatch(switchedText, /unit-secret/);
        assert.match(switchedText, /"preset": "deepseek"/);
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

test('DeepSeek requests honor per-task thinking settings', async () => {
    const tempDir = mkdtempSync(join(tmpdir(), 'ai-pdf-tutor-'));
    const logFile = join(tempDir, 'app.log');
    const configFile = join(tempDir, 'deepseek-settings.json');
    const upstreamBodies: Array<Record<string, unknown>> = [];
    const upstream = createServer(async (req, res) => {
        const rawBody = await readRawRequestBody(req);
        upstreamBodies.push(JSON.parse(rawBody) as Record<string, unknown>);
        res.writeHead(200, { 'Content-Type': 'text/event-stream' });
        res.write(`data: ${JSON.stringify({ choices: [{ delta: { content: 'ok' } }] })}\n\n`);
        res.write('data: [DONE]\n\n');
        res.end();
    });

    try {
        await new Promise<void>((resolveListen) => upstream.listen(0, '127.0.0.1', resolveListen));
        const upstreamPort = getListeningPort(upstream);

        const runScenario = async (
            providerOverrides: Record<string, unknown>,
            requests: Array<{ mode: 'translate' | 'explain' | 'ask'; text: string }>
        ): Promise<void> => {
            writeFileSync(configFile, JSON.stringify({
                provider: {
                    preset: 'deepseek',
                    kind: 'openaiCompatible',
                    protocol: 'openai',
                    endpoint: `http://127.0.0.1:${upstreamPort}/chat/completions`,
                    model: 'deepseek-v4-flash-vision-exp',
                    apiKey: 'unit-secret',
                    extraBody: {},
                    ...providerOverrides
                },
                explainPromptTemplate: 'explain {{text}}',
                translatePromptTemplate: 'translate {{text}}'
            }), 'utf8');

            const config = loadConfig(tempDir, {
                AI_TUTOR_CONFIG: configFile,
                AI_TUTOR_LOG_FILE: logFile,
                AI_TUTOR_PUBLIC_DIR: join(tempDir, 'public')
            });
            const logger = new DeveloperLogger({ logFile, level: 'debug', echo: false });
            const scenarioServer = createAppServer(config, logger);

            try {
                await new Promise<void>((resolveListen) => scenarioServer.listen(0, '127.0.0.1', resolveListen));
                const appPort = getListeningPort(scenarioServer);

                for (const request of requests) {
                    const response = await fetch(`http://127.0.0.1:${appPort}/api/explain`, {
                        method: 'POST',
                        headers: { 'Content-Type': 'application/json' },
                        body: JSON.stringify({
                            ...request,
                            source: 'unit-test.pdf p.2'
                        })
                    });
                    assert.equal(response.status, 200);
                    await response.text();
                }
            } finally {
                await closeServer(scenarioServer);
            }
        };

        await runScenario({}, [
            { mode: 'translate', text: 'Operating systems provide abstraction.' },
            { mode: 'explain', text: 'Operating systems provide abstraction.' }
        ]);
        await runScenario({ deepSeekThinkingTranslate: true, deepSeekThinkingExplain: false }, [
            { mode: 'translate', text: 'Operating systems provide abstraction.' },
            { mode: 'explain', text: 'Operating systems provide abstraction.' }
        ]);
        await runScenario({ deepSeekThinkingTranslate: false, deepSeekThinkingExplain: true }, [
            { mode: 'ask', text: 'What does abstraction mean here?' }
        ]);

        assert.equal(upstreamBodies.length, 5);
        assert.deepEqual(upstreamBodies[0].thinking, { type: 'disabled' });
        assert.deepEqual(upstreamBodies[1].thinking, { type: 'disabled' });
        assert.deepEqual(upstreamBodies[2].thinking, { type: 'enabled' });
        assert.deepEqual(upstreamBodies[3].thinking, { type: 'disabled' });
        assert.deepEqual(upstreamBodies[4].thinking, { type: 'enabled' });
    } finally {
        await closeServer(upstream);
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

test('OpenAI-compatible image requests use configured explain prompt transparently', async () => {
    const tempDir = mkdtempSync(join(tmpdir(), 'ai-pdf-tutor-'));
    const logFile = join(tempDir, 'app.log');
    const configFile = join(tempDir, 'vision-settings.json');
    const upstreamBodies: Array<Record<string, unknown>> = [];
    const upstream = createServer(async (req, res) => {
        const rawBody = await readRawRequestBody(req);
        upstreamBodies.push(JSON.parse(rawBody) as Record<string, unknown>);
        res.writeHead(200, { 'Content-Type': 'text/event-stream' });
        res.write(`data: ${JSON.stringify({ choices: [{ delta: { content: 'ok' } }] })}\n\n`);
        res.write('data: [DONE]\n\n');
        res.end();
    });
    let appServer: Server | undefined;

    try {
        await new Promise<void>((resolveListen) => upstream.listen(0, '127.0.0.1', resolveListen));
        const upstreamPort = getListeningPort(upstream);
        writeFileSync(configFile, JSON.stringify({
            provider: {
                preset: 'deepseek',
                kind: 'openaiCompatible',
                protocol: 'openai',
                endpoint: `http://127.0.0.1:${upstreamPort}/chat/completions`,
                model: 'deepseek-v4-flash-vision-exp',
                apiKey: 'unit-secret',
                extraBody: {}
            },
            explainPromptTemplate: 'CUSTOM_EXPLAIN text={{text}} context={{pageContext}} source={{source}}'
        }), 'utf8');

        const config = loadConfig(tempDir, {
            AI_TUTOR_CONFIG: configFile,
            AI_TUTOR_LOG_FILE: logFile,
            AI_TUTOR_PUBLIC_DIR: join(tempDir, 'public')
        });
        const logger = new DeveloperLogger({ logFile, level: 'debug', echo: false });
        appServer = createAppServer(config, logger);
        await new Promise<void>((resolveListen) => appServer?.listen(0, '127.0.0.1', resolveListen));
        const appPort = getListeningPort(appServer);

        const response = await fetch(`http://127.0.0.1:${appPort}/api/explain`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                mode: 'explain',
                text: 'Operating System Concepts Chapter 1 Introduction',
                pageContext: '[Page 1] Operating System Concepts',
                selectionContext: 'Operating System Concepts Chapter 1 Introduction',
                source: 'unit-test.pdf p.1 当前页',
                images: [{
                    name: 'page.png',
                    mimeType: 'image/png',
                    dataUrl: 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+/p9sAAAAASUVORK5CYII='
                }]
            })
        });

        assert.equal(response.status, 200);
        await response.text();

        assert.equal(upstreamBodies.length, 1);
        const messages = upstreamBodies[0].messages as Array<{ role?: string; content?: unknown }>;
        const systemPrompt = String(messages.find((message) => message.role === 'system')?.content ?? '');
        const userContent = messages[messages.length - 1]?.content as Array<{ type?: string; text?: string; image_url?: { url?: string } }>;
        const userPrompt = userContent
            .filter((part) => part.type === 'text')
            .map((part) => part.text ?? '')
            .join('\n');

        assert.match(systemPrompt, /页面截图/);
        assert.match(systemPrompt, /不要主动描述页面出处/);
        assert.match(userPrompt, /CUSTOM_EXPLAIN/);
        assert.match(userPrompt, /text=Operating System Concepts Chapter 1 Introduction/);
        assert.match(userPrompt, /context=\[Page 1\] Operating System Concepts/);
        assert.match(userPrompt, /source=unit-test\.pdf p\.1 当前页/);
        assert.equal(userPrompt.includes('## 图片附件'), false);
        assert.equal(userPrompt.includes('请优先根据图片中的可见内容回答'), false);
        assert.equal(userPrompt.includes('我无法读取这张图片'), false);
        assert.ok(userContent.some((part) => part.type === 'image_url' && part.image_url?.url?.startsWith('data:image/png;base64,')));
    } finally {
        if (appServer) {
            await closeServer(appServer);
        }
        await closeServer(upstream);
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

async function readRawRequestBody(req: IncomingMessage): Promise<string> {
    const chunks: Buffer[] = [];
    for await (const chunk of req) {
        chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
    }
    return Buffer.concat(chunks).toString('utf8');
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
