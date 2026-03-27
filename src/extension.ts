import * as vscode from 'vscode';
import { readFile } from 'node:fs/promises';
import { createWorker } from 'tesseract.js';
import { registerPdfTutorPanel } from './pdfTutorPanel';
import { RequestOrchestrator } from './core/requestOrchestrator';
import { CancellationGuard } from './core/cancellationGuard';
import { extractResponseText, resolveResponseTextPath } from './core/openaiResponseUtils';

type ChatRole = 'system' | 'user' | 'assistant';

interface ChatMessage {
    role: ChatRole;
    content: string;
}

interface ExplainContext {
    fileName?: string;
    lineStart?: number;
    lineEnd?: number;
}

type TriggerMode = 'auto' | 'manual';

interface AIProvider {
    ask(messages: ChatMessage[], token: vscode.CancellationToken): Promise<string>;
}

type DebugLogger = (message: string, data?: unknown) => void;

class CopilotProvider implements AIProvider {
    private cachedModel?: vscode.LanguageModelChat;
    private cachedAt = 0;

    public async ask(messages: ChatMessage[], token: vscode.CancellationToken): Promise<string> {
        if (!vscode.lm) {
            throw new Error('当前 VS Code 环境不支持 Language Model API。请升级 VS Code 或切换到 openaiCompatible。');
        }

        const model = await this.getModel();

        if (!model) {
            throw new Error('未找到可用 Copilot 模型。请在当前窗口确认已安装并登录 GitHub Copilot / GitHub Copilot Chat。');
        }

        const mapped = messages
            .filter((m) => m.role !== 'system')
            .map((m) => m.role === 'assistant'
                ? vscode.LanguageModelChatMessage.Assistant(m.content)
                : vscode.LanguageModelChatMessage.User(m.content));

        const response = await model.sendRequest(mapped, {}, token);
        let full = '';
        for await (const part of response.text) {
            full += part;
        }
        return full.trim();
    }

    private async getModel(): Promise<vscode.LanguageModelChat | undefined> {
        const now = Date.now();
        if (this.cachedModel && now - this.cachedAt < 5 * 60 * 1000) {
            return this.cachedModel;
        }

        const models = await vscode.lm.selectChatModels();
        const picked = this.pickFastModel(models);
        if (picked) {
            this.cachedModel = picked;
            this.cachedAt = now;
        }
        return picked;
    }

    private pickFastModel(models: vscode.LanguageModelChat[]): vscode.LanguageModelChat | undefined {
        if (!models.length) {
            return undefined;
        }

        const preferredKeywords = ['mini', 'flash', 'haiku', 'fast', 'turbo'];
        const preferred = models.find((m) => {
            const id = String((m as unknown as { id?: string }).id ?? '').toLowerCase();
            const family = String((m as unknown as { family?: string }).family ?? '').toLowerCase();
            return preferredKeywords.some((k) => id.includes(k) || family.includes(k));
        });

        return preferred ?? models[0];
    }
}

class OpenAICompatibleProvider implements AIProvider {
    public async ask(messages: ChatMessage[], token: vscode.CancellationToken): Promise<string> {
        const cfg = this.getProviderConfig('text');
        const body = cfg.protocol === 'anthropic'
            ? this.buildAnthropicTextBody(messages, cfg)
            : {
                model: cfg.model,
                temperature: 0.2,
                messages: messages.map((m) => ({ role: m.role, content: m.content })),
                ...cfg.extraBody
            };

        const response = await this.postJson(
            cfg.endpoint,
            this.buildHeaders(cfg),
            body,
            token,
            '请求失败'
        );

        const content = this.extractResponseText(response, cfg.responseTextPath);
        if (!content) {
            throw new Error('模型返回为空。请检查 aiTutor.openai.responseTextPath 配置。');
        }
        return content;
    }

    public async askVision(prompt: string, imageDataUrl: string, token: vscode.CancellationToken): Promise<string> {
        const cfg = this.getProviderConfig('vision');
        const body = cfg.protocol === 'anthropic'
            ? this.buildAnthropicVisionBody(prompt, imageDataUrl, cfg)
            : {
                model: cfg.model,
                temperature: 0.2,
                max_tokens: 900,
                messages: [
                    {
                        role: 'user',
                        content: [
                            { type: 'text', text: prompt },
                            { type: 'image_url', image_url: { url: imageDataUrl } }
                        ]
                    }
                ],
                ...cfg.extraBody
            };

        const response = await this.postJson(
            cfg.endpoint,
            this.buildHeaders(cfg),
            body,
            token,
            '图片请求失败'
        );

        const content = this.extractResponseText(response, cfg.responseTextPath);
        if (!content) {
            throw new Error('模型返回为空。请检查 aiTutor.openai.responseTextPath 配置。');
        }
        return content;
    }

    private getProviderConfig(mode: 'text' | 'vision'): {
        protocol: 'openai' | 'anthropic';
        endpoint: string;
        model: string;
        responseTextPath: string;
        apiKey: string;
        apiKeyHeader: string;
        apiKeyPrefix: string;
        anthropicVersion: string;
        anthropicBeta: string;
        anthropicMaxTokens: number;
        extraHeaders: Record<string, string>;
        extraBody: Record<string, unknown>;
    } {
        const config = vscode.workspace.getConfiguration('aiTutor');
        const protocolRaw = config.get<string>('openai.protocol', 'openai').trim().toLowerCase();
        const protocol: 'openai' | 'anthropic' = protocolRaw === 'anthropic' ? 'anthropic' : 'openai';
        const endpoint = config.get<string>('openai.endpoint', 'https://api.openai.com/v1/chat/completions');
        const visionEndpoint = config.get<string>('openai.visionEndpoint', '').trim();
        const apiKey = (
            config.get<string>('openai.apiKey', '').trim()
            || process.env.ANTHROPIC_API_KEY?.trim()
            || process.env.MINIMAX_API_KEY?.trim()
            || process.env.OPENAI_API_KEY?.trim()
            || ''
        );
        const model = config.get<string>('openai.model', 'gpt-4o-mini');
        const visionModel = config.get<string>('openai.visionModel', '').trim();
        const apiKeyHeader = config.get<string>('openai.apiKeyHeader', 'Authorization').trim() || 'Authorization';
        const apiKeyPrefix = config.get<string>('openai.apiKeyPrefix', 'Bearer ');
        const responseTextPath = config.get<string>('openai.responseTextPath', 'choices.0.message.content').trim() || 'choices.0.message.content';
        const visionResponseTextPath = config.get<string>('openai.visionResponseTextPath', '').trim();
        const anthropicVersion = config.get<string>('openai.anthropicVersion', '2023-06-01').trim() || '2023-06-01';
        const anthropicBeta = config.get<string>('openai.anthropicBeta', '').trim();
        const anthropicMaxTokens = Math.max(1, config.get<number>('openai.anthropicMaxTokens', 1024));
        const extraHeaders = this.parseJsonObject(config.get<string>('openai.extraHeadersJson', '{}'), 'aiTutor.openai.extraHeadersJson');
        const textExtraBody = this.parseJsonObject(config.get<string>('openai.extraBodyJson', '{}'), 'aiTutor.openai.extraBodyJson');
        const visionExtraBody = this.parseJsonObject(config.get<string>('openai.visionExtraBodyJson', '{}'), 'aiTutor.openai.visionExtraBodyJson');

        if (!apiKey) {
            throw new Error('未配置 aiTutor.openai.apiKey。请在“扩展开发主机窗口”里设置，或设置环境变量 MINIMAX_API_KEY。');
        }

        const finalEndpoint = mode === 'vision'
            ? (visionEndpoint || endpoint)
            : endpoint;
        const finalModel = mode === 'vision'
            ? (visionModel || model)
            : model;
        const finalResponseTextPath = mode === 'vision'
            ? (visionResponseTextPath || responseTextPath)
            : responseTextPath;
        const finalExtraBody = mode === 'vision'
            ? { ...textExtraBody, ...visionExtraBody }
            : textExtraBody;
        const normalizedResponseTextPath = this.resolveResponseTextPath(protocol, finalResponseTextPath);

        return {
            protocol,
            endpoint: finalEndpoint,
            model: finalModel,
            responseTextPath: normalizedResponseTextPath,
            apiKey,
            apiKeyHeader,
            apiKeyPrefix,
            anthropicVersion,
            anthropicBeta,
            anthropicMaxTokens,
            extraHeaders: Object.fromEntries(Object.entries(extraHeaders).map(([k, v]) => [k, String(v)])),
            extraBody: finalExtraBody
        };
    }

