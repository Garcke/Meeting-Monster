<p align="center">
  <img src="desktop/renderer/favicon.png" alt="Meeting-Monster logo" width="112" style="border-radius:50%; object-fit:cover;">
</p>

<h1 align="center">Meeting-Monster</h1>

<p align="center">A local Windows transcription and AI meeting assistant</p>

<p align="center">
  <a href="README.md">中文 README</a> ·
  <a href="https://github.com/Garcke/Meeting-Monster/releases/tag/v3.0.0">v3.0.0 Release</a>
</p>

Meeting-Monster is a Windows desktop meeting assistant. It performs speech transcription locally, then uses the TypeScript backend built into the Electron main process to call the model service configured by the user for answers, follow-up questions, rewrites, and screenshot analysis.

This project currently ships as a Windows desktop client; the browser workspace has been removed. When the EXE or Portable app starts, it initializes the TypeScript backend inside the Electron main process. No Python, virtual environment, `start.bat`, or separately started local HTTP service is required. Local transcription also does not require Python ASR, vLLM, WSL, or `LOCAL_ASR_MODEL_DIR`.

## v3.0.0 highlights

- Native TypeScript backend inside the Electron main process, with backend and transcription resources released on application exit.
- Official OpenAI and Anthropic JavaScript SDKs instead of a Python backend service.
- Ant Design is used across Settings, model forms, and the workspace menu.
- The floating capsule provides Chat/Hide states, transcription status, and clearer shortcut feedback.
- Fixed clipping and stale window shapes on mixed-DPI, negative-coordinate, and extended-display layouts.
- Windows defaults to system audio plus microphone; live transcription still starts only when the user enables it.

## Features

- One Electron `BrowserWindow` hosts the floating capsule and expanded panel without resizing the native window.
- Local Chinese/English streaming ASR powered by `sherpa-onnx-node`.
- Windows microphone, system audio, and mixed system-audio-plus-microphone input.
- AI answers, Assist, follow-up questions, and rewrites call the configured model service from the Electron main-process TypeScript backend and render Markdown output.
- Two supported text-model protocols: `OpenAI Compatible` and `Anthropic Compatible`.
- Workspace menu entries for shortcut guidance, live transcription, chat clearing, application hiding, and Settings.

## Models and privacy

Configure the model protocol, Base URL, Model ID, API Key, maximum tokens, and temperature in Settings. Electron `safeStorage` encrypts API keys; they are never returned to the renderer. Remote model services must use HTTPS. HTTP is allowed only for `localhost`, `127.0.0.1`, and `::1`.

The official OpenAI and Anthropic SDKs use a controlled Node `fetch transport` in the Electron main process to reach the configured model service. The app does not start a backend child process, listen on a local service port, or require a manually started backend.

Model weights are not bundled in the EXE, Portable, DMG, or ZIP artifacts. Downloads use pinned revisions, file sizes, and SHA-256 checksums.

## Assist screenshot analysis

`Assist` does not require transcript content or a selected question. It captures the complete display currently containing the mouse pointer, then sends only the screenshot and the built-in analysis instruction to the model. Before using Assist, the model connection must pass image-input verification so the multimodal model capability is known.

Screenshot data exists only in memory while it is processed. The Electron main process captures the image and the native TypeScript backend sends it directly to the configured model service. The app does not write the screenshot to disk, expose it to the renderer, or store it in conversation history. Normal messages, follow-up questions, rewrites, and automatic transcription answers remain text-only.

## Live transcription and audio input

- `Ctrl+S`: start or stop live transcription.
- `Ctrl+R`: clear the chat.
- Meetings are not recorded automatically; live transcription must be enabled manually.
- Windows defaults to system audio plus microphone. The first system-audio capture requires choosing the source in the Windows sharing dialog.
- The capsule shows idle, transcribing, processing, stopped, and error states.

## Local ASR models

Settings exposes only the bundled model catalog. Choose a model and click Download. A preselected model is not necessarily installed; transcription is disabled until a model is installed. Startup makes no model-network request, and switching between installed models does not download them again.

Bundled models:

- `streaming-paraformer-bilingual-zh-en`: bilingual Chinese/English streaming model, preselected by default.
- `streaming-zipformer-zh-int8-2025-06-30`: Chinese-enhanced streaming model.

Windows model directory:

```text
<home>/.cache/meeting-monster/models/asr/<model-id>/
```

Downloads use a pinned ModelScope source and a pinned Hugging Face fallback after the primary source fails. The renderer cannot provide arbitrary download URLs, and the previous `AppData\Roaming` model directory is not migrated automatically.

## Requirements

- Windows 10/11 64-bit
- Node.js 20 or later (source development only)
- At least 8 GB RAM recommended

Published EXE and Portable builds do not require a separate Python installation, virtual environment, WSL, or ASR runtime.

## Electron development

```powershell
Set-Location desktop
npm ci
npm start
```

Type checking, unit tests, and a production build:

```powershell
npm run typecheck
npm run unit-test
npm run build
```

## Testing and packaging

Run from the `desktop` directory:

```powershell
npm run desktop-test
npm run audit:package -- release
npm run dist:win:unsigned
```

Windows artifacts are written to `desktop\release\`:

- `Meeting-Monster-Setup-<version>.exe`: NSIS installer
- `Meeting-Monster-Portable-<version>.exe`: portable build

Releases are built and uploaded to GitHub manually. Model weights are never included in release artifacts.

## Privacy and limitations

- Audio capture and ASR inference run locally by default.
- AI requests are sent only to the model service configured by the user.
- Application hiding uses Windows content-protection capabilities. It cannot prevent phone cameras, hardware capture, privileged tools, or unsupported capture paths.
- Availability, privacy policies, and retention practices for third-party model services are controlled by those providers.
