# AI PDF Tutor Development Handoff

Last updated: 2026-04-30 19:34 Asia/Shanghai

Workspace: `D:\PDF_Reader - 副本\pdf-reader`

## Current Goal

This repo has been refactored from a VS Code extension copy into a standalone AI PDF learning app.

The app should behave like a normal desktop PDF reader:

- Open local/workspace PDFs.
- Read and render PDFs with single-page or continuous modes.
- Select PDF text and trigger AI explanation/translation.
- If auto-trigger is disabled, show floating nearby buttons for explanation and translation independently.
- Translate selected text or manually entered text.
- Chat with AI, including image attachments.
- Render AI responses as Markdown.
- Persist API/settings/prompts/UI preferences.
- Support PDF annotations: highlight, undo highlight, embedded text notes, draggable/resizable note boxes, font-size controls, freehand lines, eraser, and per-page clear.
- Keep developer logs that reflect the real runtime flow.

## Important Paths

- Web entry: `public/index.html`
- Main frontend logic: `public/app.js`
- Styles/layout: `public/styles.css`
- Standalone server: `src/standalone/server.ts`
- AI provider/client: `src/standalone/aiProvider.ts`
- Config/settings handling: `src/standalone/config.ts`
- OpenAI-compatible response path helper: `src/core/openaiResponseUtils.ts`
- Electron desktop wrapper: `src/desktop/main.ts`
- Static/frontend tests: `src/standalone-tests/publicAssets.test.ts`
- Server/provider tests: `src/standalone-tests/server.test.ts`
- Desktop input smoke helper: `scripts/electron-input-smoke.cjs`
- Default layout smoke helper: `scripts/electron-default-layout-smoke.cjs`
- Test PDF in repo: `test.pdf`

Desktop artifacts:

- Runnable desktop app: `D:\PDF_Reader - 副本\pdf-reader\release\win-unpacked\AI PDF Tutor.exe`
- Zip package: `D:\PDF_Reader - 副本\pdf-reader\release\AI-PDF-Tutor-0.1.0-win-x64.zip`
- Desktop config: `%APPDATA%\AI PDF Tutor\ai-tutor.config.json`
- Desktop logs: `%APPDATA%\AI PDF Tutor\logs\app.log`
- Web/dev config: `D:\PDF_Reader - 副本\pdf-reader\ai-tutor.config.json`
- Web/dev logs: `D:\PDF_Reader - 副本\pdf-reader\logs\app.log`

Backup before desktop packaging:

- `D:\PDF_Reader - 副本\pdf-reader\.codex-backups\before-desktop-20260429-212951`

## Current Default UI

The user approved the current initial layout as visually appropriate.

Implemented defaults:

- PDF scale: `232%` (`DEFAULT_SCALE = 2.32`)
- Left translation pane: about `22%`
- Center PDF reader pane: about `51%`
- Right AI explanation pane: about `26%`

Details:

- Defaults are dynamic by window width, not fixed pixels.
- Old saved `190%` scale is migrated away.
- Old pane widths `320/420` are migrated away unless the user had deliberately changed them.
- The latest automated layout smoke test measured:
  - shell width `1426`
  - translation width `314`
  - reader width `725`
  - assistant width `371`
  - ratio `22% / 50.8% / 26%`
  - zoom `232%`

## Recent Fixes

1. Fixed desktop text input.
   - Removed Electron `sandbox: true`.
   - Added standard Edit menu with undo/redo/cut/copy/paste/select all.
   - Prevented the PDF viewer from stealing focus from inputs/textareas/note boxes.

2. Fixed resizable/collapsible panes.
   - Added drag handles between translation/PDF/AI panes.
   - Added close/restore controls for translation and AI panes.
   - Fixed a CSS Grid bug where closing translation caused AI pane to occupy the PDF area.
   - Each pane now has an explicit grid column:
     - translation: column 1
     - PDF reader: column 3
     - AI assistant: column 5

3. Fixed API configuration pitfalls.
   - Logs showed user requests were reaching `https://api.silasvance.com/v1/chat/completions`.
   - The upstream error was `503 No available accounts`, not a local token parsing bug.
   - A bad config state was also seen earlier: `protocol=anthropic` with `/v1/chat/completions`.
   - Added validation so obvious protocol/endpoint mismatches are rejected.
   - Added response-path migration:
     - OpenAI-compatible defaults to `choices.0.message.content`
     - Anthropic defaults to `content.0.text`

4. Improved desktop packaging.
   - `npm.cmd run pack:win` builds `release\win-unpacked`.
   - `npm.cmd run dist:win` may fail if NSIS resources cannot be downloaded. Use `pack:win` plus zip for now.
   - The zip is produced manually with `Compress-Archive` after packaging.

## Validation Already Run

Last successful checks:

```powershell
npm.cmd test
npm.cmd run lint
npm.cmd run pack:win
& '.\release\win-unpacked\AI PDF Tutor.exe' --smoke-test
```

Desktop automation checks also passed:

- `scripts/electron-input-smoke.cjs`
  - Verifies API key input, manual translation input, chat input.
  - Verifies pane collapse does not overlap PDF and AI panes.
