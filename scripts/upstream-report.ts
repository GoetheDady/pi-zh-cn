/**
 * 上游跟进报告：pi 发新版后，把「CHANGELOG 怎么说、哪些源文件变了」一次列出来。
 *
 * 为什么要有这个：契约测试回答的是「本地化有没有被上游改坏」，回答不了「上游
 * 新增了什么值得汉化的东西」。后者此前靠人工 npm pack 解包、diff 整棵 dist
 * 树、再逐个文件翻，是跟进流程里最费神的一段——pi 发版很勤，这段成本会反复付。
 *
 * 为什么是脚本而不是测试：diff 出来的变更里必然混着大量与界面无关的东西
 * （打包产物、内部重构），要靠人判断。这种噪音混进断言会让上游金丝雀变得爱
 * 报警，而一个爱报警的金丝雀很快就会被忽略。放在由人主动跑、由人读的报告里，
 * 噪音是可以接受的。
 *
 * 只读不写：直接问 registry 拿 tarball（不装依赖）、不改基线、不动仓库里任何
 * 文件；解压在临时目录，结束即删。
 *
 * 用法：
 *   node scripts/upstream-report.ts          # 本地基线 → 上游最新
 *   node scripts/upstream-report.ts 1.1.0    # 与指定版本比（回溯某次跟进）
 */
import { execFileSync } from "node:child_process";
import {
  mkdtempSync,
  readFileSync,
  readdirSync,
  rmSync,
  statSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { basename, join } from "node:path";

const PKG = "@earendil-works/pi-coding-agent";

/**
 * dist 里不属于「源结构」的路径：打包产物（文件名带内容哈希，每次发版全变）
 * 与 sourcemap（体积大、无信息）。不排掉的话变更列表会被它们淹没。
 */
const isNoise = (relativePath: string): boolean =>
  relativePath.startsWith("bundle/") || relativePath.endsWith(".map");

/**
 * 递归读一棵 dist 树，返回 `相对路径 → 文件内容`（已排除 {@link isNoise}）。
 *
 * @param root dist 目录的绝对路径
 */
export function readTree(root: string): Map<string, string> {
  const files = new Map<string, string>();
  const walk = (dir: string, prefix: string) => {
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      const relativePath = prefix ? `${prefix}/${entry.name}` : entry.name;
      if (isNoise(relativePath)) continue;
      const absolute = join(dir, entry.name);
      if (entry.isDirectory()) walk(absolute, relativePath);
      else if (statSync(absolute).isFile()) {
        files.set(relativePath, readFileSync(absolute, "utf8"));
      }
    }
  };
  walk(root, "");
  return files;
}

/** 两棵树的差异，按「对跟进有意义」的顺序排列：新增 → 修改 → 删除。 */
export function diffTrees(
  before: Map<string, string>,
  after: Map<string, string>,
): { added: string[]; changed: string[]; removed: string[] } {
  const added: string[] = [];
  const changed: string[] = [];
  const removed: string[] = [];
  for (const [path, content] of after) {
    const previous = before.get(path);
    if (previous === undefined) added.push(path);
    else if (previous !== content) changed.push(path);
  }
  for (const path of before.keys()) {
    if (!after.has(path)) removed.push(path);
  }
  return { added, changed, removed: removed.sort() };
}

/**
 * 取 CHANGELOG 里比 `baseline` 新的全部条目。
 *
 * CHANGELOG 按新到旧排列，所以基线版本的标题之前那一段就是「这次要跟的内容」。
 * 找不到基线标题时（改名、或基线还没进 changelog）返回全文开头到第一个标题
 * 之前的内容，至少不会骗人。
 *
 * @param markdown CHANGELOG.md 内容
 * @param baseline 本地钉住的版本
 */
