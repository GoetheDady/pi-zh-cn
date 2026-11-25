# pi-zh-cn 上游跟进与优化点调研

> 调研时间：2026-11-25　基线：0.2.13 / pi 1.5.2　上游最新：pi 1.6.0（2026-11-20）

## 结论速览

- **现状健康**：`npm test` 65/65 全绿（对着 lockfile 的 1.5.2 基线）。
- **兼容性已实测**：手动把 `@earendil-works/pi-{coding-agent,ai,tui}` 装到 **1.6.0** 再跑 `npm test`，仍 **65/65 全绿**；跑完已 `npm ci` 还原到 1.5.2，仓库干净。→ **1.6.0 没有破坏本扩展**（含那条 Extensions breaking change）。
- **落后情况**：基线仍是 1.5.2，上游已发 1.6.0，落后 1 个 minor；Dependabot 未开升级 PR（属 README 已记录的已知问题）。

## 可跟进点（按优先级）

### P1　抬基线并发布 0.2.14（低风险，纯跟进）

1.6.0 已实测兼容。按 README 的「基线跟进」流程：
- `devDependencies` 三个 pi 包 `^1.5.2` → `^1.6.0`，`npm install` 重新生成 lockfile；
- `package.json` version `0.2.13` → `0.2.14`，按 RELEASING.md 推 tag 发布；
- 顺带核对 1.6.0 的 breaking change（`render()` 现返回 `readonly string[]`、`Container` 命中缓存返回同一数组、原地改渲染结果的扩展会坏）——本项目 header/footer 是自建组件、每次 `render()` 新建并返回数组，**不受影响**；测试也验证通过。

### P2　1.6.0 新增界面文案的汉化缺口（需人工判断可达性）

1.6.0 引入了几条新的用户可见文案，属于「可能漏汉化」的候选：

| 文案来源 | 现状 | 可达性 |
|---|---|---|
| `OpenAI dropped N reasoning items: …（details in session）`（压缩后丢弃推理项提示，`showCacheMissNotices` 打开时） | 未汉化 | 疑似在 chat 组件内，扩展 API 够不到，需确认 |
| `Operation aborted`（Esc 打断后未执行的工具补的结果） | 未汉化 | 在 `assistant-message.js` / `interactive-mode.js` 内，**扩展够不到** |
| `Response was truncated before completion.` 等错误态 | 未汉化 | 同上，够不到 |
| `Installing <source>...`（stderr，TUI 起来前） | 未汉化 | 写 stderr，非 TUI，够不到 |
| 退出时的 `To resume this session:` 独立成行 | 未汉化 | print 模式，非 TUI |

结论：多数属于 README「已知局限」那一类（硬编码在 pi 源码里，扩展 API 够不到），建议**核对后补进「已知局限」清单**，而不是硬做。真正能扩展覆盖的新文案若确认存在，再进 `zh.ts`。

### P3　footer 渲染的 O(n) 性能优化（真实收益）

`extensions/footer.ts` 的 `render()` 每次重绘都 `for (const e of ctx.sessionManager.getEntries())` 全量遍历会话条目重算 usage。长会话（上千条目）下，尤其配合 1.6.0 刚修的「全屏滚动重绘整棵 transcript」（#9549），每次滚轮都会触发 O(n) 重算，是潜在卡顿点。

- 上游内置 footer 用 `FooterDataProvider` + 订阅增量更新；本扩展复刻版是原始全量重算。
- 优化方向：缓存 usage 汇总，仅在条目变化（订阅 / 条目数变化）时增量更新，其余情况复用上次结果。
- 优先级：中。有真实长会话场景再做；属功能性优化，不紧急。

### 其它（可选）

- 无 lint/format 配置（无 eslint/prettier/biome），CI 只跑 `tsc + node --test`。是否加格式检查取决于维护意愿，非必需。
- 源码无 TODO/FIXME 残留。

## 建议下一步

先做 **P1（抬基线发 0.2.14）**——成本最低、已实测安全；P2 核对后补「已知局限」；P3 视长会话反馈再排期。

---
## 执行记录（2026-11-25，按用户「3 点都更新」落地）

- **P1 已完成**：`package.json` devDeps 三个 pi 包 `^1.5.2`→`^1.6.0`、version `0.2.13`→`0.2.14`，`npm install` 已重生成 lockfile；依赖已到 1.6.0。
- **P2 已完成**：核对 1.6.0 dist，新文案均在 chat 组件/stderr（`addCacheMissNotice`、assistant-message.js、interactive-mode.js、package-manager.js），扩展 API 够不到；已把这些补进 README「已知局限」。内置命令清单经测试比对仍全覆盖，无需加词条。
- **P3 已完成**：`extensions/footer.ts` 的 `render()` 改为 usage 增量缓存（除最后一条外聚合缓存、只重算最后一条），热路径 O(1)。
  - 复核后加固（测试A 发现）：①缓存键改为 `sessionId|leafId|条目数`，与上游 `getSessionStats` 一致，避免「切分支到等长路径」串味；②补上 `type:"usage"` 条目统计（1.6.0 cache-warmer 产生、`cacheWarming` 默认 `idle`，上游 footer 计入，原实现漏计）。
  - 回归测试：`usage 增量缓存正确（追加/流式增长/回退）`、`空会话不崩`、`type:"usage" 条目计入`、`切分支不串味`；契约测试加 `type:"usage"` 探针。
- 验证：`npm test` 在 1.6.0 上 **69/69 全绿**。

*本文件可保留作跟进记录，或删除。*
