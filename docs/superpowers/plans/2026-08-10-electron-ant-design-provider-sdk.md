# Electron 官方 SDK 与 Ant Design 迁移实施计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (- [ ]) syntax for tracking.

**Goal:** 使用官方 OpenAI/Anthropic TypeScript SDK 修复兼容服务请求路径，并将 Electron 设置、工作区和悬浮胶囊中的通用交互组件统一迁移到 Ant Design，同时把 Windows 新用户的音频默认值改为系统音频加麦克风。

**Architecture:** 保留现有 Provider、BackendService、IPC 和 React 业务状态边界；两个 Provider 内部改为官方 SDK client，并将 SDK 的异步流适配成现有文本流。新增共享 Ant Design ConfigProvider 主题入口，设置窗口、工作区和胶囊分别包裹主题；窗口布局、拖拽区、透明外壳、Markdown 和聊天业务状态继续由现有 CSS/React 结构负责。

**Tech Stack:** Electron 37、TypeScript 5.9、React 19、Vite 8、Vitest 4、openai、@anthropic-ai/sdk、antd、@ant-design/icons、Electron Builder。

## Global Constraints

- Anthropic Base URL 必须兼容 https://api.minimaxi.com/anthropic，最终请求必须是 /anthropic/v1/messages，不能缺少或重复 /v1。
- 生产 Provider 只能通过官方 openai 和 @anthropic-ai/sdk 发送模型请求，不保留手写 SSE/HTTP 回退。
- Windows 无有效保存偏好时默认 mixed；macOS/Linux/未知平台默认 microphone；有效已保存偏好不可被覆盖。
- “全部 UI 使用 Ant Design”指通用交互原语；透明窗口外壳、拖拽区域、聊天 Markdown 和业务布局继续使用现有定制实现。
- API Key 只在主进程安全存储和 Provider 内使用，不能进入 Renderer 快照、日志或错误文案。
- 每个任务必须先更新/新增回归测试，再实现最小改动，并运行 focused tests；每个任务独立提交。
- 不使用 git add -A；现有未跟踪 node_modules 不得加入提交。
- 构建前清理 desktop/dist；最终必须运行 typecheck、unit-test、build、ASAR audit 和可用的 Windows smoke test。

---

## 文件地图

