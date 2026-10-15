/**
 * 词条覆盖：不改源码就能换掉不满意的译法。
 *
 * 读 pi 自己的 `settings.json`（全局的一份，加上受信任项目本地的那份，
 * 与 footer 读 compaction 设置走同一套路径），取其中 `pi-zh-cn.copy` 这
 * 一段深合并进 `zh` 表。结构跟 extensions/zh.ts 一一对应，叶子写字符串：
 *
 * ```json
 * { "pi-zh-cn": { "copy": {
 *   "footer": { "cwdPrefix": "目录：" },
 *   "tools": { "bash": { "done": "跑完了" } }
 * } } }
 * ```
 *
 * 放进 pi 自己的设置文件而不是另造一个，是因为它的 settings schema 声明了
 * `additionalProperties: true`——多一个命名空间键不会被 schema 打回，用户
 * 也不必再记一个文件该放哪。项目本地那份只在该项目受信任时读，与内置设置
 * 的信任边界一致。
 *
 * 只覆盖字符串叶子。zh.ts 里有一部分条目是函数（要拼数字，例如
 * `lines: (n) => \`${n} 行输出\``），JSON 表达不了，那些保持原样。
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";
import {
  CONFIG_DIR_NAME,
  getAgentDir,
  type ExtensionContext,
} from "@earendil-works/pi-coding-agent";
import { zh } from "./zh.ts";

/** 覆盖项在 settings.json 里的命名空间键。 */
const SETTINGS_KEY = "pi-zh-cn";

/**
 * 把 source 里能与 target 对上的字符串叶子写进 target，返回写入条数。
 *
 * 只在两侧都是字符串时才覆盖：借这条同时挡住「拿字符串去替 zh.ts 里的函数
 * 条目」和「往不存在的键上写」两种情况，不必额外做一遍键名校验。
 *
 * @param target zh 表（或其子树）
 * @param source 用户写的覆盖内容
 */
function mergeOverrides(target: any, source: any): number {
  let applied = 0;
  for (const [key, value] of Object.entries(source ?? {})) {
    const current = target?.[key];
    if (typeof value === "string" && typeof current === "string") {
      target[key] = value;
      applied += 1;
    } else if (
      value !== null &&
      typeof value === "object" &&
      !Array.isArray(value) &&
      current !== null &&
      typeof current === "object"
    ) {
      applied += mergeOverrides(current, value);
    }
  }
  return applied;
}

/**
 * 应用 settings.json 里的词条覆盖。
 *
 * 必须在注册工具之前调用：`countResultRender` 之类的注册期参数会把当时读到的
 * 文案捕获进去，之后再改 `zh` 对它们无效。
 *
 * 两层设置都读、后者覆盖前者（全局 → 项目）。文件不存在是常态，静默跳过；
 * 存在但解析失败、或者给了覆盖却一条都没对上（多半是键名拼错），各提示一次，
 * 否则用户只会看到「改了没反应」。
 *
 * @param ctx 当前会话上下文
 */
export function applyCopyOverrides(ctx: ExtensionContext): void {
  const paths = [join(getAgentDir(), "settings.json")];
  if (ctx.isProjectTrusted()) {
    paths.push(join(ctx.cwd, CONFIG_DIR_NAME, "settings.json"));
  }

  let provided = false;
  let applied = 0;
  let layerFailed = false;

  for (const path of paths) {
    let copy: unknown;
    try {
      copy = (JSON.parse(readFileSync(path, "utf8")) as any)?.[SETTINGS_KEY]
        ?.copy;
    } catch (error) {
      // ENOENT 是常态（用户没写过这份设置）；其余（JSON 坏了、读不动）
      // 才是需要告诉用户的。
      if ((error as NodeJS.ErrnoException)?.code !== "ENOENT") layerFailed = true;
      continue;
    }
    if (copy !== null && typeof copy === "object") {
      provided = true;
      applied += mergeOverrides(zh, copy);
    }
  }

  if (layerFailed) {
    ctx.ui.notify(
      `pi-zh-cn：settings.json 解析失败，本次未应用「${SETTINGS_KEY}.copy」词条覆盖`,
      "warning",
    );
  } else if (provided && applied === 0) {
    ctx.ui.notify(
      `pi-zh-cn：「${SETTINGS_KEY}.copy」里没有一条能对上 zh.ts 的字符串词条（键名需与 extensions/zh.ts 一致，函数条目无法覆盖）`,
      "warning",
    );
  }
}
