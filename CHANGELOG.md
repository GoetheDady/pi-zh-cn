# Changelog

## 0.1.0（2026-08-25）

- 首发：简体中文 TUI 汉化插件
- 覆盖启动 header、底部状态栏、流式加载提示、thinking 折叠标签，以及 read/bash/edit/write/grep/find/ls/powershell 八个内置工具的渲染文案
- 不改动发给模型的内容（工具 description 保持英文）

## 0.1.1（2026-08-27）

- 锁定 `typescript@^5.9.3`（原生版 TS7 目前无法编译本仓库）
- 中文 header 对齐 pi 0.84.x 内置结构：compact 快捷键行新增「更多」项（跟随用户键位），新增展开提示行

## 维护约定

pi 升级后需核对（对比 `node_modules/@earendil-works/pi-coding-agent/dist/modes/interactive/`）：

- 内置 header 的 compact 行结构是否有新增提示项
- footer 统计行顺序与订阅判断逻辑
- 工具 details 字段（truncation、matchLimit 等）是否变化
