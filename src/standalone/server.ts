import { createServer, IncomingMessage, Server, ServerResponse } from 'node:http';
import { createReadStream, existsSync, readdirSync, statSync } from 'node:fs';
import { basename, dirname, extname, join, normalize, resolve, sep } from 'node:path';
import { SettingsValidationError, applySettingsUpdate, loadConfig, publicSettingsFromConfig, saveConfigFile } from './config';
import { createProvider } from './aiProvider';
import { DeveloperLogger } from './logger';
import { prepareSse, writeSse } from './sse';
import { AppConfig, ChatMessage, ExplainRequest, ImageAttachment, SafeClientConfig, SettingsUpdate } from './types';

const contentTypes: Record<string, string> = {
    '.html': 'text/html; charset=utf-8',
    '.js': 'text/javascript; charset=utf-8',
    '.mjs': 'text/javascript; charset=utf-8',
    '.css': 'text/css; charset=utf-8',
    '.json': 'application/json; charset=utf-8',
    '.svg': 'image/svg+xml',
    '.png': 'image/png',
    '.pdf': 'application/pdf'
};

export function createAppServer(config: AppConfig, logger: DeveloperLogger): Server {
    let runtimeConfig = config;
    let provider = createProvider(runtimeConfig, logger);
    const workspaceDir = dirname(config.publicDir);

    return createServer(async (req, res) => {
        const url = new URL(req.url ?? '/', `http://${req.headers.host ?? 'localhost'}`);
        logger.debug('http.request', {
            method: req.method,
            path: url.pathname
        });

        try {
            if (req.method === 'GET' && url.pathname === '/api/config') {
                sendJson(res, safeClientConfig(runtimeConfig));
                return;
            }

            if (req.method === 'GET' && url.pathname === '/api/settings') {
                sendJson(res, publicSettingsFromConfig(runtimeConfig));
                return;
            }

            if (req.method === 'POST' && url.pathname === '/api/settings') {
                const nextConfig = applySettingsUpdate(runtimeConfig, await readJson(req) as SettingsUpdate);
                saveConfigFile(nextConfig, workspaceDir, nextConfig.configFile);
                runtimeConfig = nextConfig;
                provider = createProvider(runtimeConfig, logger);
                logger.info('settings.saved', {
                    providerKind: runtimeConfig.provider.kind,
                    providerPreset: runtimeConfig.provider.preset,
                    protocol: runtimeConfig.provider.protocol,
                    endpoint: runtimeConfig.provider.endpoint,
                    model: runtimeConfig.provider.model,
                    apiKeyConfigured: Boolean(runtimeConfig.provider.apiKey)
                });
                sendJson(res, publicSettingsFromConfig(runtimeConfig));
                return;
            }

            if (req.method === 'GET' && url.pathname === '/api/logs/recent') {
                sendJson(res, { entries: logger.recent(200) });
                return;
            }

            if (req.method === 'GET' && url.pathname === '/api/local-pdfs') {
                sendJson(res, { files: listWorkspacePdfs(workspaceDir) });
                return;
            }

            if (req.method === 'POST' && url.pathname === '/api/logs/client') {
                const body = await readJson(req);
                logger.debug(`client.${String((body as { event?: unknown }).event ?? 'event')}`, sanitizeClientLogData(body));
                sendJson(res, { ok: true });
                return;
            }

            if (req.method === 'POST' && url.pathname === '/api/explain') {
                await handleExplain(req, res, provider, logger);
                return;
            }

            if (req.method === 'GET') {
                if (url.pathname.startsWith('/vendor/pdfjs/')) {
                    serveVendorPdfJs(url.pathname, workspaceDir, res, logger);
                    return;
                }

                if (url.pathname.startsWith('/local-pdfs/')) {
                    serveWorkspacePdf(url.pathname, workspaceDir, res, logger);
                    return;
                }

                serveStatic(url.pathname, config.publicDir, res, logger);
                return;
            }

            sendJson(res, { error: 'Method not allowed' }, 405);
        } catch (error) {
            const message = error instanceof Error ? error.message : String(error);
            logger.error('http.error', {
                path: url.pathname,
                message
            });
            if (!res.headersSent) {
                sendJson(res, { error: message }, error instanceof SettingsValidationError ? 400 : 500);
            } else {
                res.end();
            }
        }
    });
}

