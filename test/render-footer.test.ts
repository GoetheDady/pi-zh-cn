/**
 * 渲染回归测试：中文 footer 在任意终端宽度下都不超宽。
 *
 * 背景：pi 会检查渲染结果的宽度，超宽直接崩溃——0.2.5 修的 header 就是这个问题，
 * 当时补了 header 的宽度回归，但 **footer 一直没测过**。footer 常驻屏幕，而且
 * 中文标签（「当前目录：」「缓存命中率」）比内置英文（`pwd`、`cacheRead`）宽得多，
 * 同样的崩溃风险一直敞着。这里把「每行可见宽度 ≤ 终端宽度」钉成回归。
 *
 * theme 用 dist 里的真实主题（带 ANSI 转义），断言才算数：透传文字的假 theme
 * 测不出 ANSI 与中文宽字符混排时的超宽。
 *
 * footerData 用假对象而不是真的 FooterDataProvider：这里要验的是我们的排版，
 * 不是 provider 的行为（后者由 contract-footer.test.ts 钉着），假对象能让用例
 * 直接构造出最坏情况的输入。
 */
import { after, test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { initTheme } from "@earendil-works/pi-coding-agent";
import { visibleWidth } from "@earendil-works/pi-tui";
import { setupChineseFooter } from "../extensions/footer.ts";
import { ENV_AGENT_DIR, loadDist } from "./helpers.ts";

// getThemeByName 未从包顶层导出（顶层只有 initTheme 与 Theme 类）。
const { getThemeByName } = await loadDist<{ getThemeByName: (name: string) => any }>(
  "modes/interactive/theme/theme.js",
);

// keyHint 等读全局主题单例，未初始化会抛「Theme not initialized」。
initTheme("dark");
const theme = getThemeByName("dark");

// 设置文件落在临时目录，别读用户真实的 ~/.pi/agent/settings.json。
const agentDir = mkdtempSync(join(tmpdir(), "pi-zh-cn-footer-"));
const projectDir = mkdtempSync(join(tmpdir(), "pi-zh-cn-footer-cwd-"));
process.env[ENV_AGENT_DIR] = agentDir;
after(() => {
  rmSync(agentDir, { recursive: true, force: true });
  rmSync(projectDir, { recursive: true, force: true });
});

/** 一次 assistant 消息的 usage，数字刻意取得很大以施加宽度压力。 */
const bigUsage = {
  input: 1_234_567,
  output: 890_123,
  cacheRead: 987_654,
  cacheWrite: 456_789,
  cost: { total: 123.456 },
};

/**
 * 装好中文 footer，返回按宽度渲染的函数。
 *
 * @param opts entries 会话条目（决定统计行内容）；percent 上下文占比，
 *   传 null 走「未知」分支；statuses 扩展状态行内容（省略则没有第三行）；
 *   providers provider 数量（>1 时统计行右侧会多带 `(provider)` 前缀）
 */
function footerRenderer(
  opts: {
    entries?: unknown[];
    percent?: number | null;
    statuses?: Map<string, string>;
    providers?: number;
    sessionId?: string;
    leafId?: string;
  } = {},
) {
  let factory: any;
  setupChineseFooter({
    mode: "tui",
    cwd: projectDir,
    isProjectTrusted: () => true,
    thinkingLevel: "high",
    model: {
      id: "claude-sonnet-5-5-超长模型标识用于施加宽度压力",
      provider: "anthropic",
      contextWindow: 200_000,
      reasoning: true,
    },
    modelRegistry: {
      getProvider: () => ({ auth: { oauth: { isSubscription: false } } }),
      isUsingOAuth: () => false,
    },
    getContextUsage: () => ({
      percent: opts.percent === undefined ? 42.5 : opts.percent,
      contextWindow: 200_000,
    }),
    sessionManager: {
      // 临时目录路径不在家目录下，不会被缩成 ~，比真实情况更长。
      getCwd: () => projectDir,
      getSessionName: () => "一个相当长的会话名字用来施加宽度压力",
      // footer 的 usage 缓存键用到会话/分支（与上游 getSessionStats 一致）。
      getSessionId: () => opts.sessionId ?? "session-under-test",
      getLeafId: () => opts.leafId ?? "leaf-under-test",
      getEntries: () =>
        opts.entries ?? [
          { type: "message", message: { role: "assistant", usage: bigUsage } },
        ],
    },
    ui: {
      setFooter: (f: any) => {
        factory = f;
      },
      requestRender: () => {},
    },
  } as any);

  assert.ok(factory, "TUI 模式下应注册 footer");
  const component = factory(
    { requestRender: () => {} },
    theme,
    {
      getGitBranch: () => "feature/很长的分支名字用来施加宽度压力",
      getExtensionStatuses: () => opts.statuses ?? new Map(),
      getAvailableProviderCount: () => opts.providers ?? 3,
      onBranchChange: () => () => {},
    },
  );
  return (width: number) => component.render(width);
}

const NARROW_TO_WIDE = [1, 2, 3, 4, 5, 8, 10, 15, 20, 30, 40, 60, 80, 120, 200];

test("footer：窄终端每行可见宽度不超宽（与 0.2.5 的 header 同类风险）", () => {
  const render = footerRenderer();
  for (const width of NARROW_TO_WIDE) {
    for (const line of render(width)) {
      assert.ok(
        visibleWidth(line) <= width,
        `宽度 ${width} 下超宽到 ${visibleWidth(line)} 列：${JSON.stringify(line)}`,
      );
    }
  }
});

test("footer：内容最坏情况下也不超宽（长分支/长状态/多 provider/超大数字）", () => {
  const render = footerRenderer({
    statuses: new Map([
      ["a", "一个很长的扩展状态文本，用来把第三行撑到远超终端宽度"],
      ["b", "另一个同样很长的扩展状态"],
    ]),
    providers: 9,
  });
  for (const width of NARROW_TO_WIDE) {
    for (const line of render(width)) {
      assert.ok(
        visibleWidth(line) <= width,
        `宽度 ${width} 下超宽到 ${visibleWidth(line)} 列：${JSON.stringify(line)}`,
      );
    }
  }
});

test("footer：上下文占比未知（null）与超阈值变色时同样不超宽", () => {
  for (const percent of [null, 0, 95, 100]) {
    const render = footerRenderer({ percent: percent as any });
    for (const width of NARROW_TO_WIDE) {
      for (const line of render(width)) {
        assert.ok(
          visibleWidth(line) <= width,
          `percent=${percent} 宽度 ${width} 下超宽到 ${visibleWidth(line)} 列：${JSON.stringify(line)}`,
        );
      }
    }
  }
});

test("footer：宽度充足时关键项齐全（中文标签没被误截断）", () => {
  const text = footerRenderer()(200).join("\n");
  for (const expected of [
    "当前目录：",
    "当前分支：",
    "输入",
    "输出",
    "缓存读",
    "缓存写",
    "缓存命中率",
    "费用",
    "占比",
    "（自动压缩）",
  ]) {
    assert.ok(
      text.includes(expected),
      `宽度 200 时 footer 缺少「${expected}」：\n${text}`,
    );
  }
});

test("footer：usage 增量缓存正确（追加/流式增长/回退后统计不陈旧）", () => {
  // P3 优化：footer 只缓存「除最后一条外」的聚合，每次重算最后一条。
  // 这条测试钉住缓存的正确性——追加、流式增长、回退三种情况都不能用到陈旧值。
  const entries: any[] = [];
  const render = footerRenderer({ entries });
  const usage = (input: number) => ({
    input,
    output: 0,
    cacheRead: 0,
    cacheWrite: 0,
    cost: { total: 0 },
  });

  entries.push({
    type: "message",
    message: { role: "assistant", usage: usage(100) },
  });
  assert.ok(render(200).join("\n").includes("输入↑100"), "首条应计入 100");

  entries.push({
    type: "message",
    message: { role: "assistant", usage: usage(200) },
  });
  assert.ok(
    render(200).join("\n").includes("输入↑300"),
    "追加后应重算为 300",
  );

  // 流式：最后一条 usage 继续增长（条目数不变），必须反映最新值而非缓存陈旧值。
  entries[1].message.usage.input = 500;
  assert.ok(
    render(200).join("\n").includes("输入↑600"),
    "流式增长最后一条应反映为 600",
  );

  // 回退：条目变少时也要重算，不能残留旧的聚合。
  entries.pop();
  assert.ok(
    render(200).join("\n").includes("输入↑100"),
    "回退后应重算回 100",
  );
});

test("footer：空会话不崩、无 token 统计", () => {
  const render = footerRenderer({ entries: [] });
  const text = render(200).join("\n");
  assert.ok(text.includes("当前目录："), "空会话仍应显示目录行");
  assert.ok(!text.includes("输入↑"), "空会话不应有输入统计");
});

test('footer：type:"usage" 条目计入统计（1.6.0 cache-warmer）', () => {
  // 1.6.0 的 cache-warmer 会写 type:"usage" 条目（cacheWarming 默认 "idle"），
  // 上游 footer 计入统计；这条钉住我们也计入，且覆盖「在 prefix 里（非最后一条）」的路径。
  const usage = (input: number) => ({
    input,
    output: 0,
    cacheRead: 0,
    cacheWrite: 0,
    cost: { total: 0 },
  });
  const render = footerRenderer({
    entries: [
      {
        type: "usage",
        kind: "cache_warm",
        provider: "openai",
        model: "gpt",
        usage: usage(400),
      },
      { type: "message", message: { role: "assistant", usage: usage(100) } },
    ],
  });
  assert.ok(
    render(200).join("\n").includes("输入↑500"),
    "usage 条目应计入统计（400+100=500）",
  );
});

test("footer：切分支（等长、内容变）后缓存不串味", () => {
  // 缓存键含 leafId：切到等长的另一条分支时，条数不变但 prefix 内容变了，
  // 必须整体重算，不能复用旧聚合。
  const usage = (input: number) => ({
    input,
    output: 0,
    cacheRead: 0,
    cacheWrite: 0,
    cost: { total: 0 },
  });
  const opts: any = {
    leafId: "L1",
    entries: [
      { type: "message", message: { role: "assistant", usage: usage(100) } },
      { type: "message", message: { role: "assistant", usage: usage(200) } },
    ],
  };
  const render = footerRenderer(opts);
  assert.ok(render(200).join("\n").includes("输入↑300"), "初始应为 300");

  // 模拟切到等长的另一分支：条数不变，prefix 里的条目内容变了，leafId 也变。
  opts.entries[0].message.usage.input = 600;
  opts.leafId = "L2";
  assert.ok(
    render(200).join("\n").includes("输入↑800"),
    "切分支后应重算为 600+200=800，不串味",
  );
});