- `scripts/electron-default-layout-smoke.cjs`
  - Uses a temporary Electron user-data directory.
  - Clears UI prefs.
  - Opens `test.pdf`.
  - Verifies default zoom `232%`.
  - Verifies initial pane ratio near `22% / 51% / 26%`.

Useful smoke-test note:

If `pack:win` fails with `Access is denied` on `release\win-unpacked\AI PDF Tutor.exe`, the executable is usually still running. Close it or kill only this project's Electron/AI PDF Tutor processes, then rebuild.

## Commands

Run web/dev app:

```powershell
npm.cmd start
```

Run desktop from source:

```powershell
npm.cmd run desktop
```

Build unpacked desktop app:

```powershell
npm.cmd run pack:win
```

Recreate zip after `pack:win`:

```powershell
Compress-Archive -Path '.\release\win-unpacked\*' -DestinationPath '.\release\AI-PDF-Tutor-0.1.0-win-x64.zip' -Force
```

Smoke test packaged app:

```powershell
& '.\release\win-unpacked\AI PDF Tutor.exe' --smoke-test
```

## API Notes

Current observed desktop config uses:

- provider kind: `openaiCompatible`
- protocol: `openai`
- endpoint: `https://api.silasvance.com/v1/chat/completions`
- model in desktop config recently observed: `gpt-5.4`

If the app shows:

```text
AI request failed: 503 {"error":{"message":"No available accounts: no available accounts","type":"api_error"}}
```

That means the upstream API service returned no available accounts. Likely causes:

- The relay/provider has no available account pool.
- The configured key has no usable account.
- The model name is not available for that relay.
- The relay is temporarily overloaded.

Local code now adds hints for this error, but it cannot fix upstream account availability.

## Git/Repo State

The working tree is intentionally heavily changed because the VS Code extension copy was converted into a standalone app. There are many deleted old extension files and many new standalone files.

Do not blindly revert deleted files unless the user explicitly asks. The deletion of old VS Code extension files is part of the standalone-app direction.

Representative `git status` shape:

- Modified: `.gitignore`, `README.md`, `package.json`, `package-lock.json`, `tsconfig.json`, `src/core/openaiResponseUtils.ts`
- Deleted old VS Code extension files, e.g. `src/extension.ts`, `src/pdfTutorPanel.ts`, old VS Code tests/docs.
- New: `public/`, `src/standalone/`, `src/desktop/`, `src/standalone-tests/`, `scripts/`, `DESKTOP_PACKAGING.md`, `DEVELOPMENT_HANDOFF.md`.

## User Preferences Captured

- Avoid manual testing by the user; use logs and automated smoke tests.
- Every runtime test should check logs against real app flow.
- UI should feel like a usable reader/tool, not a demo page.
- PDF reader should be central and comfortable by default.
- Translation and AI panes should be independently resizable and closable.
- AI explanation should start at the top of new answer, not auto-scroll to the bottom.
- AI should not require a selection for free chat.
- Auto-trigger options should be independent:
  - auto explain on means no explain floating button
  - auto translate on means no translate floating button
- Prompt behavior:
  - explanation: structured knowledge points + Chinese/English bilingual + precise explanation based on surrounding PDF context
  - translation: full paragraph translation, keyword mapping with English original in parentheses, then key word explanations
- Notes should behave like embedded PDF text boxes:
  - click/place
  - type immediately
  - drag/resize
  - font-size controls
  - delete individual note
  - hide editing border after finishing input
- Lines should be freehand and erasable.

## Remaining Cautions / Possible Next Work

- Installer generation with NSIS may still fail without network access to download builder resources. Current reliable distribution is `release\win-unpacked` or the zip.
- Logs can grow large; later consider log rotation.
- The current app stores annotation data and UI prefs in browser localStorage. For a more polished desktop app, consider moving this to a file under `%APPDATA%\AI PDF Tutor`.
- For real PDF editing/export, current annotations are overlay/local annotations, not written back into the PDF file.
- If the user wants actual PDF export with annotations embedded, implement a separate export pipeline.
- If API 503 persists, test with a known working endpoint/model/key combination before changing local code.

## 2026-04-30 Visual Page Actions Update

User asked to begin development for:

- Top-bar `讲解本页` and `翻译本页`.
- No explicit screenshot mode; use right-click directly.
- Right-click tap should show page-level visual actions.
- Right-click drag should act as visual region/circle selection.

Implemented files:

- `public/index.html`
  - Added top-bar buttons `explainPage` and `translatePage`.
  - Added floating visual action menu `visualActions` with `visualExplain` and `visualTranslate`.
- `public/app.js`
  - Added page-image capture via current rendered PDF canvas.
  - Added `explainCurrentPage()` and `translateCurrentPage()`.
  - Added right-click visual selection:
    - right-click tap opens actions for the current page
    - right-click drag records a freehand path, computes a padded bounding crop, and shows floating actions
    - the captured image includes the drawn selection path so the vision model can focus on the circled area
  - Added Ctrl/Cmd+Enter submit shortcuts for:
    - manual translation input
    - AI question input
  - Added client logs for `page.explain.start`, `page.translate.start`, `pdf.image.capture`, `visual.selection.start`, `visual.selection.ready`, `visual.selection.explain`, `visual.selection.translate`, and `shortcut.submit`.
