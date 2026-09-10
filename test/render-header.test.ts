/**
 * 渲染回归测试：中文 header 在任意终端宽度下都不超宽。
 *
 * 背景：pi 会检查 header 渲染结果的宽度，超宽直接崩溃——0.2.5 修的就是
 * 窄终端下这个问题。header 复刻内置布局，宽度只由 render(width) 传入，
 * 这里把「每行可见宽度 ≤ 终端宽度」钉成回归。
 *
 * theme 用 dist 里的真实主题（带 ANSI 转义），断言才算数：透传文字的假
 * theme 测不出 ANSI 与中文宽字符混排时的超宽。
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { initTheme, VERSION } from "@earendil-works/pi-coding-agent";
import { visibleWidth } from "@earendil-works/pi-tui";
import { setChineseHeader } from "../extensions/header.ts";
import { loadDist } from "./helpers.ts";

// getThemeByName 未从包顶层导出（顶层只有 initTheme 与 Theme 类）。
const { getThemeByName } = await loadDist<{
  getThemeByName: (name: string) => any;
}>("modes/interactive/theme/theme.js");

// keyHint 读全局主题单例，未初始化会抛「Theme not initialized」。
initTheme("dark");
const theme = getThemeByName("dark");

/** 跑一次 setChineseHeader，用它注册给 pi 的组件渲染指定宽度。 */
function renderHeader(width: number): string[] {
  let factory: any;
  setChineseHeader({
    mode: "tui",
    ui: {
      setHeader: (f: any) => {
        factory = f;
      },
    },
  } as any);
  assert.ok(factory, "TUI 模式下应注册 header 渲染器");
  return factory({}, theme).render(width);
}

test("header：窄终端每行可见宽度不超宽（0.2.5 的崩溃点回归）", () => {
  // 49 是快捷键行在宽终端下的完整宽度，取它当边界值。
  for (const width of [1, 2, 10, 21, 40, 49]) {
    for (const line of renderHeader(width)) {
      assert.ok(
        visibleWidth(line) <= width,
        `宽度 ${width} 下超宽到 ${visibleWidth(line)} 列：${JSON.stringify(line)}`,
      );
    }
  }
});

test("header：宽度充足时关键项齐全（未被误截断）", () => {
  const text = renderHeader(120).join("\n");
  for (const expected of [
    `v${VERSION}`,
    "中断",
    "清空/退出",
    "命令菜单",
    "bash",
    "更多",
    "完整启动帮助",
    "能解释自身",
  ]) {
    assert.ok(
      text.includes(expected),
      `宽度 120 时 header 缺少「${expected}」：\n${text}`,
    );
  }
});
