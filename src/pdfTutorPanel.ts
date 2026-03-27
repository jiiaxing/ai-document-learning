import * as vscode from 'vscode';

interface PdfTutorPanelOptions {
    context: vscode.ExtensionContext;
    onSelection: (text: string, sourceLabel: string) => Promise<void>;
}

export function registerPdfTutorPanel(options: PdfTutorPanelOptions): vscode.Disposable {
    return vscode.commands.registerCommand('aiTutor.openPdfTutor', async () => {
        const picked = await vscode.window.showOpenDialog({
            canSelectMany: false,
            filters: { PDF: ['pdf'] },
            openLabel: '打开 PDF 助教视图'
        });

        if (!picked || picked.length === 0) {
            return;
        }

        const pdfUri = picked[0];
        const bytes = await vscode.workspace.fs.readFile(pdfUri);
        const base64 = Buffer.from(bytes).toString('base64');

        const panel = vscode.window.createWebviewPanel(
            'aiTutorPdfViewer',
            `PDF 助教 - ${vscode.workspace.asRelativePath(pdfUri, false)}`,
            vscode.ViewColumn.Active,
            {
                enableScripts: true,
                retainContextWhenHidden: true
            }
        );

        panel.webview.html = getPdfViewerHtml(base64, panel.webview);

        panel.webview.onDidReceiveMessage(async (msg) => {
            if (msg?.type !== 'selection') {
                return;
            }
            const text = String(msg.text ?? '').trim();
            if (!text) {
                return;
            }
            const source = vscode.workspace.asRelativePath(pdfUri, false);
            await options.onSelection(text, source);
        });
    });
}

