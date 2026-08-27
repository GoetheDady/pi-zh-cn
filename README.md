# pi-zh-cn

pi（[@earendil-works/pi-coding-agent](https://github.com/earendil-works/pi)）简体中文 TUI 界面汉化插件。
纯扩展 API 实现，不 patch 源码、不侵入安装；正常情况下可随 pi 升级保持兼容。

## 汉化范围

| 界面元素                                    | 方式                                                                                                   |
| ------------------------------------------- | ------------------------------------------------------------------------------------------------------ |
| 启动 header（标题 + 快捷键提示行 + 引导语） | `ctx.ui.setHeader()`，快捷键跟随用户键位配置                                                           |
| 流式加载提示（默认 "Working..."）           | `ctx.ui.setWorkingMessage()` → 「正在处理…」                                                           |
| thinking 折叠块标签                         | `ctx.ui.setHiddenThinkingLabel()` → 「思考过程已折叠」                                                 |
| 底部状态栏                                  | `ctx.ui.setFooter()` 中文重建：目录/分支/会话名、token/缓存/费用/上下文用量、模型/思考等级、扩展状态行 |
| read 工具渲染                               | 同名重注册，标签「读取」+ 中文状态文案                                                                 |
| bash 工具渲染                               | 同名重注册，标签「执行」+「完成 / 退出码 N / 输出过长已截断」                                          |
| edit 工具渲染                               | 同名重注册，标签「编辑」+「已修改 / +N / -N」                                                          |
| write 工具渲染                              | 同名重注册，标签「写入」+「已写入」                                                                    |
| grep 工具渲染                               | 同名重注册，标签「搜索内容」+ 中文搜索结果状态                                                         |
| find 工具渲染                               | 同名重注册，标签「查找文件」+ 中文查找结果状态                                                         |
| ls 工具渲染                                 | 同名重注册，标签「列出目录」+ 中文目录状态                                                             |
| PowerShell 工具渲染                         | 同名重注册，标签「执行 PowerShell」+ 中文执行状态                                                      |

**明确不改**：工具 description（发给模型的内容保持英文，避免影响模型行为）、
内置菜单及其他核心 chrome（扩展 API 覆盖不到，见下方“已知边界”）。

运行时可用 `/footer` 在中文 footer 和 built-in footer 之间切换，方便核对统计数据。

插件只替换 pi 已提供工具的渲染，不改变原有 active 工具集合；`grep`、`find`、`ls` 或 `powershell` 未启用时，不会因安装本插件而自动启用。

## 安装

```bash
# 本地路径安装（路径引用，不复制文件）
pi install /path/to/pi-zh

# 或发布 npm 后
pi install npm:pi-zh-cn

# 查看已安装包（remove 时使用这里显示的 source）
pi list
```

## 已知边界

- pi 无内置 i18n，内置菜单、`esc to …` 提示行等硬编码英文文案无法通过扩展 API 修改。
  若需彻底汉化，需要 fork 上游或 patch `dist/bundle`（维护成本高，本插件不做）。

## 开发

```bash
npm install          # 安装 devDependencies（含 peer 自动安装）
./node_modules/.bin/tsc -p .   # 类型检查

# 本地试跑
pi --no-session -e ./extensions/index.ts -p "hi"
```

文案集中在 [`extensions/i18n.ts`](extensions/i18n.ts)，改词只需动这一个文件。
