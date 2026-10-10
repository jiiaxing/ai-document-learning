import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import test from 'node:test';
import type { UpdateCheckResult } from 'electron-updater';
import type { UpdateInfo } from 'builder-util-runtime';
import { UpdateController } from '../desktop/updateController';
import type { DesktopUpdateStatus, InstallMode } from '../desktop/updateTypes';

function deferred<T>() {
    let resolve!: (value: T) => void;
    let reject!: (error: Error) => void;
    const promise = new Promise<T>((resolvePromise, rejectPromise) => {
        resolve = resolvePromise;
        reject = rejectPromise;
    });
    return { promise, resolve, reject };
}

class FakeUpdater extends EventEmitter {
    autoDownload = true;
    autoInstallOnAppQuit = true;
    allowPrerelease = true;
    allowDowngrade = true;
    checkCalls = 0;
    downloadCalls = 0;
    installCalls: Array<[boolean | undefined, boolean | undefined]> = [];
    checkResult = deferred<UpdateCheckResult | null>();
    downloadResult = deferred<string[]>();
    checkError?: Error;
    installError?: Error;

    checkForUpdates(): Promise<UpdateCheckResult | null> {
        this.checkCalls += 1;
        if (this.checkError) { throw this.checkError; }
        return this.checkResult.promise;
    }

    downloadUpdate(): Promise<string[]> {
        this.downloadCalls += 1;
        return this.downloadResult.promise;
    }

    quitAndInstall(silent?: boolean, forceRunAfter?: boolean): void {
        this.installCalls.push([silent, forceRunAfter]);
        if (this.installError) { throw this.installError; }
    }
}

function updateInfo(version = '0.1.2', notes: UpdateInfo['releaseNotes'] = 'Improved PDF reading.'): UpdateInfo {
    return { version, releaseNotes: notes, releaseDate: '2026-10-10T00:00:00.000Z', files: [], path: 'Setup.exe', sha512: 'verified-by-electron-updater' };
}

function fixture(installMode: InstallMode = 'installed', enabled = true) {
    const backend = new FakeUpdater();
    const events: DesktopUpdateStatus[] = [];
    const controller = new UpdateController(backend, { currentVersion: '0.1.1', installMode, enabled, onStatus: status => events.push(status) });
    return { backend, controller, events };
}

const flush = () => new Promise<void>(resolve => setImmediate(resolve));

async function offerUpdate(context: ReturnType<typeof fixture>, info = updateInfo()) {
    await context.controller.check();
    context.backend.emit('checking-for-update');
    context.backend.emit('update-available', info);
    context.backend.checkResult.resolve({ isUpdateAvailable: true, updateInfo: info, versionInfo: info });
    await flush();
}

async function completeDownload(context: ReturnType<typeof fixture>) {
    await context.controller.download();
    context.backend.emit('update-downloaded', updateInfo());
    context.backend.downloadResult.resolve(['downloaded/Setup.exe']);
    await flush();
}

test('updater disables unattended download, installation on quit, prereleases and downgrades', () => {
    const { backend, controller } = fixture();
    assert.equal(backend.autoDownload, false);
    assert.equal(backend.autoInstallOnAppQuit, false);
    assert.equal(backend.allowPrerelease, false);
    assert.equal(backend.allowDowngrade, false);
    assert.equal(controller.getStatus().phase, 'idle');
    controller.dispose();
});

test('checking returns immediately and duplicate calls cannot start parallel checks', async () => {
    const context = fixture();
    assert.equal((await context.controller.check()).phase, 'checking');
    await context.controller.check();
    await context.controller.download();
    await context.controller.install();
    assert.equal(context.backend.checkCalls, 1);
    assert.equal(context.backend.downloadCalls, 0);
    assert.equal(context.backend.installCalls.length, 0);
    context.backend.checkResult.resolve({ isUpdateAvailable: false, updateInfo: updateInfo('0.1.1'), versionInfo: updateInfo('0.1.1') });
    await flush();
    assert.equal(context.controller.getStatus().phase, 'not-available');
    context.controller.dispose();
});

test('new release exposes version, release date and readable text without executable HTML', async () => {
    const context = fixture();
    await offerUpdate(context, updateInfo('0.1.2', '<h2>Better &amp; faster</h2><ul><li>PDF &lt;script&gt;bad()&lt;/script&gt;reader</li></ul><script>alert(1)</script>'));
    assert.deepEqual(context.controller.getStatus(), {
        phase: 'available', currentVersion: '0.1.1', installMode: 'installed', version: '0.1.2',
        releaseNotes: 'Better & faster\n• PDF reader', releaseDate: '2026-10-10T00:00:00.000Z',
        percent: undefined, message: '发现新版本，可查看版本说明并下载更新。'
    });
    assert.equal(context.backend.downloadCalls, 0);
    context.controller.dispose();
});

