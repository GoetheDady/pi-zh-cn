# Changelog

## 0.2.5（2026-09-10）

- 修复窄终端下 header 触发 pi 超宽崩溃检查：logo、快捷键行、展开提示、引导语四行按终端宽度截断（`truncateToWidth`）

## 0.2.4（2026-09-09）

- 修复 `edit` 折叠态看不到改动内容：不再覆盖 `renderResult`，回落内置 diff 渲染器（行号 + 红绿 +/- + 词级高亮）；中文标题保留在 `renderCall`
- `write` 折叠态补上文件内容预览（语法高亮 10 行 + 中文展开提示），展开态显示全量；只高亮预览到的行，大文件不跑全量高亮
- 新增两例渲染回归测试：`edit` 折叠态必含 diff 行、`write` 预览行数与展开提示

## 0.2.2（2026-08-31）

- 添加 MIT License（与上游 pi 一致），package.json 补充 `license` 字段
- 规范化 README：徽章、特性提炼、安装/卸载/临时切英文分节、已知局限与升级核对项独立成章
- package.json 补充 `repository` 字段
- 无功能性改动，不涉及文案更新

## 0.2.1（2026-08-31）

- 信任弹窗补齐「信任父文件夹」选项：直接按内置语义写 trust.json（父目录 = 信任、清除本目录记录），返回值不带 `remember` 让 core 不再写本目录
- 信任弹窗标题补全内置说明（加载 .pi 配置与资源、安装项目缺失的包、执行项目扩展）

## 0.1.0（2026-08-25）

- 首发：简体中文 TUI 汉化插件
- 覆盖启动 header、底部状态栏、流式加载提示、thinking 折叠标签，以及 read/bash/edit/write/grep/find/ls/powershell 八个内置工具的渲染文案
- 不改动发给模型的内容（工具 description 保持英文）

## 0.1.1（2026-08-27）

- 锁定 `typescript@^5.9.3`（原生版 TS7 目前无法编译本仓库）
- 中文 header 对齐 pi 0.84.x 内置结构：compact 快捷键行新增「更多」项（跟随用户键位），新增展开提示行

## 0.2.0（2026-08-27）

- 项目信任弹窗中文化：`project_trust` handler 用中文 select 替代内置英文界面；已保存决定或无 UI 模式交回默认流程，不额外弹窗（不支持「信任父文件夹」变体）
- 内置斜杠命令描述中文化：包一层自动补全 provider，仅替换命令项 description；覆盖 core 全部 23 个内置命令
- 工具渲染去重：bash/powershell、grep/find/ls 结果渲染分别共用一个实现，抽取公共渲染小工具（净减约 160 行）

## 维护约定

pi 升级后需核对（对比 `node_modules/@earendil-works/pi-coding-agent/dist/modes/interactive/`）：

- 内置 header 的 compact 行结构是否有新增提示项
- footer 统计行顺序与订阅判断逻辑
- 工具 details 字段（truncation、matchLimit 等）是否变化
- `ToolExecutionComponent` 的渲染器回落逻辑（`dist/modes/interactive/components/tool-execution.js`：插件 `renderResult ??` 内置 `renderResult`）——汉化只覆盖 `renderCall` 就是靠它拿到内置 diff / 内容预览
- trust.json 读写语义与格式（`dist/core/trust-manager.js`：realpath 键、null = 删键、键排序、2 空格缩进、结尾换行）
