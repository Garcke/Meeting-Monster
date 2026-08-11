<p align="center">
  <a href="README.md">中文</a> ·
  <a href="README.en.md">English</a>
</p>

<p align="center">
  <img src="desktop/renderer/favicon.png" alt="Meeting-Monster logo" width="112" style="border-radius:50%; object-fit:cover;">
</p>

<h1 align="center">Meeting-Monster</h1>

<p align="center">A local Windows transcription and AI meeting assistant</p>

Meeting-Monster is a Windows desktop app that performs live speech transcription locally and uses the TypeScript backend built into the Electron main process to call an OpenAI- or Anthropic-compatible model that you configure.

The backend starts with the app. No Python, virtual environment, `start.bat`, or separately started local HTTP service is required.

## Features

- Local Chinese/English streaming transcription powered by `sherpa-onnx-node`.
- Windows microphone, system audio, and mixed system-audio-plus-microphone input; the default is system audio plus microphone.
- AI answers, Assist screenshot analysis, follow-up questions, and rewrites with Markdown output.
- `OpenAI Compatible` and `Anthropic Compatible` protocols using the official JavaScript SDKs.
- Ant Design settings, model forms, and workspace menu.
- A floating capsule with Chat/Hide states, transcription status, shortcuts, and extended-display support.

## Getting started

Published Windows installer and Portable builds do not require a separate Python, WSL, or ASR runtime. Open the app, then configure the model protocol, Base URL, Model ID, and API Key in Settings.

### Models and security

- API keys are encrypted with Electron `safeStorage` and never returned to the renderer.
- Remote model services must use HTTPS. HTTP is allowed only for `localhost`, `127.0.0.1`, and `::1`.
- Model weights are not bundled in installers; downloads use pinned revisions, file sizes, and SHA-256 checksums.

### Audio and transcription

- `Ctrl+S`: start or stop live transcription.
- `Ctrl+R`: clear the chat.
- Meetings are not recorded automatically; live transcription must be enabled manually.
- The first system-audio capture requires choosing the source in the Windows sharing dialog.

### Assist screenshot analysis

Assist captures the complete display containing the mouse pointer and sends the screenshot plus the built-in analysis instruction to a model verified for image input. The screenshot exists only in memory while it is processed; it is not written to disk, exposed to the renderer, or stored in conversation history.

## Local ASR models

Settings exposes only the built-in model catalog. Choose a model and click Download. A preselected model is not necessarily installed, and transcription cannot start until a model is installed. Startup does not automatically download models.

- `streaming-paraformer-bilingual-zh-en`: Chinese/English streaming model.
- `streaming-zipformer-zh-int8-2025-06-30`: Chinese-enhanced streaming model.

Windows model directory:

```text
<home>/.cache/meeting-monster/models/asr/<model-id>/
```

Downloads use a pinned ModelScope source and a pinned Hugging Face fallback. The renderer cannot provide arbitrary download URLs.

## Development from source

Requirements: Windows 10/11 64-bit, Node.js 20+, and at least 8 GB RAM recommended.

```powershell
Set-Location desktop
npm ci
npm start
```

Type checking, tests, build, and packaging:

```powershell
npm run typecheck
npm run unit-test
npm run build
npm run desktop-test
npm run dist:win:unsigned
npm run audit:package -- release
```

Build artifacts are written to `desktop\release\`.

## Privacy limitations

Audio capture and ASR inference run locally by default. AI requests are sent only to the model service you configure. Application hiding relies on Windows content-protection capabilities and cannot prevent phone cameras, hardware capture, privileged tools, or unsupported capture paths. Data retention and privacy policies for third-party model services are controlled by those providers.
