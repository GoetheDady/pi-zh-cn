/**
 * pi-zh-cn —— pi 简体中文 TUI 界面汉化扩展
 *
 * 覆盖范围（扩展 API 所及）：
 * - 流式加载提示（setWorkingMessage）
 * - thinking 折叠块标签（setHiddenThinkingLabel）
 * - 启动 header（setHeader）
 * - 底部状态栏（setFooter）
 * - 内置 read/bash/edit/write 工具的渲染文案（同名重注册，执行委托原实现）
 *
 * 不改动发给模型的内容（工具 description 保持英文）。
 */

import type {
  BashToolDetails,
  EditToolDetails,
  ExtensionAPI,
  FindToolDetails,
  GrepToolDetails,
  LsToolDetails,
  PowerShellToolDetails,
  ReadToolDetails,
} from "@earendil-works/pi-coding-agent";
import {
  CONFIG_DIR_NAME,
  createBashTool,
  createEditTool,
  createFindTool,
  createGrepTool,
  createLsTool,
  createPowerShellTool,
  createReadTool,
  createWriteTool,
  getAgentDir,
  keyHint,
  keyText,
  rawKeyHint,
  VERSION,
} from "@earendil-works/pi-coding-agent";
import { homedir } from "node:os";
import { readFileSync } from "node:fs";
import { join, relative } from "node:path";
import type { AssistantMessage } from "@earendil-works/pi-ai";
import { Text, truncateToWidth, visibleWidth } from "@earendil-works/pi-tui";
import { zh } from "./zh.ts";