export function changelogSince(markdown: string, baseline: string): string {
  const headings = [...markdown.matchAll(/^##+ \[?(\d+\.\d+\.\d+)\]?/gm)];
  const index = headings.findIndex((match) => match[1] === baseline);
  if (index === -1) return markdown.trim();
  return markdown.slice(0, headings[index].index).trim();
}

/** 本地 node_modules 里装着的版本（即 package-lock 钉住的基线）。 */
function installedVersion(): string {
  return JSON.parse(
    readFileSync(
      join("node_modules", PKG, "package.json"),
      "utf8",
    ),
  ).version;
}

/** 上游最新版。直接问 registry，不走 npm CLI。 */
async function latestVersion(): Promise<string> {
  const res = await fetch(`https://registry.npmjs.org/${PKG}/latest`);
  if (!res.ok) throw new Error(`查询最新版失败：HTTP ${res.status}`);
  return ((await res.json()) as { version: string }).version;
}

/**
 * 取某个版本的解压目录，返回其 dist 路径与 CHANGELOG 内容。
 *
 * 版本与本地已装的一致时直接用 node_modules——那正是锁文件钉住的那份，省一次
 * 下载；否则去 registry 取 tarball 解到临时目录。
 *
 * @param version 目标版本
 * @param workspace 临时解压目录（调用方负责清理）
 */
async function resolveTree(
  version: string,
  workspace: string,
): Promise<{ dist: string; changelog: string }> {
  if (installedVersion() === version) {
    const root = join("node_modules", PKG);
    return {
      dist: join(root, "dist"),
      changelog: readFileSync(join(root, "CHANGELOG.md"), "utf8"),
    };
  }

  const meta = await fetch(`https://registry.npmjs.org/${PKG}/${version}`);
  if (!meta.ok) throw new Error(`取 ${version} 元数据失败：HTTP ${meta.status}`);
  const { tarball } = ((await meta.json()) as { dist: { tarball: string } }).dist;

  const response = await fetch(tarball);
  if (!response.ok) throw new Error(`下载 ${version} 失败：HTTP ${response.status}`);
  const archive = join(workspace, `${version}.tgz`);
  writeFileSync(archive, Buffer.from(await response.arrayBuffer()));

  const extracted = join(workspace, version);
  execFileSync("mkdir", ["-p", extracted]);
  execFileSync("tar", ["xzf", archive, "-C", extracted]);

  const root = join(extracted, "package");
  return {
    dist: join(root, "dist"),
    changelog: readFileSync(join(root, "CHANGELOG.md"), "utf8"),
  };
}

/** 默认基线取本地装着的版本；命令行给了参数就用它（便于回溯某次跟进）。 */
const baseline = process.argv[2] ?? installedVersion();

async function main() {
  const latest = await latestVersion();
  console.log(`\n${PKG}\n  本地基线 ${baseline}  →  上游最新 ${latest}\n`);

  if (baseline === latest) {
    console.log("已是最新，无需跟进。\n");
    return;
  }

  const workspace = mkdtempSync(join(tmpdir(), "pi-upstream-"));
  try {
    const before = await resolveTree(baseline, workspace);
    const after = await resolveTree(latest, workspace);

    const changes = changelogSince(after.changelog, baseline);
    console.log("═══ CHANGELOG（比基线新的条目）═══\n");
    console.log(changes || "（CHANGELOG 里找不到比基线新的条目）");

    const diff = diffTrees(readTree(before.dist), readTree(after.dist));
    const total =
      diff.added.length + diff.changed.length + diff.removed.length;
    console.log(`\n═══ dist 变更（已排除 bundle 与 sourcemap）═══\n`);
    console.log(
      `新增 ${diff.added.length} / 修改 ${diff.changed.length} / 删除 ${diff.removed.length}，共 ${total}\n`,
    );
    const list = (label: string, paths: string[]) => {
      if (paths.length === 0) return;
      console.log(`${label}：`);
      for (const path of paths) console.log(`  ${path}`);
      console.log();
    };
    list("新增", diff.added);
    list("修改", diff.changed);
    list("删除", diff.removed);

    console.log(
      "下一步：对着上面这些界面文件（modes/interactive、core/tools、extensions）\n" +
        "核对文案，跑 npm test；确认无碍后抬基线、递增版本号。\n",
    );
  } finally {
    rmSync(workspace, { recursive: true, force: true });
  }
}

// 只在被直接执行时跑主流程。测试会 import 上面的纯函数，不写这个判断的话
// 一 import 就会联网下载。
//
// 比对的是完整文件名而不是「路径里含 upstream-report」：测试文件叫
// upstream-report.test.ts，子串匹配会把它一起命中，于是测试一 import 就联网。
// （不用 import.meta.main：CI 的 node 22 上还没有。）
if (basename(process.argv[1] ?? "") === "upstream-report.ts") {
  await main();
}
