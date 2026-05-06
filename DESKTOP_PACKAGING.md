# Desktop Packaging

This project now has two launch modes:

- Web/dev server: `npm.cmd start`
- Desktop shell: `npm.cmd run desktop`

The desktop shell starts the same local AI PDF Tutor server on a random local port, opens it in an Electron window, and stores writable runtime files in the normal Windows app data directory:

```text
C:\Users\<you>\AppData\Roaming\AI PDF Tutor\ai-tutor.config.json
C:\Users\<you>\AppData\Roaming\AI PDF Tutor\logs\app.log
```

## Build Outputs

Build a Windows installer when the machine can download Electron Builder's NSIS resources:

```powershell
npm.cmd run dist:win
```

If the installer step is blocked by network access to GitHub, build the unpacked desktop app instead:

```powershell
npm.cmd run pack:win
```

The runnable app is:

```text
release\win-unpacked\AI PDF Tutor.exe
```

For sharing without an installer, zip the `release\win-unpacked` folder. The current verified zip artifact is:

```text
release\AI-PDF-Tutor-0.1.0-win-x64.zip
```

## Smoke Test

The desktop entry supports a no-window smoke test:

```powershell
.\node_modules\.bin\electron.cmd out\desktop\main.js --smoke-test
.\release\win-unpacked\AI PDF Tutor.exe --smoke-test
```

The smoke test starts the embedded server, writes an `app.start` log entry, and exits automatically.
