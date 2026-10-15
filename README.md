# pi-zh-cn

[![npm version](https://img.shields.io/npm/v/pi-zh-cn.svg)](https://www.npmjs.com/package/pi-zh-cn)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](LICENSE)

把 [pi](https://github.com/earendil-works/pi) 编码代理的界面变成简体中文。装上重启即可，不想要了随时卸载。

## 特性

- **零侵入**：只是普通扩展，调用官方扩展 API 替换文案，不打补丁、不改安装目录里的任何文件，pi 正常升级后一般也能直接用
- **不改模型输入**：发给模型的内容保持不变，工具 description 保留英文原文，避免影响模型行为
- **按需开启**：`grep`、`find`、`ls` 或 `powershell` 没开就不会被偷偷打开
- **键位跟随**：快捷键提示跟随你自己的键位配置
- **改词不改源码**：settings.json 里写 `pi-zh-cn.copy` 就能覆盖任意字符串词条，见[改词](#改词)

## 汉化范围

- 启动画面：标题、快捷键提示、引导语；按 `ctrl+o`（跟随你的键位）展开内置那张完整键位参考表
- 底部状态栏：当前目录 / 分支 / 会话名、token 与缓存用量、费用、上下文占比、模型和思考等级
- 加载提示：「正在处理…」；thinking 折叠块的标签
- 八个内置工具的执行结果：读取、执行（bash）、编辑、写入、搜索内容、查找文件、列出目录、PowerShell——状态行都是中文，比如「完成」「退出码 N」「耗时 1.2s」，长命令执行中显示「运行中… 已用 1.2s」并每秒刷新，输出被截断时给出「完整输出：<路径>」与「已显示 N / 共 M 行」
- 搜索内容 / 查找文件 / 列出目录：折叠态就显示结果行（grep 15 行、find/ls 20 行，与内置渲染器一致），超出时提示「还有 N 行」
- 工具行里的文件路径：家目录缩成 `~/…`；支持 OSC 8 的终端里可点击直接打开文件（终端不支持时自动退化为纯文本）
- 编辑、写入与读取的内容展示沿用 pi 内置渲染器（只有标题和展开提示是中文）：`edit` 显示行号 + 红绿 diff，`write` 预览文件内容（折叠 10 行，`ctrl+o` 展开全量），`read` 展开态保留内置的语法高亮
- 项目信任弹窗：信任/不信任选择，含「信任父文件夹」变体
- 内置斜杠命令描述：core 全部 24 个命令

## 安装

```bash
pi install npm:pi-zh-cn
```

重启 pi 即生效。查看已安装的包：

```bash
pi list
```

### 卸载

```bash
pi remove npm:pi-zh-cn
```

### 临时切回英文

觉得中文状态栏不如原生好读，可以在会话里执行：

```text
/footer
```

## 兼容性

`peerDependencies` 只设下限（`>=0.84.0`）不设上限，pi 出新版也不会被拦住。兼容性靠测试保证，不靠钉版本：

- push/PR：对着 lockfile 钉住的基线跑契约测试
- 每两天：上游金丝雀忽略 lockfile、拉最新版 pi 跑同一套测试
- 基线本身由 Dependabot 自动开 PR 跟进，它的 PR 就是一次新版兼容性验证，绿了合并即完成升级

Node 版本要求跟随 pi，由 pi 自己声明和检查。

## 改词

某处译法不合口味，不用改源码、也不用 fork——在 pi 的 `settings.json` 里写 `pi-zh-cn.copy`，结构与 [`extensions/zh.ts`](extensions/zh.ts) 一致，叶子写字符串：

```json
{
  "pi-zh-cn": {
    "copy": {
      "footer": { "cwdPrefix": "目录：" },
      "tools": { "bash": { "done": "跑完了" } }
    }
  }
}
```

- 全局设置在 `~/.pi/agent/settings.json`；项目本地那份（`.pi/settings.json`）在该项目受信任时优先生效，与内置设置同一套信任边界
- 只覆盖字符串条目。`zh.ts` 里有一部分是函数（要拼数字，例如「N 行输出」），JSON 表达不了，那些保持原样
- 键名拼错不会有反应——一条都没对上时会提示一次，免得你以为改完了其实没生效

## 已知局限

- 内置菜单和其他硬编码在 pi 源码里的英文保持原样——扩展 API 够不到，除非 fork 上游重编译，不值得
- 全屏模式（pi 1.0 起为默认，`tuiMode: "fullscreen"`）文案写死在 pi-tui 里，同样够不到，例如 `↓ Jump to latest message · <键位>`，以及搜索框的 `Find in transcript` / `No matches`
- `read` 折叠态对 `SKILL.md`、`AGENTS.md`/`CLAUDE.md` 以及 pi 自带文档的紧凑显示没有复刻（上游显示 `read skill <名字>`，不显示完整路径）：上游那套路径分类依赖包内未导出的助手，复刻要把 pi 自身的安装路径写死，而只在读这几类文件时才看得出差别，不值得
- `edit` 在结果返回前不显示行内 diff 预览（上游会在参数到齐后就先算出来展示）：预览依赖未导出的 `computeEditsDiff`，够不到；结果返回后的 diff 显示不受影响

## 开发

```bash
npm install
./node_modules/.bin/tsc -p .   # 类型检查

# 本地试跑
pi --no-session -e ./extensions/index.ts -p "hi"
```

所有文案都集中在 [`extensions/zh.ts`](extensions/zh.ts)，想改词只动这一个文件就够了。
只是不满意某几处译法、并不想接手维护的话，用[改词](#改词)那节的覆盖机制更省事——
升级插件不会冲掉你的改动。

### 上游兼容性测试（契约测试）

汉化依赖 pi 内部结构（footer 统计行、工具 details 字段、trust.json 语义、
斜杠命令清单等），上游一变就可能静默失效。`test/` 下的契约测试把这些
依赖点逐条断言：实际执行内置工具、实例化 `ProjectTrustStore`、探查内置
footer 的 dist 源码，任一结构变化都会失败并指明该核对哪个文案。

```bash
npm test   # tsc 类型检查 + 全部测试
```

CI 在每次 push/PR 时运行，并每两天定时跑一次「上游金丝雀」：本地开发
基线由 `package-lock.json` 钉住，而金丝雀那趟会忽略 lockfile、拉到最新
版 pi，所以上游发布后两天内即可自动暴露兼容性问题，不用等用户反馈。

### 发布

推 tag 即发布：流水线会核对版本号、跑测试、发到 npm 并生成 provenance，认证走
npm Trusted Publishing（OIDC），仓库里没有 `NPM_TOKEN`。完整流程、发完怎么核对、
报 `ENEEDAUTH` 怎么查，见 **[RELEASING.md](RELEASING.md)**。

## 反馈

pi 大版本升级后如果出现错位或残留英文，欢迎[提 issue](https://github.com/GoetheDady/pi-zh-cn/issues)。

改动记录见 [GitHub Releases](https://github.com/GoetheDady/pi-zh-cn/releases)。

## License

[MIT](LICENSE)
