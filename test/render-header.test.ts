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
import { after, test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { initTheme, VERSION } from "@earendil-works/pi-coding-agent";
import { backgroundAnsi, foregroundAnsi, rgbColor, visibleWidth } from "@earendil-works/pi-tui";
import { setChineseHeader } from "../extensions/header.ts";
import { dist, ENV_AGENT_DIR, loadDist } from "./helpers.ts";

// getThemeByName 未从包顶层导出（顶层只有 initTheme 与 Theme 类）。
const { getThemeByName, loadThemeFromPath } = await loadDist<{
  getThemeByName: (name: string) => any;
  loadThemeFromPath: (path: string, mode: "truecolor" | "256color") => any;
}>("modes/interactive/theme/theme.js");

// keyHint 读全局主题单例，未初始化会抛「Theme not initialized」。
initTheme("dark");
const theme = getThemeByName("dark");

// 设置文件落在临时目录，绝不读用户真实的 ~/.pi/agent/settings.json：本机
// 恰好设了 quietStartup 的话，下面所有用例都会莫名变红。
const agentDir = mkdtempSync(join(tmpdir(), "pi-zh-cn-header-"));
const projectDir = mkdtempSync(join(tmpdir(), "pi-zh-cn-header-cwd-"));
process.env[ENV_AGENT_DIR] = agentDir;
after(() => {
  rmSync(agentDir, { recursive: true, force: true });
  rmSync(projectDir, { recursive: true, force: true });
});

/**
 * 跑一次 setChineseHeader，返回它注册的组件；quietStartup 要求静默时返回
 * undefined（此时扩展不应调用 setHeader）。
 *
 * @param settings 全局 settings.json 的内容；undefined 表示不建这个文件
 * @param opts trusted 项目是否受信任；project 为项目本地设置的内容
 */
function registerHeader(
  settings?: unknown,
  opts: { trusted?: boolean; project?: unknown } = {},
): any {
  rmSync(join(agentDir, "settings.json"), { force: true });
  if (settings !== undefined) {
    writeFileSync(join(agentDir, "settings.json"), JSON.stringify(settings));
  }
  rmSync(join(projectDir, ".pi"), { recursive: true, force: true });
  if (opts.project !== undefined) {
    mkdirSync(join(projectDir, ".pi"), { recursive: true });
    writeFileSync(
      join(projectDir, ".pi", "settings.json"),
      JSON.stringify(opts.project),
    );
  }

  let factory: any;
  setChineseHeader({
    mode: "tui",
    cwd: projectDir,
    isProjectTrusted: () => opts.trusted === true,
    ui: {
      setHeader: (f: any) => {
        factory = f;
      },
    },
  } as any);
  return factory;
}

/** 跑一次 setChineseHeader，用它注册给 pi 的组件渲染指定宽度。 */
function headerComponent(activeTheme = theme) {
  const factory = registerHeader();
  assert.ok(factory, "TUI 模式下应注册 header 渲染器");
  return factory({}, activeTheme);
}

const renderHeader = (width: number) => headerComponent().render(width);
const plain = (text: string) => text.replace(/\x1b\[[\d;]*m/g, "");

/** 同步渲染测试中模拟终端；结束时恢复平台与环境，避免污染后续测试。 */
function inTerminal(program: string, run: () => void) {
  const platform = Object.getOwnPropertyDescriptor(process, "platform")!;
  const previous = process.env.TERM_PROGRAM;
  Object.defineProperty(process, "platform", { ...platform, value: "darwin" });
  process.env.TERM_PROGRAM = program;
  try {
    run();
  } finally {
    Object.defineProperty(process, "platform", platform);
    if (previous === undefined) delete process.env.TERM_PROGRAM;
    else process.env.TERM_PROGRAM = previous;
  }
}

test("header：窄终端每行可见宽度不超宽（0.2.5 的崩溃点回归）", () => {
  for (const program of ["iTerm.app", "Apple_Terminal"]) {
    inTerminal(program, () => {
      for (const width of [1, 2, 3, 4, 5, 10, 21, 40, 49, 120]) {
        for (const line of renderHeader(width)) {
          assert.ok(
            visibleWidth(line) <= width,
            `${program} 宽度 ${width} 下超宽到 ${visibleWidth(line)} 列：${JSON.stringify(line)}`,
          );
        }
      }
    });
  }
});

test("header：像素布局与上游一致，支持明暗主题及两种颜色模式", async () => {
  const { piLogoLines } = await loadDist<{ piLogoLines: () => string[] }>(
    "modes/interactive/components/pi-logo.js",
  );
  const [top, bottom] = piLogoLines().map(plain);
  inTerminal("iTerm.app", () => {
    for (const name of ["dark", "light"]) {
      for (const mode of ["truecolor", "256color"] as const) {
        const activeTheme = loadThemeFromPath(dist("modes/interactive/theme", `${name}.json`), mode);
        const component = headerComponent(activeTheme);
        const lines = component.render(120);
        assert.equal(plain(lines[0]), `${top} v${VERSION}`);
        assert.ok(plain(lines[1]).startsWith(`${bottom} `));
        assert.ok(lines[0].includes(foregroundAnsi(rgbColor(228, 138, 122), mode)));
        assert.ok(lines[0].includes(backgroundAnsi(rgbColor(79, 142, 179), mode)));
        assert.ok(lines[1].includes(foregroundAnsi(rgbColor(234, 182, 93), mode)));
        component.invalidate();
        assert.deepEqual(component.render(120), lines);
      }
    }
  });
});

test("header：Apple Terminal 使用双色 Pi 字标，无半块像素", () => {
  inTerminal("Apple_Terminal", () => {
    const lines = renderHeader(120);
    assert.equal(plain(lines[0]), `Pi v${VERSION}`);
    assert.doesNotMatch(lines.join("\n"), /[▀█]/);
    assert.ok(lines[0].includes(theme.style("P", { fg: rgbColor(228, 138, 122) })));
    assert.ok(lines[0].includes(theme.style("i", { fg: rgbColor(234, 182, 93) })));
  });
});

test("header：旧版主题没有 style 时保留原文字标题", () => {
  const oldTheme = Object.create(theme);
  oldTheme.style = undefined;
  inTerminal("iTerm.app", () => {
    assert.equal(plain(headerComponent(oldTheme).render(120)[0]), `pi v${VERSION}`);
  });
});

test("header：展开态给出完整键位参考表，折叠回去复原", () => {
  const component = headerComponent();
  const collapsed = component.render(200).map(plain);

  assert.equal(collapsed.length, 5, `折叠态应为 5 行，实际 ${collapsed.length}`);
  assert.match(collapsed[2], /完整启动帮助/, "折叠态应提示按键查看完整帮助");

  // pi 靠鸭子类型识别可展开的 header（对象上有 setExpanded 即认），随后在
  // ctrl+o 切换时主动调用。少了这个方法，内置那张键位参考表在中文界面里
  // 就完全够不到，而折叠态的文案还在承诺「按上述按键查看完整启动帮助」。
  assert.equal(
    typeof (component as any).setExpanded,
    "function",
    "header 组件必须实现 setExpanded，否则 ctrl+o 不起作用",
  );
  (component as any).setExpanded(true);
  const expanded = component.render(200).map(plain);

  assert.ok(
    !expanded.some((line: string) => line.includes("完整启动帮助")),
    "展开态不应再提示「按键查看完整帮助」——已经展开了",
  );
  for (const label of [
    "挂起",
    "删除到行尾",
    "切换思考等级",
    "选择模型",
    "打开外部编辑器",
    "附加文件",
  ]) {
    assert.ok(
      expanded.some((line: string) => line.includes(label)),
      `展开态应含「${label}」，实际：\n${expanded.join("\n")}`,
    );
  }
  assert.ok(
    expanded.length > collapsed.length,
    `展开态行数应多于折叠态（${expanded.length} vs ${collapsed.length}）`,
  );

  (component as any).setExpanded(false);
  assert.deepEqual(
    component.render(200).map(plain),
    collapsed,
    "折叠回去应与初始渲染一致",
  );
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

test("header：quietStartup 为 true 时不注册，尊重用户关掉启动画面的要求", () => {
  // 上游在 quietStartup: true 时把内置 header 换成一个空占位，而 setHeader 会
  // 替换掉那个占位——不判断的话，用户明确关掉的启动画面会被我们塞回来。
  assert.equal(
    registerHeader({ quietStartup: true }),
    undefined,
    "quietStartup: true 时不该注册 header",
  );

  // "header" 只关掉启动详情、不关启动画面（内置的判断是 quietStartup !== true）。
  assert.ok(registerHeader({ quietStartup: "header" }), "取值 header 时仍应显示");
  assert.ok(registerHeader({ quietStartup: false }), "false 时仍应显示");
  assert.ok(registerHeader({}), "未设置时仍应显示");

  // 项目本地设置优先，与内置设置同一套层级：全局关了、项目里打开就按项目走。
  assert.ok(
    registerHeader(
      { quietStartup: true },
      { trusted: true, project: { quietStartup: false } },
    ),
    "受信任项目的本地设置应覆盖全局",
  );
  // 项目不受信任时不读它那份，全局的 true 仍然生效。
  assert.equal(
    registerHeader(
      { quietStartup: true },
      { trusted: false, project: { quietStartup: false } },
    ),
    undefined,
    "项目不受信任时不该读它的设置",
  );
});
