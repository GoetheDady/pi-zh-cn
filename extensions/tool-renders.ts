/**
 * 内置工具渲染的共享文案模板：read/bash/edit/write/grep/find/ls
 * 的 renderResult 共用这些小工具。
 */
import type {
  BashToolDetails,
} from "@earendil-works/pi-coding-agent";
import { Text } from "@earendil-works/pi-tui";
import { zh } from "./zh.ts";

/**
 * 取工具结果中的首个 text 块内容；结果不含文本块（如图片）时返回空串。
 */
export const textOf = (result: any): string =>
  result.content?.[0]?.type === "text" ? result.content[0].text : "";

/** 统计非空行数，用于「N 行输出」类摘要。 */
export const countNonEmpty = (s: string): number =>
  s.split("\n").filter((l) => l.trim()).length;

/** 流式部分结果的占位文案（黄色提示行）。 */
export const notePartial = (msg: string, theme: any): Text =>
  new Text(theme.fg("warning", msg), 0, 0);

// 展开态：在摘要后追加逐行弱化的原始输出。
/**
 * 组装展开态文本：raw 为空时返回 summary，否则在 summary 之后
 * 追加逐行弱化（dim 色）的原始输出。
 */
export const withExpanded = (raw: string, summary: string, theme: any): string =>
  raw
    ? `${summary}\n${raw
        .split("\n")
        .map((l) => theme.fg("dim", l))
        .join("\n")}`
    : summary;

/**
 * 判定 shell 命令是否失败。
 *
 * 内置 bash 工具不返回结构化退出码，只能从输出文本推断：匹配
 * 「exit code: N」/「command exited with code N」即失败；以 Error 开头、
 * 或含超时/中止提示也视为失败。powershell 在 Windows 上额外追加平台
 * 提示，通过 extraRe 补充识别。
 *
 * @param output 工具输出的完整文本
 * @param extraRe 额外的失败特征正则（默认无）
 * @returns exitCode 解析到的退出码（无法解析为 null）；failed 是否视为失败
 */
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

/**
 * 生成 shell 类工具（bash / powershell）共用的 renderCall + renderResult。
 *
 * 调用渲染显示命令（超 80 字符截断）与可选的超时参数；结果渲染根据
 * {@link failureState} 显示完成/失败状态、非空行数与截断警告，展开态追加
 * 逐行弱化的原始输出。
 *
 * @param w 该工具的文案对象（zh.tools.bash 或 zh.tools.powershell）
 * @param extraRe 传给 {@link failureState} 的额外失败特征正则
 */
export function shellRenders(w: ShellCopy, extraRe: RegExp[] = []) {
  return {
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
  };
}

/**
 * 生成计数类工具（grep / find / ls）共用的 renderResult 渲染器。
 *
 * 结果形态四处一致：流式时显示「搜索中」占位；输出等于哨兵值时显示
 * 「无匹配」（muted 色）；否则显示「N 行/个/项」（success 色）；达到上限
 * （由 details 中 limitField 字段标记）或发生截断时追加警告。展开态在
 * 摘要后追加原始输出（无匹配时用 noMatch 文案替代）。
 *
 * @param labels 各工具对应的中文文案对象（searching 流式占位、noMatch 无
 *   匹配文案、found 条数摘要、limit 可选的上限提示、truncated 截断警告）
 * @param sentinel 无匹配时内置工具输出的哨兵字符串
 * @param limitField details 中标记「已达到上限」的字段名
 *   （matchLimitReached / resultLimitReached / entryLimitReached）
 */
export function countResultRender(
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
