import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { AppConfig, LogLevel, ProviderKind, ProviderPreset, ProviderProtocol, PublicSettings, SettingsUpdate } from './types';
import { resolveResponseTextPath } from '../core/openaiResponseUtils';

export class SettingsValidationError extends Error {}

const defaultSystemPrompt = '你是计算机课程 PDF 助教。回答必须完全基于用户提供的 PDF 选区与周围页面上下文，不要编造外部资料。默认使用中英双语：中文解释为主，关键术语保留英文原词。只解释用户选中的内容或追问的问题，周围页面上下文只用于消歧、定位定义和补足前后逻辑。';

const defaultExplainPromptTemplate = [
    '请基于 PDF 周围页面上下文，精准讲解用户选中的部分。',
    '',
    '## 来源',
    '{{source}}',
    '',
    '## 用户选区（只讲解这部分）',
    '{{text}}',
    '',
    '## 周围页面上下文（仅用于理解，不要泛泛复述）',
    '{{pageContext}}',
    '',
    '## 输出要求',
    '1. 使用 Markdown。',
    '2. 先给出“结构化知识点”：用层级项目符号拆出概念、机制、流程、因果关系。',
    '3. 中英双语解释：中文说明为主，关键术语写成“中文解释 (English term)”。',
    '4. 完全基于上下文，说明该选区在本页/相邻页中的精准含义。',
    '5. 如果上下文不足，明确说“上下文不足”，不要猜测。',
    '6. 不要讲解未被选中的大段背景。'
].join('\n');

const defaultTranslatePromptTemplate = [
    '请把下面 PDF 选中文本做结构化翻译。',
    '',
    '## 来源',
    '{{source}}',
    '',
    '## 原文',
    '{{text}}',
    '',
    '## 输出要求',
    '1. 使用 Markdown。',
    '2. 先输出“整段翻译”：完整、通顺地翻译整段选中文本。',
    '3. 再输出“关键词汇对照”：从整段翻译中挑出关键中文词组，并用括号补充英文原词，例如：操作系统 (operating system)。',
    '4. 最后输出“关键单词讲解”：解释重要英文词/短语的通用释义、在本段里的具体含义、为什么这样翻译。',
    '5. 不要加入与原文无关的扩展内容。'
].join('\n');

const defaultFollowupPromptTemplate = [
    '请只回答用户追问的问题，并基于最近选区与周围页面上下文。',
    '',
    '## 最近选区',
    '{{selection}}',
    '',
    '## 周围页面上下文（仅用于理解，不要泛泛复述）',
    '{{pageContext}}',
    '',
    '## 用户追问',
    '{{question}}',
    '',
    '## 输出要求',
    '1. 使用 Markdown。',
    '2. 直接回答追问，不重复完整讲解选区。',
    '3. 必须引用相关英文原词或短语，并给出中文解释。',
    '4. 如果上下文不足，明确指出缺少哪些信息。'
].join('\n');

type RawConfig = Partial<AppConfig> & {
    provider?: Partial<AppConfig['provider']>;
};

type PresetDefaults = {
    protocol: ProviderProtocol;
    endpoint: string;
    model: string;
};

const providerPresetDefaults: Record<Exclude<ProviderPreset, 'custom' | 'mock'>, PresetDefaults> = {
    openai: {
        protocol: 'openai',
        endpoint: 'https://api.openai.com/v1/chat/completions',
        model: 'gpt-5'
    },
    deepseek: {
        protocol: 'openai',
        endpoint: 'https://api.deepseek.com/chat/completions',
        model: 'deepseek-v4-flash-vision-exp'
    }
};

