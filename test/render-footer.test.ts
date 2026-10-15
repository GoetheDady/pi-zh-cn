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
