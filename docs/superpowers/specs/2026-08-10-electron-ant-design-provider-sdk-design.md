# Meeting-Monster 官方 Provider SDK 与 Ant Design 全界面迁移设计

日期：2026-08-10
状态：待用户书面规格确认

## 1. 背景与目标

Meeting-Monster 已将原 Python 后端迁移到 Electron 主进程中的 TypeScript 原生后端。迁移后，Anthropic Compatible Provider 通过手写 `fetch` 拼接了错误的请求路径，使 MiniMax Anthropic 兼容地址 `https://api.minimaxi.com/anthropic` 请求到 `/anthropic/messages`，而旧 Python Anthropic SDK 会请求 `/anthropic/v1/messages`，最终在“测试连接”中出现 HTTP 404。

本轮同时完成三项目标：

1. OpenAI Compatible 与 Anthropic Compatible 分别使用官方 TypeScript SDK，移除手写 Provider 协议和 SSE 解析路径。
2. Electron 全应用的通用交互组件迁移到 Ant Design，统一设置窗口、工作区、菜单和悬浮胶囊的交互品质。
3. Windows 在没有已保存偏好时默认使用“系统音频 + 麦克风”。

## 2. 范围与边界

### 2.1 纳入范围

- Electron 设置窗口：模型配置、语音与转写页面、侧栏导航、状态提示和操作控件。
- Electron 工作区：聊天输入、操作按钮、问题列表、更多菜单、隐私与转写开关、加载和错误反馈。
- Electron 悬浮胶囊：可交互按钮、提示和状态徽标。
- TypeScript 原生后端的 OpenAI Compatible 和 Anthropic Compatible Provider。
- 音频来源默认值、持久化回退和相关 IPC/Renderer 测试。
- 桌面构建、ASAR 审计、Windows 安装版和便携版验证。

### 2.2 保留自定义实现的部分

“所有 UI 组件使用 Ant Design”指所有适合映射到组件库的交互原语，而不是删除 Electron 窗口专用布局。以下部分继续使用项目 CSS 和现有 React 结构：

- 透明、无边框的悬浮胶囊外壳和固定窗口尺寸。
- Electron 拖拽区、无拖拽交互区和窗口边界逻辑。
- 聊天消息排版、Markdown 内容、问题列表的业务布局。
- 工作区与胶囊的透明度、层级、状态动画和桌面融合效果。
- 主进程、preload、IPC 合约和安全存储边界。

这些自定义结构内部的按钮、菜单、输入框、开关、提示、加载、进度等交互组件使用 Ant Design。

### 2.3 非目标

- 不改变当前窗口结构、快捷键、转写启停逻辑或隐私保护行为。
- 不改变聊天历史、截图验证、ASR 模型下载和本地识别协议。
- 不增加外部 Python、模型服务进程或本地 HTTP 服务。
- 不将 MiniMax 固化为专用 Provider；继续通过兼容协议和自定义 Base URL 支持多家服务。
- 不覆盖用户已经保存的音频来源偏好。

## 3. Provider SDK 架构

### 3.1 依赖与适配层

桌面包新增：

- `openai`：OpenAI Compatible Provider。
- `@anthropic-ai/sdk`：Anthropic Compatible Provider。

现有 `Provider`、`ProviderCache`、`ChatService` 和 `BackendService` 接口保持不变。两个 Provider 文件继续作为项目适配层，负责将内部 `BackendChatRequest` 转换为 SDK 类型，并将 SDK 流式事件转换为现有文本 `AsyncIterable<string>`。

### 3.2 OpenAI Compatible 数据流

1. 使用设置中的 `api_key`、`base_url` 创建 OpenAI SDK client。
2. 使用 SDK 的 Chat Completions 流式接口发送模型、消息、温度、最大 Token 和图片数据 URL。
3. 将调用方的 `AbortSignal` 传入 SDK 请求选项。
4. 从 SDK chunk 的文本 delta 中输出非空文本。
5. SDK 抛出的 HTTP、限流、鉴权、连接和取消错误交给现有安全诊断层分类，不向 Renderer 暴露响应正文或密钥。

### 3.3 Anthropic Compatible 数据流

1. 使用设置中的 `api_key`、`base_url` 创建 Anthropic SDK client。
2. 使用 SDK Messages 流式接口发送 system、messages、图片 base64、模型、温度和最大 Token。
3. 适配层只规范化末尾斜杠和可选的末尾 `/v1`，再由 SDK 追加 `/v1/messages`，防止遗漏或重复版本段。对于 MiniMax，`https://api.minimaxi.com/anthropic` 必须请求到 `https://api.minimaxi.com/anthropic/v1/messages`；用户填写以 `/v1` 结尾的等价地址也必须得到同一请求路径。
4. 将调用方的 `AbortSignal` 传入 SDK 请求选项。
5. 只转发现有聊天功能所需的文本增量；SDK 事件解析替代项目手写 SSE 解析。

