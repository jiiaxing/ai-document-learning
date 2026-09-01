# AI Document Learning Desktop

AI Document Learning Desktop is an Electron-based desktop application for AI-assisted PDF reading and study workflows.

The current application provides local PDF reading, text selection, page and region image capture, streaming AI explanation and translation, Markdown rendering, and local annotation tools.

## Architecture

```text
src/desktop/              Electron main process
src/standalone/           Local HTTP server, configuration, AI provider layer
src/standalone-tests/     Server and public asset tests
public/                   Renderer assets loaded by the Electron window
scripts/                  Smoke test scripts
```

## Requirements

- Node.js 22+
- npm
- Windows for Electron packaging scripts

## Install

```powershell
npm install
```

## Development

Run the desktop application:

```powershell
npm.cmd run desktop
```

Run the local web server only:

```powershell
npm.cmd run compile
npm.cmd start
```

Default local server:

```text
http://127.0.0.1:5178
```

If the default port is unavailable, the server automatically tries the next available port.

## Scripts

```powershell
npm.cmd run compile   # TypeScript build
npm.cmd test          # Unit and asset tests
npm.cmd run lint      # ESLint
npm.cmd run desktop   # Run Electron desktop app
npm.cmd run pack:win  # Build unpacked Windows desktop app
npm.cmd run dist:win  # Build Windows installer
```

## Build

Create an unpacked Windows desktop build:

```powershell
npm.cmd run pack:win
```

Output:

```text
release/win-unpacked/AI PDF Tutor.exe
```

Create a Windows installer:

```powershell
npm.cmd run dist:win
```

Build outputs are generated under `release/`.

## Configuration

Use the example configuration as a template:

```text
ai-tutor.config.example.json
```

Local runtime configuration:

```text
ai-tutor.config.json
```

For desktop builds, runtime configuration and logs are stored in the Electron user data directory:

```text
C:\Users\<user>\AppData\Roaming\AI PDF Tutor\
```

The default provider preset is DeepSeek. The settings drawer also includes Mock, OpenAI / GPT, and custom OpenAI-compatible endpoints.

Example OpenAI provider:

```json
{
  "provider": {
    "preset": "openai",
    "kind": "openaiCompatible",
    "protocol": "openai",
    "endpoint": "https://api.openai.com/v1/chat/completions",
    "model": "gpt-5",
    "apiKey": "YOUR_API_KEY",
    "apiKeyHeader": "Authorization",
    "apiKeyPrefix": "Bearer "
  }
}
```

Example DeepSeek provider:

```json
{
  "provider": {
    "preset": "deepseek",
    "kind": "openaiCompatible",
    "protocol": "openai",
    "endpoint": "https://api.deepseek.com/chat/completions",
    "model": "deepseek-v4-flash-vision-exp",
    "apiKey": "YOUR_DEEPSEEK_API_KEY",
    "apiKeyHeader": "Authorization",
    "apiKeyPrefix": "Bearer "
  }
}
```

## Features

- Local PDF opening and rendering
- Single-page and continuous reading modes
- Page navigation, direct page jumping, and Ctrl+wheel zoom
- Selected-text explanation and translation
- Page-level explanation and translation
- Region screenshot explanation and translation
- Markdown rendering for AI responses
- Image attachments for vision-capable models
- Local highlights, notes, freehand lines, and eraser
- OpenAI-compatible provider configuration
- Local developer logs and smoke tests

## Repository Policy

Source code, templates, tests, and scripts are committed to the repository.

Local configuration, logs, PDF files, dependency folders, build output, and packaged artifacts are ignored by `.gitignore`.

## Smoke Tests

Run the Electron desktop smoke test:

```powershell
npm.cmd run compile
.\node_modules\.bin\electron.cmd out\desktop\main.js --smoke-test
```

Run the packaged app smoke test after `pack:win`:

```powershell
.\release\win-unpacked\AI PDF Tutor.exe --smoke-test
```
