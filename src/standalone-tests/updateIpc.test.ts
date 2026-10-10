import assert from 'node:assert/strict';
import test from 'node:test';
import type { IpcMainInvokeEvent, WebContents } from 'electron';
import { assertTrustedUpdateSender } from '../desktop/updateIpc';

function fixture(url = 'http://127.0.0.1:5178/?pdf=paper.pdf') {
    const frame = { url };
    const contents = { mainFrame: frame } as unknown as WebContents;
    const event = { sender: contents, senderFrame: frame } as unknown as IpcMainInvokeEvent;
    return { event, contents, server: 'http://127.0.0.1:5178' };
}

test('updates accept only the main application frame on its exact local origin', () => {
    const { event, contents, server } = fixture();
    assert.doesNotThrow(() => assertTrustedUpdateSender(event, contents, server));
    assert.throws(() => assertTrustedUpdateSender(event, undefined, server));
    assert.throws(() => assertTrustedUpdateSender(event, contents, undefined));
    assert.throws(() => assertTrustedUpdateSender({ ...event, sender: {} as WebContents }, contents, server));
    assert.throws(() => assertTrustedUpdateSender({ ...event, senderFrame: { url: server } as Electron.WebFrameMain }, contents, server));
});

test('updates reject navigation to remote pages, other ports, non-app paths and malformed origins', () => {
    for (const url of ['https://github.com/', 'http://127.0.0.1:5179/', 'http://localhost:5178/', 'http://127.0.0.1:5178/public/other.html', 'about:blank', 'invalid url']) {
        const { event, contents, server } = fixture(url);
        assert.throws(() => assertTrustedUpdateSender(event, contents, server), `Must reject ${url}`);
    }
});