### 3.4 清理与兼容

- 删除不再被生产代码使用的手写 `sse.ts`，并删除对应解析器测试。
- 保留 HTTP 边界测试，通过 SDK 支持的自定义 `fetch` 注入验证 URL、请求体、鉴权、图片、流式文本、取消和错误状态。
- Base URL、Model ID、API Key、温度和最大 Token 的设置方式不改变。
- 官方 SDK 是唯一生产 Provider 协议实现，不设置手写网络协议回退。

## 4. Ant Design 迁移架构

### 4.1 统一主题入口

新增共享的 Meeting-Monster Ant Design 主题配置，由每个 Renderer 入口通过 `ConfigProvider` 使用。主题保持当前明亮设置页和深色透明浮层各自的视觉身份，同时共享以下基础规则：

- 主强调色：沿用当前 Meeting-Monster 蓝色焦点色。
- 紧凑控件尺寸：匹配桌面工具而非网页后台的大尺寸密度。
- 圆角：设置页使用中等圆角；胶囊和浮层使用更高圆角。
- 清晰的 hover、focus-visible、disabled、loading 和 error 状态。
- 中文界面使用 Ant Design 中文 locale。
- 动效尊重 `prefers-reduced-motion`。

设置窗口使用浅色主题；工作区和悬浮胶囊使用适配当前透明深色背景的 token 覆盖。主题不改变现有窗口透明度。

### 4.2 设置窗口组件映射

- 原生 `<select>` → `Select`。
- 文本和密码 `<input>` → `Input` / `Input.Password`。
- 最大 Token、温度 → `InputNumber`。
- 操作按钮和关闭按钮 → `Button`。
- 下载进度 → `Progress`。
- 成功、错误和帮助信息 → `Alert`、`Typography` 或语义状态组件。
- 加载状态 → `Spin` 或 Button `loading`。
- 侧栏导航保持现有布局，交互项使用 Ant Design Button/Menu 语义并保留当前选中标识。

音频来源 `Select` 的三个选项为“系统音频”“麦克风”“系统音频 + 麦克风”。Windows 全部可选；其他平台禁用含系统音频的选项，并继续显示原因。

### 4.3 工作区组件映射

- 输入区 → `Input` 或 `Input.TextArea`。
- Assist、追问、重述、发送等操作 → `Button`、`Tooltip`。
- 更多菜单 → `Dropdown` / `Menu`，实时转写和应用隐藏使用 `Switch` 或菜单可选状态。
- 加载、错误和空状态 → `Spin`、`Alert`、`Empty` 或紧凑状态组件。
- 问题选择项使用 Ant Design 可访问交互原语，但保留现有列表布局、选中逻辑和快捷键行为。

菜单弹层必须绑定到当前 Renderer 容器，避免跨出 BrowserWindow 或被窗口边界错误裁切。打开、关闭、Escape、点击外部和键盘导航行为由 Ant Design 负责，Electron 窗口定位仍由主进程负责。

### 4.4 悬浮胶囊组件映射

- Chat/Hide 和退出交互 → 紧凑 Ant Design `Button`，通过 className/token 保持当前几何尺寸、透明背景和红色退出反馈。
- 状态点可使用 `Badge`，但录音波形、爪子图标、头像和胶囊状态动画继续使用现有定制结构。
- 提示信息使用 `Tooltip`，不得改变胶囊展开/收起时的统一容器尺寸。

### 4.5 样式与包体约束

- 引入 Ant Design reset 样式后，逐项移除被组件库替代的原生控件 CSS，保留窗口布局与品牌样式。
- 使用 Vite 的 ESM tree-shaking 和共享 chunk，避免每个窗口复制完整组件库代码。
- 构建和 ASAR 审计验证新增依赖被正确打包，且不重新引入 Python、源码映射或旧远程后端残留。

## 5. 音频默认值与持久化

默认规则：

- Windows：`mixed`（系统音频 + 麦克风）。
- macOS/Linux/未知平台：`microphone`。

加载规则：

1. 存在有效已保存偏好时继续使用该偏好。
2. 设置文件不存在、损坏、版本错误或值非法时使用平台默认值。
3. 非 Windows 平台读取到 `system` 或 `mixed` 时规范化为 `microphone`。
4. 不通过版本升级强制覆盖用户明确保存的 `system` 或 `microphone`。

