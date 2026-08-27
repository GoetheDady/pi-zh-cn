/**
 * 汉化文案表
 *
 * 只包含通过扩展 API 能覆盖的界面文案。
 * 工具 description（发给模型的）保持英文原文，避免影响模型行为。
 */

export const zh = {
  // 流式加载提示（默认 "Working..."，工具执行时也会显示）
  workingMessage: "正在处理…",

  // thinking 折叠块标签（默认 "Thinking..."）
  hiddenThinkingLabel: "思考过程已折叠",

  // footer
  footer: {
    cwdPrefix: "当前目录：",
    branchPrefix: "当前分支：",
    inputLabel: "输入",
    outputLabel: "输出",
    ratioLabel: "占比",
    cacheReadLabel: "缓存读",
    cacheWriteLabel: "缓存写",
    cacheHitLabel: "缓存命中率",
    costLabel: "费用",
    noModel: "尚未选择模型",
    thinkingOff: "思考已关闭",
    thinkingLevels: {
      off: "关闭",
      minimal: "最低",
      low: "低",
      medium: "中",
      high: "高",
      xhigh: "超高",
      max: "最高",
    },
    autoCompactSuffix: "（自动压缩）",
    subSuffix: "（订阅）",
  },

  // 启动 header
  header: {
    // 折叠态提示行（与内置一致：" · " 分隔）
    interrupt: "中断",
    clearExit: "清空/退出",
    commands: "命令菜单",
    more: "更多",
    expandHelp: "按下上述按键查看完整启动帮助与已加载资源",
    onboarding:
      "Pi 能解释自身的功能、查阅自己的文档——想知道怎么用、怎么扩展，直接问它。",
  },

  // 内置工具渲染
  tools: {
    read: {
      label: "读取",
      title: "读取",
      reading: "读取中…",
      imageLoaded: "图片已加载",
      noContent: "无内容",
      lines: (n: number) => `${n} 行`,
      truncatedFrom: (n: number) => `（共 ${n} 行，仅显示部分）`,
    },
    bash: {
      label: "执行",
      title: "$ ",
      timeout: (s: number) => `（超时：${s}s）`,
      running: "运行中…",
      done: "完成",
      failed: "执行失败",
      exit: (code: number) => `退出码 ${code}`,
      lines: (n: number) => `${n} 行输出`,
      truncated: "[输出过长，已截断]",
    },
    edit: {
      label: "编辑",
      title: "编辑 ",
      editing: "修改中…",
      applied: "已修改",
      additions: (n: number) => `+${n}`,
      removals: (n: number) => `-${n}`,
    },
    write: {
      label: "写入",
      title: "写入 ",
      writing: "写入中…",
      written: "已写入",
      lines: (n: number) => `${n} 行`,
    },
    grep: {
      label: "搜索内容",
      title: "搜索内容 ",
      searching: "搜索中…",
      noMatches: "未找到匹配内容",
      matches: (n: number) => `${n} 行结果`,
      matchLimit: (n: number) => `（达到 ${n} 条匹配上限）`,
      truncated: "（部分行已截断）",
    },
    find: {
      label: "查找文件",
      title: "查找文件 ",
      searching: "查找中…",
      noFiles: "未找到匹配文件",
      results: (n: number) => `${n} 个结果`,
      resultLimit: (n: number) => `（达到 ${n} 个结果上限）`,
    },
    ls: {
      label: "列出目录",
      title: "列出目录 ",
      listing: "读取目录中…",
      empty: "目录为空",
      entries: (n: number) => `${n} 项`,
      entryLimit: (n: number) => `（达到 ${n} 项上限）`,
    },
    powershell: {
      label: "执行 PowerShell",
      title: "PS> ",
      timeout: (s: number) => `（超时：${s}s）`,
      running: "PowerShell 运行中…",
      done: "完成",
      failed: "执行失败",
      exit: (code: number) => `退出码 ${code}`,
      lines: (n: number) => `${n} 行输出`,
      truncated: "[输出过长，已截断]",
    },
  },

  // 项目信任弹窗（复刻内置“信任/不信任”选项；“信任父文件夹”变体不支持）
  trust: {
    title: (cwd: string) =>
      `是否信任项目目录：${cwd}？将允许 pi 加载项目配置并执行项目扩展`,
    options: {
      trustAndRemember: "信任并记住此决定",
      trustSessionOnly: "仅本次会话信任",
      distrustAndRemember: "不信任并记住此决定",
      distrustSessionOnly: "本次会话不信任",
    },
  },

  // 内置斜杠命令的中文描述（key 为命令名；带参数提示的条目已按 core 的
  // `hint — description` 合成格式写好，避免运行时拼字符串）
  builtinCommands: {
    settings: "打开设置菜单",
    model: "<provider/model> — 选择模型（打开选择器界面）",
    tree: "浏览会话树（切换分支）",
    thinking: "<level> — 设置思考等级",
    "scoped-models": "启用/停用 Ctrl+P 轮换用的模型",
    export: "导出会话（默认 HTML，可指定 .html/.jsonl 路径）",
    import: "从 JSONL 文件导入并恢复会话",
    share: "通过 GitHub 私密 gist 分享会话",
    copy: "复制最后一条助手消息到剪贴板",
    name: "设置会话显示名称",
    session: "显示会话信息与统计",
    changelog: "显示更新日志",
    hotkeys: "显示全部快捷键",
    fork: "从历史用户消息创建新分叉",
    clone: "在当前位置复制当前会话",
    trust: "保存项目信任决定以便后续会话使用",
    login: "<provider> — 配置提供商认证",
    logout: "移除提供商认证",
    new: "开始新会话",
    compact: "手动压缩会话上下文",
    resume: "恢复另一个会话",
    reload: "重新加载快捷键、扩展、技能、提示词、主题和上下文文件",
    quit: "退出 pi",
  },
} as const;