    private buildHeaders(cfg: {
        protocol: 'openai' | 'anthropic';
        apiKey: string;
        apiKeyHeader: string;
        apiKeyPrefix: string;
        anthropicVersion: string;
        anthropicBeta: string;
        extraHeaders: Record<string, string>;
    }): Record<string, string> {
        if (cfg.protocol === 'anthropic') {
            const headers: Record<string, string> = {
                'Content-Type': 'application/json',
                'x-api-key': cfg.apiKey,
                'anthropic-version': cfg.anthropicVersion,
                ...cfg.extraHeaders
            };
            if (cfg.anthropicBeta) {
                headers['anthropic-beta'] = cfg.anthropicBeta;
            }
            return headers;
        }

        return {
            'Content-Type': 'application/json',
            [cfg.apiKeyHeader]: `${cfg.apiKeyPrefix}${cfg.apiKey}`,
            ...cfg.extraHeaders
        };
    }

    private resolveResponseTextPath(protocol: 'openai' | 'anthropic', path: string): string {
        return resolveResponseTextPath(protocol, path);
    }

    private buildAnthropicTextBody(
        messages: ChatMessage[],
        cfg: { model: string; anthropicMaxTokens: number; extraBody: Record<string, unknown> }
    ): Record<string, unknown> {
        const system = messages
            .filter((m) => m.role === 'system' && m.content.trim())
            .map((m) => m.content.trim())
            .join('\n\n');

        const converted = messages
            .filter((m) => m.role !== 'system')
            .map((m) => ({
                role: m.role === 'assistant' ? 'assistant' : 'user',
                content: m.content
            }));

        const body: Record<string, unknown> = {
            model: cfg.model,
            max_tokens: cfg.anthropicMaxTokens,
            temperature: 0.2,
            messages: converted,
            ...cfg.extraBody
        };
        if (system) {
            body.system = system;
        }
        return body;
    }

    private buildAnthropicVisionBody(
        prompt: string,
        imageDataUrl: string,
        cfg: { model: string; anthropicMaxTokens: number; extraBody: Record<string, unknown> }
    ): Record<string, unknown> {
        const match = /^data:([^;]+);base64,(.+)$/i.exec(imageDataUrl.trim());
        if (!match) {
            throw new Error('图片格式无效：Anthropic 协议需要 base64 data URL。');
        }

        const mediaType = match[1] ?? 'image/png';
        const base64Data = match[2] ?? '';

        return {
            model: cfg.model,
            max_tokens: cfg.anthropicMaxTokens,
            temperature: 0.2,
            messages: [
                {
                    role: 'user',
                    content: [
                        { type: 'text', text: prompt },
                        {
                            type: 'image',
                            source: {
                                type: 'base64',
                                media_type: mediaType,
                                data: base64Data
                            }
                        }
                    ]
                }
            ],
            ...cfg.extraBody
        };
    }

    private async postJson(
        endpoint: string,
        headers: Record<string, string>,
        body: Record<string, unknown>,
        token: vscode.CancellationToken,
        failPrefix: string
    ): Promise<unknown> {
        const abortController = new AbortController();
        const cancelSub = token.onCancellationRequested(() => abortController.abort());
        try {
            const response = await fetch(endpoint, {
                method: 'POST',
                headers,
                body: JSON.stringify(body),
                signal: abortController.signal
            });

            if (!response.ok) {
                const text = await response.text();
                throw new Error(`${failPrefix}：${response.status} ${text}`);
            }
            return await response.json();
        } finally {
            cancelSub.dispose();
        }
    }

    private parseJsonObject(raw: string | undefined, settingName: string): Record<string, unknown> {
        if (!raw || !raw.trim()) {
            return {};
        }

        try {
            const parsed = JSON.parse(raw) as unknown;
            if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
                throw new Error('不是 JSON 对象');
            }
            return parsed as Record<string, unknown>;
        } catch (error) {
            const msg = error instanceof Error ? error.message : String(error);
            throw new Error(`${settingName} 解析失败：${msg}`);
        }
    }

    private extractResponseText(data: unknown, path: string): string {
        return extractResponseText(data, path);
    }
}

class AITutorViewProvider implements vscode.WebviewViewProvider {
    public static readonly viewType = 'aiTutor.sidebar';

    private view?: vscode.WebviewView;
    private history: ChatMessage[] = [];
    private uiMessages: Array<{ role: 'user' | 'assistant' | 'system'; text: string; responseStyle?: 'plainText' | 'markdown' }> = [];
    private lastStatusText = '';
    private lastSelection = '';
    private runningTokenSource?: vscode.CancellationTokenSource;
    private pendingWebviewMessages: unknown[] = [];
    private runningOcrWorker?: { terminate: () => Promise<unknown> };
    private readonly orchestrator = new RequestOrchestrator();

    constructor(
        private readonly context: vscode.ExtensionContext,
        private readonly debugLog: DebugLogger
    ) {}

    private debug(message: string, data?: unknown): void {
        this.debugLog(message, data);
    }

    public getDebugSnapshot(): Record<string, unknown> {
        return {
            hasView: Boolean(this.view),
            historyLength: this.history.length,
            lastSelectionLength: this.lastSelection.length,
            inFlight: this.isRequestInFlight(),
            hasRunningOcrWorker: Boolean(this.runningOcrWorker),
            pendingWebviewMessages: this.pendingWebviewMessages.length,
            orchestrator: this.orchestrator.getSnapshot()
        };
    }

    public resolveWebviewView(webviewView: vscode.WebviewView): void {
        this.view = webviewView;
        webviewView.webview.options = { enableScripts: true };
        webviewView.webview.html = this.getHtml();
        this.postToWebview({ type: 'config', responseStyle: this.getResponseStyle() });
        this.restoreWebviewState();

        webviewView.webview.onDidReceiveMessage(async (msg) => {
            this.debug('webview.message.received', { type: msg?.type });
            if (msg?.type === 'ask') {
                this.beginManualInteraction();
                const question = String(msg.text ?? '').trim();
                if (!question) {
                    return;
                }
                await this.handleUserQuestion(question);
                return;
            }

            if (msg?.type === 'askImageFromInput') {
                this.beginManualInteraction();
                const question = String(msg.text ?? '').trim();
                const imageDataUrl = String(msg.imageDataUrl ?? '').trim();
                if (!imageDataUrl) {
                    this.postStatus('未检测到图片数据');
                    return;
                }
                await this.handleUserImageQuestion(question, imageDataUrl);
                return;
            }

            if (msg?.type === 'clear') {
                this.clearHistory();
                return;
            }

            if (msg?.type === 'cancel') {
                this.cancelCurrentRequest();
                return;
            }

            if (msg?.type === 'explainClipboard') {
                this.beginManualInteraction();
                await this.explainClipboardText();
                return;
            }

            if (msg?.type === 'explainImage') {
                this.beginManualInteraction();
                await this.explainImage();
                return;
            }

            if (msg?.type === 'explainLastSelection') {
                this.beginManualInteraction();
                if (!this.lastSelection) {
                    this.postAssistant('当前还没有可解释的选中文本。');
                    return;
                }
                await this.handleExplainSelection(this.lastSelection);
            }
        });
    }

