import type { AppUpdater } from 'electron-updater';
import type { AppUpdaterEvents } from 'electron-updater/out/AppUpdater';
import type { UpdateInfo } from 'builder-util-runtime';
import { gt, prerelease, valid } from 'semver';
import type { DesktopUpdateStatus, InstallMode } from './updateTypes';

type UpdateBackend = Pick<AppUpdater,
    'autoDownload' | 'autoInstallOnAppQuit' | 'allowDowngrade' | 'allowPrerelease' |
    'checkForUpdates' | 'downloadUpdate' | 'quitAndInstall'> & {
        on<E extends keyof AppUpdaterEvents>(event: E, listener: AppUpdaterEvents[E]): unknown;
        removeListener<E extends keyof AppUpdaterEvents>(event: E, listener: AppUpdaterEvents[E]): unknown;
    };

interface ControllerOptions {
    currentVersion: string;
    installMode: InstallMode;
    enabled: boolean;
    onStatus: (status: DesktopUpdateStatus) => void;
}

type Operation = 'check' | 'download' | 'install';

function releaseNotesText(notes: UpdateInfo['releaseNotes']): string {
    const source = typeof notes === 'string' ? notes : Array.isArray(notes)
        ? notes.slice(0, 40).map(entry => `${entry.version}\n${entry.note || ''}`.slice(0, 12000)).join('\n\n') : '';
    const entities: Record<string, string> = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ' };
    const text = source.slice(0, 48000)
        .replace(/&(#x[0-9a-f]+|#\d+|amp|lt|gt|quot|apos|nbsp);/gi, (entity, value: string) => {
            if (!value.startsWith('#')) { return entities[value.toLowerCase()]; }
            const point = value.toLowerCase().startsWith('#x') ? parseInt(value.slice(2), 16) : parseInt(value.slice(1), 10);
            return point > 0 && point <= 0x10ffff ? String.fromCodePoint(point) : entity;
        })
        .replace(/<(script|style)\b[^>]*>[\s\S]*?<\/\1\s*>/gi, '')
        .replace(/<br\s*\/?\s*>|<\/(?:p|div|h[1-6]|li|ul|ol)>/gi, '\n')
        .replace(/<li\b[^>]*>/gi, '• ')
        .replace(/<[^>]*>/g, '')
        .replace(/\r\n?/g, '\n')
        .replace(/[\t ]+\n/g, '\n')
        .replace(/\n{3,}/g, '\n\n')
        .trim();
    return text.length > 12000 ? `${text.slice(0, 12000)}\n…` : text;
}

export class UpdateController {
    private status: DesktopUpdateStatus;
    private operation?: Operation;
    private generation = 0;
    private disposed = false;
    private canRetryDownload = false;
    private verifiedDownload = false;
    private downloadedEvent = false;
    private installTimer?: ReturnType<typeof setTimeout>;
    private readonly enabled: boolean;

    constructor(private readonly backend: UpdateBackend, private readonly options: ControllerOptions) {
        this.enabled = options.enabled && options.installMode !== 'unsupported';
        this.status = {
            phase: this.enabled ? 'idle' : 'unavailable',
            currentVersion: options.currentVersion,
            installMode: options.installMode,
            ...(!this.enabled ? { message: '当前运行方式不支持自动更新，请使用 Windows 正式发行版。' } : {})
        };
        backend.autoDownload = false;
        backend.autoInstallOnAppQuit = false;
        backend.allowPrerelease = false;
        backend.allowDowngrade = false;
        backend.on('checking-for-update', this.onChecking);
        backend.on('update-available', this.onAvailable);
        backend.on('update-not-available', this.onNotAvailable);
        backend.on('download-progress', this.onProgress);
        backend.on('update-downloaded', this.onDownloaded);
        backend.on('error', this.onError);
    }

    getStatus(): DesktopUpdateStatus {
        return { ...this.status };
    }

    async check(): Promise<DesktopUpdateStatus> {
        if (!this.enabled || this.disposed || this.operation || this.status.phase === 'downloaded') {
            return this.getStatus();
        }
        this.operation = 'check';
        this.canRetryDownload = false;
        this.verifiedDownload = false;
        const generation = ++this.generation;
        this.publish({ phase: 'checking', version: undefined, releaseNotes: undefined, releaseDate: undefined, percent: undefined, message: '正在检查新版本…' });
        void this.runCheck(generation);
        return this.getStatus();
    }

    async download(): Promise<DesktopUpdateStatus> {
        if (!this.enabled || this.disposed || this.operation ||
            !(this.status.phase === 'available' || (this.status.phase === 'error' && this.canRetryDownload))) {
            return this.getStatus();
        }
        this.operation = 'download';
        this.verifiedDownload = false;
        this.downloadedEvent = false;
        this.canRetryDownload = false;
        const generation = ++this.generation;
        this.publish({ phase: 'downloading', percent: 0, message: '正在下载安装程序…' });
        void this.runDownload(generation);
        return this.getStatus();
    }

