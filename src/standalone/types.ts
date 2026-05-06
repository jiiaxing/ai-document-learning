export type ChatRole = 'system' | 'user' | 'assistant';

export interface ChatMessage {
    role: ChatRole;
    content: string;
}

export interface ImageAttachment {
    name: string;
    mimeType: string;
    dataUrl: string;
}

export type ProviderProtocol = 'openai' | 'anthropic';
export type ProviderKind = 'mock' | 'openaiCompatible';
export type LogLevel = 'debug' | 'info' | 'warn' | 'error';
export type AiTaskMode = 'explain' | 'translate' | 'ask';

export interface ProviderConfig {
    kind: ProviderKind;
    protocol: ProviderProtocol;
    endpoint: string;
    model: string;
    apiKey: string;
    apiKeyHeader: string;
    apiKeyPrefix: string;
    responseTextPath: string;
    anthropicVersion: string;
    anthropicBeta: string;
    anthropicMaxTokens: number;
    extraHeaders: Record<string, string>;
    extraBody: Record<string, unknown>;
    mockChunkDelayMs: number;
}

export interface AppConfig {
    configFile: string;
    host: string;
    port: number;
    publicDir: string;
    logLevel: LogLevel;
    logFile: string;
    provider: ProviderConfig;
    systemPrompt: string;
    explainPromptTemplate: string;
    translatePromptTemplate: string;
    followupPromptTemplate: string;
    maxSelectionChars: number;
}

export interface ExplainRequest {
    mode?: AiTaskMode;
    text: string;
    pageContext?: string;
    selectionContext?: string;
    source?: string;
    question?: string;
    history?: ChatMessage[];
    images?: ImageAttachment[];
}

export interface SafeClientConfig {
    providerKind: ProviderKind;
    protocol: ProviderProtocol;
    model: string;
    endpoint: string;
    apiKeyConfigured: boolean;
    maxSelectionChars: number;
}

export interface PublicSettings {
    provider: {
        kind: ProviderKind;
        protocol: ProviderProtocol;
        endpoint: string;
        model: string;
        apiKeyConfigured: boolean;
        apiKeyHeader: string;
        apiKeyPrefix: string;
        responseTextPath: string;
        anthropicVersion: string;
        anthropicBeta: string;
        anthropicMaxTokens: number;
        extraHeadersJson: string;
        extraBodyJson: string;
    };
    systemPrompt: string;
    explainPromptTemplate: string;
    translatePromptTemplate: string;
    followupPromptTemplate: string;
    maxSelectionChars: number;
}

export interface SettingsUpdate {
    provider?: {
        kind?: ProviderKind;
        protocol?: ProviderProtocol;
        endpoint?: string;
        model?: string;
        apiKey?: string;
        clearApiKey?: boolean;
        apiKeyHeader?: string;
        apiKeyPrefix?: string;
        responseTextPath?: string;
        anthropicVersion?: string;
        anthropicBeta?: string;
        anthropicMaxTokens?: number;
        extraHeadersJson?: string;
        extraBodyJson?: string;
    };
    systemPrompt?: string;
    explainPromptTemplate?: string;
    translatePromptTemplate?: string;
    followupPromptTemplate?: string;
    maxSelectionChars?: number;
}
