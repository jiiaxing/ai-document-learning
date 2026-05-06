import { appendFileSync, mkdirSync } from 'node:fs';
import { dirname } from 'node:path';
import { LogLevel } from './types';

export interface LogEntry {
    ts: string;
    level: LogLevel;
    event: string;
    data?: unknown;
}

const levelRank: Record<LogLevel, number> = {
    debug: 10,
    info: 20,
    warn: 30,
    error: 40
};

export class DeveloperLogger {
    private readonly entries: LogEntry[] = [];

    constructor(
        private readonly options: {
            logFile: string;
            level: LogLevel;
            echo?: boolean;
            maxEntries?: number;
        }
    ) {
        mkdirSync(dirname(options.logFile), { recursive: true });
    }

    public debug(event: string, data?: unknown): void {
        this.write('debug', event, data);
    }

    public info(event: string, data?: unknown): void {
        this.write('info', event, data);
    }

    public warn(event: string, data?: unknown): void {
        this.write('warn', event, data);
    }

    public error(event: string, data?: unknown): void {
        this.write('error', event, data);
    }

    public recent(count = 100): LogEntry[] {
        return this.entries.slice(-count);
    }

    private write(level: LogLevel, event: string, data?: unknown): void {
        if (levelRank[level] < levelRank[this.options.level]) {
            return;
        }

        const entry: LogEntry = {
            ts: new Date().toISOString(),
            level,
            event,
            data
        };

        this.entries.push(entry);
        const maxEntries = this.options.maxEntries ?? 500;
        if (this.entries.length > maxEntries) {
            this.entries.splice(0, this.entries.length - maxEntries);
        }

        const line = `${JSON.stringify(entry)}\n`;
        appendFileSync(this.options.logFile, line, 'utf8');
        if (this.options.echo !== false) {
            const payload = typeof data === 'undefined' ? '' : ` ${safeStringify(data)}`;
            console.log(`[${entry.ts}] ${level.toUpperCase()} ${event}${payload}`);
        }
    }
}

function safeStringify(value: unknown): string {
    try {
        return JSON.stringify(value);
    } catch {
        return String(value);
    }
}

