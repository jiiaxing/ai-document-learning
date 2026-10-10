import { contextBridge, ipcRenderer } from 'electron';
import type { DesktopUpdateApi, DesktopUpdateStatus } from './updateTypes';

const updates: DesktopUpdateApi = {
    getStatus: () => ipcRenderer.invoke('updates:status'),
    check: () => ipcRenderer.invoke('updates:check'),
    download: () => ipcRenderer.invoke('updates:download'),
    install: () => ipcRenderer.invoke('updates:install'),
    onStatus(listener) {
        const handleStatus = (_event: Electron.IpcRendererEvent, status: DesktopUpdateStatus) => listener(status);
        ipcRenderer.on('updates:status-changed', handleStatus);
        return () => ipcRenderer.removeListener('updates:status-changed', handleStatus);
    }
};

contextBridge.exposeInMainWorld('desktopUpdates', updates);
