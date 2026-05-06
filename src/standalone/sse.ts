import { ServerResponse } from 'node:http';

export function prepareSse(res: ServerResponse): void {
    res.writeHead(200, {
        'Content-Type': 'text/event-stream; charset=utf-8',
        'Cache-Control': 'no-cache, no-transform',
        Connection: 'keep-alive',
        'X-Accel-Buffering': 'no'
    });
}

export function writeSse(res: ServerResponse, event: string, data: unknown): void {
    const payload = JSON.stringify(data);
    res.write(`event: ${event}\n`);
    for (const line of payload.split(/\r?\n/)) {
        res.write(`data: ${line}\n`);
    }
    res.write('\n');
}