export function loadConfig(cwd = process.cwd(), env = process.env): AppConfig {
    const fileConfig = readConfigFile(cwd, env.AI_TUTOR_CONFIG);
    const apiKey = stringValue(
        env.AI_TUTOR_API_KEY
        ?? env.OPENAI_API_KEY
        ?? env.ANTHROPIC_API_KEY
        ?? fileConfig.provider?.apiKey
        ?? ''
    );
    const rawPresetValue = env.AI_TUTOR_PROVIDER_PRESET
        ?? env.AI_TUTOR_PROVIDER
        ?? fileConfig.provider?.preset
        ?? fileConfig.provider?.kind
        ?? 'deepseek';
    const preset = resolveProviderPreset(rawPresetValue, env.AI_TUTOR_ENDPOINT ?? fileConfig.provider?.endpoint ?? '', apiKey);
    const presetDefaults = providerDefaultsForPreset(preset);
    const envPresetOverride = Boolean(
        env.AI_TUTOR_PROVIDER_PRESET
        || ['mock', 'openai', 'gpt', 'deepseek'].includes(stringValue(env.AI_TUTOR_PROVIDER).toLowerCase())
    );
    const protocol = normalizeProtocol(
        env.AI_TUTOR_PROTOCOL
        ?? (envPresetOverride ? presetDefaults?.protocol : undefined)
        ?? fileConfig.provider?.protocol
        ?? presetDefaults?.protocol
        ?? 'openai'
    );
    const providerKind = providerKindForPreset(preset);
    const logLevel = normalizeLogLevel(env.AI_TUTOR_LOG_LEVEL ?? fileConfig.logLevel ?? 'debug');
    const logFile = resolve(cwd, stringValue(env.AI_TUTOR_LOG_FILE ?? fileConfig.logFile ?? 'logs/app.log'));

    const responseTextPath = resolveResponseTextPath(
        protocol,
        stringValue(env.AI_TUTOR_RESPONSE_TEXT_PATH ?? fileConfig.provider?.responseTextPath ?? '')
    );

    return {
        configFile: configPath(cwd, env.AI_TUTOR_CONFIG),
        host: stringValue(env.AI_TUTOR_HOST ?? fileConfig.host ?? '127.0.0.1'),
        port: numberValue(env.AI_TUTOR_PORT ?? fileConfig.port, 5178),
        publicDir: resolve(cwd, stringValue(env.AI_TUTOR_PUBLIC_DIR ?? fileConfig.publicDir ?? 'public')),
        logLevel,
        logFile,
        provider: {
            preset,
            kind: providerKind,
            protocol,
            endpoint: normalizeEndpoint(protocol, env.AI_TUTOR_ENDPOINT ?? (envPresetOverride ? presetDefaults?.endpoint : undefined) ?? fileConfig.provider?.endpoint ?? presetDefaults?.endpoint ?? 'https://api.openai.com/v1/chat/completions'),
            model: stringValue(env.AI_TUTOR_MODEL ?? (envPresetOverride ? presetDefaults?.model : undefined) ?? fileConfig.provider?.model ?? presetDefaults?.model ?? providerPresetDefaults.deepseek.model),
            apiKey,
            apiKeyHeader: stringValue(env.AI_TUTOR_API_KEY_HEADER ?? fileConfig.provider?.apiKeyHeader ?? 'Authorization'),
            apiKeyPrefix: normalizeApiKeyPrefix(env.AI_TUTOR_API_KEY_PREFIX ?? fileConfig.provider?.apiKeyPrefix ?? 'Bearer '),
            responseTextPath,
            anthropicVersion: stringValue(env.AI_TUTOR_ANTHROPIC_VERSION ?? fileConfig.provider?.anthropicVersion ?? '2023-06-01'),
            anthropicBeta: stringValue(env.AI_TUTOR_ANTHROPIC_BETA ?? fileConfig.provider?.anthropicBeta ?? ''),
            anthropicMaxTokens: numberValue(env.AI_TUTOR_ANTHROPIC_MAX_TOKENS ?? fileConfig.provider?.anthropicMaxTokens, 1024),
            extraHeaders: stringifyRecord(parseObject(env.AI_TUTOR_EXTRA_HEADERS_JSON, fileConfig.provider?.extraHeaders)),
            extraBody: parseObject(env.AI_TUTOR_EXTRA_BODY_JSON, fileConfig.provider?.extraBody),
            mockChunkDelayMs: numberValue(env.AI_TUTOR_MOCK_DELAY_MS ?? fileConfig.provider?.mockChunkDelayMs, 25)
        },
        systemPrompt: promptValue(env.AI_TUTOR_SYSTEM_PROMPT, fileConfig.systemPrompt, defaultSystemPrompt, '术语对照'),
        explainPromptTemplate: promptValue(env.AI_TUTOR_EXPLAIN_PROMPT, fileConfig.explainPromptTemplate, defaultExplainPromptTemplate, '一句话总结'),
        translatePromptTemplate: promptValue(env.AI_TUTOR_TRANSLATE_PROMPT, fileConfig.translatePromptTemplate, defaultTranslatePromptTemplate, '不要扩写讲解'),
        followupPromptTemplate: promptValue(env.AI_TUTOR_FOLLOWUP_PROMPT, fileConfig.followupPromptTemplate, defaultFollowupPromptTemplate, '标注引用到的关键英文短语'),
        maxSelectionChars: numberValue(env.AI_TUTOR_MAX_SELECTION_CHARS ?? migrateMaxSelectionChars(fileConfig.maxSelectionChars), 6000)
    };
}