    public async reveal(): Promise<void> {
        try {
            await vscode.commands.executeCommand('workbench.view.extension.aiTutor');
        } catch {
            // ignore
        }
    }

    public clearHistory(): void {
        this.history = [];
        this.uiMessages = [];
        this.lastStatusText = '';
        this.view?.webview.postMessage({ type: 'reset' });
        this.postSystem('对话已清空。');
    }

    public beginManualInteraction(): void {
        this.orchestrator.beginManualInteraction();
        this.debug('interaction.manual.begin', this.orchestrator.getSnapshot());
    }

    public canAutoTrigger(): boolean {
        const allowed = this.orchestrator.canAutoTrigger();
        if (!allowed) {
            this.debug('trigger.auto.blocked', this.orchestrator.getSnapshot());
        }
        return allowed;
    }

    public cancelCurrentRequest(): void {
        const cancelled = this.orchestrator.cancelCurrentRequest();
        this.debug('request.cancel.invoked', {
            cancelled,
            inFlight: this.isRequestInFlight(),
            orchestrator: this.orchestrator.getSnapshot()
        });
        if (cancelled && this.runningTokenSource && !this.runningTokenSource.token.isCancellationRequested) {
            this.runningTokenSource.cancel();
            if (this.runningOcrWorker) {
                void this.runningOcrWorker.terminate();
                this.runningOcrWorker = undefined;
            }
            this.postSystem('已取消当前响应。');
            this.postStatus('已取消');
            return;
        }

        this.postStatus('当前没有进行中的响应');
    }

    public async explainClipboardText(): Promise<void> {
        const text = (await vscode.env.clipboard.readText()).trim();
        if (!text) {
            this.postAssistant('剪贴板为空，请先复制一段内容（在 PDF 中可先 Ctrl+C）。');
            return;
        }

        const preview = text.length > 50 ? `${text.slice(0, 50)}...` : text;
        this.postSystem(`已读取剪贴板文本：${preview}`);
        await this.explainSelection(text, { fileName: 'clipboard' });
    }

    public async explainImage(): Promise<void> {
        if (this.isRequestInFlight()) {
            this.postStatus('已有请求处理中，请稍候...');
            return;
        }

        const picked = await vscode.window.showOpenDialog({
            canSelectMany: false,
            openLabel: '选择图片并讲解',
            filters: {
                Images: ['png', 'jpg', 'jpeg', 'webp', 'bmp']
            }
        });

        if (!picked || picked.length === 0) {
            return;
        }

        const fileUri = picked[0];
        const imageDataUrl = await this.toImageDataUrl(fileUri);
        const config = vscode.workspace.getConfiguration('aiTutor');
        const defaultImageExplainTemplate = [
            '你是计算机课程助教。请识别这张图片中的内容并讲解。',
            '要求：使用中文解释，保留关键英文术语，并给出“英文 -> 中文”对照。',
            '如果图片内有公式，请解释公式含义和变量含义。'
        ].join('\n');
        const source = vscode.workspace.asRelativePath(fileUri, false);
        const imageExplainTemplate = config.get<string>('imageExplainPromptTemplate', defaultImageExplainTemplate) || defaultImageExplainTemplate;
        const prompt = this.fillTemplate(imageExplainTemplate, { source });

        this.postUser(`请讲解这张图片：${source}`);
        await this.askModelWithImage(prompt, imageDataUrl);
    }

    public async explainSelection(
        text: string,
        explainContext?: ExplainContext,
        triggerMode: TriggerMode = 'manual'
    ): Promise<void> {
        if (this.isRequestInFlight()) {
            if (triggerMode === 'manual') {
                this.postStatus('当前已有请求处理中，请先取消或等待完成。');
            }
            this.debug('explain.selection.skipped.inflight', {
                textLength: text.length,
                explainContext,
                triggerMode
            });
            return;
        }
        this.lastSelection = text;
        this.debug('explain.selection.accepted', {
            textLength: text.length,
            explainContext,
            triggerMode
        });
        await this.handleExplainSelection(text, explainContext);
    }

    private async handleExplainSelection(text: string, explainContext?: ExplainContext): Promise<void> {
        const config = vscode.workspace.getConfiguration('aiTutor');
        const maxSelectionChars = config.get<number>('maxSelectionChars', 900);
        const clippedText = text.length > maxSelectionChars
            ? `${text.slice(0, maxSelectionChars)}\n\n（文本较长，已截断后讲解）`
            : text;

        const sourceNote = this.buildSourceNote(explainContext);
        this.postUser(`请解释这段选中文本：\n\n${sourceNote}${clippedText}`);

        const defaultExplainTemplate = [
            '你是计算机英文课件助教。请使用中文讲解，但要保留关键英文术语。',
            '输出格式必须包含',
            '1) 一句话总结',
            '2) 关键术语对照（每条使用“英文原文 -> 中文解释/翻译”）',
            '3) 逐句/分块解释（每块先贴原文短句，再给中文解释）',
            '如果原文有歧义，请明确标注“可能含义 A/B”。',
            '来源信息：{{source}}',
            '待解释原文：',
            '{{text}}'
        ].join('\n');
        const template = config.get<string>('explainPromptTemplate', defaultExplainTemplate) || defaultExplainTemplate;
        const prompt = this.fillTemplate(
            template,
            {
                source: sourceNote.trim() || '无',
                text: clippedText
            }
        );

        await this.askModel(prompt);
    }

    private async handleUserQuestion(question: string): Promise<void> {
        this.postUser(question);
        const config = vscode.workspace.getConfiguration('aiTutor');
        const defaultFollowupTemplate = [
            '已知我最近选中的课件原文是：',
            '{{selection}}',
            '',
            '我的追问是：{{question}}',
            '',
            '请结合原文回答，并标注你引用的关键英文短语。'
        ].join('\n');
        const followupTemplate = config.get<string>('followupPromptTemplate', defaultFollowupTemplate) || defaultFollowupTemplate;
        const defaultDirectQuestionTemplate = [
            '我的问题是：{{question}}',
            '',
            '请直接回答，并尽量给出计算机课程语境下的解释。'
        ].join('\n');
        const directQuestionTemplate = config.get<string>('directQuestionPromptTemplate', defaultDirectQuestionTemplate) || defaultDirectQuestionTemplate;

        const prompt = this.lastSelection
            ? this.fillTemplate(followupTemplate, {
                selection: this.lastSelection,
                question
            })
            : this.fillTemplate(directQuestionTemplate, { question });

        await this.askModel(prompt);
    }

    private async handleUserImageQuestion(question: string, imageDataUrl: string): Promise<void> {
        const config = vscode.workspace.getConfiguration('aiTutor');
        const defaultImageQuestionTemplate = '请结合这张图片回答我的问题：{{question}}';
        const defaultImageQuestionEmptyTemplate = '请识别并讲解这张图片内容。要求：中文解释，保留关键英文术语；如含公式请解释符号含义。';
        const imageQuestionTemplate = config.get<string>('imageQuestionPromptTemplate', defaultImageQuestionTemplate) || defaultImageQuestionTemplate;
        const imageQuestionEmptyTemplate = config.get<string>('imageQuestionEmptyPromptTemplate', defaultImageQuestionEmptyTemplate) || defaultImageQuestionEmptyTemplate;
        const prompt = question
            ? this.fillTemplate(imageQuestionTemplate, { question })
            : this.fillTemplate(imageQuestionEmptyTemplate, { question: '' });

        this.postUser(question ? `【图片提问】${question}` : '【图片提问】请讲解这张图片');
        await this.askModelWithImage(prompt, imageDataUrl);
    }