function listWorkspacePdfs(cwd: string): Array<{ name: string; size: number; updatedAt: string }> {
    return readdirSync(cwd, { withFileTypes: true })
        .filter((entry) => entry.isFile() && entry.name.toLowerCase().endsWith('.pdf'))
        .map((entry) => {
            const fullPath = join(cwd, entry.name);
            const stats = statSync(fullPath);
            return {
                name: entry.name,
                size: stats.size,
                updatedAt: stats.mtime.toISOString()
            };
        });
}

function serveVendorPdfJs(urlPath: string, workspaceDir: string, res: ServerResponse, logger: DeveloperLogger): void {
    const fileName = basename(decodeURIComponent(urlPath));
    const allowed = new Set(['pdf.mjs', 'pdf.worker.mjs']);
    if (!allowed.has(fileName)) {
        sendJson(res, { error: 'Not found' }, 404);
        return;
    }

    const filePath = resolve(join(workspaceDir, 'node_modules/pdfjs-dist/build', fileName));
    serveExistingFile(filePath, res, logger, 'vendor.not_found');
}

function serveWorkspacePdf(urlPath: string, workspaceDir: string, res: ServerResponse, logger: DeveloperLogger): void {
    const fileName = basename(decodeURIComponent(urlPath));
    if (!fileName.toLowerCase().endsWith('.pdf')) {
        sendJson(res, { error: 'Not found' }, 404);
        return;
    }

    const filePath = resolve(join(workspaceDir, fileName));
    const root = resolve(workspaceDir);
    if (!filePath.startsWith(`${root}${sep}`) || !existsSync(filePath)) {
        sendJson(res, { error: 'Not found' }, 404);
        return;
    }

    serveExistingFile(filePath, res, logger, 'workspace_pdf.not_found');
}

export async function startServer(config = loadConfig(), logger = new DeveloperLogger({
    logFile: config.logFile,
    level: config.logLevel
})): Promise<{ server: Server; url: string }> {
    const maxAttempts = config.port === 0 ? 1 : 20;
    let lastError: unknown;

    for (let attempt = 0; attempt < maxAttempts; attempt += 1) {
        const requestedPort = config.port === 0 ? 0 : config.port + attempt;
        const serverConfig = { ...config, port: requestedPort };
        const server = createAppServer(serverConfig, logger);

        try {
            const port = await listen(server, serverConfig.host, serverConfig.port);
            const url = `http://${serverConfig.host}:${port}`;
            logger.info('app.start', {
                url,
                publicDir: serverConfig.publicDir,
                providerKind: serverConfig.provider.kind,
                providerPreset: serverConfig.provider.preset,
                protocol: serverConfig.provider.protocol,
                model: serverConfig.provider.model,
                logFile: serverConfig.logFile
            });
            return { server, url };
        } catch (error) {
            lastError = error;
            if (config.port !== 0 && isAddressInUse(error)) {
                logger.warn('app.port.in_use', {
                    host: serverConfig.host,
                    port: requestedPort,
                    nextPort: requestedPort + 1
                });
                continue;
            }
            throw error;
        }
    }

    throw lastError instanceof Error ? lastError : new Error('Unable to start server.');
}

function listen(server: Server, host: string, port: number): Promise<number> {
    return new Promise((resolveListen, rejectListen) => {
        const cleanup = (): void => {
            server.off('error', onError);
            server.off('listening', onListening);
        };
        const onError = (error: Error): void => {
            cleanup();
            rejectListen(error);
        };
        const onListening = (): void => {
            cleanup();
            const address = server.address();
            resolveListen(typeof address === 'object' && address ? address.port : port);
        };

        server.once('error', onError);
        server.once('listening', onListening);
        server.listen(port, host);
    });
}