test('release note arrays retain versions and long notes are bounded', async () => {
    const context = fixture();
    await offerUpdate(context, updateInfo('0.1.2', [{ version: '0.1.2', note: '<p>Fix &#65;.</p>' }, { version: '0.1.1', note: null }]));
    assert.equal(context.controller.getStatus().releaseNotes, '0.1.2\nFix A.\n\n0.1.1');
    context.backend.checkResult = deferred();
    await offerUpdate(context, updateInfo('0.1.2', 'x'.repeat(60000)));
    assert.equal(context.controller.getStatus().releaseNotes?.length, 12002);
    context.controller.dispose();
});

test('same versions, older versions, prereleases and invalid versions never offer installation', async () => {
    for (const version of ['0.1.1', '0.1.1+build.2', '0.0.9', '0.1.2-beta.1', 'not-a-version']) {
        const context = fixture();
        await offerUpdate(context, updateInfo(version));
        assert.equal(context.controller.getStatus().phase, 'not-available', version);
        await context.controller.download();
        await context.controller.install();
        assert.equal(context.backend.downloadCalls, 0);
        assert.equal(context.backend.installCalls.length, 0);
        context.controller.dispose();
    }
    const context = fixture();
    await offerUpdate(context, updateInfo('0.1.10'));
    assert.equal(context.controller.getStatus().phase, 'available');
    context.controller.dispose();
});

test('download returns immediately, ignores duplicate operations and reports bounded progress', async () => {
    const context = fixture();
    await offerUpdate(context);
    assert.equal((await context.controller.download()).phase, 'downloading');
    await context.controller.download();
    await context.controller.check();
    await context.controller.install();
    assert.equal(context.backend.downloadCalls, 1);
    assert.equal(context.backend.checkCalls, 1);
    assert.equal(context.backend.installCalls.length, 0);
    context.backend.emit('download-progress', { percent: 47.5 });
    assert.equal(context.controller.getStatus().percent, 47.5);
    context.backend.emit('download-progress', { percent: Number.NaN });
    context.backend.emit('download-progress', { percent: -10 });
    assert.equal(context.controller.getStatus().percent, 47.5);
    context.backend.emit('download-progress', { percent: 125 });
    assert.equal(context.controller.getStatus().percent, 100);
    assert.equal((await context.controller.install()).phase, 'downloading');
    context.controller.dispose();
    context.backend.downloadResult.resolve([]);
});

test('installation requires both a verified download event and successful completed promise', async () => {
    const context = fixture();
    await offerUpdate(context);
    await context.controller.install();
    await context.controller.download();
    context.backend.emit('update-downloaded', updateInfo());
    assert.equal((await context.controller.install()).phase, 'downloading');
    context.backend.downloadResult.resolve(['downloaded/Setup.exe']);
    await flush();
    assert.equal(context.controller.getStatus().phase, 'downloaded');
    assert.equal(context.backend.installCalls.length, 0, 'A completed download must not install automatically');
    assert.equal((await context.controller.install()).phase, 'installing');
    await context.controller.install();
    await context.controller.download();
    assert.equal(context.backend.installCalls.length, 0, 'Installation waits for the IPC response');
    await new Promise(resolve => setTimeout(resolve, 180));
    assert.deepEqual(context.backend.installCalls, [[false, true]]);
    assert.equal(context.backend.downloadCalls, 1);
    context.controller.dispose();
});

test('checksum failure cannot authorize installation and can retry download successfully', async () => {
    const context = fixture();
    await offerUpdate(context);
    await context.controller.download();
    context.backend.emit('download-progress', { percent: 100 });
    const failure = new Error('sha512 checksum mismatch');
    context.backend.emit('error', failure);
    context.backend.downloadResult.reject(failure);
    await flush();
    assert.equal(context.controller.getStatus().phase, 'error');
    assert.equal(context.controller.getStatus().version, '0.1.2');
    assert.equal(context.controller.getStatus().percent, undefined);
    await context.controller.install();
    assert.equal(context.backend.installCalls.length, 0);
    context.backend.downloadResult = deferred();
    await completeDownload(context);
    assert.equal(context.controller.getStatus().phase, 'downloaded');
    assert.equal(context.backend.downloadCalls, 2);
    context.controller.dispose();
});

