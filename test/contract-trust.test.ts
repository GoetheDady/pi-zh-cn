/**
 * 上游契约测试：trust.json 语义。
 *
 * 断言内置 ProjectTrustStore（dist/core/trust-manager.js）的读写语义
 * 仍是 extensions/trust.ts 复刻时所依赖的行为：realpath 归一化键、null
 * 删键、按键排序、2 空格缩进、结尾换行、祖先链查找。任一失败说明上游
 * 语义变了，需核对 zh.trust.* 与 trust.ts。
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { ProjectTrustStore } from "@earendil-works/pi-coding-agent";
import { ENV_AGENT_DIR, loadDist } from "./helpers.ts";
// getProjectTrustOptions 未从包顶层导出。
const { getProjectTrustOptions } = await loadDist("core/trust-manager.js");
import {
  registerProjectTrustDialog,
  saveTrustDecisions,
} from "../extensions/trust.ts";
import { zh } from "../extensions/zh.ts";

function tmpDir(): string {
  return mkdtempSync(join(tmpdir(), "pi-zh-cn-trust-"));
}

test("ProjectTrustStore.set 写入 realpath 键、排序、2 空格缩进、结尾换行", () => {
  const agentDir = tmpDir();
  const projectA = tmpDir();
  const projectB = tmpDir();
  try {
    const store = new ProjectTrustStore(agentDir);
    // 先写 B 再写 A，验证输出按键排序
    store.set(projectB, true);
    store.set(projectA, false);

    const file = join(agentDir, "trust.json");
    const raw = readFileSync(file, "utf8");
    assert.ok(raw.endsWith("\n") && !raw.endsWith("\n\n"), "trust.json 应以单个换行结尾");
    assert.ok(raw.includes('  "'), "trust.json 应使用 2 空格缩进");
    const keys = Object.keys(JSON.parse(raw));
    assert.deepEqual(keys, [...keys].sort(), `键应按字典序排列，实际：\n${raw}`);

    // 键是 realpath（macOS 上 /var -> /private/var 这类符号链接已被归一化）
    const parsed = JSON.parse(raw);
    for (const dir of [projectA, projectB]) {
      const real = realpathSync(dir);
      assert.ok(
        parsed[real] !== undefined,
        `键应为归一化路径 ${real}，实际：${JSON.stringify(keys)}`,
      );
    }
    assert.equal(store.get(projectA), false);
    assert.equal(store.get(projectB), true);
  } finally {
    for (const d of [agentDir, projectA, projectB]) rmSync(d, { recursive: true, force: true });
  }
});

test("ProjectTrustStore.setMany 中 decision=null 删除键；get 沿祖先链查找", () => {
  const agentDir = tmpDir();
  const parent = tmpDir();
  const child = join(parent, "sub");
  mkdirSync(child, { recursive: true });
  try {
    const store = new ProjectTrustStore(agentDir);
    store.set(parent, true);
    // 子目录继承最近的祖先决定
    assert.equal(store.get(child), true);

    // 写 null = 删键（「信任父文件夹」选项用它清除本目录记录）
    store.setMany([
      { path: parent, decision: null },
      { path: child, decision: false },
    ]);
    // 上游键为 realpath；测试路径同样归一化后比对。
    const realChild = realpathSync(child);
    const parsed = JSON.parse(readFileSync(join(agentDir, "trust.json"), "utf8"));
    assert.deepEqual(parsed, { [realChild]: false }, "null 应删除键而非写 null");
    assert.equal(store.get(child), false, "子目录应命中自己的不信任决定");
    assert.equal(store.get(parent), null, "父键删除后应无决定（不上溯到兄弟键）");
  } finally {
    for (const d of [agentDir, parent]) rmSync(d, { recursive: true, force: true });
  }
});

test("saveTrustDecisions（扩展实现）与内置 ProjectTrustStore 读写兼容", () => {
  const agentDir = tmpDir();
  const project = tmpDir();
  try {
    // 扩展写入（「信任父文件夹」的写法：父目录信任 + 本目录删键）
    saveTrustDecisions(
      [
        { path: dirname(project), decision: true },
        { path: project, decision: null },
      ],
      join(agentDir, "trust.json"),
    );
    // 内置实现必须能按相同语义读回
    const store = new ProjectTrustStore(agentDir);
    assert.equal(store.get(project), true, "扩展写的 trust.json 应被内置实现读为信任");

    // 内置写回后，扩展的空写入（只做排序/格式化）不应改变文件内容，
    // 即两种实现的文件格式（键序、缩进、结尾换行）完全一致。
    store.set(project, false);
    const before = readFileSync(join(agentDir, "trust.json"), "utf8");
    saveTrustDecisions([], join(agentDir, "trust.json"));
    const after = readFileSync(join(agentDir, "trust.json"), "utf8");
    assert.equal(after, before, "扩展与内置的 trust.json 文件格式不一致");
  } finally {
    for (const d of [agentDir, project]) rmSync(d, { recursive: true, force: true });
  }
});

test("getProjectTrustOptions 仍提供扩展弹窗所复刻的选项集合", () => {
  // extensions/trust.ts 复刻的内置选项：Trust / Trust parent / session-only
  // / Distrust。上游改选项集合或顺序时报警，需核对 zh.trust.options.*。
  const cwd = tmpDir();
  type TrustOption = {
    label: string;
    trusted: boolean;
    updates: Array<{ path: string; decision: boolean | null }>;
    savedPath: string;
  };
  try {
    const options: TrustOption[] = getProjectTrustOptions(cwd, {
      includeSessionOnly: true,
    });
    const labels = options.map((o) => o.label);
    assert.ok(labels.includes("Trust"), `缺少 Trust 选项：${labels}`);
    assert.ok(
      labels.some((l) => l.startsWith("Trust parent")),
      `缺少 Trust parent 选项：${labels}`,
    );
    assert.ok(labels.includes("Do not trust"), `缺少 Do not trust 选项：${labels}`);
    assert.ok(
      labels.some((l) => l.includes("session only")),
      `缺少 session-only 变体：${labels}`,
    );
    // 「信任父文件夹」的写文件语义：父目录 true + 本目录 null。
    // trust.ts 的 saveTrustDecisions 调用依赖这个结构（路径均经上游
    // realpath 归一化，这里同样归一化后比对）。
    const realCwd = realpathSync(cwd);
    const realParent = dirname(realCwd);
    const parentOption = options.find((o) => o.label.startsWith("Trust parent"));
    assert.ok(parentOption, "应能取到 Trust parent 选项");
    assert.deepEqual(
      parentOption.updates,
      [
        { path: realParent, decision: true },
        { path: realCwd, decision: null },
      ],
      "Trust parent 的 updates 语义变了，需核对 trust.ts",
    );
  } finally {
    rmSync(cwd, { recursive: true, force: true });
  }
});

test("信任弹窗：defaultProjectTrust 为 always/never 时让路，不弹窗", async () => {
  const agentDir = tmpDir();
  const projectDir = tmpDir();
  const previous = process.env[ENV_AGENT_DIR];
  try {
    // 处理器从 agent 目录读设置与已有决定，指到临时目录才不会碰真实环境。
    process.env[ENV_AGENT_DIR] = agentDir;

    let handler: any;
    registerProjectTrustDialog({
      on: (name: string, fn: any) => {
        if (name === "project_trust") handler = fn;
      },
    } as any);
    assert.equal(typeof handler, "function", "应注册 project_trust 处理器");

    /** 跑一次处理器，返回弹了几次窗与它的返回值。 */
    const run = async (settings?: unknown) => {
      if (settings === undefined) {
        rmSync(join(agentDir, "settings.json"), { force: true });
      } else {
        writeFileSync(
          join(agentDir, "settings.json"),
          JSON.stringify(settings),
        );
      }
      let prompts = 0;
      const result = await handler(
        { type: "project_trust", cwd: projectDir },
        {
          cwd: projectDir,
          hasUI: true,
          mode: "tui",
          ui: {
            select: async () => {
              prompts += 1;
              return zh.trust.options.trustSessionOnly;
            },
          },
        },
      );
      return { prompts, result };
    };

    // 未设置＝上游默认的 "ask"：应当弹窗并给出决定。
    const asked = await run();
    assert.equal(asked.prompts, 1, "未设置时应弹窗询问");
    assert.notEqual(asked.result?.trusted, "undecided", "弹窗后应给出决定");

    // always / never 时上游直接定论、不弹窗；那条判断排在扩展事件之后，所以
    // 我们得自己让路，否则用户设了「永不询问」仍然会被问。
    for (const value of ["always", "never"]) {
      const letThrough = await run({ defaultProjectTrust: value });
      assert.equal(
        letThrough.prompts,
        0,
        `defaultProjectTrust: ${value} 时不该弹窗`,
      );
      assert.equal(
        letThrough.result?.trusted,
        "undecided",
        "让路必须返回 undecided——返回任何别的值都会被 core 当成结论，反而绕过了该设置",
      );
    }

    // 不认识的取值按默认的 ask 处理（与上游 SETTINGS_DEFAULTS 一致）。
    const unknown = await run({ defaultProjectTrust: "sometimes" });
    assert.equal(unknown.prompts, 1, "不认识的取值应按 ask 处理");
  } finally {
    if (previous === undefined) delete process.env[ENV_AGENT_DIR];
    else process.env[ENV_AGENT_DIR] = previous;
    rmSync(agentDir, { recursive: true, force: true });
    rmSync(projectDir, { recursive: true, force: true });
  }
});