export function configPath(cwd = process.cwd(), configuredPath?: string): string {
    return configuredPath ? resolve(cwd, configuredPath) : join(cwd, 'ai-tutor.config.json');
}

export function publicSettingsFromConfig(config: AppConfig): PublicSettings {
    return {
        provider: {
            kind: config.provider.kind,
            preset: config.provider.preset,
            protocol: config.provider.protocol,
            endpoint: config.provider.endpoint,
            model: config.provider.model,
            apiKeyConfigured: Boolean(config.provider.apiKey),
            apiKeyHeader: config.provider.apiKeyHeader,
            apiKeyPrefix: config.provider.apiKeyPrefix,
            responseTextPath: config.provider.responseTextPath,
            anthropicVersion: config.provider.anthropicVersion,
            anthropicBeta: config.provider.anthropicBeta,
            anthropicMaxTokens: config.provider.anthropicMaxTokens,
            extraHeadersJson: JSON.stringify(config.provider.extraHeaders, null, 2),
            extraBodyJson: JSON.stringify(config.provider.extraBody, null, 2)
        },
        systemPrompt: config.systemPrompt,
        explainPromptTemplate: config.explainPromptTemplate,
        translatePromptTemplate: config.translatePromptTemplate,
        followupPromptTemplate: config.followupPromptTemplate,
        maxSelectionChars: config.maxSelectionChars
    };
}

export function applySettingsUpdate(current: AppConfig, update: SettingsUpdate): AppConfig {
    const providerUpdate = update.provider ?? {};
    const nextPreset = normalizeProviderPreset(providerUpdate.preset ?? providerUpdate.kind ?? current.provider.preset);
    const providerChanged = nextPreset !== current.provider.preset;
    const typedApiKey = typeof providerUpdate.apiKey === 'string' ? providerUpdate.apiKey.trim() : '';
    const nextApiKey = providerUpdate.clearApiKey
        ? ''
        : (typedApiKey || (providerChanged ? '' : current.provider.apiKey));
    const presetDefaults = providerDefaultsForPreset(nextPreset);
    const nextProtocol = normalizeProtocol(presetDefaults?.protocol ?? providerUpdate.protocol ?? current.provider.protocol);
    const nextEndpoint = normalizeEndpoint(nextProtocol, presetDefaults?.endpoint ?? providerUpdate.endpoint ?? current.provider.endpoint);
    validateProtocolEndpoint(nextProtocol, nextEndpoint);

    return {
        ...current,
        provider: {
            ...current.provider,
            preset: nextPreset,
            kind: providerKindForPreset(nextPreset),
            protocol: nextProtocol,
            endpoint: nextEndpoint,
            model: stringValue(providerUpdate.model ?? presetDefaults?.model ?? current.provider.model),
            apiKey: nextApiKey,
            apiKeyHeader: stringValue(providerUpdate.apiKeyHeader ?? current.provider.apiKeyHeader) || 'Authorization',
            apiKeyPrefix: normalizeApiKeyPrefix(providerUpdate.apiKeyPrefix ?? current.provider.apiKeyPrefix),
            responseTextPath: resolveResponseTextPath(nextProtocol, stringValue(providerUpdate.responseTextPath ?? current.provider.responseTextPath)),
            anthropicVersion: stringValue(providerUpdate.anthropicVersion ?? current.provider.anthropicVersion) || '2023-06-01',
            anthropicBeta: stringValue(providerUpdate.anthropicBeta ?? current.provider.anthropicBeta),
            anthropicMaxTokens: Math.max(1, numberValue(providerUpdate.anthropicMaxTokens ?? current.provider.anthropicMaxTokens, current.provider.anthropicMaxTokens)),
            extraHeaders: stringifyRecord(parseObject(providerUpdate.extraHeadersJson, current.provider.extraHeaders)),
            extraBody: parseObject(providerUpdate.extraBodyJson, current.provider.extraBody),
            mockChunkDelayMs: current.provider.mockChunkDelayMs
        },
        systemPrompt: stringValue(update.systemPrompt ?? current.systemPrompt),
        explainPromptTemplate: stringValue(update.explainPromptTemplate ?? current.explainPromptTemplate),
        translatePromptTemplate: stringValue(update.translatePromptTemplate ?? current.translatePromptTemplate),
        followupPromptTemplate: stringValue(update.followupPromptTemplate ?? current.followupPromptTemplate),
        maxSelectionChars: Math.max(100, numberValue(update.maxSelectionChars ?? current.maxSelectionChars, current.maxSelectionChars))
    };
}

