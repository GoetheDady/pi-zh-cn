# pi-zh-cn

[![npm version](https://img.shields.io/npm/v/pi-zh-cn.svg)](https://www.npmjs.com/package/pi-zh-cn)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](LICENSE)

把 [pi](https://github.com/earendil-works/pi) 编码代理的界面变成简体中文。装上重启即可，不想要了随时卸载。

## 特性

- **零侵入**：只是普通扩展，调用官方扩展 API 替换文案，不打补丁、不改安装目录里的任何文件，pi 正常升级后一般也能直接用
- **不改模型输入**：发给模型的内容保持不变，工具 description 保留英文原文，避免影响模型行为
- **按需开启**：`grep`、`find`、`ls` 或 `powershell` 没开就不会被偷偷打开
- **键位跟随**：快捷键提示跟随你自己的键位配置

## 汉化范围

- 启动画面：标题、快捷键提示、引导语
- 底部状态栏：当前目录 / 分支 / 会话名、token 与缓存用量、费用、上下文占比、模型和思考等级
- 加载提示：「正在处理…」；thinking 折叠块的标签
- 八个内置工具的执行结果：读取、执行（bash）、编辑、写入、搜索内容、查找文件、列出目录、PowerShell——状态行都是中文，比如「完成」「退出码 N」「输出过长已截断」
- 项目信任弹窗：信任/不信任选择，含「信任父文件夹」变体
- 内置斜杠命令描述：core 全部 23 个命令

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

## 已知局限

- 内置菜单和其他硬编码在 pi 源码里的英文保持原样——扩展 API 够不到，除非 fork 上游重编译，不值得

## 开发

```bash
npm install
./node_modules/.bin/tsc -p .   # 类型检查

# 本地试跑
pi --no-session -e ./extensions/index.ts -p "hi"
```

所有文案都集中在 [`extensions/zh.ts`](extensions/zh.ts)，想改词只动这一个文件就够了。

### 升级 pi 后的核对项

对比 `node_modules/@earendil-works/pi-coding-agent/dist/modes/interactive/`：

- 内置 header 的 compact 行结构是否有新增提示项
- footer 统计行顺序与订阅判断逻辑
- 工具 details 字段（truncation、matchLimit 等）是否变化
- trust.json 读写语义与格式（`dist/core/trust-manager.js`：realpath 键、null = 删键、键排序、2 空格缩进、结尾换行）

## 反馈

pi 大版本升级后如果出现错位或残留英文，欢迎[提 issue](https://github.com/GoetheDady/pi-zh-cn/issues)。

改动记录见 [CHANGELOG.md](CHANGELOG.md)。

## License

[MIT](LICENSE)
