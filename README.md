<p align="center">
  <img src="desktop/renderer/favicon.png" alt="Meeting-Monster 产品标志" width="112" style="border-radius:50%; object-fit:cover;">
</p>

<h1 align="center">Meeting-Monster</h1>

<p align="center">Windows 本地实时语音转写与 AI 会议助手</p>

<p align="center">本地 ASR · 系统音频 · Markdown AI 回答 · 隐私优先</p>

Meeting-Monster 是一个面向 Windows 的桌面会议助手：在本机完成实时语音转写，并由 Electron 主进程内置的 TypeScript 后端直接调用用户配置的模型服务，生成回答、追问和重述。

本项目当前只发布 Windows 桌面客户端。浏览器工作区已移除；EXE 或 Portable 应用启动时会在 Electron 主进程中初始化 TypeScript 后端，不需要 Python、虚拟环境、`start.bat` 或单独启动的本地 HTTP 服务。本地语音转写也不需要 Python ASR 模型、vLLM、WSL 或 `LOCAL_ASR_MODEL_DIR`。

模型必须由用户在设置页手动选择并下载。启动时不会联网下载模型，切换已安装模型也不会重复下载。

模型权重不会打包进 EXE、Portable、DMG 或 ZIP。模型源使用固定版本、文件大小和 SHA-256 校验值。

## 功能概览

- Electron 单 `BrowserWindow`、单 React renderer，悬浮胶囊与展开面板属于同一个应用窗口。
- 使用 `sherpa-onnx-node` 在本机运行中英文流式 ASR。
- Windows 支持麦克风、系统音频，以及系统音频＋麦克风混合输入。
- ASR 模型由设置页手动选择和下载，启动时不会联网下载。
- AI 回答、Assist、追问、重述由 Electron 主进程中的 TypeScript 后端直接访问所配置的模型服务，输出按 Markdown 渲染。
- 仅支持两种文本模型协议：`OpenAI Compatible` 和 `Anthropic Compatible`。
- 模型权重不打包进安装版或便携版；应用退出按钮会真正结束 Electron 进程。

## Assist 截屏分析

`Assist` 不依赖转写内容或问题选择。点击后会截取当前鼠标所在显示器的完整截图，只将截图与内置分析指令发送给模型生成回答。使用 Assist 前，设置中的模型连接必须先通过图片输入验证，确认该模型支持多模态模型的图片输入能力。

截图数据在处理期间仅以内存形式存在：Electron 主进程负责截取，并由内置 TypeScript 后端直接发送给用户配置的模型服务以生成回答。应用不会将截图写入磁盘、不传给 renderer，也不进入对话历史记录；第三方模型服务对请求数据的处理遵循其各自的隐私政策。普通发送、追问、重述和自动转写回答仍然只发送文本，不会触发截图。

## 运行环境

- Windows 10/11 64 位
- Node.js 20 或更高版本
- 建议至少 8 GB 内存

本地语音转写不需要 Python ASR、vLLM 或 WSL。AI 回答和模型测试同样不需要 Python 运行时。系统音频输入是 Windows 专属能力，首次录音时需要在系统共享界面选择需要捕获的音频来源。

## AI 后端与启动方式

EXE 和 Portable 应用会在启动时自动初始化 Electron 主进程内的 TypeScript 后端。它通过 Node `fetch` 直接连接所配置的模型服务，不会启动子进程或监听本地端口，也没有需要手动运行的后端服务。

## 配置文本模型

在 Electron 设置中分别配置以下字段：

- 协议：`OpenAI Compatible` 或 `Anthropic Compatible`
- `Base URL`
- `Model ID`
- 可选 `API Key`
- 最大 Token 数和温度

API Key 会由 Electron `safeStorage` 加密保存，不会返回给 renderer。生产环境的远程 Base URL 应使用 HTTPS。

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
