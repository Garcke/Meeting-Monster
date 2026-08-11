<p align="center">
  <a href="README.md">中文</a> ·
  <a href="README.en.md">English</a>
</p>

<p align="center">
  <img src="desktop/renderer/favicon.png" alt="Meeting-Monster 产品标志" width="112" style="border-radius:50%; object-fit:cover;">
</p>

<h1 align="center">Meeting-Monster</h1>

<p align="center">Windows 本地实时语音转写与 AI 会议助手</p>

Meeting-Monster 是一款 Windows 桌面应用：在本机完成实时语音转写，并通过 Electron 主进程内置的 TypeScript 后端访问你配置的 OpenAI 或 Anthropic 兼容模型。

应用启动时会自动初始化后端，不需要 Python、虚拟环境、`start.bat` 或单独启动本地 HTTP 服务。

## 功能

- 本地中英文流式语音转写，使用 `sherpa-onnx-node`。
- Windows 音频来源支持麦克风、系统音频和系统音频＋麦克风；默认使用系统音频＋麦克风。
- 支持 AI 回答、Assist 截屏分析、追问和重述，结果按 Markdown 显示。
- 支持 `OpenAI Compatible` 和 `Anthropic Compatible` 两种模型协议，并使用官方 JavaScript SDK。
- 使用 Ant Design 构建设置页、模型表单和工作区菜单。
- 悬浮胶囊支持 Chat/Hide、实时转写状态、快捷键和扩展显示器布局。

## 开始使用

已发布的 Windows 安装版和 Portable 版不需要单独安装 Python、WSL 或 ASR 运行时。安装后打开应用，在设置页填写模型协议、Base URL、Model ID 和 API Key 即可。

### 模型与安全

- API Key 使用 Electron `safeStorage` 加密保存，不会返回给 renderer。
- 远程模型服务必须使用 HTTPS；只有 `localhost`、`127.0.0.1` 和 `::1` 允许使用 HTTP。
- 模型权重不打包进安装包，下载使用固定版本、文件大小和 SHA-256 校验值。

### 音频与转写

- `Ctrl+S`：开始或停止实时转写。
- `Ctrl+R`：清空聊天。
- 会议不会自动录音，必须手动开启实时转写。
- 系统音频首次使用时，需要在 Windows 共享界面选择要捕获的音频来源。

### Assist 截屏分析

Assist 会截取鼠标所在显示器的完整画面，并将截图与内置分析指令发送给已验证支持图片输入的模型。截图只在处理期间以内存形式存在，不写入磁盘、不传给 renderer，也不进入对话历史。

## 本地 ASR 模型

设置页只提供内置模型目录。选择模型后点击“下载模型”；预选模型不代表已经安装，未安装模型时不能开始转写。启动时不会自动联网下载模型。

- `streaming-paraformer-bilingual-zh-en`：中英文双语流式模型。
- `streaming-zipformer-zh-int8-2025-06-30`：中文增强流式模型。

Windows 模型目录：

```text
C:\Users\<用户名>\.cache\meeting-monster\models\asr\<model-id>\
```

模型从固定版本的 ModelScope 下载，失败后使用固定版本的 Hugging Face 备用源；不接受 renderer 传入的任意下载 URL。

## 从源码开发

要求：Windows 10/11 64 位、Node.js 20+，建议至少 8 GB 内存。

```powershell
Set-Location desktop
npm ci
npm start
```

类型检查、单元测试、构建和打包：

```powershell
npm run typecheck
npm run unit-test
npm run build
npm run desktop-test
npm run dist:win:unsigned
npm run audit:package -- release
```

构建产物位于 `desktop\release\`。

## 隐私限制

音频采集和 ASR 推理默认在本机完成；AI 请求只发送到你配置的模型服务。“应用隐藏”依赖 Windows 内容保护能力，不能阻止手机拍摄、硬件采集、特权工具或不支持该能力的捕获路径。第三方模型服务的数据保留和隐私政策由其服务商负责。
