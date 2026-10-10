export type UpdatePhase = 'unavailable' | 'idle' | 'checking' | 'not-available' | 'available' | 'downloading' | 'downloaded' | 'installing' | 'error';
export type InstallMode = 'installed' | 'portable' | 'unsupported';

export interface DesktopUpdateStatus {
    phase: UpdatePhase;
    currentVersion: string;
    installMode: InstallMode;
    version?: string;
    releaseNotes?: string;
    releaseDate?: string;
    percent?: number;
    message?: string;
}

export interface DesktopUpdateApi {
    getStatus(): Promise<DesktopUpdateStatus>;
    check(): Promise<DesktopUpdateStatus>;
    download(): Promise<DesktopUpdateStatus>;
    install(): Promise<DesktopUpdateStatus>;
    onStatus(listener: (status: DesktopUpdateStatus) => void): () => void;
}
