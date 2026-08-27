/**
 * 中文 footer：逐行复刻内置信息（pwd 行 / 统计行 / 扩展状态行），仅描述文案用中文。
 */
import { readFileSync } from "node:fs";
import { homedir } from "node:os";
import { join, relative } from "node:path";
import type { AssistantMessage } from "@earendil-works/pi-ai";
import {
  CONFIG_DIR_NAME,
  getAgentDir,
  type ExtensionContext,
} from "@earendil-works/pi-coding-agent";
import { truncateToWidth, visibleWidth } from "@earendil-works/pi-tui";
import { zh } from "./zh.ts";

/**
 * 安装中文 footer（仅 TUI 模式，其他模式返回 undefined）。
 *
 * footer 逐行复刻内置信息结构：
 * 1. pwd 行 —— 当前目录（~ 缩写）+ git 分支 + 会话名；
 * 2. 统计行 —— 左侧为输入/输出 token、缓存读写与命中率、费用、上下文
 *    占比（按阈值变色），右侧为 provider • 模型 • 思考等级（放不下时省略）；
 * 3. 扩展状态行 —— 各扩展 `setStatus` 的文本。
 * 仅描述文案用中文，数据格式与 built-in 一致。
 *
 * @param ctx 当前会话上下文
 * @returns 切换函数：第一次调用恢复内置 footer，再调用切回中文 footer；
 *          非 TUI 模式下为 undefined
 */
