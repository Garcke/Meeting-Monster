# 悬浮菜单主题 Token 与胶囊间距修复设计

## 目标

让工作区菜单在非悬停状态下也始终显示所有标签，并进一步拉开 Chat/Hide 与图标之间的视觉距离。

## 根因

Ant Design Dropdown 的运行时样式直接读取 `ConfigProvider` 的 `colorText`。悬浮层主题目前继承公共的深色文字 `#161B22`，但菜单背景已经改为 `#151B25`，两者几乎融为一体。自定义悬停规则把文字改成亮色，因此标签只在鼠标移入时可见。胶囊按钮使用 10px 间距和 70px 宽度，仍不足以形成清晰分隔。

## 设计

- 在 `overlayTheme` 中覆盖 Ant Design 语义 Token：`colorText`、`colorTextDescription`、`colorTextDisabled`、`colorBgElevated`、`controlItemBgHover`、`controlItemBgActive`。
- 保留设置页的浅色主题，不修改公共 Token。
- Chat/Hide 共用 `14px` 间距，按钮宽度和最小宽度调整为 `76px`，其余胶囊几何尺寸不变。
- 保留现有 Dropdown CSS 作为布局约束；颜色以主题 Token 为根因修复，避免依赖悬停或 `!important` 才可见。

## 验收

- 悬浮主题结构测试验证亮色文字、深色弹层、描述色、禁用色和交互背景 Token。
- 胶囊结构测试验证 `gap: 14px`、`width: 76px` 和 `min-width: 76px`。
- 聚焦测试、类型检查、完整单测、构建和 Windows 打包均通过。
