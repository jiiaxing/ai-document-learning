import { AppConfig, ChatMessage, ExplainRequest, ImageAttachment, ProviderConfig } from './types';
import { DeveloperLogger } from './logger';
import { extractResponseText } from '../core/openaiResponseUtils';

export interface StreamingAiProvider {
    streamExplain(request: ExplainRequest, signal: AbortSignal): AsyncGenerator<string>;
}

export function createProvider(config: AppConfig, logger: DeveloperLogger): StreamingAiProvider {
    if (config.provider.kind === 'mock') {
        return new MockAiProvider(config, logger);
    }
    return new OpenAICompatibleStreamingProvider(config, logger);
}

class MockAiProvider implements StreamingAiProvider {
    constructor(
        private readonly config: AppConfig,
        private readonly logger: DeveloperLogger
    ) {}

    public async *streamExplain(request: ExplainRequest, signal: AbortSignal): AsyncGenerator<string> {
        const imageCount = request.images?.length ?? 0;
        const imageNames = (request.images ?? []).map((image) => image.name).join(', ');
        this.logger.info('provider.mock.start', {
            textLength: request.text.length,
            source: request.source ?? 'unknown',
            mode: request.mode ?? 'explain',
            imageCount
        });

        const text = truncateText(request.text, this.config.maxSelectionChars);
        const terms = pickTerms(text);
        const imageSummary = imageCount
            ? `\n\n附图：已收到 ${imageCount} 张图片（${imageNames}）。mock 模式不会做真实视觉识别，但真实模型请求会携带图片内容。`
            : '';
        const content = request.mode === 'translate'
            ? [
                '翻译：',
                text,
                '',
                `术语：${terms.length ? terms.map((term) => `${term} -> 保留英文术语并解释`).join('；') : '未检测到明显英文术语。'}${imageSummary}`
            ].join('\n')
            : request.mode === 'ask'
            ? [
                '自由提问回答：',
                '',
                `问题：${text}`,
                '',
                request.selectionContext ? `当前选区仅作为可选参考：${truncateText(request.selectionContext, 180)}` : '未附带当前选区参考。',
                '',
                `页面上下文长度：${request.pageContext?.length ?? 0}`,
                imageSummary
            ].join('\n')
            : [
                '一句话总结：这段内容的核心是在说明一个概念、机制或流程，需要先抓住主语、动作和条件。',
                '',
                `关键术语对照：${terms.length ? terms.map((term) => `${term} -> 关键英文术语`).join('；') : '未检测到明显英文术语。'}`,
                '',
                `分块解释：${text.slice(0, 180)}${text.length > 180 ? '...' : ''}`,
                '',
                request.question ? `追问回答：${request.question} 可以从原文中的限定条件、结论关系和附图入手。${imageSummary}` : `可追问的问题：这个术语在上下文中承担什么作用？它和前后句的因果关系是什么？${imageSummary}`
            ].join('\n');

        for (const chunk of splitIntoChunks(content, 18)) {
            if (signal.aborted) {
                this.logger.warn('provider.mock.aborted');
                return;
            }
            await delay(this.config.provider.mockChunkDelayMs, signal);
            this.logger.debug('provider.mock.chunk', { length: chunk.length });
            yield chunk;
        }

        this.logger.info('provider.mock.finish');
    }
}

class OpenAICompatibleStreamingProvider implements StreamingAiProvider {
    constructor(
        private readonly config: AppConfig,
        private readonly logger: DeveloperLogger
    ) {}