export function setupChineseFooter(ctx: ExtensionContext): (() => void) | undefined {
  if (ctx.mode !== "tui") return undefined;

  let usingZhFooter = true;

  const applyZhFooter = () => {
    usingZhFooter = true;
    // 自动压缩标记：全局设置为基准，受信任项目的本地设置优先。
    // 一秒缓存避免流式渲染时频繁读文件，同时能跟随 /settings 的运行时修改。
    const settingsPaths = [join(getAgentDir(), "settings.json")];
    if (ctx.isProjectTrusted())
      settingsPaths.push(join(ctx.cwd, CONFIG_DIR_NAME, "settings.json"));
    let autoCompactEnabled = true;
    let autoCompactCheckedAt = 0;
    /**
     * 返回自动压缩标记文案。设置读取带 1 秒缓存：避免流式渲染时每次
     * 重绘都读文件，同时仍能跟随 /settings 的运行时修改。全局设置为基准，
     * 受信任项目的本地设置优先覆盖。
     */
    const getAutoCompactSuffix = () => {
      const now = Date.now();
      if (now - autoCompactCheckedAt >= 1000) {
        autoCompactEnabled = true;
        for (const settingsPath of settingsPaths) {
          try {
            const settings = JSON.parse(readFileSync(settingsPath, "utf8"));
            if (typeof settings?.compaction?.enabled === "boolean") {
              autoCompactEnabled = settings.compaction.enabled;
            }
          } catch {
            // 设置文件不存在或内容无效时忽略该层。
          }
        }
        autoCompactCheckedAt = now;
      }
      return autoCompactEnabled ? zh.footer.autoCompactSuffix : "";
    };

    let unsubscribeBranch: (() => void) | undefined;

    // footer 渲染器：onBranchChange 触发重绘；dispose 时取消订阅。
    ctx.ui.setFooter((tui, theme, footerData) => {
      unsubscribeBranch?.();
      unsubscribeBranch = footerData.onBranchChange(() =>
        tui.requestRender(),
      );

      const home = homedir();
      return {
        dispose() {
          unsubscribeBranch?.();
          unsubscribeBranch = undefined;
        },
        invalidate() {},
        /** 汇总会话 usage 统计并渲染三行中文 footer，见模块级说明。 */
        render(width: number): string[] {
          let input = 0,
            output = 0,
            cacheRead = 0,
            cacheWrite = 0,
            cost = 0;
          const addUsage = (t: {
            input: number;
            output: number;
            cacheRead: number;
            cacheWrite: number;
            cost: { total: number };
          }) => {
            input += t.input;
            output += t.output;
            cacheRead += t.cacheRead;
            cacheWrite += t.cacheWrite;
            cost += t.cost.total;
          };
          let latestRate: number | undefined;

          for (const e of ctx.sessionManager.getEntries()) {
            if (e.type === "message" && e.message.role === "assistant") {
              const u = (e.message as AssistantMessage).usage;
              addUsage(u);
              const promptTokens = u.input + u.cacheRead + u.cacheWrite;
              latestRate =
                promptTokens > 0
                  ? (u.cacheRead / promptTokens) * 100
                  : undefined;
            } else if (
              e.type === "message" &&
              e.message.role === "toolResult" &&
              e.message.usage
            ) {
              addUsage(e.message.usage as any);
            } else if (
              (e.type === "branch_summary" || e.type === "compaction") &&
              (e as any).usage
            ) {
              addUsage((e as any).usage);
            }
          }

          const fmt = (n: number) =>
            n < 1e3
              ? `${n}`
              : n < 1e4
                ? `${(n / 1e3).toFixed(1)}k`
                : n < 1e6
                  ? `${Math.round(n / 1e3)}k`
                  : n < 1e7
                    ? `${(n / 1e6).toFixed(1)}M`
                    : `${Math.round(n / 1e6)}M`;

          // 第 1 行：当前目录：~路径（分支）• 会话名
          let pwd = ctx.sessionManager.getCwd();
          const homeRelative = relative(home, pwd);
          if (homeRelative === "") pwd = "~";
          else if (
            homeRelative &&
            !homeRelative.startsWith("..") &&
            !homeRelative.startsWith("/")
          )
            pwd = `~/${homeRelative}`;
          const branch = footerData.getGitBranch();
          if (branch) pwd += ` ${zh.footer.branchPrefix}(${branch})`;
          const sessionName = ctx.sessionManager.getSessionName();
          if (sessionName) pwd += ` • ${sessionName}`;
          pwd = `${zh.footer.cwdPrefix}${pwd}`;

          // 第 2 行左：严格按内置顺序：输入、输出、缓存、费用、上下文占比。
          const clauses: string[] = [];
          if (input > 0 || output > 0) {
            const io: string[] = [];
            if (input > 0) io.push(`${zh.footer.inputLabel}↑${fmt(input)}`);
            if (output > 0)
              io.push(`${zh.footer.outputLabel}↓${fmt(output)}`);
            clauses.push(io.join("/"));
          }

          const cacheParts: string[] = [];
          if (cacheRead > 0)
            cacheParts.push(`${zh.footer.cacheReadLabel}${fmt(cacheRead)}`);
          if (cacheWrite > 0)
            cacheParts.push(
              `${zh.footer.cacheWriteLabel}${fmt(cacheWrite)}`,
            );
          if (
            (cacheRead > 0 || cacheWrite > 0) &&
            latestRate !== undefined
          ) {
            cacheParts.push(
              `${zh.footer.cacheHitLabel}${latestRate.toFixed(1)}%`,
            );
          }
          if (cacheParts.length > 0) clauses.push(cacheParts.join(" "));

          const provider = ctx.model
            ? ctx.modelRegistry.getProvider(ctx.model.provider)
            : undefined;
          const usingSubscription =
            ctx.model?.provider === "kimi-coding" ||
            (!!ctx.model &&
              ctx.modelRegistry.isUsingOAuth(ctx.model) &&
              provider?.auth.oauth?.isSubscription === true);
          if (cost > 0 || usingSubscription) {
            clauses.push(
              `${zh.footer.costLabel}$${cost.toFixed(3)}${usingSubscription ? zh.footer.subSuffix : ""}`,
            );
          }

          // built-in 顺序的最后一项：上下文占比 / 上下文窗口（自动压缩）。
          const cu = ctx.getContextUsage();
          const windowSize =
            cu?.contextWindow ?? ctx.model?.contextWindow ?? 0;
          const pctValue = cu?.percent ?? 0;
          // 与 built-in 一致：明确为 null 时显示未知；尚无 usage 时按 0.0% 显示。
          const pctText =
            cu?.percent === null ? "?" : `${pctValue.toFixed(1)}%`;
          const contextClause = `${zh.footer.ratioLabel}${pctText}/${fmt(windowSize)}${getAutoCompactSuffix()}`;
          const contextIndex = clauses.length;
          clauses.push(contextClause);

          // 占比按阈值变色（>90% 红、>70% 黄）；实验标记沿用 built-in 样式。
          const statsLeft = clauses
            .map((clause, index) => {
              if (index === contextIndex) {
                return pctValue > 90
                  ? theme.fg("error", clause)
                  : pctValue > 70
                    ? theme.fg("warning", clause)
                    : theme.fg("dim", clause);
              }
              return theme.fg("dim", clause);
            })
            .join(" ");

          // 第 2 行右：provider • 模型 • 思考等级（等级映射为中文）
          let rightSideWithoutProvider = ctx.model?.id ?? zh.footer.noModel;
          if (ctx.model?.reasoning) {
            const tl = ctx.thinkingLevel || "off";
            const tlLabel =
              tl === "off"
                ? zh.footer.thinkingOff
                : ((zh.footer.thinkingLevels as Record<string, string>)[
                    tl
                  ] ?? tl);
            rightSideWithoutProvider = `${rightSideWithoutProvider} • ${tlLabel}`;
          }
          let rightSide = rightSideWithoutProvider;
          if (footerData.getAvailableProviderCount() > 1 && ctx.model) {
            rightSide = `(${ctx.model.provider}) ${rightSideWithoutProvider}`;
            if (
              visibleWidth(statsLeft) + 2 + visibleWidth(rightSide) >
              width
            ) {
              rightSide = rightSideWithoutProvider;
            }
          }

          let statsDisplay = statsLeft;
          let statsWidth = visibleWidth(statsDisplay);
          if (statsWidth > width) {
            statsDisplay = truncateToWidth(statsDisplay, width, "...");
            statsWidth = visibleWidth(statsDisplay);
          }
          const availableForRight = width - statsWidth - 2;
          let statsLine = statsDisplay;
          if (availableForRight > 0) {
            const truncatedRight = truncateToWidth(
              rightSide,
              availableForRight,
              "",
            );
            const padding = " ".repeat(
              Math.max(
                0,
                width - statsWidth - visibleWidth(truncatedRight),
              ),
            );
            statsLine = `${statsDisplay}${padding}${theme.fg("dim", truncatedRight)}`;
          }

          const lines = [
            truncateToWidth(
              theme.fg("dim", pwd),
              width,
              theme.fg("dim", "..."),
            ),
          ];
          lines.push(statsLine);

          // 第 3 行：各扩展的 setStatus 状态
          const statuses = footerData.getExtensionStatuses();
          if (statuses.size > 0) {
            const statusLine = Array.from(statuses.entries())
              .sort(([a], [b]) => a.localeCompare(b))
              .map(([, text]) =>
                text
                  .replace(/[\r\n\t]/g, " ")
                  .replace(/ +/g, " ")
                  .trim(),
              )
              .join(" ");
            lines.push(
              truncateToWidth(statusLine, width, theme.fg("dim", "...")),
            );
          }
          return lines;
        },
      };
    });
  };

  applyZhFooter();
  return () => {
    if (usingZhFooter) {
      usingZhFooter = false;
      ctx.ui.setFooter(undefined);
    } else {
      applyZhFooter();
    }
  };
}