    private async askModel(userPrompt: string): Promise<void> {
        await this.runOrchestratedRequest({
            userPrompt,
            runningStatus: 'AI 正在思考...',
            execute: async ({ token, provider, guard }) => {
                guard.throwIfCancelled();
                const { requestMessages } = this.buildRequestMessages(userPrompt);
                const result = await provider.ask(requestMessages, token);
                guard.throwIfCancelled();
                return result;
            }
        });
    }

    private async askModelWithImage(userPrompt: string, imageDataUrl: string): Promise<void> {
        await this.runOrchestratedRequest({
            userPrompt,
            runningStatus: 'AI 正在识别图片...',
            execute: ({ token, provider, guard }) => this.askImageWithFallback(userPrompt, imageDataUrl, token, provider, guard)
        });
    }

    private async runOrchestratedRequest(args: {
        userPrompt: string;
        runningStatus: string;
        execute: (ctx: { token: vscode.CancellationToken; provider: AIProvider; guard: CancellationGuard }) => Promise<string>;
    }): Promise<void> {
        if (!(await this.checkPrivacy(args.userPrompt))) {
            return;
        }

        if (this.isRequestInFlight()) {
            this.postStatus('已有请求处理中，请稍候...');
            return;
        }

        const start = this.orchestrator.startRequest();
        if (!start.started) {
            this.postStatus('请求状态繁忙，请稍后重试');
            this.debug('request.start.rejected', this.orchestrator.getSnapshot());
            return;
        }

        this.runningTokenSource?.dispose();
        const tokenSource = new vscode.CancellationTokenSource();
        this.runningTokenSource = tokenSource;
        const requestId = start.requestId;
        const guard = new CancellationGuard(requestId, tokenSource.token, (id) => this.orchestrator.isCurrentRequest(id));
        const { style } = this.buildRequestMessages(args.userPrompt);
        this.debug('request.started', {
            requestId,
            promptLength: args.userPrompt.length,
            style,
            orchestrator: this.orchestrator.getSnapshot()
        });

        this.postStatus(args.runningStatus);

        try {
            const provider = this.getProvider();
            const answerRaw = await args.execute({ token: tokenSource.token, provider, guard });
            if (guard.isCancelled()) {
                this.debug('request.dropped.cancelled.before-render', { requestId });
                return;
            }

            const answer = style === 'plainText' ? this.toPlainText(answerRaw) : answerRaw;
            this.history.push({ role: 'user', content: args.userPrompt });
            this.history.push({ role: 'assistant', content: answer });
            this.postAssistant(answer);
            this.postStatus('已完成');
            this.debug('request.completed', { requestId, answerLength: answer.length });
        } catch (error) {
            if (guard.isCancelled()) {
                this.debug('request.error.ignored.cancelled', { requestId });
                return;
            }

            const msg = error instanceof Error ? error.message : String(error);
            if (/cancel/i.test(msg)) {
                this.postStatus('已取消');
                this.debug('request.cancelled.by-error', { requestId, message: msg });
            } else {
                this.postAssistant(`请求失败：${msg}`);
                this.postStatus('失败');
                this.debug('request.failed', { requestId, message: msg });
            }
        } finally {
            tokenSource.dispose();
            if (this.runningTokenSource === tokenSource) {
                this.runningTokenSource = undefined;
            }
            this.runningOcrWorker = undefined;
            this.orchestrator.finishRequest(requestId, tokenSource.token.isCancellationRequested || guard.isCancelled());
            this.debug('request.finalized', {
                requestId,
                tokenCancelled: tokenSource.token.isCancellationRequested,
                guardCancelled: guard.isCancelled(),
                orchestrator: this.orchestrator.getSnapshot()
            });
        }
    }

    private async askImageWithFallback(
        userPrompt: string,
        imageDataUrl: string,
        token: vscode.CancellationToken,
        provider: AIProvider,
        guard: CancellationGuard
    ): Promise<string> {
        guard.throwIfCancelled();
        const visionMode = this.resolveVisionMode();
        const canUseVisionApi = visionMode === 'openaiCompatible' && this.hasOpenAIKeyConfigured();
        const fallbackToOcr = vscode.workspace.getConfiguration('aiTutor').get<boolean>('imageExplainFallbackToOcr', true);

        if (canUseVisionApi) {
            const visionProvider = new OpenAICompatibleProvider();
            try {
                const visionResult = await visionProvider.askVision(userPrompt, imageDataUrl, token);
                guard.throwIfCancelled();
                return visionResult;
            } catch (visionError) {
                guard.throwIfCancelled();
                if (!fallbackToOcr) {
                    throw visionError;
                }

                const msg = visionError instanceof Error ? visionError.message : String(visionError);
                this.postSystem(`视觉接口不可用，已自动回退 OCR + 文本模型：${msg}`);
            }
        } else if (visionMode === 'openaiCompatible' && fallbackToOcr) {
            guard.throwIfCancelled();
            this.postSystem('未检测到视觉 API Key，已自动回退 OCR + 文本模型。');
        } else if (visionMode === 'openaiCompatible') {
            throw new Error('未配置视觉 API Key。请设置 aiTutor.openai.apiKey，或开启 aiTutor.imageExplainFallbackToOcr。');
        }

        guard.throwIfCancelled();
        this.postSystem('当前使用 OCR 回退：将先提取图片文字，再让模型讲解。');
        const ocrText = await this.ocrImageText(imageDataUrl, token);
        guard.throwIfCancelled();
        if (!ocrText) {
            throw new Error('OCR 未识别到有效文本。请换清晰截图或改用“解释图片”选择原图。');
        }

        const mergedPrompt = `${userPrompt}\n\n以下是从图片 OCR 提取的文本（可能有误）：\n${ocrText}`;
        const { requestMessages } = this.buildRequestMessages(mergedPrompt);
        const result = await provider.ask(requestMessages, token);
        guard.throwIfCancelled();
        return result;
    }

    private isRequestInFlight(): boolean {
        return Boolean(this.runningTokenSource && !this.runningTokenSource.token.isCancellationRequested);
    }

    private buildRequestMessages(userPrompt: string): {
        requestMessages: ChatMessage[];
        style: 'plainText' | 'markdown';
    } {
        const config = vscode.workspace.getConfiguration('aiTutor');
        const maxTurns = config.get<number>('maxContextTurns', 6);
        const fastMode = config.get<boolean>('fastMode', true);
        const effectiveMaxTurns = fastMode ? Math.min(maxTurns, 2) : maxTurns;
        const style = this.getResponseStyle();
        const styleInstruction = style === 'plainText'
            ? '输出纯文本，不要使用 Markdown 标记（不要使用 #、*、-、```、表格）。'
            : '可使用 Markdown 输出，并保持结构清晰。';

        const systemPrompt: ChatMessage = {
            role: 'system',
            content: `${config.get<string>('systemPrompt', '')}\n${styleInstruction}`
        };

        const contextMessages = this.history.slice(-effectiveMaxTurns * 2);
        const optimizedUserPrompt = fastMode ? this.optimizePromptForSpeed(userPrompt) : userPrompt;
        const requestMessages: ChatMessage[] = [
            systemPrompt,
            ...contextMessages,
            { role: 'user', content: optimizedUserPrompt }
        ];

        return { requestMessages, style };
    }

    private resolveVisionMode(): 'openaiCompatible' | 'ocr' {
        const config = vscode.workspace.getConfiguration('aiTutor');
        const mode = config.get<string>('visionMode', 'auto');
        if (mode === 'openaiCompatible') {
            return 'openaiCompatible';
        }
        if (mode === 'ocr') {
            return 'ocr';
        }

        return this.hasOpenAIKeyConfigured() ? 'openaiCompatible' : 'ocr';
    }