function getPdfViewerHtml(base64Pdf: string, webview: vscode.Webview): string {
    const nonce = String(Date.now());
    return `<!DOCTYPE html>
<html lang="zh-CN">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <meta http-equiv="Content-Security-Policy" content="default-src 'none'; img-src ${webview.cspSource} https: data:; style-src 'unsafe-inline' https:; script-src 'nonce-${nonce}' https:;">
  <style>
    html, body { height: 100%; }
    body { margin: 0; padding: 0; background: #1e1e1e; color: #ddd; font-family: sans-serif; overflow: hidden; }
    #topbar { position: sticky; top: 0; z-index: 10; padding: 8px 12px; background: #252526; border-bottom: 1px solid #333; display: flex; align-items: center; gap: 8px; }
    #topbar button { padding: 4px 10px; }
    #viewer { height: calc(100% - 46px); overflow: hidden; display: flex; justify-content: center; padding: 12px; box-sizing: border-box; }
    .page-wrap { position: relative; background: #fff; box-shadow: 0 2px 12px rgba(0,0,0,.35); }
    canvas { display: block; }
    .textLayer {
      position: absolute;
      inset: 0;
      overflow: hidden;
      line-height: 1;
      opacity: 1;
    }
    .textLayer span {
      color: rgba(0,0,0,0.01);
      position: absolute;
      white-space: pre;
      transform-origin: 0% 0%;
      user-select: text;
      cursor: text;
      -webkit-user-select: text;
    }
    .textLayer ::selection { background: rgba(0, 120, 215, 0.35); }
  </style>
</head>
<body>
  <div id="topbar">
    <button id="prev">上一页</button>
    <button id="next">下一页</button>
    <span id="pageInfo">- / -</span>
    <span style="opacity:.8; margin-left: 8px;">在页面文字上拖选，松开左键后自动发送讲解</span>
  </div>
  <div id="viewer">
    <div id="page" class="page-wrap"></div>
  </div>

  <script nonce="${nonce}" type="module">
    import * as pdfjsLib from 'https://cdn.jsdelivr.net/npm/pdfjs-dist@4.10.38/build/pdf.min.mjs';

    const vscode = acquireVsCodeApi();
    const viewerEl = document.getElementById('viewer');
    const pageEl = document.getElementById('page');
    const pageInfoEl = document.getElementById('pageInfo');
    const prevBtn = document.getElementById('prev');
    const nextBtn = document.getElementById('next');
    const pdfData = Uint8Array.from(atob('${base64Pdf}'), c => c.charCodeAt(0));

    let lastSent = '';
    let sendTimer = null;
    let pdfDoc = null;
    let currentPage = 1;
    let scale = 1.35;
    let renderLock = false;

    function getSelectedTextFromTextLayer() {
      const sel = window.getSelection();
      if (!sel || sel.rangeCount === 0) {
        return '';
      }

      const range = sel.getRangeAt(0);
      const container = range.commonAncestorContainer;
      const node = container.nodeType === Node.TEXT_NODE ? container.parentElement : container;
      if (!(node instanceof Element)) {
        return '';
      }

      if (!node.closest('.textLayer')) {
        return '';
      }

      return String(sel.toString() || '').trim();
    }

    function onMouseUp() {
      if (sendTimer) {
        clearTimeout(sendTimer);
      }
      sendTimer = setTimeout(() => {
        const text = getSelectedTextFromTextLayer();
        if (!text || text.length < 6 || text === lastSent) {
          return;
        }
        lastSent = text;
        vscode.postMessage({ type: 'selection', text });
      }, 80);
    }

    document.addEventListener('mouseup', onMouseUp, true);

    pdfjsLib.GlobalWorkerOptions.workerSrc = 'https://cdn.jsdelivr.net/npm/pdfjs-dist@4.10.38/build/pdf.worker.min.mjs';

    function updatePageInfo() {
      pageInfoEl.textContent = currentPage + ' / ' + (pdfDoc?.numPages || '-');
      prevBtn.disabled = currentPage <= 1;
      nextBtn.disabled = !pdfDoc || currentPage >= pdfDoc.numPages;
    }

    async function renderPage(pageNumber) {
      if (!pdfDoc) {
        return;
      }
      if (renderLock) {
        return;
      }
      renderLock = true;

      try {
      const page = await pdfDoc.getPage(pageNumber);
      const viewport = page.getViewport({ scale });

      pageEl.innerHTML = '';
      pageEl.style.width = viewport.width + 'px';
      pageEl.style.height = viewport.height + 'px';

      const canvas = document.createElement('canvas');
      canvas.width = Math.ceil(viewport.width);
      canvas.height = Math.ceil(viewport.height);
      pageEl.appendChild(canvas);

      const textLayer = document.createElement('div');
      textLayer.className = 'textLayer';
      pageEl.appendChild(textLayer);

      const ctx = canvas.getContext('2d');
      await page.render({ canvasContext: ctx, viewport }).promise;

      const textContent = await page.getTextContent();
      const styles = textContent.styles || {};

      for (const item of textContent.items) {
        if (!item.str || !item.str.trim()) {
          continue;
        }

        const tx = pdfjsLib.Util.transform(viewport.transform, item.transform);
        const angle = Math.atan2(tx[1], tx[0]);
        const fontHeight = Math.hypot(tx[2], tx[3]);

        const span = document.createElement('span');
        span.textContent = item.str;
        span.style.left = tx[4] + 'px';
        span.style.top = (tx[5] - fontHeight) + 'px';
        span.style.fontSize = fontHeight + 'px';

        const style = styles[item.fontName] || {};
        if (style.fontFamily) {
          span.style.fontFamily = style.fontFamily;
        }

        span.style.transform = 'rotate(' + angle + 'rad)';
        textLayer.appendChild(span);
      }

      updatePageInfo();
      } finally {
        renderLock = false;
      }
    }

    async function gotoPage(nextPage) {
      if (!pdfDoc) return;
      const bounded = Math.max(1, Math.min(pdfDoc.numPages, nextPage));
      if (bounded === currentPage) return;
      currentPage = bounded;
      await renderPage(currentPage);
    }

    prevBtn.addEventListener('click', async () => {
      await gotoPage(currentPage - 1);
    });

    nextBtn.addEventListener('click', async () => {
      await gotoPage(currentPage + 1);
    });

    viewerEl.addEventListener('wheel', async (event) => {
      if (!pdfDoc) return;
      event.preventDefault();
      if (renderLock) return;

      if (event.deltaY > 0) {
        await gotoPage(currentPage + 1);
      } else if (event.deltaY < 0) {
        await gotoPage(currentPage - 1);
      }
    }, { passive: false });

    pdfDoc = await pdfjsLib.getDocument({ data: pdfData }).promise;
    await renderPage(currentPage);
  </script>
</body>
</html>`;
}
