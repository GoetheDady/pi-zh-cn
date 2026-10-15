/**
 * 内置 read/bash/edit/write/grep/find/ls/powershell 工具的中文渲染。
 * 同名重注册，执行委托原实现（createXxxTool）；
 * 不改动发给模型的内容（工具 description 保持英文）。
 */
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import {
  createBashTool,
  createEditTool,
  createFindTool,
  createGrepTool,
  createLsTool,
  createPowerShellTool,
  createReadTool,
  createWriteTool,
  DEFAULT_MAX_BYTES,
  DEFAULT_MAX_LINES,
  formatSize,
  getLanguageFromPath,
  highlightCode,
  keyHint,
  type BashToolDetails,
  type ReadToolDetails,
  type TruncationResult,
} from "@earendil-works/pi-coding-agent";
import { Text } from "@earendil-works/pi-tui";
import { zh } from "./zh.ts";
import {
  countResultRender,
  notePartial,
  renderToolPath,
  shellRenders,
} from "./tool-renders.ts";

/** write 工具折叠态预览的行数（与内置 write 渲染器一致）。 */
const WRITE_PREVIEW_LINES = 10;

// grep / find / ls 折叠态显示的结果行数，取内置渲染器同样的值
// （renderers/grep.js 用 15，find.js / ls.js 用 20）。
const GREP_PREVIEW_LINES = 15;
const LIST_PREVIEW_LINES = 20;

/**
 * read 的截断提示，三种形态对齐内置 read 渲染器：首行就超字节上限、
 * 命中行数上限、命中字节上限。三者给的信息不同，合成一句会误导
 * （例如首行超限时并没有「共 N 行」这回事）。
 *
 * @param t 工具结果 details 里的 truncation
 */
function readTruncationNotice(t: TruncationResult): string {
  if (t.firstLineExceedsLimit) {
    return zh.tools.read.truncatedFirstLine(
      formatSize(t.maxBytes ?? DEFAULT_MAX_BYTES),
    );
  }
  if (t.truncatedBy === "lines") {
    return zh.tools.read.truncatedLines(
      t.outputLines,
      t.totalLines,
      t.maxLines ?? DEFAULT_MAX_LINES,
    );
  }
  return zh.tools.read.truncatedBytes(
    t.outputLines,
    formatSize(t.maxBytes ?? DEFAULT_MAX_BYTES),
  );
}

/**
 * 重注册所有内置工具的中文渲染。
 *
 * 逐个用 `createXxxTool(cwd)` 重新生成内置实现并展开同名注册：执行逻辑、
 * 参数与 description（发给模型的）保持原样，仅覆盖 `label` 与
 * `renderCall`/`renderResult` 为中文渲染；各工具在 `zh.tools.*` 下有自己的
 * 文案对象。grep / find / ls / powershell 仅在内置工具集存在时注册。
 *
 * @param pi 扩展 API 实例
 * @param cwd 当前项目目录（透传给 createXxxTool）
 */
