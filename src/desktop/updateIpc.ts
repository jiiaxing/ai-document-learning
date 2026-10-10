import type { IpcMainInvokeEvent, WebContents } from 'electron';

export function assertTrustedUpdateSender(event: IpcMainInvokeEvent, contents: WebContents | null | undefined, serverUrl: string | undefined): void {
    if (!contents || event.sender !== contents || event.senderFrame !== contents.mainFrame || !serverUrl) {
        throw new Error('Update requests must come from the main application window.');
    }
    const source = new URL(event.senderFrame.url);
    const expected = new URL(serverUrl);
    if (source.origin !== expected.origin || source.pathname !== '/') {
        throw new Error('Update requests must come from the application page.');
    }
}