function isAddressInUse(error: unknown): boolean {
    return error instanceof Error && (error as NodeJS.ErrnoException).code === 'EADDRINUSE';
}

async function handleExplain(
    req: IncomingMessage,
    res: ServerResponse,
    provider: ReturnType<typeof createProvider>,
    logger: DeveloperLogger
): Promise<void> {
    const request = validateExplainRequest(await readJson(req));
    const requestId = crypto.randomUUID();
    const startedAt = Date.now();
    const abortController = new AbortController();
    let finished = false;

    res.on('close', () => {
        if (!finished) {
            abortController.abort();
            logger.warn('explain.response.client_closed', { requestId });
        }
    });

    logger.info('explain.request.received', {
        requestId,
        textLength: request.text.length,
        pageContextLength: request.pageContext?.length ?? 0,
        selectionContextLength: request.selectionContext?.length ?? 0,
        imageCount: request.images?.length ?? 0,
        source: request.source ?? 'unknown',
        hasQuestion: Boolean(request.question?.trim()),
        mode: request.mode ?? 'explain'
    });

    prepareSse(res);
    writeSse(res, 'start', { requestId });

    let chunks = 0;
    let characters = 0;
    try {
        for await (const chunk of provider.streamExplain(request, abortController.signal)) {
            chunks += 1;
            characters += chunk.length;
            writeSse(res, 'delta', { requestId, text: chunk });
        }

        finished = true;
        writeSse(res, 'done', {
            requestId,
            chunks,
            characters,
            elapsedMs: Date.now() - startedAt
        });
        logger.info('explain.response.done', {
            requestId,
            chunks,
            characters,
            elapsedMs: Date.now() - startedAt
        });
        res.end();
    } catch (error) {
        finished = true;
        const message = error instanceof Error ? error.message : String(error);
        logger.error('explain.response.error', { requestId, message });
        writeSse(res, 'error', { requestId, message });
        res.end();
    }
}

async function readJson(req: IncomingMessage): Promise<unknown> {
    const chunks: Buffer[] = [];
    for await (const chunk of req) {
        chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
    }

    const raw = Buffer.concat(chunks).toString('utf8');
    if (!raw.trim()) {
        return {};
    }

    return JSON.parse(raw) as unknown;
}

function validateExplainRequest(value: unknown): ExplainRequest {
    if (!value || typeof value !== 'object' || Array.isArray(value)) {
        throw new Error('Request body must be a JSON object.');
    }

    const record = value as Record<string, unknown>;
    const text = String(record.text ?? '').trim();
    const images = Array.isArray(record.images) ? parseImages(record.images) : [];
    if (!text && images.length === 0) {
        throw new Error('Missing selected text or image.');
    }

    return {
        mode: parseMode(record.mode),
        text: text || '\u8bf7\u8bb2\u89e3\u56fe\u7247\u5185\u5bb9\u3002',
        pageContext: typeof record.pageContext === 'string' ? record.pageContext.trim() : undefined,
        selectionContext: typeof record.selectionContext === 'string' ? record.selectionContext.trim() : undefined,
        source: typeof record.source === 'string' ? record.source : undefined,
        question: typeof record.question === 'string' ? record.question : undefined,
        history: Array.isArray(record.history) ? parseHistory(record.history) : undefined,
        images
    };
}

function parseMode(value: unknown): ExplainRequest['mode'] {
    if (value === 'translate' || value === 'ask') {
        return value;
    }
    return 'explain';
}

