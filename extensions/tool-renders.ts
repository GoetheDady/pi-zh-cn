/**
 * 内置工具渲染的共享文案模板：read/bash/edit/write/grep/find/ls
 * 的 renderResult 共用这些小工具。
 */
import {
  DEFAULT_MAX_BYTES,
  formatSize,
  keyHint,
  type BashToolDetails,
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
 * 首选渲染上下文的 `isError` 标记：pi 0.99 起内置 bash 非零退出不再抛错，
 * 改为 resolve 一个 `isError: true` 的结果（0.87 及更早没有该标记，传入
 * false 即退化为纯文本推断）。文本推断作为兜底，且始终用于解析退出码：
 * 匹配「exit code: N」/「command exited with code N」；以 Error 开头、
 * 或含超时/中止/无退出码提示也视为失败。powershell 在 Windows 上额外
 * 追加平台提示，通过 extraRe 补充识别。
 *
 * @param output 工具输出的完整文本
 * @param isError 渲染上下文的 isError 标记（旧版 pi 传 false）
 * @param extraRe 额外的失败特征正则（默认无）
 * @returns exitCode 解析到的退出码（无法解析为 null）；failed 是否视为失败
 */
function failureState(
  output: string,
  isError: boolean,
  extraRe: RegExp[] = [],
) {
  const m = output.match(
    /(?:exit code:\s*|command exited with code\s+)(\d+)/i,
  );
  const exitCode = m ? parseInt(m[1], 10) : null;
  return {
    exitCode,
    failed:
      isError ||
      exitCode !== null ||
      /^error\b/i.test(output) ||
      // 状态串由 appendStatus 拼在输出后（输出为空时位于文本开头，0.86.0
      // 起新增的「Command terminated without an exit code」就是这个形态）。
      /(?:^|\n\n)command (?:timed out|was aborted|terminated|failed)/i.test(output) ||
      extraRe.some((re) => re.test(output)),
  };
}

/**
 * 格式化工具耗时，与内置 bash 行同一套刻度：不足 1 分钟给一位小数的秒，
 * 之后依次进位到「分 秒」「时 分 秒」。数字与单位保持原样，只换前缀文案。
 */
export function formatToolDuration(ms: number): string {
  const seconds = ms / 1000;
  if (seconds < 60) return `${seconds.toFixed(1)}s`;
  const totalSeconds = Math.floor(seconds);
  const minutes = Math.floor(totalSeconds / 60);
  const remainder = totalSeconds % 60;
  if (minutes < 60) return `${minutes}m ${remainder}s`;
  return `${Math.floor(minutes / 60)}h ${minutes % 60}m ${remainder}s`;
}

// shell 类工具（bash/powershell 文案同构）的渲染对。
type ShellCopy =
  | typeof zh.tools.bash
  | typeof zh.tools.powershell;

/**
 * 剥掉上游追加在结果文本末尾的英文截断脚注（`\n\n[Showing lines 1-2000 of
 * 5000. Full output: /tmp/…]`），返回展示用的文本。
 *
 * 只在展示层剥离：result 原样交给模型，符合「不改模型输入」。内置 bash
 * 渲染器做同样的事，然后自己画警告行，中文行沿用这条路径以免展开态漏出
 * 英文、并与下面的中文提示重复。
 *
 * 条件与上游一致——文本需以 `]` 结尾。带状态行（失败）的结果末尾不是 `]`，
 * 此时不剥，避免误删正文。
 *
 * @param output 结果文本
 * @param details 工具结果 details
 */
function stripTruncationFooter(
  output: string,
  details?: BashToolDetails,
): string {
  const fullOutputPath = details?.fullOutputPath;
  if (
    !details?.truncation?.truncated ||
    !fullOutputPath ||
    !output.endsWith("]")
  ) {
    return output;
  }
  const footerStart = output.lastIndexOf("\n\n[");
  if (footerStart === -1 || !output.slice(footerStart).includes(fullOutputPath)) {
    return output;
  }
  return output.slice(0, footerStart).trimEnd();
}

/**
 * 组装 shell 行的截断提示，对齐内置 bash 的 `[Full output: …. Truncated: …]`：
 * 完整输出的落盘路径，加上精确的行数或字节上限；两项皆无时返回空串。
 *
 * @param details 工具结果 details
 * @param w 该工具的文案对象
 */
function truncationNotice(
  details: BashToolDetails | undefined,
  w: ShellCopy,
): string {
  const truncation = details?.truncation;
  const parts: string[] = [];
  if (details?.fullOutputPath) {
    parts.push(w.fullOutput(details.fullOutputPath));
  }
  if (truncation?.truncated) {
    parts.push(
      truncation.truncatedBy === "lines"
        ? w.truncatedLines(truncation.outputLines, truncation.totalLines)
        : w.truncatedBytes(
            truncation.outputLines,
            formatSize(truncation.maxBytes ?? DEFAULT_MAX_BYTES),
          ),
    );
  }
  return parts.join("；");
}

/**
 * 生成 shell 类工具（bash / powershell）共用的 renderCall + renderResult。
 *
 * 调用渲染显示命令（超 80 字符截断）与可选的超时参数；结果渲染根据
 * {@link failureState} 显示完成/失败状态、非空行数、截断提示（
 * {@link truncationNotice}，含完整输出路径）与耗时（对齐内置 shell 行的
 * Took），展开态追加逐行弱化的原始输出（先经
 * {@link stripTruncationFooter} 剥掉上游的英文截断脚注）。
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
      // pi 把 isError 放在第 4 个参数（渲染上下文）上，第 1 个参数只有
      // content/details；旧版 pi 不传该参数。
      context?: { isError?: boolean; durationMs?: number },
    ): Text {
      if (isPartial) return notePartial(w.running, theme);
      const details = result.details as BashToolDetails | undefined;
      const output = stripTruncationFooter(textOf(result), details);
      const { exitCode, failed } = failureState(
        output,
        context?.isError === true,
        extraRe,
      );
      let text = failed
        ? theme.fg(
            "error",
            exitCode !== null ? w.exit(exitCode) : w.failed,
          )
        : theme.fg("success", w.done);
      text += theme.fg("dim", ` (${w.lines(countNonEmpty(output))})`);
      const notice = truncationNotice(details, w);
      if (notice) text += theme.fg("warning", ` [${notice}]`);
      // 内置 shell 行末尾有耗时（Took 1.2s），中文行原本丢了这条。durationMs
      // 由框架从最终结果填在渲染上下文上（tool-execution.ts），不依赖渲染器
      // 自己计时，所以这里只覆盖「已完成」那一档；流式中与旧会话的存量结果
      // 拿不到该值，自然不显示。
      const durationMs = context?.durationMs;
      if (!isPartial && typeof durationMs === "number") {
        text += theme.fg("dim", ` ${w.took(formatToolDuration(durationMs))}`);
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
 *   匹配文案、found 条数摘要、limit 可选的上限提示、truncated 截断警告、
 *   moreLines/expand 折叠态的行数提示与展开键位说明）
 * @param sentinel 无匹配时内置工具输出的哨兵字符串
 * @param limitField details 中标记「已达到上限」的字段名
 *   （matchLimitReached / resultLimitReached / entryLimitReached）
 * @param maxCollapsedLines 折叠态最多显示的结果行数（对齐上游：grep 15、
 *   find/ls 20）
 */
export function countResultRender(
  labels: {
    searching: string;
    noMatch: string;
    found: (n: number) => string;
    limit?: (n: number) => string;
    truncated: string;
    moreLines: (n: number) => string;
    expand: string;
  },
  sentinel: string,
  limitField: string,
  maxCollapsedLines: number,
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
    // 结果行本身：上游 grep/find/ls 折叠态就显示前 15/20 行，中文行此前折叠
    // 态一行都不给（只有上面那句条数），等于看不到命中了什么。展开态给全部。
    const lines = isEmpty ? [] : output.trim().split("\n");
    const shown = expanded ? lines : lines.slice(0, maxCollapsedLines);
    if (shown.length > 0) {
      text += `\n${shown.map((line) => theme.fg("toolOutput", line)).join("\n")}`;
      const remaining = lines.length - shown.length;
      if (remaining > 0) {
        text += theme.fg("muted", `\n${labels.moreLines(remaining)}`);
        text += keyHint("app.tools.expand", labels.expand);
        text += theme.fg("muted", "）");
      }
    }
    return new Text(text, 0, 0);
  };
}