    public async *streamExplain(request: ExplainRequest, signal: AbortSignal): AsyncGenerator<string> {
        const messages = buildMessages(this.config, request);
        const provider = this.config.provider;
        const images = request.images ?? [];
        const body = provider.protocol === 'anthropic'
            ? buildAnthropicBody(messages, provider, images)
            : buildOpenAiBody(messages, provider, images);

        this.logger.info('provider.http.start', {
            preset: provider.preset,
            protocol: provider.protocol,
            endpoint: provider.endpoint,
            model: provider.model,
            imageCount: images.length
        });

        const response = await fetch(provider.endpoint, {
            method: 'POST',
            headers: buildHeaders(provider),
            body: JSON.stringify(body),
            signal
        });

        if (!response.ok) {
            const text = await response.text();
            throw new Error(formatProviderHttpError(response.status, text, provider));
        }

        const contentType = response.headers.get('content-type') ?? '';
        if (!contentType.includes('text/event-stream') || !response.body) {
            const rawText = await response.text();
            if (!contentType.includes('application/json')) {
                throw new Error(`AI response was ${contentType || 'unknown content type'} instead of JSON/SSE. Check the endpoint path, for OpenAI-compatible chat it should usually end with /v1/chat/completions. Preview: ${compactPreview(rawText, 220)}`);
            }

            let data: unknown;
            try {
                data = JSON.parse(rawText) as unknown;
            } catch (error) {
                throw new Error(`AI returned invalid JSON. Check endpoint path and provider protocol. Preview: ${compactPreview(rawText, 220)}`);
            }

            const text = extractResponseText(data, provider.responseTextPath);
            this.logger.warn('provider.http.non_stream_response', {
                contentType,
                textLength: text.length
            });
            if (text) {
                yield text;
            }
            return;
        }

        for await (const delta of readSseDeltas(response.body, provider.protocol, this.logger)) {
            if (signal.aborted) {
                this.logger.warn('provider.http.aborted');
                return;
            }
            yield delta;
        }

        this.logger.info('provider.http.finish');
    }
}

function buildMessages(config: AppConfig, request: ExplainRequest): ChatMessage[] {
    const text = truncateText(request.text, config.maxSelectionChars);
    const pageContext = truncateText(request.pageContext ?? '', config.maxSelectionChars * 3);
    const selectionContext = truncateText(request.selectionContext ?? '', config.maxSelectionChars);
    const source = request.source?.trim() || 'PDF selection';
    const imageInstruction = buildImageInstruction(request.images ?? []);
    const basePrompt = request.mode === 'translate'
        ? renderTemplate(config.translatePromptTemplate, {
            text,
            source,
            pageContext,
            question: ''
        })
        : request.mode === 'ask'
        ? buildAskPrompt({
            question: text,
            source,
            pageContext,
            selectionContext
        })
        : request.question?.trim()
        ? renderTemplate(config.followupPromptTemplate, {
            selection: text,
            question: request.question.trim(),
            source,
            pageContext
        })
        : renderTemplate(config.explainPromptTemplate, {
            text,
            source,
            pageContext,
            question: ''
        });
    const userPrompt = `${basePrompt}${imageInstruction}`;

    return [
        { role: 'system', content: config.systemPrompt },
        ...(request.history ?? []).slice(-6),
        { role: 'user', content: userPrompt }
    ];
}

function buildAskPrompt(values: {
    question: string;
    source: string;
    pageContext: string;
    selectionContext: string;
}): string {
    return [
        '请回答用户的自由提问。不要默认把它当成“继续追问选区”，也不要强制限定在选区内。',
        '',
        '## 来源',
        values.source,
        '',
        '## 用户问题（主任务）',
        values.question,
        '',
        '## 当前 PDF 选区（可选参考，不是强制范围）',
        values.selectionContext || '无当前选区。',
        '',
        '## 周围页面上下文（可选参考）',
        values.pageContext || '无页面上下文。',
        '',
        '## 输出要求',
        '1. 直接回答用户问题。',
        '2. 只有当用户问题明确要求结合 PDF、选区或上下文时，才使用这些参考。',
        '3. 如果问题主要关于图片，请以图片内容为主回答。',
        '4. 使用 Markdown，必要时保留关键英文原词并给出中文解释。',
        '5. 不要声称看到了不存在的信息；上下文或图片信息不足时要明确说明。'
    ].join('\n');
}

function buildImageInstruction(images: ImageAttachment[]): string {
    if (!images.length) {
        return '';
    }

    return [
        '',
        '',
        '## 图片附件',
        `本次请求附带 ${images.length} 张图片：${images.map((image) => image.name).join(', ')}。`,
        '请直接读取并理解图片内容，再结合用户问题回答。',
        '如果当前模型或接口无法访问图片内容，请明确说“我无法读取这张图片”，不要假装已经看到了图片。'
    ].join('\n');
}

