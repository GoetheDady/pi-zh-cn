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
} as const;

export type Zh = typeof zh;