export function registerLocalizedTools(pi: ExtensionAPI, cwd: string) {
  const activeTools = pi.getActiveTools();
  const builtinTools = new Set(
    pi
      .getAllTools()
      .filter((tool) => tool.sourceInfo.source === "builtin")
      .map((tool) => tool.name),
  );

  // read
  pi.registerTool({
    ...createReadTool(cwd),
    label: zh.tools.read.label,

    renderCall(args: any, theme: any, context?: { cwd?: string }) {
      let text = theme.fg("toolTitle", theme.bold(`${zh.tools.read.title} `));
      text += renderToolPath(args.path, theme, context?.cwd ?? "");
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
      // 渲染上下文的 args 用来判断文件语言，决定展开态是否高亮。
      context?: { args?: { path?: string } },
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
        text += theme.fg("warning", readTruncationNotice(truncation));
      }
      // 展开态跟随内置 read 渲染器做语法高亮；识别不出语言（或没有路径）时
      // 退回逐行弱化的原文，即本地化前的显示方式。
      const raw = content.text
        .replace(/\r/g, "")
        .replace(/\t/g, "   ")
        .replace(/\n+$/, "");
      const path = context?.args?.path;
      const lang = path ? getLanguageFromPath(path) : undefined;
      const body = expanded
        ? lang
          ? highlightCode(raw, lang).join("\n")
          : theme.fg("dim", raw)
        : "";
      return new Text(body ? `${text}\n${body}` : text, 0, 0);
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
    // 刻意不设 renderShell: "self"。上游 edit 声明它是为了自己用 Box 画那条
    // 状态色带（pending 黄 / 成功绿 / 失败红），而我们的 renderCall 只返回一个
    // 裸 Text，于是色带整个丢了——八种工具里只有 edit 没有。用默认 shell 时
    // 框架会拿 contentBox 自动套上同一套 bgFn（见 tool-execution.js 的
    // updateDisplay），色带就回来了，且不必复刻上游的 Box 组件。

    renderCall(args: any, theme: any, context?: { cwd?: string }) {
      let text = theme.fg("toolTitle", theme.bold(zh.tools.edit.title));
      text += renderToolPath(args.path, theme, context?.cwd ?? "");
      return new Text(text, 0, 0);
    },

    // 不覆盖 renderResult：沿用内置渲染器（行号 + 红绿 + 词级高亮的 diff）。
  });

  // write
  pi.registerTool({
    ...createWriteTool(cwd),
    label: zh.tools.write.label,

    renderCall(args: any, theme: any, context: any) {
      const rawLines = String(args.content ?? "")
        .replace(/\r/g, "")
        .replace(/\t/g, "   ")
        .split("\n");
      let end = rawLines.length;
      while (end > 0 && rawLines[end - 1] === "") end--;

      let text = theme.fg("toolTitle", theme.bold(zh.tools.write.title));
      text += renderToolPath(args.path, theme, context.cwd ?? "");
      text += theme.fg("dim", ` (${zh.tools.write.lines(end)})`);

      if (end > 0) {
        const maxLines = context.expanded ? end : WRITE_PREVIEW_LINES;
        const lang = args.path ? getLanguageFromPath(args.path) : undefined;
        // ponytail: 只高亮预览到的行，大文件折叠态不跑全量高亮；跨行语法
        // （块注释等）在预览边界可能染色偏移，需要精确时改全量高亮 + 增量缓存
        // （上游 write.js 的做法）。
        text += `\n\n${highlightCode(rawLines.slice(0, maxLines).join("\n"), lang).join("\n")}`;
        if (end > maxLines) {
          text += theme.fg(
            "muted",
            `\n${zh.tools.write.moreLines(end - maxLines, end)}`,
          );
          text += keyHint("app.tools.expand", zh.tools.write.expand);
          text += theme.fg("muted", "）");
        }
      }
      return new Text(text, 0, 0);
    },

    // 不覆盖 renderResult：沿用内置渲染器（成功时不追加内容，出错时显示完整错误）。
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
          moreLines: zh.tools.grep.moreLines,
          expand: zh.tools.grep.expand,
        },
        "No matches found",
        "matchLimitReached",
        GREP_PREVIEW_LINES,
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
          moreLines: zh.tools.find.moreLines,
          expand: zh.tools.find.expand,
        },
        "No files found matching pattern",
        "resultLimitReached",
        LIST_PREVIEW_LINES,
      ),
    });
  }

  if (builtinTools.has("ls")) {
    pi.registerTool({
      ...createLsTool(cwd),
      label: zh.tools.ls.label,

      renderCall(args: any, theme: any, context?: { cwd?: string }) {
        let text = theme.fg("toolTitle", theme.bold(zh.tools.ls.title));
        text += renderToolPath(args.path, theme, context?.cwd ?? "", ".");
        return new Text(text, 0, 0);
      },

      renderResult: countResultRender(
        {
          searching: zh.tools.ls.listing,
          noMatch: zh.tools.ls.empty,
          found: zh.tools.ls.entries,
          limit: zh.tools.ls.entryLimit,
          truncated: zh.tools.grep.truncated,
          moreLines: zh.tools.ls.moreLines,
          expand: zh.tools.ls.expand,
        },
        "(empty directory)",
        "entryLimitReached",
        LIST_PREVIEW_LINES,
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