Renderer 初始占位状态仍使用安全的 `microphone`，平台和持久化结果解析完成后再显示权威值，避免未确认平台时启动系统音频采集。

## 6. 错误处理与安全

- SDK 错误必须经过现有 `classifyProviderError` 和 Renderer 安全诊断文案，不直接显示 Provider 原始响应。
- API Key 只保存在主进程安全存储中，不进入 Renderer 快照、日志或测试输出。
- Abort 不显示错误、不提交部分助手消息，并释放 Provider/聊天锁。
- Ant Design 表单错误只显示可操作的中文提示，不显示堆栈、请求正文或密钥。
- UI 迁移不得放宽 preload 白名单、IPC 输入校验、外链策略或 CSP。

## 7. 测试策略

### 7.1 Provider

- MiniMax Anthropic Base URL 精确请求 `/anthropic/v1/messages`。
- 已包含 `/v1` 的 Anthropic Base URL 不重复版本段。
- OpenAI 与 Anthropic SDK 的文本、图片、system、温度和最大 Token 序列化符合现有内部协议。
- 流式文本正常、空 delta 忽略、Abort 终止、HTTP 状态可分类且正文被脱敏。
- Provider 测试不访问真实外部模型服务、不使用真实 API Key。

### 7.2 UI

- 使用 Testing Library 按 role、label 和可见文案测试，不依赖 Ant Design 内部 DOM 层级。
- 设置页所有表单可通过键盘操作，label 与错误状态可被辅助技术识别。
- 下拉选项、禁用项、保存回滚、异步广播和最后一次选择优先逻辑保持正确。
- 工作区菜单的打开/关闭、转写、清空聊天、隐私、设置入口与快捷键说明保持正确。
- 胶囊 Chat/Hide、状态、退出和窗口尺寸行为保持正确。

### 7.3 默认音频

- Windows 无设置、损坏设置和非法设置均回退到 `mixed`。
- Windows 有效已保存值不被覆盖。
- 非 Windows 始终规范化到 `microphone`。
- 设置页首次加载显示权威的 `mixed`，选择变化继续通过 typed IPC 持久化。

### 7.4 验证门槛

- TypeScript 主进程与 Renderer 类型检查通过。
- 完整 Vitest unit-test 通过。
- Node desktop-test 中非环境相关测试通过；Electron 二进制或 Windows symlink 环境限制需单独记录。
- Vite/Electron 主进程构建通过。
- Windows unsigned 安装版与便携版打包、ASAR 审计通过。
- 运行打包后的应用完成设置窗口、工作区、胶囊、模型连接和退出清理 smoke test。

## 8. 实施阶段与提交边界

### 阶段 A：Provider SDK 与音频默认值

- 加入两个官方 SDK。
- 替换两个 Provider，删除手写 SSE。
- 将 Windows 默认值改为 `mixed`。
- 完成 Provider 和默认值回归测试。

### 阶段 B：设置窗口 Ant Design

- 建立共享主题和 locale。
- 迁移设置窗口全部通用交互组件。
- 完成设置页功能、可访问性和视觉验证。

### 阶段 C：工作区与悬浮胶囊 Ant Design

- 迁移工作区输入、按钮、菜单、开关和状态组件。
- 迁移胶囊内部适用的按钮、Tooltip 和 Badge。
- 保持透明窗口、拖拽、快捷键和固定尺寸行为。

### 阶段 D：打包与最终审查

- 清理冗余原生控件 CSS 和无用代码。
- 运行全量验证、Windows 打包和 ASAR 审计。
- 对设置、工作区和胶囊分别进行截图对比及独立代码审查。

每个阶段使用独立的 TDD 红/绿验证和精确文件提交；不得使用 `git add -A`，不得提交工作区现有未跟踪 `node_modules/`。

## 9. 验收标准

- 截图中的 MiniMax Anthropic Compatible 配置不再因缺少 `/v1` 产生路径型 404。
- 生产 Provider 只通过两个官方 SDK 发起模型请求，不再使用项目手写 SSE 解析器。
- 设置窗口、工作区和悬浮胶囊中适合组件化的交互控件均使用 Ant Design，视觉一致且不破坏定制桌面外壳。
- Windows 新默认音频来源为“系统音频 + 麦克风”，已有用户选择得到保留。
- 应用启动即可使用原生 TypeScript 后端，退出后无 Python、后端子进程或遗留端口。
- 类型检查、单元测试、构建、包审计和打包后 smoke test 达到上述验证门槛。
