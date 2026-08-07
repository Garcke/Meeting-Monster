# Meeting-Monster Electron 内置后端设计

日期：2026-08-07

## 目标

将当前 `server/` 下的 Python 后端业务能力重构为 TypeScript，并随 Electron 安装版和便携版一起构建。用户双击 Meeting-Monster EXE 后即可使用 AI 对话、模型测试和截图分析，不需要安装 Python、创建虚拟环境、运行 `start.bat` 或手动启动本地服务。退出 Electron 后不得保留后端进程或未取消的模型请求。

## 设计结论

后端作为一组独立的 TypeScript 模块运行在 Electron 主进程中。Renderer 继续只通过白名单 IPC 使用后端能力，不启动本地 HTTP 服务，不监听 `127.0.0.1:9000`，也不创建额外 Node 或 Python 子进程。

这种结构保留清晰的前端/后端代码边界，同时让后端生命周期天然归属于 Electron：应用启动时初始化，应用退出时释放。

## 范围

本次迁移覆盖当前桌面应用依赖的后端行为：

- OpenAI Compatible 流式文本和图片请求。
- Anthropic Compatible 流式文本和图片请求。
- 单用户对话上下文、连续追问和清空聊天。
- 截图输入校验与协议消息序列化。
- 模型连接测试与图片能力验证。
- 模型配置校验、默认协议选项和加密持久化。
- 请求取消、并发约束、Provider 连接复用与释放。
- 稳定的错误分类、用户消息和敏感信息脱敏。

现有 Python HTTP 路由不会作为网络 API 原样保留。它们承载的应用行为会迁移为内部服务接口；没有桌面调用方的管理路由不会继续暴露本地端口。

## 非目标

- 不恢复浏览器客户端。
- 不引入独立后台守护进程或 Windows 服务。
- 不改变本地 sherpa-onnx ASR 架构。
- 不把 ASR 模型权重打进 EXE。
- 不增加新的模型协议；仍只支持 OpenAI Compatible 与 Anthropic Compatible。
- 不向 renderer 暴露 API Key、供应商原始错误或截图 Base64。

## 架构

```text
React renderer
    |
    | allowlisted IPC
    v
Electron main process
    |
    +-- BackendService
    |     +-- ChatService / ConversationStore
    |     +-- ModelConnectionStore
    |     +-- ModelDiagnostics
    |     +-- VisionChallenge
    |     `-- ProviderCache
    |             +-- OpenAIProvider
    |             `-- AnthropicProvider
    |
    `-- HTTPS requests to the user-selected model provider
```

建议代码边界：

```text
desktop/src/backend/
├── backend-service.ts
├── chat-service.ts
├── conversation-store.ts
├── chat-images.ts
├── model-profiles.ts
├── model-diagnostics.ts
├── sensitive-data.ts
├── vision-challenge.ts
└── providers/
    ├── provider.ts
    ├── provider-cache.ts
    ├── openai-provider.ts
    └── anthropic-provider.ts