export default function (pi: ExtensionAPI) {
  let toggleFooter: (() => void) | undefined;

  // 只注册一次；当前 session 的 footer 实现由 session_start 更新。
  pi.registerCommand("footer", {
    description: "在中文 footer 和内置 footer 之间切换",
    handler: async () => {
      toggleFooter?.();
    },
  });

  // ---------- UI 文案 + 中文 header/footer（session 启动时应用） ----------
  pi.on("session_start", (_event, ctx) => {
    if (!ctx.hasUI) return;

    ctx.ui.setWorkingMessage(zh.workingMessage);
    ctx.ui.setHiddenThinkingLabel(zh.hiddenThinkingLabel);

    // 中文 header：复刻内置结构（标题 + 折叠提示行 + 引导语），快捷键跟随用户键位配置。
    if (ctx.mode === "tui") {
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
          return [
            logo,
            compact,
            theme.fg(
              "dim",
              `${zh.header.expandHelp} (${keyText("app.tools.expand")})`,
            ),
            "",
            theme.fg("dim", zh.header.onboarding),
          ];
        },
        invalidate() {},
      }));
    }

    // 中文 footer：逐行复刻内置信息（pwd 行 / 统计行 / 扩展状态行），仅描述文案用中文。
    if (ctx.mode === "tui") {
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
              const xpIndex =
                process.env.PI_EXPERIMENTAL === "1" ? clauses.length : -1;
              if (xpIndex >= 0) clauses.push("xp");

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
                  if (index === xpIndex) {
                    return `${theme.fg("dim", "•")} ${theme.bold(theme.fg("warning", "xp"))}`;
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
      toggleFooter = () => {
        if (usingZhFooter) {
          usingZhFooter = false;
          ctx.ui.setFooter(undefined);
        } else {
          applyZhFooter();
        }
      };
    }

    registerLocalizedTools(ctx.cwd);
  });

  function registerLocalizedTools(cwd: string) {
    const activeTools = pi.getActiveTools();
    const builtinTools = new Set(
      pi
        .getAllTools()
        .filter((tool) => tool.sourceInfo.source === "builtin")
        .map((tool) => tool.name),
    );

    // ---------- 内置工具汉化渲染 ----------
    // read
    const originalRead = createReadTool(cwd);
    pi.registerTool({
      ...originalRead,
      label: zh.tools.read.label,

      renderCall(args: any, theme: any, _context: any) {
        let text = theme.fg("toolTitle", theme.bold(`${zh.tools.read.title} `));
        text += theme.fg("accent", args.path);
        if (args.offset || args.limit) {
          const parts: string[] = [];
          if (args.offset) parts.push(`offset=${args.offset}`);
          if (args.limit) parts.push(`limit=${args.limit}`);
          text += theme.fg("dim", ` (${parts.join(", ")})`);
        }
        return new Text(text, 0, 0);
      },

      renderResult(
        result: any,
        { expanded, isPartial }: { expanded: boolean; isPartial: boolean },
        theme: any,
        _context: any,
      ) {
        if (isPartial)
          return new Text(theme.fg("warning", zh.tools.read.reading), 0, 0);

        const details = result.details as ReadToolDetails | undefined;
        const content = result.content[0];

        if (content?.type === "image") {
          return new Text(theme.fg("success", zh.tools.read.imageLoaded), 0, 0);
        }
        if (content?.type !== "text") {
          return new Text(theme.fg("error", zh.tools.read.noContent), 0, 0);
        }

        const lineCount = content.text.split("\n").length;
        let text = theme.fg("success", zh.tools.read.lines(lineCount));

        if (details?.truncation?.truncated) {
          text += theme.fg(
            "warning",
            zh.tools.read.truncatedFrom(details.truncation.totalLines),
          );
        }

        if (expanded) {
          for (const line of content.text.split("\n")) {
            text += `\n${theme.fg("dim", line)}`;
          }
        }

        return new Text(text, 0, 0);
      },
    });

    // bash
    const originalBash = createBashTool(cwd);
    pi.registerTool({
      ...originalBash,
      label: zh.tools.bash.label,

      renderCall(args: any, theme: any, _context: any) {
        let text = theme.fg("toolTitle", theme.bold(zh.tools.bash.title));
        const cmd: string =
          args.command.length > 80
            ? `${args.command.slice(0, 77)}...`
            : args.command;
        text += theme.fg("accent", cmd);
        if (args.timeout) {
          text += theme.fg("dim", zh.tools.bash.timeout(args.timeout));
        }
        return new Text(text, 0, 0);
      },

      renderResult(
        result: any,
        { expanded, isPartial }: { expanded: boolean; isPartial: boolean },
        theme: any,
        _context: any,
      ) {
        if (isPartial)
          return new Text(theme.fg("warning", zh.tools.bash.running), 0, 0);

        const details = result.details as BashToolDetails | undefined;
        const content = result.content[0];
        const output: string = content?.type === "text" ? content.text : "";

        const exitMatch = output.match(
          /(?:exit code:\s*|command exited with code\s+)(\d+)/i,
        );
        const exitCode = exitMatch ? parseInt(exitMatch[1], 10) : null;
        const failed =
          exitCode !== null ||
          /^error\b/i.test(output) ||
          /\n\ncommand (?:timed out|was aborted|failed)/i.test(output);
        const lineCount = output.split("\n").filter((l) => l.trim()).length;

        let text = "";
        if (!failed) {
          text += theme.fg("success", zh.tools.bash.done);
        } else {
          text += theme.fg(
            "error",
            exitCode !== null
              ? zh.tools.bash.exit(exitCode)
              : zh.tools.bash.failed,
          );
        }
        text += theme.fg("dim", ` (${zh.tools.bash.lines(lineCount)})`);

        if (details?.truncation?.truncated) {
          text += theme.fg("warning", ` ${zh.tools.bash.truncated}`);
        }

        if (expanded) {
          for (const line of output.split("\n")) {
            text += `\n${theme.fg("dim", line)}`;
          }
        }

        return new Text(text, 0, 0);
      },
    });

    // edit
    const originalEdit = createEditTool(cwd);
    pi.registerTool({
      ...originalEdit,
      label: zh.tools.edit.label,
      renderShell: "self",

      renderCall(args: any, theme: any, _context: any) {
        let text = theme.fg("toolTitle", theme.bold(zh.tools.edit.title));
        text += theme.fg("accent", args.path);
        return new Text(text, 0, 0);
      },

      renderResult(
        result: any,
        { expanded, isPartial }: { expanded: boolean; isPartial: boolean },
        theme: any,
        _context: any,
      ) {
        if (isPartial)
          return new Text(theme.fg("warning", zh.tools.edit.editing), 0, 0);

        const details = result.details as EditToolDetails | undefined;
        const content = result.content[0];

        if (content?.type === "text" && content.text.startsWith("Error")) {
          return new Text(theme.fg("error", content.text.split("\n")[0]), 0, 0);
        }
        if (!details?.diff) {
          return new Text(theme.fg("success", zh.tools.edit.applied), 0, 0);
        }

        const diffLines: string[] = details.diff.split("\n");
        let additions = 0,
          removals = 0;
        for (const line of diffLines) {
          if (line.startsWith("+") && !line.startsWith("+++")) additions++;
          if (line.startsWith("-") && !line.startsWith("---")) removals++;
        }

        let text = theme.fg("success", zh.tools.edit.additions(additions));
        text += theme.fg("dim", " / ");
        text += theme.fg("error", zh.tools.edit.removals(removals));

        if (expanded) {
          for (const line of diffLines) {
            text += `\n${theme.fg("dim", line)}`;
          }
        }

        return new Text(text, 0, 0);
      },
    });

    // write
    const originalWrite = createWriteTool(cwd);
    pi.registerTool({
      ...originalWrite,
      label: zh.tools.write.label,

      renderCall(args: any, theme: any, _context: any) {
        let text = theme.fg("toolTitle", theme.bold(zh.tools.write.title));
        text += theme.fg("accent", args.path);
        const lineCount = String(args.content).split("\n").length;
        text += theme.fg("dim", ` (${zh.tools.write.lines(lineCount)})`);
        return new Text(text, 0, 0);
      },

      renderResult(
        result: any,
        { isPartial }: { isPartial: boolean },
        theme: any,
        _context: any,
      ) {
        if (isPartial)
          return new Text(theme.fg("warning", zh.tools.write.writing), 0, 0);

        const content = result.content[0];
        if (content?.type === "text" && content.text.startsWith("Error")) {
          return new Text(theme.fg("error", content.text.split("\n")[0]), 0, 0);
        }

        return new Text(theme.fg("success", zh.tools.write.written), 0, 0);
      },
    });

    if (builtinTools.has("grep")) {
      const originalGrep = createGrepTool(cwd);
      pi.registerTool({
        ...originalGrep,
        label: zh.tools.grep.label,

        renderCall(args: any, theme: any, _context: any) {
          let text = theme.fg("toolTitle", theme.bold(zh.tools.grep.title));
          text += theme.fg("accent", args.pattern);
          if (args.path) text += theme.fg("dim", ` · ${args.path}`);
          if (args.glob) text += theme.fg("dim", ` (${args.glob})`);
          return new Text(text, 0, 0);
        },

        renderResult(
          result: any,
          { expanded, isPartial }: { expanded: boolean; isPartial: boolean },
          theme: any,
          _context: any,
        ) {
          if (isPartial)
            return new Text(theme.fg("warning", zh.tools.grep.searching), 0, 0);

          const details = result.details as GrepToolDetails | undefined;
          const content = result.content[0];
          const output = content?.type === "text" ? content.text : "";
          const noMatches = output === "No matches found";
          const count = output
            .split("\n")
            .filter((line: string) => line.trim()).length;
          let text = theme.fg(
            noMatches ? "muted" : "success",
            noMatches ? zh.tools.grep.noMatches : zh.tools.grep.matches(count),
          );
          if (details?.matchLimitReached !== undefined) {
            text += theme.fg(
              "warning",
              zh.tools.grep.matchLimit(details.matchLimitReached),
            );
          }
          if (details?.linesTruncated || details?.truncation?.truncated) {
            text += theme.fg("warning", zh.tools.grep.truncated);
          }
          if (expanded && output) {
            const expandedOutput = noMatches ? zh.tools.grep.noMatches : output;
            text += `\n${theme.fg("dim", expandedOutput)}`;
          }
          return new Text(text, 0, 0);
        },
      });
    }

    if (builtinTools.has("find")) {
      const originalFind = createFindTool(cwd);
      pi.registerTool({
        ...originalFind,
        label: zh.tools.find.label,

        renderCall(args: any, theme: any, _context: any) {
          let text = theme.fg("toolTitle", theme.bold(zh.tools.find.title));
          text += theme.fg("accent", args.pattern);
          if (args.path) text += theme.fg("dim", ` · ${args.path}`);
          return new Text(text, 0, 0);
        },

        renderResult(
          result: any,
          { expanded, isPartial }: { expanded: boolean; isPartial: boolean },
          theme: any,
          _context: any,
        ) {
          if (isPartial)
            return new Text(theme.fg("warning", zh.tools.find.searching), 0, 0);

          const details = result.details as FindToolDetails | undefined;
          const content = result.content[0];
          const output = content?.type === "text" ? content.text : "";
          const noFiles = output === "No files found matching pattern";
          const count = output
            .split("\n")
            .filter((line: string) => line.trim()).length;
          let text = theme.fg(
            noFiles ? "muted" : "success",
            noFiles ? zh.tools.find.noFiles : zh.tools.find.results(count),
          );
          if (details?.resultLimitReached !== undefined) {
            text += theme.fg(
              "warning",
              zh.tools.find.resultLimit(details.resultLimitReached),
            );
          }
          if (details?.truncation?.truncated) {
            text += theme.fg("warning", zh.tools.grep.truncated);
          }
          if (expanded && output) {
            const expandedOutput = noFiles ? zh.tools.find.noFiles : output;
            text += `\n${theme.fg("dim", expandedOutput)}`;
          }
          return new Text(text, 0, 0);
        },
      });
    }

    if (builtinTools.has("ls")) {
      const originalLs = createLsTool(cwd);
      pi.registerTool({
        ...originalLs,
        label: zh.tools.ls.label,

        renderCall(args: any, theme: any, _context: any) {
          let text = theme.fg("toolTitle", theme.bold(zh.tools.ls.title));
          text += theme.fg("accent", args.path || ".");
          return new Text(text, 0, 0);
        },

        renderResult(
          result: any,
          { expanded, isPartial }: { expanded: boolean; isPartial: boolean },
          theme: any,
          _context: any,
        ) {
          if (isPartial)
            return new Text(theme.fg("warning", zh.tools.ls.listing), 0, 0);

          const details = result.details as LsToolDetails | undefined;
          const content = result.content[0];
          const output = content?.type === "text" ? content.text : "";
          const empty = output === "(empty directory)";
          const count = output
            .split("\n")
            .filter((line: string) => line.trim()).length;
          let text = theme.fg(
            empty ? "muted" : "success",
            empty ? zh.tools.ls.empty : zh.tools.ls.entries(count),
          );
          if (details?.entryLimitReached !== undefined) {
            text += theme.fg(
              "warning",
              zh.tools.ls.entryLimit(details.entryLimitReached),
            );
          }
          if (details?.truncation?.truncated) {
            text += theme.fg("warning", zh.tools.grep.truncated);
          }
          if (expanded && output) {
            const expandedOutput = empty ? zh.tools.ls.empty : output;
            text += `\n${theme.fg("dim", expandedOutput)}`;
          }
          return new Text(text, 0, 0);
        },
      });
    }

    if (builtinTools.has("powershell")) {
      const originalPowerShell = createPowerShellTool(cwd);
      pi.registerTool({
        ...originalPowerShell,
        label: zh.tools.powershell.label,

        renderCall(args: any, theme: any, _context: any) {
          let text = theme.fg(
            "toolTitle",
            theme.bold(zh.tools.powershell.title),
          );
          const command =
            args.command.length > 80
              ? `${args.command.slice(0, 77)}...`
              : args.command;
          text += theme.fg("accent", command);
          if (args.timeout) {
            text += theme.fg("dim", zh.tools.powershell.timeout(args.timeout));
          }
          return new Text(text, 0, 0);
        },

        renderResult(
          result: any,
          { expanded, isPartial }: { expanded: boolean; isPartial: boolean },
          theme: any,
          _context: any,
        ) {
          if (isPartial)
            return new Text(
              theme.fg("warning", zh.tools.powershell.running),
              0,
              0,
            );

          const details = result.details as PowerShellToolDetails | undefined;
          const content = result.content[0];
          const output = content?.type === "text" ? content.text : "";
          const exitMatch = output.match(
            /(?:exit code:\s*|command exited with code\s+)(\d+)/i,
          );
          const exitCode = exitMatch ? parseInt(exitMatch[1], 10) : null;
          const failed =
            exitCode !== null ||
            /^error\b/i.test(output) ||
            /only available on windows/i.test(output) ||
            /\n\ncommand (?:timed out|was aborted|failed)/i.test(output);
          const lineCount = output
            .split("\n")
            .filter((line: string) => line.trim()).length;
          let text = theme.fg(
            failed ? "error" : "success",
            failed
              ? exitCode !== null
                ? zh.tools.powershell.exit(exitCode)
                : zh.tools.powershell.failed
              : zh.tools.powershell.done,
          );
          text += theme.fg("dim", ` (${zh.tools.powershell.lines(lineCount)})`);
          if (details?.truncation?.truncated) {
            text += theme.fg("warning", ` ${zh.tools.powershell.truncated}`);
          }
          if (expanded) {
            for (const line of output.split("\n")) {
              text += `\n${theme.fg("dim", line)}`;
            }
          }
          return new Text(text, 0, 0);
        },
      });
    }

    // 同名注册可能改变 active 集合；恢复注册前的工具启用状态。
    pi.setActiveTools(activeTools);
  }
}
