export function resolveResponseTextPath(protocol: 'openai' | 'anthropic', path: string): string {
    const trimmed = path.trim();
    if (protocol === 'anthropic') {
        if (!trimmed || trimmed === 'choices.0.message.content') {
            return 'content.0.text';
        }
    }

    if (protocol === 'openai' && trimmed === 'content.0.text') {
        return 'choices.0.message.content';
    }

    if (!trimmed) {
        return 'choices.0.message.content';
    }

    return trimmed;
}

export function getValueByPath(data: unknown, path: string): unknown {
    const segments = path.split('.').map((s) => s.trim()).filter(Boolean);
    let current: unknown = data;

    for (const seg of segments) {
        if (Array.isArray(current)) {
            const idx = Number(seg);
            if (Number.isNaN(idx)) {
                return undefined;
            }
            current = current[idx];
            continue;
        }

        if (!current || typeof current !== 'object') {
            return undefined;
        }

        const record = current as Record<string, unknown>;
        current = record[seg];
    }

    return current;
}

export function extractResponseText(data: unknown, path: string): string {
    const value = getValueByPath(data, path);
    if (typeof value === 'string') {
        return value.trim();
    }
    if (Array.isArray(value)) {
        return value.map((v) => typeof v === 'string' ? v : JSON.stringify(v)).join('\n').trim();
    }
    if (value && typeof value === 'object') {
        return JSON.stringify(value);
    }
    return '';
}
