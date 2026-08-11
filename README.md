<p align="center">
  <img src="desktop/renderer/favicon.png" alt="Meeting-Monster 产品标志" width="112" style="border-radius:50%; object-fit:cover;">
</p>

<h1 align="center">Meeting-Monster</h1>

<p align="center">Windows 本地实时语音转写与 AI 会议助手</p>

<p align="center">
  <a href="README.en.md">English README</a> ·
  <a href="https://github.com/Garcke/Meeting-Monster/releases/tag/v3.0.0">v3.0.0 Release</a>
</p>

Meeting-Monster 是一款面向 Windows 的桌面会议助手。它在本机完成实时语音转写，并由 Electron 主进程内置的 TypeScript 后端直接访问用户配置的模型服务，生成回答、追问、重述和截图分析结果。

本项目当前只发布 Windows 桌面客户端，浏览器工作区已移除。EXE 或 Portable 应用启动时会在 Electron 主进程中初始化 TypeScript 后端，不需要 Python、虚拟环境、`start.bat` 或单独启动的本地 HTTP 服务。本地语音转写不需要 Python ASR、vLLM、WSL 或 `LOCAL_ASR_MODEL_DIR`。

## v3.0.0 亮点

- Electron 主进程内置原生 TypeScript 后端，退出应用时会一起释放后端和转写资源。
- 使用 OpenAI 与 Anthropic 官方 JavaScript SDK，不再依赖 Python 后端服务。
- 设置页、模型表单和工作区菜单统一采用 Ant Design。
- 悬浮胶囊支持 Chat/Hide 状态、实时转写状态和更清晰的快捷键反馈。
- 修复混合 DPI、负坐标和扩展显示器上的悬浮窗形状与裁切问题。
- Windows 默认音频来源为系统音频＋麦克风，实时转写仍然需要手动开启。

## 功能概览

- 单个 Electron `BrowserWindow` 承载悬浮胶囊和展开面板，窗口尺寸保持稳定。
- 使用 `sherpa-onnx-node` 在本机运行中英文流式 ASR。
- Windows 支持麦克风、系统音频，以及系统音频＋麦克风混合输入。
- AI 回答、Assist、追问和重述由 Electron 主进程中的 TypeScript 后端直接访问所配置的模型服务，输出按 Markdown 渲染。
- 支持 `OpenAI Compatible` 和 `Anthropic Compatible` 两种文本模型协议。
- 工作区菜单提供快捷键说明、实时转写、清空聊天、应用隐藏和设置入口。

## AI 模型与隐私

在设置页配置模型协议、Base URL、Model ID、API Key、最大 Token 数和温度。API Key 会由 Electron `safeStorage` 加密保存，不会返回给 renderer。远程模型服务必须使用 HTTPS；仅允许 `localhost`、`127.0.0.1` 和 `::1` 使用 HTTP。

官方 OpenAI 和 Anthropic SDK 在 Electron 主进程中通过可控的 Node `fetch transport` 访问用户配置的模型服务。应用不会启动后端子进程、监听本地服务端口，也没有需要手动运行的后端服务。

模型权重不会打包进 EXE、Portable、DMG 或 ZIP。模型下载使用固定版本、文件大小和 SHA-256 校验值。

## Assist 截屏分析

`Assist` 不依赖转写内容或问题选择。点击后会截取当前鼠标所在显示器的完整截图，只将截图与内置分析指令发送给模型生成回答。使用 Assist 前，模型连接必须先通过图片输入验证，确认该多模态模型支持图片输入。

截图数据在处理期间仅以内存形式存在：Electron 主进程负责截取，并由 TypeScript 后端直接发送给用户配置的模型服务。应用不会将截图写入磁盘、不传给 renderer，也不进入对话历史记录。普通发送、追问、重述和自动转写回答仍然只发送文本。

## 实时转写与音频来源

- `Ctrl+S`：开始或停止实时转写。
- `Ctrl+R`：清空聊天。
- 会议不会自动录音，必须手动开启实时转写。
- Windows 默认选择“系统音频＋麦克风”。系统音频输入首次使用时需要在系统共享界面选择要捕获的音频来源。
- 悬浮胶囊会显示待机、转写中、处理中、已停止和异常状态。

## 本地 ASR 模型

设置页只允许手动选择内置模型，然后点击“下载模型”。默认预选不代表已经安装；未安装模型时不能开始转写。启动时不会联网下载模型，切换已安装模型也不会重复下载。

当前内置模型：

- `streaming-paraformer-bilingual-zh-en`：中英文双语流式模型，默认预选。
- `streaming-zipformer-zh-int8-2025-06-30`：中文增强流式模型。

Windows 模型目录：

```text
C:\Users\<用户名>\.cache\meeting-monster\models\asr\<model-id>\
```

下载使用固定版本的 ModelScope 源，并在主源失败后使用固定版本的 Hugging Face 备用源。不接受 renderer 传入的任意下载 URL，旧的 `AppData\Roaming` 模型目录不会被自动迁移。

## 运行环境

- Windows 10/11 64 位
- Node.js 20 或更高版本（仅从源码开发时需要）
- 建议至少 8 GB 内存

已发布的 EXE 和 Portable 不需要单独安装 Python、虚拟环境、WSL 或 ASR 运行时。

## Electron 开发

```powershell
Set-Location desktop
npm ci
npm start
```

类型检查、单元测试和构建：

```powershell
npm run typecheck
npm run unit-test
npm run build
```

## 测试与打包

在 `desktop` 目录执行：

```powershell
npm run desktop-test
npm run audit:package -- release
npm run dist:win:unsigned
```

Windows 安装版和便携版会输出到 `desktop\release\`：

- `Meeting-Monster-Setup-<version>.exe`：NSIS 安装版
- `Meeting-Monster-Portable-<version>.exe`：便携版

当前发布流程为手动构建和上传 GitHub Release。模型权重不会随安装包发布。

## 隐私与限制

- 音频和 ASR 推理默认在本机完成。
- AI 请求只发送到用户在设置中配置的模型服务。
- “应用隐藏”使用 Windows 内容保护能力，不能防止手机拍摄、硬件采集、特权工具或不支持该能力的捕获路径。
- 第三方模型服务的可用性、隐私政策和数据保留策略由其服务商负责。