type OpenAiContentPart =
    | { type: 'text'; text: string }
    | { type: 'image_url'; image_url: { url: string } };

type OpenAiMessage = {
    role: ChatMessage['role'];
    content: string | OpenAiContentPart[];
};

type AnthropicContentPart =
    | { type: 'text'; text: string }
    | { type: 'image'; source: { type: 'base64'; media_type: string; data: string } };

type AnthropicMessage = {
    role: 'user' | 'assistant';
    content: string | AnthropicContentPart[];
};

function buildOpenAiBody(messages: ChatMessage[], provider: ProviderConfig, images: ImageAttachment[] = []): Record<string, unknown> {
    const converted: OpenAiMessage[] = messages.map((message) => ({
        role: message.role,
        content: message.content
    }));
    attachOpenAiImagesToLastUserMessage(converted, images);

    return {
        model: provider.model,
        temperature: 0.2,
        stream: true,
        messages: converted,
        ...provider.extraBody
    };
}

function buildAnthropicBody(messages: ChatMessage[], provider: ProviderConfig, images: ImageAttachment[] = []): Record<string, unknown> {
    const system = messages
        .filter((message) => message.role === 'system' && message.content.trim())
        .map((message) => message.content.trim())
        .join('\n\n');
    const converted: AnthropicMessage[] = messages
        .filter((message) => message.role !== 'system')
        .map((message) => ({
            role: message.role === 'assistant' ? 'assistant' : 'user',
            content: message.content
        }));
    attachAnthropicImagesToLastUserMessage(converted, images);

    return {
        model: provider.model,
        max_tokens: provider.anthropicMaxTokens,
        temperature: 0.2,
        stream: true,
        messages: converted,
        ...(system ? { system } : {}),
        ...provider.extraBody
    };
}

function attachOpenAiImagesToLastUserMessage(messages: OpenAiMessage[], images: ImageAttachment[]): void {
    if (!images.length) {
        return;
    }

    const index = findLastUserMessageIndex(messages);
    if (index < 0) {
        return;
    }

    const message = messages[index];
    const content = typeof message.content === 'string'
        ? [{ type: 'text' as const, text: message.content }]
        : message.content;
    messages[index] = {
        ...message,
        content: [
            ...content,
            ...images.map((image): OpenAiContentPart => ({
                type: 'image_url',
                image_url: { url: image.dataUrl }
            }))
        ]
    };
}

function attachAnthropicImagesToLastUserMessage(messages: AnthropicMessage[], images: ImageAttachment[]): void {
    if (!images.length) {
        return;
    }

    const index = findLastUserMessageIndex(messages);
    if (index < 0) {
        return;
    }

    const message = messages[index];
    const content = typeof message.content === 'string'
        ? [{ type: 'text' as const, text: message.content }]
        : message.content;
    messages[index] = {
        ...message,
        content: [
            ...content,
            ...images.map((image): AnthropicContentPart => ({
                type: 'image',
                source: {
                    type: 'base64',
                    media_type: image.mimeType,
                    data: image.dataUrl.split(',', 2)[1] ?? ''
                }
            }))
        ]
    };
}

function findLastUserMessageIndex(messages: Array<{ role: string }>): number {
    for (let index = messages.length - 1; index >= 0; index -= 1) {
        if (messages[index].role === 'user') {
            return index;
        }
    }
    return -1;
}

function buildHeaders(provider: ProviderConfig): Record<string, string> {
    if (!provider.apiKey) {
        throw new Error('Missing AI_TUTOR_API_KEY, OPENAI_API_KEY, or ANTHROPIC_API_KEY.');
    }

    if (provider.protocol === 'anthropic') {
        return {
            'Content-Type': 'application/json',
            'x-api-key': provider.apiKey,
            'anthropic-version': provider.anthropicVersion,
            ...(provider.anthropicBeta ? { 'anthropic-beta': provider.anthropicBeta } : {}),
            ...provider.extraHeaders
        };
    }

    return {
        'Content-Type': 'application/json',
        [provider.apiKeyHeader]: `${provider.apiKeyPrefix}${provider.apiKey}`,
        ...provider.extraHeaders
    };
}

