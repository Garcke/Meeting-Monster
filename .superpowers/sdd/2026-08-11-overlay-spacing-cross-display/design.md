# 悬浮胶囊按钮间距与跨显示器裁剪修复规格

日期：2026-08-11

## 背景

当前悬浮胶囊存在两个可复现问题：

1. `Chat` 前的爪子图标、`Hide` 前的下拉箭头仍与文字过近。虽然按钮样式已经把 `gap` 从 7px 增加到 14px，但视觉间距基本没有变化。
2. 将胶囊拖到另一个扩展显示器后，胶囊左侧或右侧会持续被裁掉；点击 `Chat` 或 `Hide` 后内容恢复。返回原显示器时也可能再次出现。

## 根因

### 按钮间距

Ant Design Button 会把当前 React Fragment 包装成内部 `span`。现有 `gap` 设置在 `.capsule-button.ant-btn` 上，实际作用于 Ant Design 的内部包装层，而不是包装层内部的“SVG 图标 + 文本”，所以数值变化没有真正改变图标与文字之间的距离。

### 跨显示器裁剪

悬浮胶囊和展开面板共用一个固定大小的透明 BrowserWindow，并使用 Electron 的实验性 `BrowserWindow.setShape()` 只显示胶囊或胶囊加面板区域。当前代码只在初始化和 Chat/Hide 状态切换时应用 shape；原生窗口跨显示器移动结束后不会重新应用。

Windows 在不同显示器坐标或 DPI 缩放上下文之间移动透明异形窗口时，原生裁剪区域可能失效或部分错位。点击 Chat/Hide 会再次调用 `setShape()`，这与“点击后恢复”的现象一致。

## 目标

- Chat 和 Hide 按钮中的图标与文字具有稳定、清晰的实际间距。
- 胶囊跨显示器拖动结束后完整显示，不持续裁掉任一侧内容。
- 胶囊保持在用户松手的位置。
- 点击 Chat/Hide 只切换内容状态，不改变窗口坐标。
- 保持当前单 BrowserWindow、固定原生窗口尺寸和 shape 裁剪架构。

## 非目标

- 不拆分为胶囊窗口和聊天面板窗口。
- 不重做胶囊整体尺寸、状态区域、退出按钮或菜单视觉。
- 不更改键盘移动行为、聊天状态机或隐私保护逻辑。
- 不引入显示器位置持久化。

## 设计

### 1. 使用应用自有的按钮内容容器

在 Chat 和 Hide 两种分支中统一增加 `.capsule-button-content` 容器。容器直接包裹 SVG 与文字，并使用 `inline-flex`、垂直居中和 `12px` 的实际 `gap`。

按钮本身继续由 Ant Design Button 提供交互、焦点和语义；现有 76px 宽度保持不变。间距不再依赖 Ant Design 的内部 DOM 结构或内部类名，后续升级 Ant Design 时不会因包装层变化再次失效。

### 2. 拖动完成后重新同步原生 shape

OverlayWindowController 保留现有 `move` 监听，用它持续更新胶囊 anchor。新增 `moved` 监听，用于 Windows 原生拖动完成后的稳定同步点。验收以“松手后立即恢复完整显示”为准，不要求拖动过程中的每一帧都重放 shape。

`moved` 发生时：

1. 读取 BrowserWindow 当前 bounds，并更新 anchor。
2. 根据当前 `panelVisible` 状态重新生成 shape：
   - 收起：仅 `CAPSULE_SHAPE`；
   - 展开：`CAPSULE_SHAPE + PANEL_SHAPE`。
3. 再次调用 `setShape()`。

该流程不调用 `setBounds()`，因此不会移动、缩放或吸附窗口，也不会形成新的 move 事件循环。Chat/Hide 仍只改变 shape 内容，不恢复旧 anchor。

### 3. 生命周期清理

窗口销毁或控制器 dispose 时同时移除 `move`、`moved` 和 `closed` 监听，避免控制器销毁后仍刷新 shape。

## 状态与数据流

```text
用户跨屏拖动
  -> move: 更新当前 anchor
  -> moved: 再次读取最终 bounds
  -> 按 panelVisible 生成当前 shape
  -> setShape(currentShape)
  -> 胶囊在松手位置完整显示

用户点击 Chat/Hide
  -> Overlay 状态机更新
  -> setShape(nextShape)
  -> 原生 bounds 不变
```

## 测试策略

### 按钮结构与样式

- 先添加失败测试，要求 Chat/Hide 共享应用自有 `.capsule-button-content`。
- 验证该容器使用 `inline-flex`、居中和 12px gap。
- 验证不再依赖按钮根节点 gap 来控制图标文字间距。

### OverlayWindowController

- 先添加失败测试，模拟窗口从一个显示器坐标移动到另一个坐标后触发 `moved`。
- 验证收起状态重新应用且只应用胶囊 shape。
- 验证展开状态重新应用胶囊加面板 shape。
- 验证 `moved` 前后 BrowserWindow bounds 完全不变，且没有额外 `setBounds()` 调用。
- 验证随后 Chat/Hide 切换不会恢复移动前坐标。
- 验证 dispose 后移除 `moved` 监听且不再刷新 shape。

### 回归验证

- 悬浮胶囊相关聚焦测试。
- Overlay controller 和交互测试。
- TypeScript 类型检查。
- 全量桌面单元测试。
- Electron 构建、Windows 安装版与便携版打包、ASAR 审计。
- 可运行环境中进行主显示器与扩展显示器之间的手动拖动验证。

## 验收标准

- 爪子/Chat、箭头/Hide 的实际可见间距均为 12px。
- 跨屏拖动松手后胶囊左右内容均完整可见。
- 跨屏前后窗口的最终坐标只由用户拖动决定。
- 点击 Chat/Hide 不改变最终窗口坐标。
- 收起与展开 shape 均能在跨屏后正确恢复。
- 所有新增回归、类型检查、单元测试、构建与包审计通过；环境限制导致的既有跳过或 ENOENT 必须单独记录。

## 风险与缓解

- `setShape()` 是 Electron 实验性 API：把刷新限制在一次 `moved` 稳定事件，避免在拖动过程中高频调用。
- 不同显示器缩放组合难以在纯单元测试中真实模拟：以控制器事件测试证明坐标不变和 shape 重放，再用实际 Windows 多屏手测补充。
- Ant Design 内部结构可能继续变化：使用应用自有内容容器，测试只约束项目拥有的类名和行为。