    private hasOpenAIKeyConfigured(): boolean {
        const config = vscode.workspace.getConfiguration('aiTutor');
        const apiKey = (
            config.get<string>('openai.apiKey', '').trim()
            || process.env.ANTHROPIC_API_KEY?.trim()
            || process.env.MINIMAX_API_KEY?.trim()
            || process.env.OPENAI_API_KEY?.trim()
            || ''
        );
        return Boolean(apiKey);
    }

    private getProvider(): AIProvider {
        const provider = vscode.workspace.getConfiguration('aiTutor').get<string>('provider', 'copilot');
        if (provider === 'openaiCompatible') {
            if (!this.hasOpenAIKeyConfigured()) {
                return new CopilotProvider();
            }
            return new OpenAICompatibleProvider();
        }
        return new CopilotProvider();
    }

    private async checkPrivacy(text: string): Promise<boolean> {
        const mode = vscode.workspace.getConfiguration('aiTutor').get<string>('privacyMode', 'allow');

        if (mode === 'deny') {
            vscode.window.showWarningMessage('当前隐私策略为 deny，已阻止将文本发送给模型。');
            return false;
        }

        if (mode === 'confirm') {
            const preview = text.length > 140 ? `${text.slice(0, 140)}...` : text;
            const choice = await vscode.window.showWarningMessage(
                `即将发送文本到模型：${preview}`,
                { modal: false },
                '允许本次',
                '取消'
            );
            return choice === '允许本次';
        }

        return true;
    }

    private buildSourceNote(explainContext?: ExplainContext): string {
        const include = vscode.workspace.getConfiguration('aiTutor').get<boolean>('includeFileContext', true);
        if (!include || !explainContext) {
            return '';
        }

        const fileName = explainContext.fileName ?? 'unknown';
        const lineInfo = typeof explainContext.lineStart === 'number' && typeof explainContext.lineEnd === 'number'
            ? ` 行 ${explainContext.lineStart}-${explainContext.lineEnd}`
            : '';

        return `[来源文件: ${fileName}${lineInfo}]\n`;
    }

    private postUser(text: string): void {
        this.uiMessages.push({ role: 'user', text });
        this.postToWebview({ type: 'message', role: 'user', text });
    }

    private postAssistant(text: string): void {
        const responseStyle = this.getResponseStyle();
        this.uiMessages.push({ role: 'assistant', text, responseStyle });
        this.postToWebview({
            type: 'message',
            role: 'assistant',
            text,
            responseStyle
        });
    }

    private postSystem(text: string): void {
        this.uiMessages.push({ role: 'system', text });
        this.postToWebview({ type: 'message', role: 'system', text });
    }

    private getResponseStyle(): 'plainText' | 'markdown' {
        const style = vscode.workspace.getConfiguration('aiTutor').get<string>('responseStyle', 'plainText');
        return style === 'markdown' ? 'markdown' : 'plainText';
    }

    private fillTemplate(template: string, values: Record<string, string>): string {
        let output = template;
        for (const [k, v] of Object.entries(values)) {
            output = output.replaceAll(`{{${k}}}`, v);
        }
        return output;
    }

    private optimizePromptForSpeed(prompt: string): string {
        const trimmed = prompt.trim();
        if (trimmed.length <= 1800) {
            return trimmed;
        }
        return `${trimmed.slice(0, 1800)}\n\n（其余内容已省略，请优先解释已给出的关键部分）`;
    }

    private toPlainText(text: string): string {
        return text
            .replace(/```[\s\S]*?```/g, '')
            .replace(/^\s{0,3}#{1,6}\s*/gm, '')
            .replace(/^\s*[-*+]\s+/gm, '• ')
            .replace(/^\s*\d+\.\s+/gm, '')
            .replace(/\*\*(.*?)\*\*/g, '$1')
            .replace(/\*(.*?)\*/g, '$1')
            .replace(/`([^`]+)`/g, '$1')
            .replace(/\[(.*?)\]\((.*?)\)/g, '$1')
            .replace(/\n{3,}/g, '\n\n')
            .trim();
    }

    private async toImageDataUrl(uri: vscode.Uri): Promise<string> {
        const bytes = await readFile(uri.fsPath);
        const lower = uri.path.toLowerCase();
        let mime = 'image/png';
        if (lower.endsWith('.jpg') || lower.endsWith('.jpeg')) {
            mime = 'image/jpeg';
        } else if (lower.endsWith('.webp')) {
            mime = 'image/webp';
        } else if (lower.endsWith('.bmp')) {
            mime = 'image/bmp';
        }

        const base64 = bytes.toString('base64');
        return `data:${mime};base64,${base64}`;
    }

    private async ocrImageText(imageDataUrl: string, token: vscode.CancellationToken): Promise<string> {
        const base64 = imageDataUrl.split(',')[1] ?? '';
        if (!base64) {
            return '';
        }

        const imageBuffer = Buffer.from(base64, 'base64');
        const worker = await createWorker('eng');
        this.runningOcrWorker = worker as unknown as { terminate: () => Promise<unknown> };
        const cancelSub = token.onCancellationRequested(() => {
            void worker.terminate();
        });
        try {
            const result = await worker.recognize(imageBuffer);
            const text = result.data?.text ?? '';
            return text.trim().slice(0, 4000);
        } finally {
            cancelSub.dispose();
            await worker.terminate();
            this.runningOcrWorker = undefined;
        }
    }

    private postStatus(text: string): void {
        this.lastStatusText = text;
        this.postToWebview({ type: 'status', text });
    }

    private postToWebview(message: unknown): void {
        if (this.view) {
            void this.view.webview.postMessage(message);
            return;
        }
        this.pendingWebviewMessages.push(message);
    }

    private flushPendingWebviewMessages(): void {
        if (!this.view || this.pendingWebviewMessages.length === 0) {
            return;
        }

        for (const msg of this.pendingWebviewMessages) {
            void this.view.webview.postMessage(msg);
        }
        this.pendingWebviewMessages = [];
    }

    private restoreWebviewState(): void {
        if (!this.view) {
            return;
        }

        void this.view.webview.postMessage({ type: 'reset' });
        for (const msg of this.uiMessages) {
            void this.view.webview.postMessage({
                type: 'message',
                role: msg.role,
                text: msg.text,
                responseStyle: msg.responseStyle
            });
        }

        if (this.lastStatusText) {
            void this.view.webview.postMessage({ type: 'status', text: this.lastStatusText });
        }

        this.pendingWebviewMessages = [];
    }

    private getHtml(): string {
        return `<!DOCTYPE html>
<html lang="zh-CN">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
    <link rel="stylesheet" href="https://cdn.jsdelivr.net/npm/katex@0.16.11/dist/katex.min.css">
  <style>
        html, body { height: 100%; overflow: hidden; }
        body {
            font-family: var(--vscode-font-family);
            color: var(--vscode-foreground);
            margin: 0;
            padding: 8px;
            box-sizing: border-box;
        }
        #app {
            height: 100%;
            display: flex;
            flex-direction: column;
            gap: 8px;
            min-height: 0;
            overflow: hidden;
        }
        #messages {
            border: 1px solid var(--vscode-editorWidget-border);
            border-radius: 6px;
            padding: 8px;
            flex: 1;
            min-height: 140px;
            overflow: auto;
            overscroll-behavior: contain;
            background: var(--vscode-editor-background);
        }
    .msg {
        margin: 8px 0;
        white-space: pre-wrap;
        line-height: 1.5;
        border-radius: 6px;
        padding: 8px 10px;
        border: 1px solid transparent;
    }
    .user {
        color: var(--vscode-textLink-foreground);
        background: color-mix(in srgb, var(--vscode-textLink-foreground) 10%, transparent);
        border-color: color-mix(in srgb, var(--vscode-textLink-foreground) 22%, transparent);
    }
    .assistant { color: var(--vscode-foreground); border-color: var(--vscode-editorWidget-border); }
    .system {
        color: var(--vscode-descriptionForeground);
        font-style: italic;
        background: color-mix(in srgb, var(--vscode-descriptionForeground) 10%, transparent);
    }
    .tag { font-weight: 600; margin-right: 4px; }
        #composer {
            border-top: 1px solid var(--vscode-editorWidget-border);
            padding-top: 8px;
            flex: 0 0 auto;
            background: var(--vscode-sideBar-background);
        }
        textarea {
            width: 100%;
            min-height: 84px;
            max-height: 180px;
            resize: vertical;
            box-sizing: border-box;
        }
        .row { display: flex; gap: 6px; margin-top: 8px; flex-wrap: wrap; }
    button { flex: 1; min-width: 90px; }
    button[disabled] { opacity: 0.55; cursor: not-allowed; }
        #status { color: var(--vscode-descriptionForeground); min-height: 18px; margin-top: 4px; }
        #status.running { color: var(--vscode-textLink-foreground); }
        #hint { color: var(--vscode-descriptionForeground); font-size: 12px; margin-top: 4px; }
  </style>
