# Meeting-Monster Desktop

This folder contains the pure Electron desktop client. There is no browser client and no Python WebSocket ASR path. Electron does not probe, start, or bundle a Python service.

## Development

```powershell
Set-Location desktop
npm ci
npm start
```

## Electron local ASR

The Electron client runs transcription locally with `sherpa-onnx-node`; Python, vLLM, WSL, and a Python ASR process are not required for Electron transcription. The Settings drawer contains exactly these fixed model IDs:

- `streaming-paraformer-bilingual-zh-en` — the preselected bilingual Chinese/English model.
- `streaming-zipformer-zh-int8-2025-06-30` — the optional Chinese-enhanced streaming model.

The preselected model is not downloaded automatically. Choose a model and download it manually. Startup makes no model-network request, and switching between installed models does not download them again. If no model is installed, Electron disables transcription and directs the user to Settings.

Installed models live at `<home>/.cache/meeting-monster/models/asr/<model-id>/`; temporary downloads are staged beneath that root. Existing models under the previous Electron `userData` directory are not reused. Downloads use ModelScope first and use the pinned Hugging Face fallback only after the primary source fails. Every archive or file is verified against its pinned size and SHA-256 checksum, and the renderer cannot enter an arbitrary URL. Model weights are not bundled in the EXE, Portable build, DMG, or ZIP.

Electron transcription works with Python stopped.

## Python API integration

Python is used only for Electron AI replies. The Electron overlay uses `http://127.0.0.1:9000/` for `/api/chat/`, `/api/model-options/`, and `/api/model-test/`.

Electron Settings exposes exactly two protocols: `OpenAI Compatible` and `Anthropic Compatible`. Each protocol has an independent `Base URL`, `Model ID`, optional `API Key`, maximum-token, and temperature form. The complete current connection is sent to the fixed local Python API for chat or connection testing; Electron keeps API keys encrypted and receives only non-secret summaries. A non-local production service requires HTTPS and should be supplied by application deployment configuration rather than the Electron UI.

## Packaging and privacy

Windows packaging uses the Meeting-Monster logo for the application and installer icons. The NSIS installer creates desktop and Start Menu shortcuts named `Meeting-Monster`.

- Electron content protection is enabled for Meeting-Monster windows by default through `BrowserWindow.setContentProtection(true)`.
- Press `Ctrl+Shift+P` or use the capsule protection button to toggle `setContentProtection(true/false)`.
- The capsule button and expanded status badge report whether window protection is enabled, disabled, unsupported, or failed.

Window protection is best-effort OS capture protection. It is not process hiding or anti-monitoring behavior and cannot guarantee protection from phone cameras, hardware capture, privileged tools, or unsupported capture paths.