test('a late download rejection revokes completion and empty or mismatched downloads fail closed', async () => {
    for (const outcome of ['reject', 'empty', 'different-version']) {
        const context = fixture();
        await offerUpdate(context);
        await context.controller.download();
        context.backend.emit('update-downloaded', updateInfo(outcome === 'different-version' ? '0.1.3' : '0.1.2'));
        if (outcome === 'reject') { context.backend.downloadResult.reject(new Error('Download verification failed')); }
        else { context.backend.downloadResult.resolve(outcome === 'empty' ? [] : ['downloaded/Setup.exe']); }
        await flush();
        assert.equal(context.controller.getStatus().phase, 'error', outcome);
        await context.controller.install();
        assert.equal(context.backend.installCalls.length, 0);
        context.controller.dispose();
    }
});

test('download resolution without the verified event never allows installation', async () => {
    const context = fixture();
    await offerUpdate(context);
    await context.controller.download();
    context.backend.downloadResult.resolve(['downloaded/Setup.exe']);
    await flush();
    assert.equal(context.controller.getStatus().phase, 'error');
    await context.controller.install();
    assert.equal(context.backend.installCalls.length, 0);
    context.controller.dispose();
});

test('check failures clear stale version data and allow another check', async () => {
    const context = fixture();
    await offerUpdate(context);
    context.backend.checkResult = deferred();
    await context.controller.check();
    const error = new Error('GitHub is unreachable');
    context.backend.emit('error', error);
    context.backend.checkResult.reject(error);
    await flush();
    assert.equal(context.controller.getStatus().phase, 'error');
    assert.equal(context.controller.getStatus().version, undefined);
    await context.controller.download();
    assert.equal(context.backend.downloadCalls, 0);
    context.backend.checkResult = deferred();
    await offerUpdate(context);
    assert.equal(context.controller.getStatus().phase, 'available');
    assert.equal(context.backend.checkCalls, 3);
    context.controller.dispose();
});

test('synchronous backend exceptions and null check responses become recoverable errors', async () => {
    const context = fixture();
    context.backend.checkError = new Error('Invalid update configuration');
    assert.equal((await context.controller.check()).phase, 'error');
    context.backend.checkError = undefined;
    await context.controller.check();
    context.backend.checkResult.resolve(null);
    await flush();
    assert.equal(context.controller.getStatus().phase, 'error');
    assert.equal(context.backend.checkCalls, 2);
    context.controller.dispose();
});

test('unsupported and unpackaged apps never contact the update service or installer', async () => {
    for (const context of [fixture('unsupported'), fixture('installed', false)]) {
        await context.controller.check();
        await context.controller.download();
        await context.controller.install();
        context.backend.emit('update-available', updateInfo());
        context.backend.emit('update-downloaded', updateInfo());
        assert.equal(context.controller.getStatus().phase, 'unavailable');
        assert.equal(context.backend.checkCalls + context.backend.downloadCalls + context.backend.installCalls.length, 0);
        context.controller.dispose();
    }
});

test('portable builds clearly offer migration through the installer', async () => {
    const context = fixture('portable');
    await offerUpdate(context);
    await completeDownload(context);
    assert.equal(context.controller.getStatus().installMode, 'portable');
    assert.match(context.controller.getStatus().message || '', /迁移到安装版/);
    assert.equal(context.backend.autoInstallOnAppQuit, false);
    context.controller.dispose();
});

test('disposal prevents pending installation and drops results from outstanding checks', async () => {
    const context = fixture();
    await offerUpdate(context);
    await completeDownload(context);
    await context.controller.install();
    context.controller.dispose();
    await new Promise(resolve => setTimeout(resolve, 180));
    assert.equal(context.backend.installCalls.length, 0);
    assert.equal(context.backend.listenerCount('update-available'), 0);
    const pending = fixture();
    await pending.controller.check();
    pending.controller.dispose();
    const eventCount = pending.events.length;
    pending.backend.checkResult.resolve({ isUpdateAvailable: true, updateInfo: updateInfo(), versionInfo: updateInfo() });
    await flush();
    assert.equal(pending.events.length, eventCount);
});

test('installation exceptions surface a download retry and status snapshots cannot mutate internal state', async () => {
    const context = fixture();
    await offerUpdate(context);
    await completeDownload(context);
    context.backend.installError = new Error('Installer could not start');
    const snapshot = context.controller.getStatus();
    snapshot.phase = 'idle';
    assert.equal(context.controller.getStatus().phase, 'downloaded');
    await context.controller.install();
    await new Promise(resolve => setTimeout(resolve, 180));
    assert.equal(context.controller.getStatus().phase, 'error');
    context.backend.downloadResult = deferred();
    assert.equal((await context.controller.download()).phase, 'downloading');
    assert.equal(context.backend.downloadCalls, 2);
    context.controller.dispose();
    context.backend.downloadResult.resolve([]);
});
