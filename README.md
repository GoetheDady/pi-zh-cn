# pi-zh-cn

把 [pi](https://github.com/earendil-works/pi) 编码代理的界面变成简体中文。装上重启即可，不想要了随时卸载。

原理上它只是一个普通扩展：调用官方扩展 API 替换文案，不打补丁、不改安装目录里的任何文件，所以 pi 正常升级后一般也能直接用。

## 会变成中文的部分

- 启动画面：标题、快捷键提示、引导语（快捷键显示跟随你自己的键位配置）
- 底部状态栏：当前目录 / 分支 / 会话名、token 与缓存用量、费用、上下文占比、模型和思考等级
- 加载提示：「正在处理…」；thinking 折叠块的标签
- 八个内置工具的执行结果：读取、执行（bash）、编辑、写入、搜索内容、查找文件、列出目录、PowerShell——状态行都是中文，比如「完成」「退出码 N」「输出过长已截断」

发给模型的内容不变。工具的 description 保持英文原文，避免影响模型行为。

## 保持原样的部分

- 内置菜单和其他硬编码在 pi 源码里的英文（扩展 API 够不到，除非 fork 上游重编译，不值得）
- 工具的启用范围：`grep`、`find`、`ls` 或 `powershell` 没开就不会被这个插件偷偷打开

## 使用

```bash
# 从 npm 安装
pi install npm:pi-zh-cn

# 查看/卸载用这里显示的 source 名
pi list
```

觉得中文状态栏不如原生好读，可以临时切回英文：

```text
/footer
```

## 开发

```bash
npm install
./node_modules/.bin/tsc -p .   # 类型检查

# 本地试跑
pi --no-session -e ./extensions/index.ts -p "hi"
```

所有文案都集中在 [`extensions/zh.ts`](extensions/zh.ts)，想改词只动这一个文件就够了。

改动记录见 [CHANGELOG.md](CHANGELOG.md)。pi 大版本升级后如果出现错位或残留英文，欢迎提 issue。
