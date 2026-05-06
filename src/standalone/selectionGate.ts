export interface SelectionGateConfig {
    minLength: number;
    cooldownMs: number;
}

export interface SelectionGateResult {
    shouldTrigger: boolean;
    reason: 'ok' | 'empty' | 'too-short' | 'duplicate' | 'cooldown';
    normalizedText: string;
    elapsedMs: number;
}

export class SelectionTriggerGate {
    private lastText = '';
    private lastTriggeredAt = 0;

    constructor(private readonly config: SelectionGateConfig) {}

    public evaluate(rawText: string, now = Date.now()): SelectionGateResult {
        const normalizedText = normalizeSelectionText(rawText);
        const elapsedMs = this.lastTriggeredAt === 0 ? Number.POSITIVE_INFINITY : now - this.lastTriggeredAt;

        if (!normalizedText) {
            return { shouldTrigger: false, reason: 'empty', normalizedText, elapsedMs };
        }

        if (normalizedText.length < this.config.minLength) {
            return { shouldTrigger: false, reason: 'too-short', normalizedText, elapsedMs };
        }

        if (normalizedText === this.lastText) {
            return { shouldTrigger: false, reason: 'duplicate', normalizedText, elapsedMs };
        }

        if (elapsedMs < this.config.cooldownMs) {
            return { shouldTrigger: false, reason: 'cooldown', normalizedText, elapsedMs };
        }

        return { shouldTrigger: true, reason: 'ok', normalizedText, elapsedMs };
    }

    public markTriggered(text: string, now = Date.now()): void {
        this.lastText = normalizeSelectionText(text);
        this.lastTriggeredAt = now;
    }

    public reset(): void {
        this.lastText = '';
        this.lastTriggeredAt = 0;
    }
}

export function normalizeSelectionText(rawText: string): string {
    return rawText.replace(/\s+/g, ' ').trim();
}

