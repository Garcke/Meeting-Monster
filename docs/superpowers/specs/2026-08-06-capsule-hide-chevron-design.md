# Meeting-Monster 胶囊 Hide 箭头设计

日期：2026-08-06

## 目标

优化悬浮胶囊的展开按钮状态表达：关闭状态保持 `Chat`，展开状态把“收起”改为 `Hide`，并使用参考图中的左侧细线下箭头，替换当前文字右侧的字符箭头。

## 状态设计

- 胶囊关闭时：按钮只显示 `Chat`，不显示箭头。
- 会话面板展开时：按钮显示“左侧下箭头 + `Hide`”。
- 点击逻辑仍发送 `overlay.intent({type: 'toggle-workspace'})`。
- `aria-expanded` 继续准确反映面板状态；箭头使用 `aria-hidden="true"`。

## 箭头视觉

- 使用内联 SVG，不使用 Unicode `⌄`、字体图标或新依赖。
- SVG 视口为 `0 0 14 14`，实际显示为 `14 × 14px`。
- 路径为向下的折线，使用 `currentColor`、`fill="none"`、`stroke-width="1.5"`、`stroke-linecap="round"`、`stroke-linejoin="round"`。
- 箭头位于 `Hide` 左侧，与文字间距为 `7px`。
- 箭头与文字垂直居中；按钮保持胶囊形状、30px 高度和现有 hover/focus 行为。

建议 SVG：

```tsx
<svg className="capsule-chevron" viewBox="0 0 14 14" aria-hidden="true">
    <path d="M3.5 5.25 7 8.75l3.5-3.5" />
</svg>
```

## 代码边界

- `desktop/ui/capsule/CapsuleApp.tsx`：按 `snapshot.target` 条件渲染 `Chat` 或 SVG + `Hide`。
- `desktop/ui/capsule/capsule.css`：设置展开态按钮间距、SVG 尺寸与 stroke 样式。
- 不修改 overlay 几何、窗口 shape、ASR、IPC、preload、设置页、版本或依赖。

## 测试

- 初始关闭状态存在名为 `Chat` 的按钮，且不存在 `Hide` 箭头。
- 点击 `Chat` 后按钮名称变为 `Hide`，`aria-expanded="true"`，并渲染 `.capsule-chevron`。
- 再次切换回关闭状态后恢复 `Chat`，箭头消失。
- 静态契约确保不存在 Unicode `⌄`，并锁定 SVG 的路径、视口和圆角 stroke 属性。
- 运行 capsule focused tests、unit-test、typecheck、build 和 desktop-test。

## 不在范围

- 不重新调整胶囊尺寸、透明度、头像、退出按钮或面板布局。
- 不重新构建设置页视觉。