function parseImages(value: unknown[]): ImageAttachment[] {
    const maxImages = 4;
    const maxDataUrlLength = 8 * 1024 * 1024;
    return value
        .map((entry): ImageAttachment | undefined => {
            if (!entry || typeof entry !== 'object' || Array.isArray(entry)) {
                return undefined;
            }

            const record = entry as Record<string, unknown>;
            const name = typeof record.name === 'string' && record.name.trim()
                ? record.name.trim().slice(0, 120)
                : 'image';
            const mimeType = typeof record.mimeType === 'string' ? record.mimeType.trim().toLowerCase() : '';
            const dataUrl = typeof record.dataUrl === 'string' ? record.dataUrl.trim() : '';
            if (!/^image\/(png|jpe?g|webp|gif)$/i.test(mimeType)) {
                return undefined;
            }
            if (!dataUrl.startsWith(`data:${mimeType};base64,`) || dataUrl.length > maxDataUrlLength) {
                return undefined;
            }

            return { name, mimeType, dataUrl };
        })
        .filter((entry): entry is ImageAttachment => Boolean(entry))
        .slice(0, maxImages);
}

function parseHistory(value: unknown[]): ChatMessage[] {
    return value
        .map((entry): ChatMessage | undefined => {
            if (!entry || typeof entry !== 'object' || Array.isArray(entry)) {
                return undefined;
            }

            const record = entry as Record<string, unknown>;
            const role = record.role === 'assistant' ? 'assistant' : record.role === 'system' ? 'system' : 'user';
            const content = typeof record.content === 'string' ? record.content.trim() : '';
            if (!content) {
                return undefined;
            }

            return { role, content };
        })
        .filter((entry): entry is ChatMessage => Boolean(entry))
        .slice(-8);
}

function serveStatic(urlPath: string, publicDir: string, res: ServerResponse, logger: DeveloperLogger): void {
    const requestPath = urlPath === '/' ? '/index.html' : decodeURIComponent(urlPath);
    const safePath = normalize(requestPath).replace(/^(\.\.(?:[/\\]|$))+/, '');
    const filePath = resolve(join(publicDir, safePath));
    const publicRoot = resolve(publicDir);

    if (filePath !== publicRoot && !filePath.startsWith(`${publicRoot}${sep}`)) {
        sendJson(res, { error: 'Not found' }, 404);
        return;
    }

    if (!existsSync(filePath) || !statSync(filePath).isFile()) {
        logger.debug('static.not_found', { path: requestPath });
        sendJson(res, { error: 'Not found' }, 404);
        return;
    }

    serveExistingFile(filePath, res, logger, 'static.not_found');
}

function serveExistingFile(filePath: string, res: ServerResponse, logger: DeveloperLogger, missingEvent: string): void {
    if (!existsSync(filePath) || !statSync(filePath).isFile()) {
        logger.debug(missingEvent, { path: filePath });
        sendJson(res, { error: 'Not found' }, 404);
        return;
    }

    res.writeHead(200, {
        'Content-Type': contentTypes[extname(filePath)] ?? 'application/octet-stream'
    });
    createReadStream(filePath).pipe(res);
}

function sendJson(res: ServerResponse, data: unknown, statusCode = 200): void {
    res.writeHead(statusCode, {
        'Content-Type': 'application/json; charset=utf-8'
    });
    res.end(JSON.stringify(data));
}

function safeClientConfig(config: AppConfig): SafeClientConfig {
    return {
        providerKind: config.provider.kind,
        providerPreset: config.provider.preset,
        protocol: config.provider.protocol,
        model: config.provider.model,
        endpoint: config.provider.endpoint,
        apiKeyConfigured: Boolean(config.provider.apiKey),
        maxSelectionChars: config.maxSelectionChars
    };
}

function sanitizeClientLogData(body: unknown): unknown {
    if (!body || typeof body !== 'object' || Array.isArray(body)) {
        return body;
    }

    const { event, ...rest } = body as Record<string, unknown>;
    return rest;
}

if (require.main === module) {
    startServer().catch((error) => {
        console.error(error);
        process.exitCode = 1;
    });
}