export function saveConfigFile(config: AppConfig, cwd = process.cwd(), configuredPath?: string): void {
    const persisted = {
        host: config.host,
        port: config.port > 0 ? config.port : 5178,
        logLevel: config.logLevel,
        provider: {
            preset: config.provider.preset,
            kind: config.provider.kind,
            protocol: config.provider.protocol,
            endpoint: config.provider.endpoint,
            model: config.provider.model,
            apiKey: config.provider.apiKey,
            apiKeyHeader: config.provider.apiKeyHeader,
            apiKeyPrefix: config.provider.apiKeyPrefix,
            responseTextPath: config.provider.responseTextPath,
            anthropicVersion: config.provider.anthropicVersion,
            anthropicBeta: config.provider.anthropicBeta,
            anthropicMaxTokens: config.provider.anthropicMaxTokens,
            extraHeaders: config.provider.extraHeaders,
            extraBody: config.provider.extraBody,
            mockChunkDelayMs: config.provider.mockChunkDelayMs
        },
        systemPrompt: config.systemPrompt,
        explainPromptTemplate: config.explainPromptTemplate,
        translatePromptTemplate: config.translatePromptTemplate,
        followupPromptTemplate: config.followupPromptTemplate,
        maxSelectionChars: config.maxSelectionChars
    };
    writeFileSync(configPath(cwd, configuredPath ?? config.configFile), `${JSON.stringify(persisted, null, 2)}\n`, 'utf8');
}

function readConfigFile(cwd: string, configuredPath: string | undefined): RawConfig {
    const path = configPath(cwd, configuredPath);
    if (!existsSync(path)) {
        return {};
    }

    const raw = readFileSync(path, 'utf8');
    const parsed = JSON.parse(raw) as unknown;
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
        throw new Error(`Config file must contain a JSON object: ${path}`);
    }

    return parsed as RawConfig;
}

function resolveProviderPreset(value: unknown, endpoint: unknown, apiKey: string): ProviderPreset {
    const preset = normalizeProviderPreset(value);
    if (preset !== 'custom') {
        return preset;
    }

    const endpointPreset = presetFromEndpoint(endpoint);
    if (endpointPreset) {
        return endpointPreset;
    }

    return apiKey ? 'custom' : 'mock';
}

function normalizeProviderPreset(value: unknown): ProviderPreset {
    const normalized = String(value ?? '').trim().toLowerCase();
    if (normalized === 'mock') {
        return 'mock';
    }
    if (normalized === 'openai' || normalized === 'gpt') {
        return 'openai';
    }
    if (normalized === 'deepseek') {
        return 'deepseek';
    }
    return 'custom';
}

function presetFromEndpoint(value: unknown): ProviderPreset | null {
    const endpoint = stringValue(value);
    if (!endpoint) {
        return null;
    }

    try {
        const host = new URL(endpoint).hostname.toLowerCase();
        if (host === 'api.openai.com') {
            return 'openai';
        }
        if (host.endsWith('deepseek.com')) {
            return 'deepseek';
        }
    } catch {
        return null;
    }

    return null;
}

function providerDefaultsForPreset(preset: ProviderPreset): PresetDefaults | null {
    if (preset === 'openai' || preset === 'deepseek') {
        return providerPresetDefaults[preset];
    }
    return null;
}

function providerKindForPreset(preset: ProviderPreset): ProviderKind {
    return preset === 'mock' ? 'mock' : 'openaiCompatible';
}

