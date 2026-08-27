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
  type BashToolDetails,
  type EditToolDetails,
  type ReadToolDetails,
} from "@earendil-works/pi-coding-agent";
import { Text } from "@earendil-works/pi-tui";
import { zh } from "./zh.ts";
import {
  countResultRender,
  errorFirstLine,
  notePartial,
  shellRenders,
  withExpanded,
} from "./tool-renders.ts";

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
