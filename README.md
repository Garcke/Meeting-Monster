# Meeting-Monster

The browser client has been removed; the Python service is API-only for Electron. GET / returns HTTP 410. No Python ASR model or LOCAL_ASR_MODEL_DIR is needed.

Each model requires an explicit manual download. Startup makes no model-network request, and switching between installed models does not download them again.

The platform-neutral model path is <home>/.cache/meeting-monster/models/asr/<model-id>/.

Model weights are not bundled in the EXE, Portable, DMG, or ZIP.

Model sources use pinned revisions, byte sizes, and SHA-256 checksums.

Meeting-Monster 是一个面向 Windows 的桌面会议助手：在本机完成实时语音转写，再通过本地 Python API 调用用户配置的文本模型生成回答、追问和重述。

本项目当前只发布 Windows 桌面客户端，不再提供浏览器工作区，也不再通过 Python、vLLM 或 WSL 执行客户端 ASR。

## 功能概览

- Electron 单 `BrowserWindow`、单 React renderer，悬浮胶囊与展开面板属于同一个应用窗口。
- 使用 `sherpa-onnx-node` 在本机运行中英文流式 ASR。
- Windows 支持麦克风、系统音频，以及系统音频＋麦克风混合输入。
- ASR 模型由设置页手动选择和下载，不会在启动时自动联网下载。
- AI 回答、Assist、追问、重述通过本地 Python `/api/chat/` 服务完成，输出按 Markdown 渲染。
- 仅支持两种文本模型协议：`OpenAI Compatible` 和 `Anthropic Compatible`。
- 模型权重不打包进安装版或便携版；应用退出按钮会真正结束 Electron 进程。

## 运行环境

- Windows 10/11 64 位
- Node.js 20 或更高版本
- Python 3.12（仅在使用 AI 回答、模型测试或模型配置 API 时需要）
- 建议至少 8 GB 内存

本地语音转写不需要 Python ASR、vLLM 或 WSL。系统音频输入是 Windows 专属能力，首次录音时需要在系统共享界面选择需要捕获的音频来源。

## 安装与启动 Python 服务

在项目根目录执行：

```powershell
uv venv --python 3.12 .venv
uv pip install --python .venv\Scripts\python.exe -r server\requirements.txt
Copy-Item .env.example .env
```

编辑 `.env` 设置模型配置加密密钥和管理令牌（如部署需要），然后启动服务：

```powershell
.\.venv\Scripts\python.exe -m server.app
```

服务默认监听 `http://127.0.0.1:9000`。Python 服务只负责文本模型调用和模型配置接口，不加载 ASR 模型。

| 接口 | 用途 |
| --- | --- |
| `/api/chat/` | 流式生成 AI 回答 |
| `/api/model-options/` | 返回可选的协议配置 |
| `/api/model-test/` | 测试当前连接 |
| `/api/models/` | 返回脱敏后的模型配置摘要 |
| `/api/prompt/` | 返回系统提示词 |

## 配置文本模型

在 Electron 设置中分别配置以下字段：

- 协议：`OpenAI Compatible` 或 `Anthropic Compatible`
- `Base URL`
- `Model ID`
- 可选 `API Key`
- 最大 Token 数和温度

API Key 会由 Electron 加密保存，不会返回给 renderer，也不会写入 Python 的模型配置文件。生产环境的远程 Base URL 应使用 HTTPS。

## 本地 ASR 模型

设置页只允许手动选择内置模型，然后点击“下载模型”。默认预选不代表已经安装；未安装模型时不能开始转写。

当前内置模型：

- `streaming-paraformer-bilingual-zh-en`：中英文双语流式模型，默认预选。
- `streaming-zipformer-zh-int8-2025-06-30`：中文增强流式模型。

Windows 模型目录：

```text
C:\Users\<用户名>\.cache\meeting-monster\models\asr\<model-id>\
```

下载使用固定版本的 ModelScope 源，并在主源失败后使用固定版本的 Hugging Face 备用源。每个文件都会校验固定大小和 SHA-256；不接受 renderer 传入的任意下载 URL。旧的 `AppData\Roaming` 模型目录不会被兼容或自动迁移。

## Electron 开发

```powershell
Set-Location desktop
npm ci
npm start
```

如果只需要类型检查和构建：

```powershell
npm run typecheck
npm run build
```

## 测试

在 `desktop` 目录执行：

```powershell
npm run typecheck
npm run unit-test
npm run desktop-test
npm run audit:package
```

其中安装包审计会确认发布内容不包含 `.onnx` 或其他模型权重，也不包含 Python 运行时。

## 构建 Windows 发布包

本项目的发布流水线只构建 Windows x64 产物：

```powershell
Set-Location desktop
npm run dist:win:unsigned
```

产物位于 `desktop\release\`：

- `Meeting-Monster-Setup-<version>.exe`：NSIS 安装版
- `Meeting-Monster-Portable-<version>.exe`：便携版

GitHub Actions 的 `.github/workflows/build-desktop.yml` 由 `v*` tag 触发，并自动上传这两个 Windows 产物到 GitHub Release。macOS 和 Linux 不在当前发布范围内。

## 隐私与限制

- 音频和 ASR 推理默认在本机完成。
- AI 请求只发送到用户在设置中配置的文本模型服务。
- 窗口内容保护是 Windows 的尽力而为能力，不能防止手机拍摄、硬件采集或特权工具捕获。
- 本项目不保证第三方模型服务的可用性、隐私政策或数据保留策略。