</head>
<body>
    <div id="app">
        <div id="messages"></div>
        <div id="composer">
            <textarea id="input" placeholder="可输入问题；也支持在此 Ctrl+V 粘贴图片后发送"></textarea>
            <div id="hint">Enter 发送，Shift+Enter 换行</div>
            <div class="row">
                <button id="send">发送问题</button>
                <button id="explainSelection">解释最近选中</button>
                <button id="fromClipboard">解释剪贴板</button>
                <button id="fromImage">解释图片</button>
                <button id="pasteImage">粘贴图片</button>
                <button id="cancel">取消响应</button>
                <button id="clear">清空</button>
            </div>
            <div id="status"></div>
        </div>
  </div>

  <script>
    const vscode = acquireVsCodeApi();
    const messagesEl = document.getElementById('messages');
    const inputEl = document.getElementById('input');
    const statusEl = document.getElementById('status');
    const sendBtn = document.getElementById('send');
    const explainSelectionBtn = document.getElementById('explainSelection');
    const fromClipboardBtn = document.getElementById('fromClipboard');
    const fromImageBtn = document.getElementById('fromImage');
    const pasteImageBtn = document.getElementById('pasteImage');
    const cancelBtn = document.getElementById('cancel');
    const clearBtn = document.getElementById('clear');
        let responseStyle = 'plainText';
    let pastedImageDataUrl = '';
    let isBusy = false;

        function setBusy(nextBusy) {
            isBusy = Boolean(nextBusy);
            sendBtn.disabled = isBusy;
            explainSelectionBtn.disabled = isBusy;
            fromClipboardBtn.disabled = isBusy;
            fromImageBtn.disabled = isBusy;
            pasteImageBtn.disabled = isBusy;
            clearBtn.disabled = isBusy;
            cancelBtn.disabled = !isBusy;
        }

        function updateStatus(text) {
            const msg = String(text || '');
            statusEl.textContent = msg;
            const running = /正在|处理中|识别/.test(msg);
            statusEl.classList.toggle('running', running);

            if (running) {
                setBusy(true);
                return;
            }

            if (/已完成|已取消|失败|没有进行中|为空|请先/.test(msg) || !msg) {
                setBusy(false);
            }
        }

        function setPastedImage(dataUrl) {
            pastedImageDataUrl = String(dataUrl || '');
            if (pastedImageDataUrl) {
                updateStatus('已粘贴图片，可直接点“发送问题”');
            }
        }

    function addMessage(role, text) {
      const div = document.createElement('div');
            div.className = 'msg ' + role;
      const tag = role === 'user' ? '你' : (role === 'assistant' ? '助教' : '系统');
            const body = role === 'assistant' && responseStyle === 'markdown'
                ? renderMarkdown(text)
                : toHtmlLines(text);
            div.innerHTML = '<span class="tag">[' + tag + ']</span>' + body;
      messagesEl.appendChild(div);
      messagesEl.scrollTop = messagesEl.scrollHeight;
    }

    function escapeHtml(str) {
      return str
        .replaceAll('&', '&amp;')
        .replaceAll('<', '&lt;')
        .replaceAll('>', '&gt;');
    }

    function toHtmlLines(str) {
      return escapeHtml(String(str)).split(String.fromCharCode(10)).join('<br/>');
    }

        function renderMarkdown(md) {
            const lines = String(md).split(String.fromCharCode(10));
            const rendered = lines.map((line) => {
                const safe = escapeHtml(line);
                if (safe.startsWith('### ')) {
                    return '<strong>' + safe.slice(4) + '</strong>';
                }
                if (safe.startsWith('## ')) {
                    return '<strong>' + safe.slice(3) + '</strong>';
                }
                if (safe.startsWith('# ')) {
                    return '<strong>' + safe.slice(2) + '</strong>';
                }
                if (safe.startsWith('- ')) {
                    return '• ' + safe.slice(2);
                }
                return safe;
            });
            return rendered.join('<br/>');
        }

    function handleSend() {
      const text = inputEl.value.trim();
            if (!text && !pastedImageDataUrl) return;
            if (isBusy) return;

            if (pastedImageDataUrl) {
                vscode.postMessage({ type: 'askImageFromInput', text, imageDataUrl: pastedImageDataUrl });
                pastedImageDataUrl = '';
                updateStatus('已发送图片请求');
            } else {
                vscode.postMessage({ type: 'ask', text });
                updateStatus('请求已发送，AI 正在思考...');
            }

      inputEl.value = '';
    }

    sendBtn.addEventListener('click', handleSend);

    inputEl.addEventListener('keydown', (event) => {
        if (event.key === 'Enter' && !event.shiftKey) {
            event.preventDefault();
            handleSend();
        }
    });

        function handlePaste(event) {
            const clipboard = event.clipboardData;
            if (!clipboard) {
                return;
            }

            const items = Array.from(clipboard.items || []);
            for (const item of items) {
                if (item.type && item.type.startsWith('image/')) {
                    const file = item.getAsFile();
                    if (!file) {
                        continue;
                    }

                    event.preventDefault();
                    const reader = new FileReader();
                    reader.onload = () => setPastedImage(reader.result);
                    reader.readAsDataURL(file);
                    return;
                }
            }

            const files = Array.from(clipboard.files || []);
            const imageFile = files.find((f) => f.type && f.type.startsWith('image/'));
            if (imageFile) {
                event.preventDefault();
                const reader = new FileReader();
                reader.onload = () => setPastedImage(reader.result);
                reader.readAsDataURL(imageFile);
            }
        }

        inputEl.addEventListener('paste', handlePaste);
        document.addEventListener('paste', handlePaste, true);

        document.getElementById('pasteImage').addEventListener('click', async () => {
            try {
                if (!navigator.clipboard || !navigator.clipboard.read) {
                    updateStatus('当前环境不支持主动读剪贴板，请在输入框按 Ctrl+V。');
                    return;
                }

                const items = await navigator.clipboard.read();
                for (const item of items) {
                    const imageType = item.types.find((t) => t.startsWith('image/'));
                    if (!imageType) {
                        continue;
                    }

                    const blob = await item.getType(imageType);
                    const reader = new FileReader();
                    reader.onload = () => setPastedImage(reader.result);
                    reader.readAsDataURL(blob);
                    return;
                }

                updateStatus('剪贴板里没有图片。');
            } catch {
                updateStatus('读取剪贴板失败，请先点击输入框后按 Ctrl+V。');
            }
        });

    document.getElementById('explainSelection').addEventListener('click', () => {
      vscode.postMessage({ type: 'explainLastSelection' });
    });

    document.getElementById('clear').addEventListener('click', () => {
      vscode.postMessage({ type: 'clear' });
    });

        document.getElementById('fromClipboard').addEventListener('click', () => {
            vscode.postMessage({ type: 'explainClipboard' });
        });

        document.getElementById('cancel').addEventListener('click', () => {
            vscode.postMessage({ type: 'cancel' });
        });

        document.getElementById('fromImage').addEventListener('click', () => {
            vscode.postMessage({ type: 'explainImage' });
        });

    window.addEventListener('message', (event) => {
      const msg = event.data;
      if (msg.type === 'message') {
                if (msg.responseStyle) {
                    responseStyle = msg.responseStyle;
                }
        addMessage(msg.role, msg.text);
      } else if (msg.type === 'status') {
                updateStatus(msg.text);
      } else if (msg.type === 'reset') {
        messagesEl.innerHTML = '';
                updateStatus('');
            } else if (msg.type === 'config') {
                responseStyle = msg.responseStyle || 'plainText';
      }
    });

        setBusy(false);
  </script>
    <script defer src="https://cdn.jsdelivr.net/npm/katex@0.16.11/dist/katex.min.js"></script>
    <script defer src="https://cdn.jsdelivr.net/npm/katex@0.16.11/dist/contrib/auto-render.min.js"></script>
    <script>
        setInterval(() => {
            if (typeof renderMathInElement === 'function') {
                try {
                    renderMathInElement(document.body, {
                        delimiters: [
                            { left: '$$', right: '$$', display: true },
                            { left: '$', right: '$', display: false }
                        ],
                        throwOnError: false
                    });
                } catch {
                    // ignore
                }
            }
        }, 1200);
    </script>