| 文件 | 职责 | 变化 |
|---|---|---|
| desktop/src/backend/providers/openai-provider.ts | OpenAI SDK 适配 | 用 OpenAI client 替换 raw fetch/SSE |
| desktop/src/backend/providers/anthropic-provider.ts | Anthropic SDK 适配 | 用 Anthropic client 替换 raw fetch/SSE，并规范化 Base URL |
| desktop/src/backend/sse.ts | 旧手写 SSE 解析 | 删除 |
| tests/desktop/backend/providers.test.ts | Provider HTTP 边界回归 | 验证 SDK URL、headers、body、stream、abort、错误 |
| tests/desktop/backend/provider-sdk-usage.test.ts | 官方 SDK 使用守卫 | mock 两个 SDK，确认 Provider 通过 SDK client 发起 stream |
| tests/desktop/backend/sse-and-diagnostics.test.ts | SSE 与诊断测试 | 删除 SSE 段，只保留诊断或改名 |
| desktop/src/shared/audio-input-mode.ts | 音频模式规范化 | Windows fallback 改为 mixed |
| desktop/src/main/audio-input-settings.ts | 音频持久化 | 使用新平台 fallback |
| tests/desktop/test_audio_input_settings.mjs | 音频回归 | 更新 Windows 默认和已保存值 |
| desktop/ui/shared/antd-theme.tsx | 共享主题 | 新建浅色设置和透明深色浮层 token |
| desktop/ui/settings/* | 设置窗口 | Select/Input/InputNumber/Button/Alert/Spin/Progress |
| desktop/ui/panel/* | 工作区 | Dropdown/Menu/Switch/Button/Input/Tooltip/Alert/Spin |
| desktop/ui/capsule/*、desktop/ui/overlay/main.tsx | 悬浮胶囊 | Button/Tooltip/Badge，保留外壳动画 |
| tests/desktop/settings_renderer.test.tsx | 设置页回归 | 按 role/label 测试 |
| tests/desktop/react_overlay.test.tsx、tests/desktop/react_services.test.ts | 工作区/录音回归 | 保持菜单、快捷键、音频行为 |
| tests/desktop/test_project_layout.mjs、test_packaging_config.mjs | 守卫 | 检查依赖、旧残留和构建 |

---

## Task 1: 官方 Provider SDK 迁移

**Files:** desktop/package.json、desktop/package-lock.json；两个 Provider；desktop/src/backend/sse.ts；tests/desktop/backend/providers.test.ts；tests/desktop/backend/provider-sdk-usage.test.ts；tests/desktop/backend/sse-and-diagnostics.test.ts。

**Interfaces:** 输入现有 BackendModelSelection、BackendChatRequest、BackendFetch、Provider；输出仍是 AsyncIterable<string>，错误带 status/providerStatus，dispose 幂等。

- [ ] **Step 1: 安装依赖**

~~~powershell
npm view openai version
npm view @anthropic-ai/sdk version
npm view antd version
npm view @ant-design/icons version
npm install openai @anthropic-ai/sdk antd @ant-design/icons --save-exact
~~~

四个包写入 dependencies，package-lock 只包含安装产生的变化。

- [ ] **Step 2: 写官方 SDK 使用守卫和 HTTP 回归**

新建 provider-sdk-usage.test.ts，用 Vitest mock 官方模块的 client constructor 和 stream 方法；测试在没有调用 SDK client 时失败，从而确保旧 raw fetch 实现不能通过。保留 providers.test.ts 的 HTTP 边界测试并增加：

在 providers.test.ts 保留现有文本、图像、错误测试，并增加：

~~~ts
expect(capturedUrl).toBe('https://provider.example/anthropic/v1/messages');
expect(capturedUrl).not.toContain('/v1/v1/');
await expect(collect(provider.stream(request, signal))).resolves.toEqual(['hello', ' world']);
await expect(collect(provider.stream(request, abortedSignal))).rejects.toMatchObject({name: expect.stringMatching(/Abort|Canceled/)});
~~~

fake fetch 返回最小合法 OpenAI/Anthropic SSE；SDK usage 测试观察 constructor/stream 调用，HTTP 测试观察请求和 Provider 输出，不测试 parser 内部实现。

- [ ] **Step 3: 运行 RED**

~~~powershell
npm --prefix desktop exec vitest run --root .. --config desktop/vitest.config.ts tests/desktop/backend/provider-sdk-usage.test.ts tests/desktop/backend/providers.test.ts
~~~

Expected：旧实现至少在 Anthropic 版本路径或 SDK stream 行为断言上失败。

- [ ] **Step 4: 替换 OpenAI Provider**

使用官方 client 和 custom fetch：

~~~ts
const client = new OpenAI({apiKey: selection.api_key || 'unused', baseURL: selection.base_url, fetch: fetcher});
const stream = await client.chat.completions.create(
  {model: selection.model, messages: sdkMessages, max_tokens: selection.max_tokens, temperature: selection.temperature, stream: true},
  {signal},
);
for await (const chunk of stream) {
  const text = chunk.choices[0]?.delta?.content;
  if (text) yield text;
}
~~~

保留图片 data URL 转换，使用 SDK 类型；SDK 错误交给上层分类器。

- [ ] **Step 5: 替换 Anthropic Provider**

创建 client 前去除末尾斜杠和可选的末尾 /v1，使用官方 Messages stream API，并传入 AbortSignal：

~~~ts
const normalizedBaseUrl = selection.base_url.replace(/\/+$/, '').replace(/\/v1$/i, '');
const client = new Anthropic({apiKey: selection.api_key || 'unused', baseURL: normalizedBaseUrl, fetch: fetcher});
const stream = client.messages.stream({model: selection.model, max_tokens: selection.max_tokens, temperature: selection.temperature, system, messages}, {signal});
for await (const text of stream.textStream) {
  if (text) yield text;
}
~~~

如当前 SDK 类型要求 messages.create({stream: true})，对 content_block_delta 的 text_delta 做同等适配；不能恢复项目 SSE parser。fake fetch 必须观察到 /anthropic/v1/messages。

- [ ] **Step 6: 删除 parser 并保留诊断测试**

删除 desktop/src/backend/sse.ts；移除 sse-and-diagnostics.test.ts 的 parser import、pending stream、malformed event 测试；保留 diagnostics 测试，必要时改名为 model-diagnostics.test.ts 并同步 package.json glob。

- [ ] **Step 7: GREEN、typecheck、提交**

~~~powershell
npm --prefix desktop exec vitest run --root .. --config desktop/vitest.config.ts tests/desktop/backend/provider-sdk-usage.test.ts tests/desktop/backend/providers.test.ts tests/desktop/backend/chat-service.test.ts tests/desktop/backend/model-diagnostics.test.ts
npm --prefix desktop run typecheck
git diff --check
git add desktop/package.json desktop/package-lock.json desktop/src/backend/providers/openai-provider.ts desktop/src/backend/providers/anthropic-provider.ts desktop/src/backend/providers/provider.ts desktop/src/backend/sse.ts tests/desktop/backend/providers.test.ts tests/desktop/backend/provider-sdk-usage.test.ts tests/desktop/backend/sse-and-diagnostics.test.ts
git commit -m "fix: use official model provider SDKs"
~~~

Expected：focused backend 全绿，TypeScript 通过，desktop/src 无 sse/parser 生产引用。

---

## Task 2: Windows 混合音频默认值

**Files:** desktop/src/shared/audio-input-mode.ts；desktop/src/main/audio-input-settings.ts（仅必要时）；desktop/ui/settings/SpeechSettingsPage.tsx；tests/desktop/test_audio_input_settings.mjs；tests/desktop/settings_renderer.test.tsx；tests/desktop/react_services.test.ts。

**Interfaces:** 保留 AudioInputMode 和 audioInput IPC；getDefaultAudioInputMode('win32') === 'mixed'。

- [ ] **Step 1: 更新失败测试**

~~~ts
expect(getDefaultAudioInputMode('win32')).toBe('mixed');
expect(getDefaultAudioInputMode('darwin')).toBe('microphone');
~~~

增加文件缺失/损坏回退 mixed 和保存 system 后仍为 system；保持非 Windows mixed 规范化为 microphone。

- [ ] **Step 2: 运行 RED**

~~~powershell
npm --prefix desktop run build:main
node --test tests/desktop/test_audio_input_settings.mjs
npm --prefix desktop exec vitest run --root .. --config desktop/vitest.config.ts tests/desktop/react_services.test.ts tests/desktop/settings_renderer.test.tsx
~~~

Expected：旧 Windows fallback 断言失败。

- [ ] **Step 3: 修改 fallback**

将 getDefaultAudioInputMode 的 Windows 返回值改为 mixed。Renderer 初始 state/ref 继续 microphone，仅在平台和 IPC 读取成功后显示 mixed，避免平台未解析时启动系统录音。

- [ ] **Step 4: GREEN、提交**

~~~powershell
npm --prefix desktop run build:main
node --test tests/desktop/test_audio_input_settings.mjs
npm --prefix desktop exec vitest run --root .. --config desktop/vitest.config.ts tests/desktop/react_services.test.ts tests/desktop/settings_renderer.test.tsx
git diff --check
git add desktop/src/shared/audio-input-mode.ts desktop/src/main/audio-input-settings.ts desktop/ui/settings/SpeechSettingsPage.tsx tests/desktop/test_audio_input_settings.mjs tests/desktop/react_services.test.ts tests/desktop/settings_renderer.test.tsx
git commit -m "fix: default Windows capture to mixed audio"
~~~

---

## Task 3: 共享 Ant Design 主题与设置窗口

**Files:** 新建 desktop/ui/shared/antd-theme.tsx；修改 desktop/ui/settings/main.tsx、SettingsApp.tsx、ModelSettingsPage.tsx、SpeechSettingsPage.tsx、settings.css、tests/desktop/settings_renderer.test.tsx；必要时修改 package.json/lock。

**Interfaces:** 输入 SettingsRendererApi 和现有 state/actions；输出 MeetingMonsterConfigProvider 及 AntD role/label settings UI，不改变 IPC payload。

- [ ] **Step 1: 写组件语义测试**

~~~tsx
expect(screen.getByRole('combobox', {name: '音频来源'})).toBeTruthy();
expect(screen.getByRole('button', {name: '测试连接'})).toBeTruthy();
expect(screen.getByRole('spinbutton', {name: '最大 Token'})).toBeTruthy();
~~~

增加键盘选择、非 Windows 禁用系统音频、保存回滚和 loading 按钮断言；不匹配 AntD 内部 class。

- [ ] **Step 2: 运行 RED**

~~~powershell
npm --prefix desktop exec vitest run --root .. --config desktop/vitest.config.ts tests/desktop/settings_renderer.test.tsx
~~~

Expected：原生控件不能满足新增 AntD 语义断言。

- [ ] **Step 3: 建立主题**

在 antd-theme.tsx 导出主题 Provider：

~~~tsx
export function MeetingMonsterConfigProvider({children, variant}: {children: React.ReactNode; variant: 'light' | 'overlay'}) {
  return <ConfigProvider locale={zhCN} theme={variant === 'light' ? lightTheme : overlayTheme}>{children}</ConfigProvider>;
}
~~~

设置窗口、panel、capsule 只传 variant，不复制 token。

- [ ] **Step 4: 迁移设置表单**

协议/音频/ASR select → Select；Base URL/Model/API Key → Input/Input.Password；数字字段 → InputNumber；操作 → Button；进度/错误/加载 → Progress/Alert/Spin。继续调用 selectProfile、changeAudioInputMode、save、test、selectAsr，不重写竞态逻辑。

- [ ] **Step 5: 迁移 SettingsApp**

关闭操作使用 Button，侧栏使用 Menu 或带 aria-current 的 Button；保留 titlebar drag region 和 no-drag CSS。

- [ ] **Step 6: 调整 CSS、GREEN、提交**

保留窗口 shell、滚动、卡片、拖拽区、响应式和 focus-visible；popup container 落在 settings BrowserWindow 内。

~~~powershell
npm --prefix desktop exec vitest run --root .. --config desktop/vitest.config.ts tests/desktop/settings_renderer.test.tsx
npm --prefix desktop run typecheck
git diff --check
git add desktop/ui/shared/antd-theme.tsx desktop/ui/settings tests/desktop/settings_renderer.test.tsx
git commit -m "feat: migrate settings controls to Ant Design"
~~~

---

## Task 4: 工作区和更多菜单

**Files:** desktop/ui/panel/main.tsx、WorkspaceMenu.tsx、WorkspaceView.tsx、panel.css、tests/desktop/react_overlay.test.tsx、tests/desktop/react_services.test.ts。

**Interfaces:** 输入 MeetingMonsterApi、workspace stores、menu callbacks 和 keyboard shortcuts；输出 AntD Dropdown/Menu/Switch/Button/Input/Tooltip/Alert/Spin 工作区。

- [ ] **Step 1: 写行为测试**

~~~tsx
fireEvent.click(screen.getByRole('button', {name: '更多'}));
expect(screen.getByRole('menu', {name: '工作区菜单'})).toBeTruthy();
expect(screen.getByRole('menuitem', {name: '清空聊天'})).toBeTruthy();
await user.type(screen.getByRole('textbox', {name: '输入问题'}), '测试问题');
expect(screen.getByRole('button', {name: '发送'})).toBeTruthy();
~~~

补充 Escape、转写 disabled、应用隐藏、设置入口和错误 Alert。

- [ ] **Step 2: 运行 RED**

~~~powershell
npm --prefix desktop exec vitest run --root .. --config desktop/vitest.config.ts tests/desktop/react_overlay.test.tsx
~~~

Expected：旧自定义 popover/按钮不能满足新增 AntD 语义测试。

- [ ] **Step 3: 迁移 WorkspaceMenu**

用 Dropdown + Menu 承载说明、实时转写、清空聊天、应用隐藏和设置；说明项 disabled；状态操作用 Switch/受控 menu item；保留 privacyActive、recording、privacyPending、transcriptionDisabled 和错误处理。设置 getPopupContainer 为当前 panel BrowserWindow 容器。

- [ ] **Step 4: 迁移 WorkspaceView**

使用 Input.TextArea/Input、Button、Tooltip、Spin、Alert，保留 cancelActiveRequest、sendText、assistWithScreenshot、问题选择和 requestPhase。

- [ ] **Step 5: 调整 CSS、GREEN、typecheck**

~~~powershell
npm --prefix desktop exec vitest run --root .. --config desktop/vitest.config.ts tests/desktop/react_overlay.test.tsx tests/desktop/react_services.test.ts
npm --prefix desktop run typecheck
~~~

- [ ] **Step 6: 提交**

~~~powershell
git diff --check
git add desktop/ui/panel tests/desktop/react_overlay.test.tsx tests/desktop/react_services.test.ts
git commit -m "feat: migrate workspace controls to Ant Design"
~~~

---

## Task 5: 悬浮胶囊

**Files:** desktop/ui/capsule/main.tsx、CapsuleApp.tsx、capsule.css、desktop/ui/overlay/main.tsx、tests/desktop/react_overlay.test.tsx、tests/desktop/test_floating_capsule.mjs。

**Interfaces:** 输入 OverlayState、状态文案、window.meetingMonster.window.quit 和 intent callback；输出 AntD Button/Tooltip/Badge 胶囊交互，整体尺寸、透明度、拖拽和状态动画不变。

- [ ] **Step 1: 写状态和键盘测试**

~~~tsx
expect(screen.getByRole('button', {name: '打开聊天'})).toBeTruthy();
expect(screen.getByRole('button', {name: '退出 Meeting-Monster'})).toBeTruthy();
fireEvent.click(screen.getByRole('button', {name: '打开聊天'}));
expect(window.meetingMonster.overlay.sendIntent).toHaveBeenCalled();
~~~

补充展开 Hide、录音/处理中/异常文案、退出按钮红色 focus-visible 和 shell fixed width。

- [ ] **Step 2: 运行 RED**

~~~powershell
npm --prefix desktop exec vitest run --root .. --config desktop/vitest.config.ts tests/desktop/react_overlay.test.tsx
~~~

- [ ] **Step 3: 迁移内部交互**

使用紧凑 Button、Tooltip、必要时 Badge，通过 className/token 保持 capsule-shell 尺寸和 -webkit-app-region 分区。头像、爪子 SVG、波形和退出 X 保留定制结构。

- [ ] **Step 4: GREEN/build/截图检查**

~~~powershell
npm --prefix desktop exec vitest run --root .. --config desktop/vitest.config.ts tests/desktop/react_overlay.test.tsx
npm --prefix desktop run build
~~~

检查收起/展开宽度一致、Chat/Hide、菜单边界、退出按钮位置和拖拽区；截图只保存到临时目录。

- [ ] **Step 5: 提交**

~~~powershell
git diff --check
git add desktop/ui/capsule desktop/ui/overlay tests/desktop/react_overlay.test.tsx tests/desktop/floating_capsule.test.mjs
git commit -m "feat: polish capsule controls with Ant Design"
~~~

---

## Task 6: 依赖、布局守卫和完整验证

**Files:** desktop/package.json、tests/desktop/test_project_layout.mjs、tests/desktop/test_packaging_config.mjs、tests/desktop/audit_packaged_artifact.mjs（必要时）、README.md（必要时）。

- [ ] **Step 1: 增加守卫**

~~~js
assert.match(packageJson.dependencies.openai, /.+/);
assert.match(packageJson.dependencies['@anthropic-ai/sdk'], /.+/);
assert.match(packageJson.dependencies.antd, /.+/);
assert.equal(await exists('desktop/src/backend/sse.ts'), false);
assert.equal(await exists('desktop/dist/backend/sse.js'), false);
~~~

保留 Python、旧 remote-api-client、旧 desktop-settings 和 localhost:9000 禁入断言。

- [ ] **Step 2: 运行 RED 并更新脚本**

~~~powershell
node --test tests/desktop/test_project_layout.mjs tests/desktop/test_packaging_config.mjs
~~~

Expected：新增守卫先失败。unit-test 脚本覆盖全部 tests/desktop/backend，build 继续先清理 dist。

- [ ] **Step 3: 全量验证**

~~~powershell
npm --prefix desktop run typecheck
npm --prefix desktop run unit-test
npm --prefix desktop run build
npm --prefix desktop run desktop-test
~~~

环境限制单独记录；Task 1–5 引入的失败必须修复。

- [ ] **Step 4: 打包和审计**

~~~powershell
npm --prefix desktop run dist:win:unsigned
npm --prefix desktop run audit:package
~~~

确认 ASAR 包含 backend-service.js、两个官方 SDK 和 AntD，不包含 sse.js、Python、旧 remote client、旧 desktop settings、模型权重或 .map。

- [ ] **Step 5: 打包后 smoke test**

运行 unpacked Electron：设置窗口音频初始为“系统音频 + 麦克风”；兼容服务测试请求路径正确；工作区菜单、胶囊按钮、下拉和 Tooltip 可操作；退出后无 Python 子进程、旧端口或残留进程。

- [ ] **Step 6: 最终审计与提交**

~~~powershell
git diff --check
git status --short
git diff HEAD --stat
git add desktop/package.json desktop/package-lock.json tests/desktop/test_project_layout.mjs tests/desktop/test_packaging_config.mjs tests/desktop/audit_packaged_artifact.mjs README.md
git commit -m "test: guard native SDK and Ant Design packaging"
~~~

只允许剩余原有未跟踪 node_modules，不得出现构建产物或临时截图。

---

## 验证结果记录格式

最终报告记录 Provider、audio/settings/workspace/capsule focused tests；typecheck、unit-test、build、desktop-test；NSIS/portable 路径、大小和 SHA-256；ASAR entry count；环境限制；以及确认 node_modules 未进入提交。
