/**
 * 项目信任弹窗：中文选择器代替内置英文界面。
 *
 * 复刻 ~/「agent dir」/trust.json 的读写逻辑（与内置 ProjectTrustStore
 * 同格式：键为 realpath 归一化路径，null 表示删除该键）；已有决定的目录
 * 不再弹窗。选项与内置一一对应，含「信任父文件夹」变体——扩展 API 表达
 * 不了父目录决定，这里按内置 setMany 语义直接写 trust.json 实现。
 */
import {
  existsSync,
  mkdirSync,
  readFileSync,
  realpathSync,
  writeFileSync,
} from "node:fs";
import { dirname, join } from "node:path";
import {
  getAgentDir,
  type ExtensionAPI,
} from "@earendil-works/pi-coding-agent";
import { zh } from "./zh.ts";

/** realpath 归一化（与 core 的 normalizeCwd 等价）；目录不存在时原样返回。 */
const normalizeDir = (dir: string): string => {
  try {
    return realpathSync(dir);
  } catch {
    return dir;
  }
};

/** trust.json 路径。 */
const trustFile = (): string => join(getAgentDir(), "trust.json");

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
  let current = normalizeDir(dir);
  try {
    const store = JSON.parse(readFileSync(trustFile(), "utf8"));
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
 * 写入信任决定，语义与内置 ProjectTrustStore.setMany / writeTrustFile
 * 一致：`decision` 为 `null` 删除该键；输出按键排序、2 空格缩进、结尾
 * 换行。文件缺失时从空表开始；内容无效时抛出（与内置一致，此时事件
 * 处理器报错，core 回退到内置英文弹窗）。
 *
 * # ponytail: 无文件锁（内置用 withTrustFileLock）；只在启动信任弹窗
 * 时写入，并发窗口极小，出现实害再补锁文件。
 *
 * @param decisions 要写入的决定列表
 * @param file trust.json 路径（默认 agentDir 下；测试可覆盖）
 */
export const saveTrustDecisions = (
  decisions: Array<{ path: string; decision: boolean | null }>,
  file: string = trustFile(),
): void => {
  let store: Record<string, boolean | null> = {};
  if (existsSync(file)) {
    store = JSON.parse(readFileSync(file, "utf8"));
  }
  for (const { path, decision } of decisions) {
    const key = normalizeDir(path);
    if (decision === null) delete store[key];
    else store[key] = decision;
  }
  const sorted: Record<string, boolean | null> = {};
  for (const key of Object.keys(store).sort()) {
    const value = store[key];
    if (value === true || value === false || value === null) sorted[key] = value;
  }
  mkdirSync(dirname(file), { recursive: true });
  writeFileSync(file, `${JSON.stringify(sorted, null, 2)}\n`, "utf8");
};

/**
 * 注册 `project_trust` 事件处理器：用中文选择弹窗代替内置英文信任界面。
 *
 * 选「信任父文件夹」时按内置语义写 trust.json（父目录 = 信任、清除本目
 * 录记录），并返回不带 `remember` 的结果——core 只在 `remember` 时写
 * cwd，这样文件里只留下与内置选项完全相同的两条记录。
 *
 * 无 UI 的运行模式（rpc/print 等）或目录已有保存决定时不弹窗，返回
 * `undecided` 让 core 走默认流程。
 *
 * @param pi 扩展 API 实例
 */
export function registerProjectTrustDialog(pi: ExtensionAPI) {
  pi.on("project_trust", async (event, ctx) => {
    // 无 UI（rpc/print 等模式）或已有保存的决定时返回 undecided，让 core 走默认流程。
    if (!ctx.hasUI || savedTrustDecision(event.cwd) !== null) return { trusted: "undecided" };

    const trustPath = normalizeDir(event.cwd);
    const parentPath = dirname(trustPath);
    const parentOption =
      parentPath === trustPath ? undefined : zh.trust.trustParent(parentPath);

    const options = [
      zh.trust.options.trustAndRemember,
      ...(parentOption ? [parentOption] : []),
      zh.trust.options.trustSessionOnly,
      zh.trust.options.distrustAndRemember,
      zh.trust.options.distrustSessionOnly,
    ];
    const selected = await ctx.ui.select(zh.trust.title(event.cwd), options);
    if (parentOption !== undefined && selected === parentOption) {
      saveTrustDecisions([
        { path: parentPath, decision: true },
        { path: trustPath, decision: null },
      ]);
      return { trusted: "yes" }; // 不带 remember：core 不写本目录，只留上面两条记录
    }
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
