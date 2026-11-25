/**
 * 中文 footer：逐行复刻内置信息（pwd 行 / 统计行 / 扩展状态行），仅描述文案用中文。
 */
import { readFileSync } from "node:fs";
import { homedir } from "node:os";
import { join, relative } from "node:path";
import type { AssistantMessage } from "@earendil-works/pi-ai";
import type { ExtensionContext } from "@earendil-works/pi-coding-agent";
import { truncateToWidth, visibleWidth } from "@earendil-works/pi-tui";
import { settingsFiles } from "./settings.ts";
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
    const settingsPaths = settingsFiles(ctx);
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

      // —— usage 增量缓存 ——
      // 长会话里 render 每次全量遍历 entries 是 O(n)，而全屏滚动会频繁重绘 footer
      // （1.6.0 的 #9549 只优化了 transcript，footer 仍每帧渲染）。旧条目不可变，
      // 只有最后一条会因流式而变化，故缓存「除最后一条外」的聚合，每次只重算最后
      // 一条，把热路径降到 O(1)；条目数变化（新增/回退/换会话）时才 O(n) 重算一次。
      type UsageTotals = {
        input: number;
        output: number;
        cacheRead: number;
        cacheWrite: number;
        cost: number;
      };
      const zeroTotals = (): UsageTotals => ({
        input: 0,
        output: 0,
        cacheRead: 0,
        cacheWrite: 0,
        cost: 0,
      });
      /** 单条 entries → 用量快照（assistant 附带缓存命中率）；非用量条目返回 null。 */
      const entryUsage = (
        e: any,
      ): (UsageTotals & { rate?: number }) | null => {
        const fromUsage = (u: {
          input: number;
          output: number;
          cacheRead: number;
          cacheWrite: number;
          cost: { total: number };
        }): UsageTotals => ({
          input: u.input,
          output: u.output,
          cacheRead: u.cacheRead,
          cacheWrite: u.cacheWrite,
          cost: u.cost.total,
        });
        if (e.type === "message" && e.message.role === "assistant") {
          const u = (e.message as AssistantMessage).usage;
          const promptTokens = u.input + u.cacheRead + u.cacheWrite;
          return {
            ...fromUsage(u),
            rate:
              promptTokens > 0
                ? (u.cacheRead / promptTokens) * 100
                : undefined,
          };
        }
        if (
          e.type === "message" &&
          e.message.role === "toolResult" &&
          e.message.usage
        ) {
          return fromUsage(e.message.usage);
        }
        if (
          (e.type === "branch_summary" || e.type === "compaction") &&
          e.usage
        ) {
          return fromUsage(e.usage);
        }
        // 1.6.0：cache-warmer 会写 type:"usage" 的用量条目（cacheWarming 默认 "idle"）。
        // 上游 footer 把它计入统计（usage-totals.js 的 entry.type === "usage"），
        // 这里一并计入，否则开缓存预热时 token/费用会比内置少。
        if (e.type === "usage" && e.usage) {
          return fromUsage(e.usage);
        }
        return null;
      };
      // 缓存键：会话 + 叶子（分支）+ 条目数，与上游 footer 的 getSessionStats 一致。
      // 只按条目数会漏掉「切分支到等长路径」这类内容变了、条数不变的情况而串味。
      let prefixKey = "";
      let prefixTotals: UsageTotals = zeroTotals();
      let prefixRate: number | undefined;

      return {
        dispose() {
          unsubscribeBranch?.();
          unsubscribeBranch = undefined;
        },
        invalidate() {},
        /** 汇总会话 usage 统计并渲染三行中文 footer，见模块级说明。 */
        render(width: number): string[] {
          const entries = ctx.sessionManager.getEntries();
          const n = entries.length;
          const cacheKey = `${ctx.sessionManager.getSessionId()}|${ctx.sessionManager.getLeafId()}|${n}`;
          // 除最后一条外的聚合只在会话/分支/条目数变化时重算（旧条目不可变）。
          if (cacheKey !== prefixKey) {
            const p = zeroTotals();
            let rate: number | undefined;
            for (let i = 0; i < n - 1; i++) {
              const u = entryUsage(entries[i]);
              if (!u) continue;
              p.input += u.input;
              p.output += u.output;
              p.cacheRead += u.cacheRead;
              p.cacheWrite += u.cacheWrite;
              p.cost += u.cost;
              if (u.rate !== undefined) rate = u.rate;
            }
            prefixTotals = p;
            prefixRate = rate;
            prefixKey = cacheKey;
          }
          // 每次只重算最后一条：流式中它的 usage 持续变化。
          let input = prefixTotals.input,
            output = prefixTotals.output,
            cacheRead = prefixTotals.cacheRead,
            cacheWrite = prefixTotals.cacheWrite,
            cost = prefixTotals.cost;
          let latestRate = prefixRate;
          if (n > 0) {
            const last = entryUsage(entries[n - 1]);
            if (last) {
              input += last.input;
              output += last.output;
              cacheRead += last.cacheRead;
              cacheWrite += last.cacheWrite;
              cost += last.cost;
              if (last.rate !== undefined) latestRate = last.rate;
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
