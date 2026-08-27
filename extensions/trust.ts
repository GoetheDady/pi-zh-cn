/**
 * 项目信任弹窗：中文选择器代替内置英文界面。
 *
 * 复刻 ~/「agent dir」/trust.json 的祖先目录查找逻辑；已有决定的目录不再弹窗。
 * 与内置的差异：「信任父文件夹」选项无法通过扩展 API 写入父目录决定，故省略。
 */
import { readFileSync, realpathSync } from "node:fs";
import { dirname, join } from "node:path";
import {
  getAgentDir,
  type ExtensionAPI,
} from "@earendil-works/pi-coding-agent";
import { zh } from "./zh.ts";

/**
 * 查询某个目录已保存的项目信任决定。
 *
 * 查找规则与内置逻辑一致：先对目录做 realpath 归一化，然后沿祖先链在
 * `~/<agentDir>/trust.json` 中查找该目录（或其任一祖先）的记录——子目录
 * 继承最近的祖先决定；到达根目录仍无记录则视为未决定。
 *
 * @param dir 要查询的项目目录（绝对路径）
 * @returns 已保存的信任（`true`）/ 不信任（`false`）决定；
 *          目录未被记录、trust.json 缺失或内容无效时返回 `null`
 */
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

/**
 * 注册 `project_trust` 事件处理器：用中文选择弹窗代替内置英文信任界面。
 *
 * 弹窗选项与内置语义一一对应（信任/不信任 × 是否记住），但不含内置的
 * 「信任父文件夹」变体——扩展 API 无法写入父目录的决定，故省略。
 *
 * 无 UI 的运行模式（rpc/print 等）或目录已有保存决定时不弹窗，返回
 * `undecided` 让 core 走默认流程。
 *
 * @param pi 扩展 API 实例
 */
export function registerProjectTrustDialog(pi: ExtensionAPI) {
  /** 取消（未选择）默认「本次会话不信任」，与内置行为一致。 */
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
}
