import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import test from 'node:test';
import { runInNewContext } from 'node:vm';

const source = readFileSync(resolve(__dirname, '../../public/app.js'), 'utf8');
function appFunction(name: string, context: Record<string, unknown>) {
    const code = source.match(new RegExp(`^(?:async )?function ${name}\\([^]*?^\\}`, 'm'))?.[0];
    assert.ok(code);
    return runInNewContext(`(${code})`, context);
}
function saveFixture() {
    const state = { annotationSaveTimer: 0, annotationSavePromise: null as Promise<unknown> | null, pendingAnnotationSave: { id: 'doc-1', notes: { text: 'latest note' } } as { id: string; notes: { text: string } } | null };
    return {
        state, window: { clearTimeout() {} },
        fetch: async () => ({}), readJsonResponse: async () => ({ file: {} }),
        parseReadingFile: () => null, upsertReadingFile() {}, logClient() {}, flashStatus() {},
        messageOf: (error: Error) => error.message
    };
}

test('update preparation finishes editing and waits for notes to persist', async () => {
    let releaseSave: () => void = () => {};
    const calls: string[] = [];
    const prepare = appFunction('prepareForDesktopUpdate', {
        state: { activeReadingFileId: 'doc-1' },
        finishActiveNoteEdit: () => calls.push('finish'),
        saveAnnotations: () => calls.push('queue'),
        flushPendingAnnotationSave: (options: { throwOnError: boolean }) => {
            assert.equal(options.throwOnError, true);
            return new Promise<void>(resolve => { releaseSave = resolve; });
        }
    });
    let completed = false;
    const pending = prepare().then(() => { completed = true; });
    await Promise.resolve();
    assert.deepEqual(calls, ['finish', 'queue']);
    assert.equal(completed, false);
    releaseSave();
    await pending;
    assert.equal(completed, true);
});

test('failed note saves block installation and remain available to retry', async () => {
    const context = saveFixture();
    let fail = true;
    context.fetch = async () => { if (fail) { throw new Error('offline'); } return {}; };
    const flush = appFunction('flushPendingAnnotationSave', context);
    await assert.rejects(flush({ throwOnError: true }), /批注尚未保存/);
    assert.equal(context.state.pendingAnnotationSave?.notes.text, 'latest note');
    assert.equal(context.state.annotationSavePromise, null);
    fail = false;
    await flush({ throwOnError: true });
    assert.equal(context.state.pendingAnnotationSave, null);
});

test('new notes wait for an older in-flight save before being written', async () => {
    const context = saveFixture();
    let finishOldSave: () => void = () => {};
    let requests = 0;
    context.state.annotationSavePromise = new Promise<void>(resolve => { finishOldSave = () => { context.state.annotationSavePromise = null; resolve(); }; });
    context.fetch = async () => { requests++; return {}; };
    const flush = appFunction('flushPendingAnnotationSave', context);
    const pending = flush({ throwOnError: true });
    await Promise.resolve();
    assert.equal(requests, 0);
    finishOldSave();
    await pending;
    assert.equal(requests, 1);
    assert.equal(context.state.pendingAnnotationSave, null);
});

test('local annotation storage failure prevents update preparation from completing', async () => {
    const prepare = appFunction('prepareForDesktopUpdate', {
        state: { activeReadingFileId: '', annotations: {} }, finishActiveNoteEdit() {},
        ANNOTATION_STORE_KEY: 'annotations',
        localStorage: { setItem: () => { throw new Error('storage full'); } },
        flushPendingAnnotationSave: () => { throw new Error('Must not continue'); }
    });
    await assert.rejects(prepare(), /storage full/);
});

test('strict preparation also waits for a save started by another waiting flush', async () => {
    const context = saveFixture();
    const requests: Array<() => void> = [];
    context.fetch = () => new Promise(resolve => { requests.push(() => resolve({})); });
    const flush = appFunction('flushPendingAnnotationSave', context);
    const first = flush();
    context.state.pendingAnnotationSave = { id: 'doc-1', notes: { text: 'newer note' } };
    const background = flush();
    let readyToInstall = false;
    const preparing = flush({ throwOnError: true }).then(() => { readyToInstall = true; });
    requests[0]();
    await first;
    await new Promise(resolve => setImmediate(resolve));
    assert.equal(requests.length, 2);
    assert.equal(readyToInstall, false, 'A second flush owns the newer save, so installation must keep waiting');
    requests[1]();
    await Promise.all([background, preparing]);
    assert.equal(readyToInstall, true);
    assert.equal(context.state.annotationSavePromise, null);
});

test('strict preparation drains notes queued while its own save is still in flight', async () => {
    const context = saveFixture();
    const requests: Array<() => void> = [];
    context.fetch = () => new Promise(resolve => { requests.push(() => resolve({})); });
    const flush = appFunction('flushPendingAnnotationSave', context);
    // The function can invoke itself when another edit enters the queue.
    const bound = appFunction('flushPendingAnnotationSave', { ...context, flushPendingAnnotationSave: flush });
    let complete = false;
    const preparing = bound({ throwOnError: true }).then(() => { complete = true; });
    context.state.pendingAnnotationSave = { id: 'doc-1', notes: { text: 'newer note' } };
    requests[0]();
    await new Promise(resolve => setImmediate(resolve));
    assert.equal(requests.length, 2);
    assert.equal(complete, false);
    requests[1]();
    await preparing;
    assert.equal(complete, true);
    assert.equal(context.state.pendingAnnotationSave, null);
});