    async install(): Promise<DesktopUpdateStatus> {
        if (!this.enabled || this.disposed || this.operation || this.status.phase !== 'downloaded' || !this.verifiedDownload) {
            return this.getStatus();
        }
        this.operation = 'install';
        this.publish({ phase: 'installing', message: '正在退出并启动更新安装程序…' });
        // Give the IPC response and final status time to reach the window before it closes.
        this.installTimer = setTimeout(() => {
            this.installTimer = undefined;
            if (this.disposed || this.operation !== 'install' || !this.verifiedDownload) { return; }
            try {
                this.backend.quitAndInstall(false, true);
            } catch (error) {
                this.fail(error, 'install');
            }
        }, 150);
        return this.getStatus();
    }

    dispose(): void {
        this.disposed = true;
        this.generation += 1;
        if (this.installTimer) { clearTimeout(this.installTimer); }
        this.backend.removeListener('checking-for-update', this.onChecking);
        this.backend.removeListener('update-available', this.onAvailable);
        this.backend.removeListener('update-not-available', this.onNotAvailable);
        this.backend.removeListener('download-progress', this.onProgress);
        this.backend.removeListener('update-downloaded', this.onDownloaded);
        this.backend.removeListener('error', this.onError);
    }

    private async runCheck(generation: number): Promise<void> {
        try {
            const result = await this.backend.checkForUpdates();
            if (this.disposed || this.generation !== generation) { return; }
            if (this.status.phase === 'checking') {
                if (!result) { throw new Error('Update information is unavailable.'); }
                if (result.isUpdateAvailable) { this.onAvailable(result.updateInfo); }
                else { this.onNotAvailable(); }
            }
            this.operation = undefined;
        } catch (error) {
            if (!this.disposed && this.generation === generation) { this.fail(error, 'check'); }
        }
    }

    private async runDownload(generation: number): Promise<void> {
        try {
            const files = await this.backend.downloadUpdate();
            if (this.disposed || this.generation !== generation) { return; }
            if (!this.downloadedEvent || !files.length) { throw new Error('The update download did not complete verification.'); }
            this.operation = undefined;
            this.verifiedDownload = true;
            this.publish({ phase: 'downloaded', percent: 100, message: this.status.installMode === 'portable'
                ? '下载完成。继续后将退出软件并打开安装向导，迁移到安装版。'
                : '下载完成，点击重启并安装更新。' });
        } catch (error) {
            if (!this.disposed && this.generation === generation) { this.fail(error, 'download'); }
        }
    }

    private publish(change: Partial<DesktopUpdateStatus>): void {
        if (this.disposed) { return; }
        this.status = { ...this.status, ...change };
        this.options.onStatus(this.getStatus());
    }

    private fail(error: unknown, operation: Operation): void {
        if (this.installTimer) { clearTimeout(this.installTimer); this.installTimer = undefined; }
        this.generation += 1;
        this.operation = undefined;
        this.verifiedDownload = false;
        this.downloadedEvent = false;
        this.canRetryDownload = operation !== 'check' && Boolean(this.status.version);
        const detail = error instanceof Error ? error.message : '';
        const message = operation === 'check'
            ? (/latest\.yml/i.test(detail) ? '新版更新文件尚未就绪，请稍后再检查。' : '检查更新失败，请检查网络连接后重试。')
            : (/checksum|signature|verification|version.*match/i.test(detail) ? '更新文件校验失败，请重新下载。' : '更新未完成，请检查网络连接并重新下载后重试。');
        this.publish({ phase: 'error', percent: undefined, message,
            ...(operation === 'check' ? { version: undefined, releaseNotes: undefined, releaseDate: undefined } : {}) });
    }

    private readonly onChecking = (): void => {
        if (this.operation === 'check') { this.publish({ phase: 'checking' }); }
    };

    private readonly onAvailable = (info: UpdateInfo): void => {
        if (this.disposed || this.operation !== 'check') { return; }
        if (!valid(info.version) || !valid(this.status.currentVersion) || prerelease(info.version) || !gt(info.version, this.status.currentVersion)) {
            this.onNotAvailable();
            return;
        }
        this.publish({ phase: 'available', version: info.version, releaseNotes: releaseNotesText(info.releaseNotes), releaseDate: info.releaseDate, message: '发现新版本，可查看版本说明并下载更新。' });
    };

    private readonly onNotAvailable = (): void => {
        if (this.operation === 'check') { this.publish({ phase: 'not-available', version: undefined, releaseNotes: undefined, releaseDate: undefined, message: '当前已是最新版本。' }); }
    };

    private readonly onProgress = (progress: { percent: number }): void => {
        if (this.operation !== 'download' || !Number.isFinite(progress.percent)) { return; }
        this.publish({ phase: 'downloading', percent: Math.max(this.status.percent || 0, Math.min(100, Math.max(0, progress.percent))) });
    };

    private readonly onDownloaded = (info: UpdateInfo): void => {
        if (this.operation !== 'download') { return; }
        if (info.version !== this.status.version) {
            this.fail(new Error('The downloaded version does not match the selected update.'), 'download');
            return;
        }
        this.downloadedEvent = true;
    };

    private readonly onError = (error: Error): void => {
        if (!this.enabled || this.disposed) { return; }
        this.fail(error, this.operation || (this.status.phase === 'downloaded' ? 'download' : 'check'));
    };
}
