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
import { homedir } from "node:os";
import type { ExtensionContext } from "@earendil-works/pi-coding-agent";
import { getCapabilities } from "@earendil-works/pi-tui";
import { globalSettingsFile, projectSettingsFile } from "./settings.ts";
import { zh } from "./zh.ts";

/** 覆盖项在 settings.json 里的命名空间键。 */
const SETTINGS_KEY = "pi-zh-cn";

/** 家目录缩成 ~，状态报告里的路径要一眼能认出来是哪一个文件。 */
function shortenPath(path: string): string {
  const home = homedir();
  return path.startsWith(home) ? `~${path.slice(home.length)}` : path;
}

/**
 * zh 表在第一次覆盖之前的样子。每次应用覆盖都先从它还原，再重新合并。
 *
 * 不还原的话，用户删掉某条覆盖后，再次进入 session_start（/reload、/new、
 * /resume、/fork 都会），旧译法会一直留在内存里，直到重启 pi。模块加载时 zh
 * 还没被任何覆盖动过，所以这里拍下的就是默认值。
 */
const pristine = cloneTree(zh);

/**
 * 深拷贝 zh 的对象结构。字符串与函数（如「N 行输出」）按原样保留——函数本就
 * 不会被覆盖，字符串则需要在还原时换回来。zh 里没有数组，不必处理数组。
 *
 * @param source zh 表或其子树
 */
function cloneTree(source: any): any {
  if (source === null || typeof source !== "object") return source;
  return Object.fromEntries(
    Object.entries(source).map(([key, value]) => [key, cloneTree(value)]),
  );
}

/**
 * 把 snapshot 里的叶子还原回 target。覆盖只改已有的字符串键、不增删键，
 * 所以逐键复原就够了。
 *
 * @param target 要被还原的 zh 表（或其子树）
 * @param snapshot 对应的默认值快照
 */
function restoreTree(target: any, snapshot: any): void {
  for (const [key, value] of Object.entries(snapshot)) {
    if (value !== null && typeof value === "object") {
      restoreTree(target[key], value);
    } else {
      target[key] = value;
    }
  }
}

/**
 * 一层设置的读取结果，供 `/zh` 自诊断展示。
 *
 * `outcome` 覆盖用户会遇到的四种「改了没反应」：文件不存在、项目未受信任而
 * 整层被跳过、JSON 坏了、以及文件读了但里面没有 copy 段。
 */
export type OverrideLayer = {
  path: string;
  scope: "全局" | "项目";
  outcome: "生效" | "无此文件" | "未读取（项目未受信任）" | "解析失败" | "无覆盖内容";
  applied: number;
};

/** 最近一次应用覆盖的结果。`/zh` 读它，所以要在 applyCopyOverrides 里填。 */
let lastReport: { layers: OverrideLayer[]; keys: string[] } = {
  layers: [],
  keys: [],
};

/**
 * 把 source 里能与 target 对上的字符串叶子写进 target，返回写入条数。
 *
 * 只在两侧都是字符串时才覆盖：借这条同时挡住「拿字符串去替 zh.ts 里的函数
 * 条目」和「往不存在的键上写」两种情况，不必额外做一遍键名校验。
 *
 * @param target zh 表（或其子树）
 * @param source 用户写的覆盖内容
 * @param applied 收集生效条目的点分路径（如 `tools.bash.done`）
 * @param prefix 当前递归位置的点分前缀
 */