```

`desktop/src/main/main.ts` 只负责 Electron 生命周期、调用后端服务和转发 IPC 事件。模型协议、对话状态和供应商错误处理不直接堆叠在 `main.ts` 中。

## 核心接口

`BackendService` 是 Electron 主进程使用的唯一后端入口，提供以下职责：

- `listModelOptions()`：返回固定、脱敏的两种协议选项。
- `streamChat(request, sink)`：流式产生 `chunk`、`error` 和 `done` 事件。
- `testModel(selection, progress)`：执行连通性和图片能力测试。
- `resetConversation()`：清空主进程中的对话上下文。
- `cancel(requestId)`：取消指定聊天或测试请求。
- `dispose()`：停止接受新工作、取消全部活跃请求并释放 Provider 客户端。

Renderer 与 preload 的公开契约保持最小化。现有聊天事件 DTO 和模型测试进度 DTO 尽量保持不变，避免不必要的 UI 重构。

## 数据流

### 应用启动

1. Electron 获得单实例锁并进入 `app.whenReady()`。
2. 初始化 `ModelConnectionStore` 和 `BackendService`。
3. 创建窗口并注册 IPC。
4. 后端初始化不访问模型网络，也不自动下载 ASR 模型。
5. 缺少模型配置不会阻止应用启动；只有相关操作返回可读错误。

### 聊天

1. Renderer 通过 preload 发送 `requestId`、文本和可选模型选择。
2. 主进程验证发送者、请求 ID、文本和模型字段。
3. `BackendService` 合并已加密保存的连接信息，解析为内部模型配置。
4. `ChatService` 在串行会话锁内构建上下文并选择 Provider。
5. Provider SDK 将增量文本传回主进程；主进程按现有 IPC 事件推送给 renderer。
6. 仅在流正常完成且产生有效内容时写入 assistant 历史。
7. 取消或失败请求不得留下不完整的 assistant 历史。

### Assist 截图

截图仍由 Electron 主进程捕获并只保存在内存。后端模块校验 PNG 输入并按所选协议组装图片消息。截图数据不落盘、不进入日志、不传给非目标 renderer，也不成为长期脱敏秘密集合的一部分。

### 清空聊天

现有 `clear-chat` 命令除清理 renderer 状态外，还调用 `BackendService.resetConversation()`。这样 UI 与真正发送给模型的上下文保持一致。

### 模型测试

模型测试使用短输出、零温度，并发送内存中的数字图片挑战。挑战图片由纯 JavaScript 实现生成 PNG，避免 Python Pillow 和额外 Python 资源。测试结果只返回固定的成功字段或经过分类的诊断码。

## Provider 实现

OpenAI 与 Anthropic Provider 使用固定版本的生产依赖，并在主进程中运行。两者实现统一的异步流接口：

```ts
interface LlmProvider {
    streamText(messages: ChatMessage[], signal: AbortSignal): AsyncIterable<string>;
    dispose(): Promise<void>;
}
```

OpenAI Provider 生成 Chat Completions 兼容消息；Anthropic Provider 将 system 消息与 conversation 消息分开。图片分别编码为 data URL 和 Anthropic base64 source。Provider 缓存设置固定上限，并按最近使用顺序淘汰和释放连接。

## 配置与安全

- 继续使用现有 `ModelConnectionStore` 和 Electron `safeStorage` 保存 API Key。
- renderer 只获取 `hasApiKey` 等脱敏摘要。
- Base URL 继续执行协议、凭据、查询串、fragment 和本地网络限制校验。
- 任何 Provider 错误在发送给 renderer 前必须分类和脱敏。
- 日志不得包含 API Key、Authorization、完整 Base URL 查询信息、截图数据或第三方响应正文。
- IPC 处理器继续验证调用方属于 Meeting-Monster 的 overlay 或 settings 窗口。

## 取消、退出与失败处理

- 每个活跃请求拥有独立 `AbortController`。
- 相同 `requestId` 不允许覆盖已有请求。
- Renderer 关闭或用户取消时立即中止对应请求。
- `before-quit` 首先阻止新请求，然后取消全部活跃请求并调用 `BackendService.dispose()`。
- Provider 的释放设置有限等待时间；释放失败只记录脱敏诊断，不阻止 Electron 最终退出。
- 因为没有子进程或本地服务器，正常退出和强制终止都不会留下独立后端进程。

## 打包与仓库清理

- 将运行时 SDK 和纯 JavaScript 图片编码依赖加入 `desktop/package.json` 的 `dependencies`。
- TypeScript 后端由现有 `build:main` 编译到 `desktop/dist/backend/`。
- electron-builder 随应用打包编译结果与生产依赖。
- 包审计继续拒绝 Python、`.py`、`.pyc`、虚拟环境、测试、文档和模型权重进入发布产物。
- 迁移完成且行为测试通过后，删除 `server/`、`server/requirements.txt`、`requirements-dev.txt` 和 `start.bat`。
- 更新 README，说明 EXE 内置后端能力，不再要求 Python 或端口 9000。
- 更新原先断言“Electron 不包含后端”的布局和打包测试，使其断言新的内置 TypeScript 后端边界。

## 测试策略

迁移采用测试驱动方式，每项生产行为先建立失败测试：

1. 模型配置规范化、校验和加密存储。
2. OpenAI 与 Anthropic 文本、图片消息序列化。
3. 两种协议的流式 chunk、结束、取消和 HTTP 错误。
4. 会话历史只在成功响应后提交，清空聊天同步清除后端上下文。
5. Provider 缓存上限、淘汰与释放。
6. 图片挑战生成、严格答案解析和能力验证。
7. 错误分类以及 API Key、Base URL、模型名和截图数据脱敏。
8. IPC 授权、重复 request ID、取消和退出清理。
9. 打包配置不包含 Python，并包含后端编译产物和运行时依赖。

最终验证包含桌面单元测试、Node 桌面测试、TypeScript 类型检查、生产构建、安装版与便携版构建，以及两个产物的包审计。人工冒烟验证包括启动即聊天、流式取消、Assist、清空聊天和退出后确认无 Meeting-Monster 后端残留进程。

## 完成标准

- 干净 Windows 环境无需 Python 即可启动安装版和便携版。
- 启动应用后无需其他操作即可访问所有后端能力。
- OpenAI Compatible 与 Anthropic Compatible 的文本和图片流式行为与迁移前一致。
- 清空聊天同步清除后端上下文。
- 关闭应用后没有独立后端进程、监听端口或继续执行的请求。
- 所有迁移后的测试、类型检查、构建和包审计通过。
- 发布产物不包含 Python 解释器、Python 源码、虚拟环境或模型权重。
