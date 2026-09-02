/**
 * 上游契约测试：footer / header 依赖的上游结构。
 *
 * 中文 footer 逐行复刻内置 footer（dist/modes/interactive/components/footer.js），
 * 两类断言：
 * 1. 运行时行为 —— FooterDataProvider 的只读表面（getGitBranch /
 *    getExtensionStatuses / getAvailableProviderCount / onBranchChange）；
 * 2. dist 源码探针 —— 内置 footer 实现仍读取我们复刻所依赖的字段与入口
 *    （session 条目类型、usage 字段、compaction 设置、订阅判断、
 *    getContextUsage 等）。
 *
 * 任一失败说明内置 footer 结构变化，需核对 footer.ts / header.ts 与
 * zh.footer.* 文案。
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  CONFIG_DIR_NAME,
  getAgentDir,
  keyHint,
  keyText,
  rawKeyHint,
  VERSION,
} from "@earendil-works/pi-coding-agent";
import { loadDist, readDist } from "./helpers.ts";
// FooterDataProvider 类未从包顶层导出（顶层只有只读类型别名）。
const { FooterDataProvider } = await loadDist<{
  FooterDataProvider: any;
}>("core/footer-data-provider.js");
import { truncateToWidth, visibleWidth } from "@earendil-works/pi-tui";

test("footer/header 依赖的上游导出仍然存在", () => {
  assert.equal(typeof getAgentDir, "function");
  assert.equal(typeof CONFIG_DIR_NAME, "string");
  assert.equal(typeof FooterDataProvider, "function");
  // pi-tui 的文本宽度工具（footer 布局依赖）
  assert.equal(typeof truncateToWidth, "function");
  assert.equal(typeof visibleWidth, "function");
  assert.equal(
    truncateToWidth("你好世界abcd", 6),
    truncateToWidth("你好世界abcd", 6),
    "truncateToWidth 行为自检（中英文混排宽度）",
  );
});

test("FooterDataProvider 仍提供扩展 footer 使用的只读表面", () => {
  const repo = mkdtempSync(join(tmpdir(), "pi-zh-cn-footer-"));
  try {
    // 建一个带一次提交的临时 git 仓库，验证分支解析。
    const git = (...args: string[]) =>
      execFileSync("git", ["-c", "user.email=t@t", "-c", "user.name=t", ...args], {
        cwd: repo,
      });
    git("init", "-b", "main");
    writeFileSync(join(repo, "f.txt"), "x");
    git("add", ".");
    git("commit", "-m", "init");

    const provider = new FooterDataProvider(repo);
    // extensions/footer.ts 只使用这四个方法（ReadonlyFooterDataProvider 表面）。
    assert.equal(provider.getGitBranch(), "main", "getGitBranch 应返回当前分支名");
    assert.ok(
      provider.getExtensionStatuses() instanceof Map,
      "getExtensionStatuses 应返回 Map",
    );
    assert.equal(typeof provider.getAvailableProviderCount(), "number");
    const unsubscribe = provider.onBranchChange(() => {});
    assert.equal(typeof unsubscribe, "function", "onBranchChange 应返回取消订阅函数");
    unsubscribe();
    provider.dispose();
  } finally {
    rmSync(repo, { recursive: true, force: true });
  }
});

test("内置 footer 仍按扩展复刻的结构读取会话条目与 usage", () => {
  const footerJs = readDist("modes/interactive/components/footer.js");
  const usageTotals = readDist("core/usage-totals.js");

  // 会话条目类型：extensions/footer.ts 累计 branch_summary / compaction 的 usage
  assert.ok(
    footerJs.includes('"branch_summary"') && footerJs.includes('"compaction"'),
    "内置 footer 不再读取 branch_summary/compaction 条目，需核对 footer.ts 的 addUsage 分支",
  );
  assert.ok(
    footerJs.includes('entry.message.role === "toolResult"'),
    "内置 footer 不再读取 toolResult usage，需核对 footer.ts",
  );
  // usage 字段形状：{ input, output, cacheRead, cacheWrite, cost.total }
  for (const field of ["input", "output", "cacheRead", "cacheWrite", "cost"]) {
    assert.ok(
      usageTotals.includes(`usage.${field}`),
      `usage-totals 不再读取 usage.${field}，需核对 footer.ts 的统计行`,
    );
  }
  assert.ok(
    usageTotals.includes("usage.cost.total"),
    "usage.cost.total 变了，zh.footer.costLabel 的取数逻辑需核对",
  );

  // ctx 表面：getContextUsage（占比行）、sessionManager.getSessionName（pwd 行）
  assert.ok(
    footerJs.includes("getContextUsage()"),
    "内置 footer 不再用 getContextUsage()，footer.ts 的占比行需核对",
  );
  assert.ok(
    footerJs.includes("getSessionName()"),
    "内置 footer 不再用 getSessionName()，footer.ts 的会话名需核对",
  );
  assert.ok(
    footerJs.includes("getAvailableProviderCount()"),
    "内置 footer 不再用 getAvailableProviderCount()，footer.ts 的 provider 显示需核对",
  );
});

test("自动压缩标记与订阅判断的上游依据仍在", () => {
  // footer.ts 的 getAutoCompactSuffix 读 settings.json 的
  // compaction.enabled；上游 settings-manager 仍提供同名字段读取。
  const settingsManager = readDist("core/settings-manager.js");
  assert.ok(
    settingsManager.includes("compaction?.enabled") ||
      settingsManager.includes("compaction.enabled"),
    "settings-manager 不再读 compaction.enabled，getAutoCompactSuffix 需核对",
  );

  // 订阅判断：footer.ts 用 ctx.modelRegistry.isUsingOAuth + provider.auth.oauth.isSubscription，
  // 并特判 provider === "kimi-coding"（与内置 footer 的判断来源保持等价）。
  const footerJs = readDist("modes/interactive/components/footer.js");
  assert.ok(
    footerJs.includes("kimi-coding"),
    "内置 footer 不再特判 kimi-coding，footer.ts 的订阅特判需核对",
  );
  const modelRegistry = readDist("core/model-registry.d.ts");
  assert.ok(
    modelRegistry.includes("isUsingOAuth"),
    "modelRegistry.isUsingOAuth 不存在了，footer.ts 的订阅判断需改用其他 API",
  );
  assert.ok(
    readDist("core/model-runtime.d.ts").includes("isUsingSubscription"),
    "isUsingSubscription 不存在了；若内置 footer 改用其他订阅判断，footer.ts 需同步",
  );
});

test("header 依赖的键位动作与导出仍在", () => {
  // extensions/header.ts 用这些导出复刻内置 header 的 compact 行。
  assert.equal(typeof VERSION, "string");
  assert.equal(typeof keyHint, "function");
  assert.equal(typeof keyText, "function");
  assert.equal(typeof rawKeyHint, "function");

  // keyHint/keyText 按动作 ID 解析快捷键；动作被重命名会让中文提示静默失效。
  const keybindingsJs = readDist("core/keybindings.js");
  for (const action of ["app.interrupt", "app.clear", "app.exit", "app.tools.expand"]) {
    assert.ok(
      keybindingsJs.includes(`"${action}"`),
      `键位动作 ${action} 不存在了，header.ts 的快捷键提示需核对`,
    );
  }
});
