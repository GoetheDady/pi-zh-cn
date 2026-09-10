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
  ctx.ui.setHeader((_tui, theme) => ({
    render(_width: number): string[] {
      const logo =
        theme.bold(theme.fg("accent", "pi")) +
        theme.fg("dim", ` v${VERSION}`);
      const compact = [
        keyHint("app.interrupt", zh.header.interrupt),
        rawKeyHint(
          `${keyText("app.clear")}/${keyText("app.exit")}`,
          zh.header.clearExit,
        ),
        rawKeyHint("/", zh.header.commands),
        rawKeyHint("!", "bash"),
        keyHint("app.tools.expand", zh.header.more),
      ].join(theme.fg("muted", " · "));
      // 窄终端时按宽度截断，避免触发 pi 的超宽崩溃检查
      const w = Math.max(1, _width);
      return [
        truncateToWidth(logo, w, ""),
        truncateToWidth(compact, w, ""),
        truncateToWidth(
          theme.fg(
            "dim",
            `${zh.header.expandHelp} (${keyText("app.tools.expand")})`,
          ),
          w,
          "",
        ),
        "",
        truncateToWidth(theme.fg("dim", zh.header.onboarding), w, ""),
      ];
    },
    invalidate() {},
  }));
}