- `public/styles.css`
  - Added visual action and visual selection overlay styles.
- `src/standalone-tests/publicAssets.test.ts`
  - Added static coverage for page actions, visual selection, screenshot capture, and Ctrl+Enter shortcuts.

Verification completed before user paused due to low battery:

```powershell
npm.cmd test
npm.cmd run lint
```

Both passed.

Browser/in-app smoke verification completed against `http://127.0.0.1:5178/?pdf=test.pdf...`:

- Confirmed `讲解本页` and `翻译本页` appear in the top toolbar.
- Temporarily switched provider to `mock` through `/api/settings` to avoid sending smoke-test screenshots to the real API.
- Clicked `讲解本页`:
  - observed assistant message appears
  - logs showed `page.explain.start`, `pdf.image.capture`, `explain.first_token`, `explain.done`
- Clicked `翻译本页`:
  - observed translation result appears
  - logs showed `page.translate.start`, `pdf.image.capture`, `translate.first_token`, `translate.done`
- Restored provider to the original `openaiCompatible` config after smoke test; API key remained configured.
- Right-clicked rendered PDF page:
  - visual floating actions appeared
  - logs showed `visual.selection.start`, `visual.action.show`, `visual.selection.ready`

Not fully completed due to user low-battery pause:

- Did not run a full right-click drag path through action click to model response after the freehand-path upgrade.
- Did not rebuild packaged desktop app after this update.
- Did not run packaged Electron smoke tests after this update.
- Did not verify on desktop executable UI, only web/in-app browser surface.

Recommended next resume steps:

1. Run `npm.cmd test` and `npm.cmd run lint` again if files changed.
2. Start app or use existing `5178` service with `test.pdf`.
3. Temporarily switch provider to `mock` before screenshot-action smoke tests, then restore provider.
4. Test right-click drag:
   - drag a visible region on page 1
   - confirm freehand overlay appears
   - click visual `讲解`
   - check logs for `visual.selection.explain`, `pdf.image.capture`, `explain.first_token`, `explain.done`
   - repeat visual `翻译`
5. Rebuild desktop with `npm.cmd run pack:win` when battery/time allows.
6. Run packaged smoke tests and inspect logs.

## 2026-04-30 Resume Completion

Resumed after the interrupted visual page-actions work and completed the missing validation/build steps.

Additional fixes made:

- `public/app.js`
  - Fixed right-click tap being misclassified as a small region selection.
    - The tap/drag threshold now uses the raw unpadded drag rectangle.
    - Padding is only applied after the raw drag distance is accepted as a region.
  - Preserved the visible freehand/region overlay after right-click drag completes.
    - The overlay remains visible beside the floating `璁茶В` / `缈昏瘧` actions.
    - The overlay is cleared when an action is clicked or when the user clicks away.
- `scripts/visual-actions-smoke.cjs`
  - Added a CDP smoke test for:
    - right-click tap page action menu
    - right-click drag region selection
    - visual explain action through `/api/explain`
    - visual translate action through `/api/explain`
    - image capture and real log flow checks
  - Supports `PDF_FILE=...` so packaged desktop smoke tests can load a local PDF through the hidden file input.
- `src/standalone-tests/publicAssets.test.ts`
  - Added static coverage for the visual smoke script and the raw/padded region-selection logic.

Validation completed after resume:

```powershell
npm.cmd test
npm.cmd run lint
npm.cmd run pack:win
& '.\release\win-unpacked\AI PDF Tutor.exe' --smoke-test
```

Desktop visual smoke tests completed:

- Source Electron with mock provider:
  - loaded `test.pdf`
  - right-click tap produced page visual actions
  - right-click drag produced visible region overlay
  - clicked visual `璁茶В`
  - logs confirmed `pdf.image.capture`, `visual.selection.explain`, `explain.first_token`, `explain.done`
  - clicked visual `缈昏瘧`
  - logs confirmed `pdf.image.capture`, `visual.selection.translate`, `translate.first_token`, `translate.done`
- Packaged `release\win-unpacked\AI PDF Tutor.exe` with mock provider:
  - loaded `test.pdf` via `PDF_FILE`
  - completed the same right-click tap, drag, visual explain, and visual translate flow
  - final smoke result:
    - page info `1 / 50`
    - assistant messages `1`
    - translation result length `127`
    - visual action menu hidden after actions

Packaging artifacts refreshed:

- Runnable desktop app:
  - `D:\PDF_Reader - 鍓湰\pdf-reader\release\win-unpacked\AI PDF Tutor.exe`
- Zip package:
  - `D:\PDF_Reader - 鍓湰\pdf-reader\release\AI-PDF-Tutor-0.1.0-win-x64.zip`

Current status:

- The visual page actions work is complete.
- The desktop package has been rebuilt.
- The packaged app has passed both basic smoke and visual-actions smoke.
- NSIS installer generation was not retried; keep using `release\win-unpacked` or the zip unless installer work is specifically requested.