function mergeOverrides(
  target: any,
  source: any,
  applied: string[],
  prefix = "",
): number {
  let count = 0;
  for (const [key, value] of Object.entries(source ?? {})) {
    const current = target?.[key];
    const path = prefix ? `${prefix}.${key}` : key;
    if (typeof value === "string" && typeof current === "string") {
      target[key] = value;
      applied.push(path);
      count += 1;
    } else if (
      value !== null &&
      typeof value === "object" &&
      !Array.isArray(value) &&
      current !== null &&
      typeof current === "object"
    ) {
      count += mergeOverrides(current, value, applied, path);
    }
  }
  return count;
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
  // 每次都从默认译法重新合并，删掉的覆盖才会真的回到默认。
  restoreTree(zh, pristine);
  const layers: OverrideLayer[] = [];
  const keys: string[] = [];
  let provided = false;
  let layerFailed = false;

  const candidates: {
    path: string;
    scope: OverrideLayer["scope"];
    eligible: boolean;
  }[] = [
    { path: globalSettingsFile(), scope: "全局", eligible: true },
    // 项目那份不论受不信任都列出来：不受信任时报告里要写明「没读」，否则用户
    // 只会看到项目设置毫无反应，却不知道是被信任边界挡下的。位置也留在它该在
    // 的地方（全局之后），报告的顺序才对得上应用顺序。
    {
      path: projectSettingsFile(ctx.cwd),
      scope: "项目",
      eligible: ctx.isProjectTrusted(),
    },
  ];

  for (const { path, scope, eligible } of candidates) {
    if (!eligible) {
      layers.push({
        path,
        scope,
        outcome: "未读取（项目未受信任）",
        applied: 0,
      });
      continue;
    }
    let copy: unknown;
    try {
      copy = (JSON.parse(readFileSync(path, "utf8")) as any)?.[SETTINGS_KEY]
        ?.copy;
    } catch (error) {
      // ENOENT 是常态（用户没写过这份设置）；其余（JSON 坏了、读不动）
      // 才是需要告诉用户的。
      const missing = (error as NodeJS.ErrnoException)?.code === "ENOENT";
      if (!missing) layerFailed = true;
      layers.push({
        path,
        scope,
        outcome: missing ? "无此文件" : "解析失败",
        applied: 0,
      });
      continue;
    }
    if (copy === null || typeof copy !== "object") {
      layers.push({ path, scope, outcome: "无覆盖内容", applied: 0 });
      continue;
    }
    provided = true;
    const applied: string[] = [];
    const count = mergeOverrides(zh, copy, applied);
    keys.push(...applied);
    layers.push({ path, scope, outcome: "生效", applied: count });
  }

  lastReport = { layers, keys };
  const applied = keys.length;

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

/**
 * 所有可被覆盖的词条路径（点分，如 `tools.bash.done`）。
 *
 * 从 zh 表当场推出来，而不是另维护一份清单——两份清单迟早对不上，而用户按
 * 错的路径去写覆盖只会得到「改了没反应」。
 *
 * 只收字符串叶子：`zh` 里的函数条目（要拼数字，如「N 行输出」）JSON 表达不了，
 * mergeOverrides 也不接受，所以不算可覆盖。
 */
export function copyKeyPaths(): string[] {
  const paths: string[] = [];
  const walk = (node: any, prefix: string) => {
    for (const [key, value] of Object.entries(node ?? {})) {
      const path = prefix ? `${prefix}.${key}` : key;
      if (typeof value === "string") paths.push(path);
      else if (value !== null && typeof value === "object") walk(value, path);
    }
  };
  walk(zh, "");
  return paths;
}

/** zh 里不可覆盖的函数条目数（报给用户，免得他们去试）。 */
function functionLeafCount(): number {
  let count = 0;
  const walk = (node: any) => {
    for (const value of Object.values(node ?? {})) {
      if (typeof value === "function") count += 1;
      else if (value !== null && typeof value === "object") walk(value);
    }
  };
  walk(zh);
  return count;
}

/**
 * `/zh keys` 的正文：把所有可覆盖的词条按父级分组列出来。
 *
 * 分组用父级路径（如 `tools.bash`）而不是顶层分区：一是 `tools` 一个区就有
 * 六十多条，平铺没法看；二是分组的形状正好就是用户要写的嵌套 JSON 的形状。
 *
 * @param filter 只看路径里含该子串的条目；留空则全列
 */
export function describeCopyKeys(filter?: string): string {
  const all = copyKeyPaths();
  const needle = filter?.trim();
  const shown = needle ? all.filter((p) => p.includes(needle)) : all;

  if (shown.length === 0) {
    return `pi-zh-cn：没有路径含「${needle}」的词条。不带参数运行 /zh keys 可看全部 ${all.length} 条。`;
  }

  const groups = new Map<string, string[]>();
  for (const path of shown) {
    const cut = path.lastIndexOf(".");
    const parent = cut === -1 ? "（顶层）" : path.slice(0, cut);
    if (!groups.has(parent)) groups.set(parent, []);
    groups.get(parent)!.push(cut === -1 ? path : path.slice(cut + 1));
  }

  const functions = functionLeafCount();
  const head = needle
    ? `pi-zh-cn 可覆盖的词条：匹配「${needle}」的 ${shown.length} 条（共 ${all.length} 条）`
    : `pi-zh-cn 可覆盖的词条：共 ${all.length} 条`;
  const lines = [
    head,
    `另有 ${functions} 条是函数（要拼数字，如「N 行输出」），JSON 表达不了，覆盖不了。`,
    "",
  ];
  for (const [parent, leaves] of [...groups].sort(([a], [b]) => a.localeCompare(b))) {
    lines.push(`${parent}（${leaves.length}）`);
    lines.push(`  ${leaves.join(", ")}`);
  }
  lines.push("", "写法见 README 的「改词」一节；改完需 /reload 或新开会话。");
  return lines.join("\n");
}

/**
 * `/zh` 的正文：词条覆盖各层读到了什么、哪些条目生效、以及终端能力。
 *
 * 存在的理由是覆盖有两种「静默失败」——项目未受信任时整层被跳过、键名拼错只
 * 在启动时提示一次且容易被刷走。用户看到「改了没反应」时，这里能直接给出是
 * 哪一层、哪一条出了问题，而不必去翻源码或猜。
 *
 * 报的是当前会话**已生效**的状态，不是重新读一遍设置文件。这样才对得上用户
 * 眼前看到的界面：改完文件还没 reload 时，界面确实还是旧的，报告也该是旧的。
 * 结尾那句提示就是给这种情况的。
 */
export function describeLocalization(): string {
  const lines = ["pi-zh-cn 状态", "", "词条覆盖："];

  if (lastReport.layers.length === 0) {
    lines.push("  （尚未应用；本命令只在 TUI 会话里可用）");
  }
  for (const layer of lastReport.layers) {
    const detail =
      layer.outcome === "生效" ? `生效 ${layer.applied} 条` : layer.outcome;
    lines.push(`  ${layer.scope} ${shortenPath(layer.path)} — ${detail}`);
  }

  // 去重：两层都覆盖同一个键时它只算一条生效（项目层胜出），列两遍只会让人
  // 以为自己写重了。
  const keys = [...new Set(lastReport.keys)];
  if (keys.length > 0) {
    lines.push("", "已覆盖的条目：");
    for (const key of keys) lines.push(`  ${key}`);
  } else {
    lines.push("", "当前没有生效的覆盖，全部使用默认译法。");
  }

  // 终端支持情况会影响工具行里的路径能否点击，属于「看起来该有却没有」的
  // 常见疑问，顺手报出来。
  const capabilities = getCapabilities();
  lines.push(
    "",
    `终端：${capabilities.hyperlinks ? "支持" : "不支持"}可点击文件链接，${capabilities.trueColor ? "支持" : "不支持"}真彩色`,
    "",
    "想看能覆盖哪些词条：/zh keys（可按子串过滤，如 /zh keys bash）。",
    "改动 settings.json 后需 /reload 或新开会话才生效。",
  );

  return lines.join("\n");
}
