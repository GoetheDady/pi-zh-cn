/**
 * 中文 header：复刻内置结构（标题 + 折叠提示行 + 引导语），
 * 快捷键跟随用户键位配置。
 */
import {
  keyHint,
  keyText,
  rawKeyHint,
  VERSION,
  type ExtensionContext,
} from "@earendil-works/pi-coding-agent";
import { truncateToWidth } from "@earendil-works/pi-tui";
import { zh } from "./zh.ts";

// 与上游 pi-logo 相同的品牌色，不随主题改变；theme.style 负责颜色模式转换。
const CORAL = { kind: "rgb", r: 228, g: 138, b: 122 } as const;
const BLUE = { kind: "rgb", r: 79, g: 142, b: 179 } as const;
const YELLOW = { kind: "rgb", r: 234, g: 182, b: 93 } as const;

/**
 * 设置中文启动 header（仅 TUI 模式，其他模式无效果）。
 *
 * 复刻内置结构：logo + 折叠提示行（快捷键跟随用户键位配置）+
 * 展开帮助语 + 引导文案。
 *
 * @param ctx 当前会话上下文
 */
export function setChineseHeader(ctx: ExtensionContext) {
  if (ctx.mode !== "tui") return;

  // 启动 header 的展开态就是「展开工具输出」（ctrl+o）那一个开关：pi 在
  // setToolsExpanded 里对自定义 header 调 setExpanded，识别方式是鸭子类型
  // （对象上有 setExpanded 方法即可，见 interactive-mode 的 isExpandable）。
  const state = { expanded: false };

  ctx.ui.setHeader((_tui, theme) => ({
    setExpanded(expanded: boolean) {
      state.expanded = expanded;
    },

    render(_width: number): string[] {
      const hints = state.expanded
        ? expandedHints()
        : [compactHints(theme)];

      // 旧版 pi 没有 theme.style，保留原文字标题；Apple Terminal 的半块
      // 会有行间缝隙，和上游一样回退为双色 Pi 字标。两种情况都没有 logo
      // 底行，提示另起一行；有像素 logo 时第一条提示接在底行之后。
      const styleable = typeof theme.style === "function";
      const appleTerminal =
        process.platform === "darwin" &&
        process.env.TERM_PROGRAM === "Apple_Terminal";
      let logo =
        theme.bold(theme.fg("accent", "pi")) +
        theme.fg("dim", ` v${VERSION}`);
      let hintPrefix: string | undefined;
      if (styleable) {
        const version = theme.fg("dim", `v${VERSION}`);
        if (appleTerminal) {
          logo =
            theme.style("P", { fg: CORAL }) +
            theme.style("i", { fg: YELLOW }) + ` ${version}`;
        } else {
          logo =
            theme.style("▀", { fg: CORAL, bg: BLUE }) +
            theme.style("▀█", { fg: CORAL }) + `  ${version}`;
          hintPrefix =
            theme.style("█▀", { fg: BLUE }) + " " +
            theme.style("█", { fg: YELLOW });
        }
      }

      const body =
        hintPrefix !== undefined
          ? [`${hintPrefix} ${hints[0]}`, ...hints.slice(1)]
          : hints;

      const lines = [logo, ...body];
      // 展开态本身就是完整帮助，再提示「按键查看完整帮助」是自相矛盾。
      if (!state.expanded) {
        lines.push(
          theme.fg(
            "dim",
            `${zh.header.expandHelp} (${keyText("app.tools.expand")})`,
          ),
        );
      }
      lines.push("", theme.fg("dim", zh.header.onboarding));

      // 窄终端时按宽度截断，避免触发 pi 的超宽崩溃检查
      const w = Math.max(1, _width);
      return lines.map((line) => truncateToWidth(line, w, ""));
    },

    invalidate() {},
  }));
}

/** 折叠态那一行紧凑提示（与内置一致，用 " · " 分隔）。 */
function compactHints(theme: any): string {
  const c = zh.header.compact;
  return [
    keyHint("app.interrupt", c.interrupt),
    rawKeyHint(`${keyText("app.clear")}/${keyText("app.exit")}`, c.clearExit),
    rawKeyHint("/", c.commands),
    rawKeyHint("!", "bash"),
    keyHint("app.tools.expand", c.more),
  ].join(theme.fg("muted", " · "));
}

/**
 * 展开态的完整键位参考表，逐条对齐内置 expandedInstructions。
 * 键位名由 keyHint/rawKeyHint 按用户键位配置渲染，这里只给中文说明。
 */
function expandedHints(): string[] {
  const e = zh.header.expanded;
  return [
    keyHint("app.interrupt", e.interrupt),
    keyHint("app.clear", e.clear),
    rawKeyHint(`${keyText("app.clear")} ${e.twice}`, e.exit),
    keyHint("app.exit", e.exitEmpty),
    keyHint("app.suspend", e.suspend),
    keyHint("tui.editor.deleteToLineEnd", e.deleteToLineEnd),
    keyHint("app.thinking.cycle", e.cycleThinking),
    rawKeyHint(
      `${keyText("app.model.cycleForward")}/${keyText("app.model.cycleBackward")}`,
      e.cycleModels,
    ),
    keyHint("app.model.select", e.selectModel),
    keyHint("app.tools.expand", e.expandTools),
    keyHint("app.thinking.toggle", e.expandThinking),
    keyHint("app.editor.external", e.externalEditor),
    rawKeyHint("/", e.commands),
    rawKeyHint("!", e.bash),
    rawKeyHint("!!", e.bashNoContext),
    keyHint("app.message.followUp", e.followUp),
    keyHint("app.message.dequeue", e.dequeue),
    keyHint("app.clipboard.pasteImage", e.pasteImage),
    rawKeyHint(e.dropFiles, e.attach),
  ];
}
