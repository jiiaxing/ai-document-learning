import * as vscode from 'vscode';

export class CancellationGuard {
    constructor(
        private readonly requestId: number,
        private readonly token: vscode.CancellationToken,
        private readonly isCurrentRequest: (requestId: number) => boolean
    ) {}

    public isCancelled(): boolean {
        return this.token.isCancellationRequested || !this.isCurrentRequest(this.requestId);
    }

    public throwIfCancelled(): void {
        if (this.isCancelled()) {
            throw new Error('Request cancelled');
        }
    }
}