</body>
</html>`;
    }
}

function safeStringifyForDebug(value: unknown): string {
    try {
        return JSON.stringify(value);
    } catch {
        return String(value);
    }
}

export function activate(context: vscode.ExtensionContext) {
    const debugChannel = vscode.window.createOutputChannel('AI Tutor Debug');
    context.subscriptions.push(debugChannel);

    const isDebugEnabled = (): boolean => vscode.workspace.getConfiguration('aiTutor').get<boolean>('debugMode', false);
    const debugLog: DebugLogger = (message, data) => {
        if (!isDebugEnabled()) {
            return;
        }

        const ts = new Date().toISOString();
        const suffix = typeof data === 'undefined'
            ? ''
            : ` ${safeStringifyForDebug(data)}`;
        debugChannel.appendLine(`[${ts}] ${message}${suffix}`);
    };

    const provider = new AITutorViewProvider(context, debugLog);

    context.subscriptions.push(
        vscode.window.registerWebviewViewProvider(AITutorViewProvider.viewType, provider, {
            webviewOptions: { retainContextWhenHidden: true }
        })
    );

    context.subscriptions.push(vscode.commands.registerCommand('aiTutor.openSidebar', async () => {
        await provider.reveal();
    }));

    context.subscriptions.push(vscode.commands.registerCommand('aiTutor.debugOpenLogs', () => {
        debugChannel.show(true);
        debugLog('debug.channel.opened');
    }));

    context.subscriptions.push(vscode.commands.registerCommand('aiTutor.debugDumpState', () => {
        const snapshot = provider.getDebugSnapshot();
        debugLog('debug.snapshot', snapshot);
        debugChannel.show(true);
        vscode.window.showInformationMessage('AI Tutor 调试状态已输出到 “AI Tutor Debug” 面板。');
    }));

    context.subscriptions.push(vscode.commands.registerCommand('aiTutor.clearConversation', async () => {
        provider.clearHistory();
    }));

    context.subscriptions.push(vscode.commands.registerCommand('aiTutor.explainClipboard', async () => {
        provider.beginManualInteraction();
        await provider.reveal();
        await provider.explainClipboardText();
    }));

    context.subscriptions.push(vscode.commands.registerCommand('aiTutor.cancelResponse', () => {
        provider.cancelCurrentRequest();
    }));

    context.subscriptions.push(vscode.commands.registerCommand('aiTutor.explainImage', async () => {
        provider.beginManualInteraction();
        await provider.reveal();
        await provider.explainImage();
    }));

    context.subscriptions.push(vscode.commands.registerCommand('aiTutor.explainSelection', async () => {
        provider.beginManualInteraction();
        const editor = vscode.window.activeTextEditor;
        const useClipboardFallback = vscode.workspace.getConfiguration('aiTutor').get<boolean>('useClipboardFallback', true);

        let text = '';
        let explainContext: ExplainContext | undefined;

        if (editor) {
            text = editor.document.getText(editor.selection).trim();
            if (text) {
                const start = editor.selection.start.line + 1;
                const end = editor.selection.end.line + 1;
                explainContext = {
                    fileName: vscode.workspace.asRelativePath(editor.document.uri),
                    lineStart: Math.min(start, end),
                    lineEnd: Math.max(start, end)
                };
            }
        }

        if (!text && useClipboardFallback) {
            text = (await vscode.env.clipboard.readText()).trim();
            if (text) {
                explainContext = { fileName: 'clipboard' };
                vscode.window.showInformationMessage('未检测到编辑器选中文本，已改为解释剪贴板内容。');
            }
        }

        if (!text) {
            vscode.window.showWarningMessage('请先选中一段文本；若在 PDF 预览中，请先复制后再执行“讲解剪贴板文本”。');
            return;
        }

        await provider.reveal();
        await provider.explainSelection(text, explainContext);
    }));

    context.subscriptions.push(registerPdfTutorPanel({
        context,
        onSelection: async (text, sourceLabel) => {
            provider.beginManualInteraction();
            await provider.reveal();
            await provider.explainSelection(text, { fileName: sourceLabel });
        }
    }));

    let debounceTimer: NodeJS.Timeout | undefined;
    let mouseReleaseTimer: NodeJS.Timeout | undefined;
    let lastAutoSelection = '';
    let lastAutoClipboard = '';
    let pendingClipboardText = '';
    let pendingClipboardSince = 0;
    let pendingClipboardStableCount = 0;
    let pdfSelectionSettlingUntil = 0;
    let verifyingPdfSelection = false;
    let lastAutoTriggerAt = 0;
    let lastPdfCopyAttemptAt = 0;

    const normalizeSelectionText = (input: string): string => input.replace(/\s+/g, ' ').trim();

    const isAutoSelectionEligibleEditor = (editor: vscode.TextEditor): boolean => {
        const scheme = editor.document.uri.scheme;
        if (scheme !== 'file' && scheme !== 'untitled') {
            return false;
        }

        const languageId = editor.document.languageId;
        if (languageId === 'Log') {
            return false;
        }

        return true;
    };

    const isPdfTabActive = (): boolean => {
        const tab = vscode.window.tabGroups.activeTabGroup.activeTab;
        if (!tab) {
            return false;
        }

        const label = (tab.label ?? '').toLowerCase();
        if (label.endsWith('.pdf')) {
            return true;
        }

        const input = tab.input as { uri?: vscode.Uri } | undefined;
        const path = input?.uri?.path?.toLowerCase?.();
        if (path?.endsWith('.pdf')) {
            return true;
        }

        return false;
    };

    context.subscriptions.push(vscode.window.onDidChangeTextEditorSelection(async (event) => {
        const config = vscode.workspace.getConfiguration('aiTutor');
        const auto = config.get<boolean>('autoExplainOnSelection', true);
        if (!auto) {
            debugLog('selection.event.ignored.auto-disabled');
            return;
        }

        if (!isAutoSelectionEligibleEditor(event.textEditor)) {
            return;
        }

        if (!provider.canAutoTrigger()) {
            debugLog('selection.event.ignored.auto-gate-blocked');
            return;
        }

        const isMouseSelection = event.kind === vscode.TextEditorSelectionChangeKind.Mouse;
        debugLog('selection.event.received', {
            kind: event.kind,
            isMouseSelection,
            file: vscode.workspace.asRelativePath(event.textEditor.document.uri)
        });

        const editor = event.textEditor;
        if (!editor.selection || editor.selection.isEmpty) {
            debugLog('selection.event.ignored.empty-selection');
            return;
        }

        const text = editor.document.getText(editor.selection).trim();
        const minLength = config.get<number>('minSelectionLength', 1);
        if (!text || text.length < minLength) {
            debugLog('selection.event.ignored.too-short', { textLength: text.length, minLength });
            return;
        }

        const capturedUri = editor.document.uri.toString();
        const capturedStart = editor.selection.start;
        const capturedEnd = editor.selection.end;

        const cooldownMs = config.get<number>('autoExplainCooldownMs', 3000);
        if (Date.now() - lastAutoTriggerAt < cooldownMs) {
            debugLog('selection.event.ignored.cooldown', { cooldownMs, elapsed: Date.now() - lastAutoTriggerAt });
            return;
        }

        if (text === lastAutoSelection) {
            debugLog('selection.event.ignored.same-as-last-auto');
            return;
        }

        const debounceMs = config.get<number>('selectionDebounceMs', 1200);
        const mouseReleaseDelayMs = config.get<number>('mouseReleaseDelayMs', 180);
        const releaseDelayMs = isMouseSelection ? mouseReleaseDelayMs : 0;

        if (mouseReleaseTimer) {
            clearTimeout(mouseReleaseTimer);
        }

        mouseReleaseTimer = setTimeout(() => {
            if (debounceTimer) {
                clearTimeout(debounceTimer);
            }

            debounceTimer = setTimeout(async () => {
                const active = vscode.window.activeTextEditor;
                if (!active) {
                    debugLog('selection.trigger.aborted.no-active-editor');
                    return;
                }

                if (active.document.uri.toString() !== capturedUri) {
                    debugLog('selection.trigger.aborted.uri-changed');
                    return;
                }

                const currentSel = active.selection;
                const sameRange =
                    currentSel.start.line === capturedStart.line &&
                    currentSel.start.character === capturedStart.character &&
                    currentSel.end.line === capturedEnd.line &&
                    currentSel.end.character === capturedEnd.character;

                if (!sameRange || currentSel.isEmpty) {
                    debugLog('selection.trigger.aborted.range-changed-or-empty');
                    return;
                }

                const currentText = active.document.getText(currentSel).trim();
                if (!currentText || currentText !== text) {
                    debugLog('selection.trigger.aborted.text-changed', {
                        capturedLength: text.length,
                        currentLength: currentText.length
                    });
                    return;
                }

                lastAutoSelection = text;
                lastAutoTriggerAt = Date.now();
                debugLog('selection.trigger.fire', {
                    textLength: text.length,
                    debounceMs,
                    releaseDelayMs
                });
                const start = currentSel.start.line + 1;
                const end = currentSel.end.line + 1;
                await provider.reveal();
                await provider.explainSelection(text, {
                    fileName: vscode.workspace.asRelativePath(active.document.uri),
                    lineStart: Math.min(start, end),
                    lineEnd: Math.max(start, end)
                }, 'auto');
            }, debounceMs);
        }, releaseDelayMs);
    }));

    const clipboardTimer = setInterval(async () => {
        try {
            const config = vscode.workspace.getConfiguration('aiTutor');
            const enabled = config.get<boolean>('autoExplainOnClipboardChange', true);
            if (!enabled) {
                return;
            }

            if (!provider.canAutoTrigger()) {
                return;
            }

            const autoCapturePdfSelection = config.get<boolean>('autoCapturePdfSelection', true);
            const pdfTabActive = isPdfTabActive();
            if (autoCapturePdfSelection && pdfTabActive) {
                const now = Date.now();
                const pdfAutoCopyProbeMs = 900;
                const hasPendingCandidate = Boolean(pendingClipboardText);
                const canProbeCopy = !hasPendingCandidate && !verifyingPdfSelection && now - lastPdfCopyAttemptAt >= pdfAutoCopyProbeMs;
                if (canProbeCopy) {
                    lastPdfCopyAttemptAt = now;
                    try {
                        await vscode.commands.executeCommand('editor.action.clipboardCopyAction');
                    } catch {
                        // ignore copy failures from non-text editors
                    }
                }
            }

            const text = (await vscode.env.clipboard.readText()).trim();
            const minLength = config.get<number>('minSelectionLength', 1);
            if (!text || text.length < minLength) {
                pendingClipboardText = '';
                pendingClipboardSince = 0;
                pendingClipboardStableCount = 0;
                return;
            }

            const clipboardStableMs = config.get<number>('clipboardStableMs', 1000);
            const pdfSelectionSettleMs = 1400;

            if (text !== pendingClipboardText) {
                pendingClipboardText = text;
                pendingClipboardSince = Date.now();
                pendingClipboardStableCount = 1;
                if (pdfTabActive) {
                    // PDF 拖选时会出现选区闪烁和内容抖动，先进入沉默窗口，不立即触发
                    pdfSelectionSettlingUntil = Date.now() + pdfSelectionSettleMs;
                }
                return;
            }

            pendingClipboardStableCount += 1;

            if (pdfTabActive && Date.now() < pdfSelectionSettlingUntil) {
                return;
            }

            if (Date.now() - pendingClipboardSince < clipboardStableMs) {
                return;
            }

            // PDF 场景二次校验：触发前执行两次复制并比对剪贴板，尽量确保左键已松开
            if (pdfTabActive) {
                if (verifyingPdfSelection) {
                    return;
                }

                verifyingPdfSelection = true;
                try {
                    try {
                        await vscode.commands.executeCommand('editor.action.clipboardCopyAction');
                    } catch {
                        // ignore
                    }

                    await new Promise((resolve) => setTimeout(resolve, 140));
                    const verifyText1 = (await vscode.env.clipboard.readText()).trim();
                    if (!verifyText1 || normalizeSelectionText(verifyText1) !== normalizeSelectionText(text)) {
                        pendingClipboardText = verifyText1;
                        pendingClipboardSince = Date.now();
                        pendingClipboardStableCount = 1;
                        pdfSelectionSettlingUntil = Date.now() + pdfSelectionSettleMs;
                        return;
                    }

                    try {
                        await vscode.commands.executeCommand('editor.action.clipboardCopyAction');
                    } catch {
                        // ignore
                    }

                    await new Promise((resolve) => setTimeout(resolve, 180));
                    const verifyText2 = (await vscode.env.clipboard.readText()).trim();
                    if (!verifyText2 || normalizeSelectionText(verifyText2) !== normalizeSelectionText(verifyText1)) {
                        pendingClipboardText = verifyText2;
                        pendingClipboardSince = Date.now();
                        pendingClipboardStableCount = 1;
                        pdfSelectionSettlingUntil = Date.now() + pdfSelectionSettleMs;
                        return;
                    }
                } finally {
                    verifyingPdfSelection = false;
                }
            }

            const cooldownMs = config.get<number>('autoExplainCooldownMs', 3000);
            if (Date.now() - lastAutoTriggerAt < cooldownMs) {
                return;
            }

            if (text === lastAutoClipboard || text === lastAutoSelection) {
                return;
            }

            lastAutoClipboard = text;
            pendingClipboardText = '';
            pendingClipboardSince = 0;
            pendingClipboardStableCount = 0;
            lastAutoTriggerAt = Date.now();
            await provider.reveal();
            await provider.explainSelection(text, { fileName: 'clipboard-auto' }, 'auto');
        } catch (error) {
            const msg = error instanceof Error ? error.message : String(error);
            vscode.window.setStatusBarMessage(`AI 助教自动捕获异常：${msg}`, 3000);
        }
    }, 700);

    context.subscriptions.push({
        dispose: () => clearInterval(clipboardTimer)
    });

    void provider.reveal();
    vscode.window.setStatusBarMessage('AI 助教已启动：在 PDF 里选中文本即可自动讲解。', 4000);
}

export function deactivate() {}