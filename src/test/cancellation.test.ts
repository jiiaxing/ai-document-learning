import * as assert from 'assert';
import * as vscode from 'vscode';
import { RequestOrchestrator } from '../core/requestOrchestrator';
import { CancellationGuard } from '../core/cancellationGuard';

suite('Cancellation Reliability Suite', () => {
    test('orchestrator cancel invalidates current request id', () => {
        const orchestrator = new RequestOrchestrator();
        const started = orchestrator.startRequest();
        assert.strictEqual(started.started, true);
        if (!started.started) {
            return;
        }

        const oldRequestId = started.requestId;
        assert.strictEqual(orchestrator.isCurrentRequest(oldRequestId), true);

        const cancelled = orchestrator.cancelCurrentRequest();
        assert.strictEqual(cancelled, true);
        assert.strictEqual(orchestrator.isCurrentRequest(oldRequestId), false);
    });

    test('orchestrator rejects parallel start while running', () => {
        const orchestrator = new RequestOrchestrator();
        const first = orchestrator.startRequest();
        assert.strictEqual(first.started, true);

        const second = orchestrator.startRequest();
        assert.strictEqual(second.started, false);
    });

    test('cancellation guard detects stale request id', () => {
        const orchestrator = new RequestOrchestrator();
        const started = orchestrator.startRequest();
        assert.strictEqual(started.started, true);
        if (!started.started) {
            return;
        }

        const tokenSource = new vscode.CancellationTokenSource();
        const guard = new CancellationGuard(started.requestId, tokenSource.token, (id) => orchestrator.isCurrentRequest(id));

        assert.strictEqual(guard.isCancelled(), false);
        orchestrator.cancelCurrentRequest();
        assert.strictEqual(guard.isCancelled(), true);
    });

    test('cancellation guard detects token cancellation', () => {
        const orchestrator = new RequestOrchestrator();
        const started = orchestrator.startRequest();
        assert.strictEqual(started.started, true);
        if (!started.started) {
            return;
        }

        const tokenSource = new vscode.CancellationTokenSource();
        const guard = new CancellationGuard(started.requestId, tokenSource.token, (id) => orchestrator.isCurrentRequest(id));

        tokenSource.cancel();
        assert.strictEqual(guard.isCancelled(), true);
        assert.throws(() => guard.throwIfCancelled(), /cancelled/i);
    });
});