function compactPreview(text: string, maxLength: number): string {
    return text.replace(/\s+/g, ' ').trim().slice(0, maxLength);
}

function formatProviderHttpError(status: number, text: string, provider: ProviderConfig): string {
    const preview = compactPreview(text, 500);
    const lowerPreview = preview.toLowerCase();
    const hints: string[] = [];

    if (status === 503 && lowerPreview.includes('no available accounts')) {
        hints.push('上游服务返回“无可用账号”，通常是中转站账号池耗尽、当前 key 无可用账户，或模型名在该服务上不可用。');
    }
    if (provider.protocol === 'anthropic' && provider.endpoint.includes('/chat/completions')) {
        hints.push('当前协议是 Anthropic，但 endpoint 看起来是 OpenAI Compatible 的 /v1/chat/completions。');
    }
    if (provider.protocol === 'openai' && provider.responseTextPath === 'content.0.text') {
        hints.push('当前响应路径看起来是 Anthropic 的 content.0.text，OpenAI Compatible 通常应为 choices.0.message.content。');
    }

    const hintText = hints.length ? ` 提示：${hints.join(' ')}` : '';
    return `AI request failed: ${status} ${preview}${hintText}`;
}

async function *readSseDeltas(
    body: ReadableStream<Uint8Array>,
    protocol: 'openai' | 'anthropic',
    logger: DeveloperLogger
): AsyncGenerator<string> {
    const reader = body.getReader();
    const decoder = new TextDecoder();
    let buffer = '';

    while (true) {
        const { done, value } = await reader.read();
        if (done) {
            break;
        }

        buffer += decoder.decode(value, { stream: true });
        const events = buffer.split(/\r?\n\r?\n/);
        buffer = events.pop() ?? '';

        for (const eventText of events) {
            const delta = extractDeltaFromSseEvent(eventText, protocol);
            if (!delta) {
                continue;
            }
            logger.debug('provider.http.chunk', { length: delta.length });
            yield delta;
        }
    }
}

function extractDeltaFromSseEvent(eventText: string, protocol: 'openai' | 'anthropic'): string {
    const dataLines = eventText
        .split(/\r?\n/)
        .filter((line) => line.startsWith('data:'))
        .map((line) => line.slice(5).trim());
    if (!dataLines.length) {
        return '';
    }

    const payload = dataLines.join('\n');
    if (!payload || payload === '[DONE]') {
        return '';
    }

    try {
        const parsed = JSON.parse(payload) as Record<string, unknown>;
        if (protocol === 'anthropic') {
            const delta = parsed.delta as Record<string, unknown> | undefined;
            return typeof delta?.text === 'string' ? delta.text : '';
        }

        const choices = parsed.choices as Array<Record<string, unknown>> | undefined;
        const first = choices?.[0];
        const delta = first?.delta as Record<string, unknown> | undefined;
        const message = first?.message as Record<string, unknown> | undefined;
        return String(delta?.content ?? message?.content ?? '');
    } catch {
        return '';
    }
}

function renderTemplate(template: string, values: Record<string, string>): string {
    return template.replace(/\{\{(\w+)}}/g, (_, key: string) => values[key] ?? '');
}

function truncateText(text: string, maxChars: number): string {
    const trimmed = text.trim();
    return trimmed.length > maxChars ? `${trimmed.slice(0, maxChars)}\n...[truncated]` : trimmed;
}

function pickTerms(text: string): string[] {
    return Array.from(new Set(text.match(/[A-Za-z][A-Za-z0-9_-]{2,}/g) ?? [])).slice(0, 6);
}

function splitIntoChunks(text: string, size: number): string[] {
    const chunks: string[] = [];
    for (let index = 0; index < text.length; index += size) {
        chunks.push(text.slice(index, index + size));
    }
    return chunks;
}

function delay(ms: number, signal: AbortSignal): Promise<void> {
    if (ms <= 0) {
        return Promise.resolve();
    }

    return new Promise((resolve, reject) => {
        const timer = setTimeout(resolve, ms);
        signal.addEventListener('abort', () => {
            clearTimeout(timer);
            reject(new Error('Request aborted'));
        }, { once: true });
    });
}
