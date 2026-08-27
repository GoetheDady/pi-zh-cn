/**
 * pi-zh-cn —— pi 简体中文 TUI 界面汉化扩展
 *
 * 覆盖范围（扩展 API 所及）：
 * - 流式加载提示（setWorkingMessage）
 * - thinking 折叠块标签（setHiddenThinkingLabel）
 * - 启动 header（setHeader）
 * - 底部状态栏（setFooter）
 * - 项目信任弹窗（project_trust handler + 中文 select）
 * - 内置斜杠命令描述（addAutocompleteProvider 包一层翻译）
 * - 内置 read/bash/edit/write 工具的渲染文案（同名重注册，执行委托原实现）
 *
 * 不改动发给模型的内容（工具 description 保持英文）。
 */

import type {
  BashToolDetails,
  EditToolDetails,
  ExtensionAPI,
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
import { readFileSync, realpathSync } from "node:fs";
import { dirname, join, relative } from "node:path";
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

  // ---------- 项目信任弹窗（中文选择器代替内置英文界面） ----------
  // 复刻 ~/「agent dir」/trust.json 的祖先目录查找逻辑；已有决定的目录不再弹窗。
  // 与内置的差异：「信任父文件夹」选项无法通过扩展 API 写入父目录决定，故省略。
  const savedTrustDecision = (dir: string): boolean | null => {
    let current = dir;
    try {
      current = realpathSync(current); // 与 core 的 normalizeCwd 一致
    } catch {
      // 目录不存在时保持原样
    }
    try {
      const store = JSON.parse(readFileSync(join(getAgentDir(), "trust.json"), "utf8"));
      for (;;) {
        const decision = store[current];
        if (typeof decision === "boolean") return decision;
        const parent = dirname(current);
        if (parent === current) return null;
        current = parent;
      }
    } catch {
      return null; // 无 trust.json 或内容无效 → 视作没有已存决定
    }
  };

  pi.on("project_trust", async (event, ctx) => {
    // 无 UI（rpc/print 等模式）或已有保存的决定时返回 undecided，让 core 走默认流程。
    if (!ctx.hasUI || savedTrustDecision(event.cwd) !== null) return { trusted: "undecided" };

    const options = [
      zh.trust.options.trustAndRemember,
      zh.trust.options.trustSessionOnly,
      zh.trust.options.distrustAndRemember,
      zh.trust.options.distrustSessionOnly,
    ];
    const selected = await ctx.ui.select(zh.trust.title(event.cwd), options);
    switch (selected ?? zh.trust.options.distrustSessionOnly) {
      case zh.trust.options.trustAndRemember:
        return { trusted: "yes", remember: true };
      case zh.trust.options.trustSessionOnly:
        return { trusted: "yes" };
      case zh.trust.options.distrustAndRemember:
        return { trusted: "no", remember: true };
      default:
        return { trusted: "no" }; // 取消 = 本次不信任（与内置行为一致）
    }
  });

  // ---------- UI 文案 + 中文 header/footer（session 启动时应用） ----------
  let autocompleteTranslated = false;
  pi.on("session_start", (_event, ctx) => {
    if (!ctx.hasUI) return;

    ctx.ui.setWorkingMessage(zh.workingMessage);
    ctx.ui.setHiddenThinkingLabel(zh.hiddenThinkingLabel);

    // 中文化内置斜杠命令描述：包一层自动补全 provider，只替换命令项的
    // description（文件补全等其他建议原样透传）。替换是幂等的，跨 session 只包一次。
    if (ctx.mode === "tui" && !autocompleteTranslated) {
      autocompleteTranslated = true;
      ctx.ui.addAutocompleteProvider((current) => ({
        ...(current.triggerCharacters ? { triggerCharacters: current.triggerCharacters } : {}),
        getSuggestions: async (lines, cursorLine, cursorCol, options) => {
          const suggestions = await current.getSuggestions(lines, cursorLine, cursorCol, options);
          if (!suggestions) return null;
          return {
            ...suggestions,
            items: suggestions.items.map((item) => {
              const key = item.value.replace(/^\//, "") as keyof typeof zh.builtinCommands;
              const zhDesc = zh.builtinCommands[key];
              return zhDesc ? { ...item, description: zhDesc } : item;
            }),
          };
        },
        applyCompletion: (lines, cursorLine, cursorCol, item, prefix) =>
          current.applyCompletion(lines, cursorLine, cursorCol, item, prefix),
      }));
    }

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

  // ---------- 工具渲染通用小工具 ----------
  const textOf = (result: any): string =>
    result.content?.[0]?.type === "text" ? result.content[0].text : "";

  const countNonEmpty = (s: string): number =>
    s.split("\n").filter((l) => l.trim()).length;

  const notePartial = (msg: string, theme: any): Text =>
    new Text(theme.fg("warning", msg), 0, 0);

  // 错误结果：内容以 "Error" 开头时只展示首行（edit/write 共用）。
  const errorFirstLine = (result: any, theme: any): Text | undefined => {
    const out = textOf(result);
    return out.startsWith("Error")
      ? new Text(theme.fg("error", out.split("\n")[0]), 0, 0)
      : undefined;
  };

  // 展开态：在摘要后追加逐行弱化的原始输出。
  const withExpanded = (raw: string, summary: string, theme: any): string =>
    raw
      ? `${summary}\n${raw
          .split("\n")
          .map((l) => theme.fg("dim", l))
          .join("\n")}`
      : summary;

  // 失败判定（bash/powershell 共用）：解析退出码；powershell 通过 extraRe
  // 追加 Windows 平台提示的识别。
  function failureState(output: string, extraRe: RegExp[] = []) {
    const m = output.match(
      /(?:exit code:\s*|command exited with code\s+)(\d+)/i,
    );
    const exitCode = m ? parseInt(m[1], 10) : null;
    return {
      exitCode,
      failed:
        exitCode !== null ||
        /^error\b/i.test(output) ||
        /\n\ncommand (?:timed out|was aborted|failed)/i.test(output) ||
        extraRe.some((re) => re.test(output)),
    };
  }

  // shell 类工具（bash/powershell 文案同构）的渲染对。
  type ShellCopy =
    | typeof zh.tools.bash
    | typeof zh.tools.powershell;
  const shellRenders = (w: ShellCopy, extraRe: RegExp[] = []) => ({
    renderCall(args: any, theme: any): Text {
      let text = theme.fg("toolTitle", theme.bold(w.title));
      const cmd: string =
        args.command.length > 80
          ? `${args.command.slice(0, 77)}...`
          : args.command;
      text += theme.fg("accent", cmd);
      if (args.timeout) text += theme.fg("dim", w.timeout(args.timeout));
      return new Text(text, 0, 0);
    },

    renderResult(
      result: any,
      { expanded, isPartial }: { expanded: boolean; isPartial: boolean },
      theme: any,
    ): Text {
      if (isPartial) return notePartial(w.running, theme);
      const output = textOf(result);
      const { exitCode, failed } = failureState(output, extraRe);
      let text = failed
        ? theme.fg(
            "error",
            exitCode !== null ? w.exit(exitCode) : w.failed,
          )
        : theme.fg("success", w.done);
      text += theme.fg("dim", ` (${w.lines(countNonEmpty(output))})`);
      if (
        (result.details as BashToolDetails | undefined)?.truncation?.truncated
      ) {
        text += theme.fg("warning", ` ${w.truncated}`);
      }
      return new Text(withExpanded(expanded ? output : "", text, theme), 0, 0);
    },
  });

  // 计数类工具（grep/find/ls 文案同构）的结果渲染：无匹配哨兵、条数统计、
  // 上限提示与截断警告四处逻辑一致，仅文案不同。
  function countResultRender(
    labels: {
      searching: string;
      noMatch: string;
      found: (n: number) => string;
      limit?: (n: number) => string;
      truncated: string;
    },
    sentinel: string,
    limitField: string,
  ) {
    return (
      result: any,
      { expanded, isPartial }: { expanded: boolean; isPartial: boolean },
      theme: any,
    ): Text => {
      if (isPartial) return notePartial(labels.searching, theme);
      const details = result.details ?? {};
      const output = textOf(result);
      const isEmpty = output === sentinel;
      let text = theme.fg(
        isEmpty ? "muted" : "success",
        isEmpty ? labels.noMatch : labels.found(countNonEmpty(output)),
      );
      if (labels.limit && typeof details[limitField] === "number") {
        text += theme.fg("warning", labels.limit(details[limitField]));
      }
      // 与旧实现的行为差异：grep 原本同时检查 linesTruncated，find/ls 只查
      // truncation.truncated；这里统一为两者都检查，Find/LsToolDetails 目前无
      // linesTruncated 字段，运行时行为等价。若上游新增该字段需复核。
      if (details.linesTruncated || details.truncation?.truncated) {
        text += theme.fg("warning", labels.truncated);
      }
      return new Text(
        withExpanded(
          expanded ? (isEmpty ? labels.noMatch : output) : "",
          text,
          theme,
        ),
        0,
        0,
      );
    };
  }

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
    pi.registerTool({
      ...createReadTool(cwd),
      label: zh.tools.read.label,

      renderCall(args: any, theme: any) {
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
      ) {
        if (isPartial) return notePartial(zh.tools.read.reading, theme);

        const content = result.content[0];
        if (content?.type === "image") {
          return new Text(theme.fg("success", zh.tools.read.imageLoaded), 0, 0);
        }
        if (content?.type !== "text") {
          return new Text(theme.fg("error", zh.tools.read.noContent), 0, 0);
        }

        let text = theme.fg(
          "success",
          zh.tools.read.lines(content.text.split("\n").length),
        );
        const truncation = (result.details as ReadToolDetails | undefined)
          ?.truncation;
        if (truncation?.truncated) {
          text += theme.fg(
            "warning",
            zh.tools.read.truncatedFrom(truncation.totalLines),
          );
        }
        return new Text(
          withExpanded(expanded ? content.text : "", text, theme),
          0,
          0,
        );
      },
    });

    // bash / powershell（渲染逻辑同构，仅文案与失败判定集合不同）
    pi.registerTool({
      ...createBashTool(cwd),
      label: zh.tools.bash.label,
      ...shellRenders(zh.tools.bash),
    });

    // edit
    pi.registerTool({
      ...createEditTool(cwd),
      label: zh.tools.edit.label,
      renderShell: "self",

      renderCall(args: any, theme: any) {
        let text = theme.fg("toolTitle", theme.bold(zh.tools.edit.title));
        text += theme.fg("accent", args.path);
        return new Text(text, 0, 0);
      },

      renderResult(
        result: any,
        { expanded, isPartial }: { expanded: boolean; isPartial: boolean },
        theme: any,
      ) {
        if (isPartial) return notePartial(zh.tools.edit.editing, theme);

        const err = errorFirstLine(result, theme);
        if (err) return err;

        const details = result.details as EditToolDetails | undefined;
        if (!details?.diff) {
          return new Text(theme.fg("success", zh.tools.edit.applied), 0, 0);
        }

        let additions = 0,
          removals = 0;
        for (const line of details.diff.split("\n")) {
          if (line.startsWith("+") && !line.startsWith("+++")) additions++;
          if (line.startsWith("-") && !line.startsWith("---")) removals++;
        }

        let text = theme.fg("success", zh.tools.edit.additions(additions));
        text += theme.fg("dim", " / ");
        text += theme.fg("error", zh.tools.edit.removals(removals));

        return new Text(
          withExpanded(expanded ? details.diff : "", text, theme),
          0,
          0,
        );
      },
    });

    // write
    pi.registerTool({
      ...createWriteTool(cwd),
      label: zh.tools.write.label,

      renderCall(args: any, theme: any) {
        let text = theme.fg("toolTitle", theme.bold(zh.tools.write.title));
        text += theme.fg("accent", args.path);
        const lineCount = String(args.content).split("\n").length;
        text += theme.fg("dim", ` (${zh.tools.write.lines(lineCount)})`);
        return new Text(text, 0, 0);
      },

      renderResult(result: any, { isPartial }: { isPartial: boolean }, theme: any) {
        if (isPartial) return notePartial(zh.tools.write.writing, theme);
        const err = errorFirstLine(result, theme);
        if (err) return err;
        return new Text(theme.fg("success", zh.tools.write.written), 0, 0);
      },
    });

    // grep / find / ls：调用渲染各自略有差异，结果渲染走同一个计数模板。
    if (builtinTools.has("grep")) {
      pi.registerTool({
        ...createGrepTool(cwd),
        label: zh.tools.grep.label,

        renderCall(args: any, theme: any) {
          let text = theme.fg("toolTitle", theme.bold(zh.tools.grep.title));
          text += theme.fg("accent", args.pattern);
          if (args.path) text += theme.fg("dim", ` · ${args.path}`);
          if (args.glob) text += theme.fg("dim", ` (${args.glob})`);
          return new Text(text, 0, 0);
        },

        renderResult: countResultRender(
          {
            searching: zh.tools.grep.searching,
            noMatch: zh.tools.grep.noMatches,
            found: zh.tools.grep.matches,
            limit: zh.tools.grep.matchLimit,
            truncated: zh.tools.grep.truncated,
          },
          "No matches found",
          "matchLimitReached",
        ),
      });
    }

    if (builtinTools.has("find")) {
      pi.registerTool({
        ...createFindTool(cwd),
        label: zh.tools.find.label,

        renderCall(args: any, theme: any) {
          let text = theme.fg("toolTitle", theme.bold(zh.tools.find.title));
          text += theme.fg("accent", args.pattern);
          if (args.path) text += theme.fg("dim", ` · ${args.path}`);
          return new Text(text, 0, 0);
        },

        renderResult: countResultRender(
          {
            searching: zh.tools.find.searching,
            noMatch: zh.tools.find.noFiles,
            found: zh.tools.find.results,
            limit: zh.tools.find.resultLimit,
            truncated: zh.tools.grep.truncated,
          },
          "No files found matching pattern",
          "resultLimitReached",
        ),
      });
    }

    if (builtinTools.has("ls")) {
      pi.registerTool({
        ...createLsTool(cwd),
        label: zh.tools.ls.label,

        renderCall(args: any, theme: any) {
          let text = theme.fg("toolTitle", theme.bold(zh.tools.ls.title));
          text += theme.fg("accent", args.path || ".");
          return new Text(text, 0, 0);
        },

        renderResult: countResultRender(
          {
            searching: zh.tools.ls.listing,
            noMatch: zh.tools.ls.empty,
            found: zh.tools.ls.entries,
            limit: zh.tools.ls.entryLimit,
            truncated: zh.tools.grep.truncated,
          },
          "(empty directory)",
          "entryLimitReached",
        ),
      });
    }

    if (builtinTools.has("powershell")) {
      pi.registerTool({
        ...createPowerShellTool(cwd),
        label: zh.tools.powershell.label,
        ...shellRenders(zh.tools.powershell, [/only available on windows/i]),
      });
    }

    // 同名注册可能改变 active 集合；恢复注册前的工具启用状态。
    pi.setActiveTools(activeTools);
  }
}