function normalizeProtocol(value: unknown): ProviderProtocol {
    return String(value).trim().toLowerCase() === 'anthropic' ? 'anthropic' : 'openai';
}

function normalizeEndpoint(protocol: ProviderProtocol, value: unknown): string {
    const endpoint = stringValue(value);
    const fallback = protocol === 'anthropic'
        ? 'https://api.anthropic.com/v1/messages'
        : 'https://api.openai.com/v1/chat/completions';
    const raw = endpoint || fallback;

    try {
        const url = new URL(raw);
        const path = url.pathname.replace(/\/+$/, '');
        if (protocol === 'anthropic') {
            if (!path || path === '/' || path.endsWith('/v1')) {
                url.pathname = `${path && path !== '/' ? path : '/v1'}/messages`;
            }
            return url.toString();
        }

        if (!path || path === '/' || path.endsWith('/v1')) {
            url.pathname = `${path && path !== '/' ? path : '/v1'}/chat/completions`;
        }
        return url.toString();
    } catch {
        const trimmed = raw.replace(/\/+$/, '');
        if (protocol === 'anthropic' && trimmed.endsWith('/v1')) {
            return `${trimmed}/messages`;
        }
        if (protocol === 'openai' && trimmed.endsWith('/v1')) {
            return `${trimmed}/chat/completions`;
        }
        return raw;
    }
}

function validateProtocolEndpoint(protocol: ProviderProtocol, endpoint: string): void {
    try {
        const path = new URL(endpoint).pathname.replace(/\/+$/, '').toLowerCase();
        if (protocol === 'anthropic' && path.endsWith('/chat/completions')) {
            throw new SettingsValidationError('协议和 Endpoint 不匹配：/v1/chat/completions 是 OpenAI Compatible 接口，请把“协议”改为 OpenAI；Anthropic 协议通常应使用 /v1/messages。');
        }
        if (protocol === 'openai' && path.endsWith('/messages')) {
            throw new SettingsValidationError('协议和 Endpoint 不匹配：/v1/messages 是 Anthropic 接口，请把“协议”改为 Anthropic；OpenAI Compatible 通常应使用 /v1/chat/completions。');
        }
    } catch (error) {
        if (error instanceof SettingsValidationError) {
            throw error;
        }
    }
}

function normalizeLogLevel(value: unknown): LogLevel {
    const normalized = String(value).trim().toLowerCase();
    if (normalized === 'info' || normalized === 'warn' || normalized === 'error') {
        return normalized;
    }
    return 'debug';
}

function normalizeApiKeyPrefix(value: unknown): string {
    if (typeof value !== 'string') {
        return 'Bearer ';
    }
    const trimmed = value.trim();
    if (!trimmed) {
        return '';
    }
    if (trimmed.toLowerCase() === 'bearer') {
        return 'Bearer ';
    }
    return value.replace(/^\s+/, '');
}

function promptValue(envValue: unknown, fileValue: unknown, defaultValue: string, legacyMarker: string): string {
    if (typeof envValue === 'string' && envValue.trim()) {
        return envValue.trim();
    }
    if (typeof fileValue !== 'string' || !fileValue.trim()) {
        return defaultValue;
    }
    return fileValue.includes(legacyMarker) ? defaultValue : fileValue.trim();
}

function migrateMaxSelectionChars(value: unknown): unknown {
    return Number(value) === 1200 ? 6000 : value;
}

function stringValue(value: unknown): string {
    return typeof value === 'string' ? value.trim() : String(value ?? '').trim();
}

function numberValue(value: unknown, fallback: number): number {
    const num = Number(value);
    return Number.isFinite(num) ? num : fallback;
}

function parseObject(raw: unknown, fallback: unknown): Record<string, unknown> {
    if (typeof raw === 'string' && raw.trim()) {
        const parsed = JSON.parse(raw) as unknown;
        return isRecord(parsed) ? parsed : {};
    }

    return isRecord(fallback) ? fallback : {};
}

function isRecord(value: unknown): value is Record<string, unknown> {
    return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

function stringifyRecord(value: Record<string, unknown>): Record<string, string> {
    return Object.fromEntries(Object.entries(value).map(([key, entry]) => [key, String(entry)]));
}
