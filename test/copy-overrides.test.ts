/**
 * 词条覆盖：settings.json 里 `pi-zh-cn.copy` 的读取、合并与容错。
 *
 * applyCopyOverrides 直接改写 zh 表——注册期参数（如 countResultRender 的
 * labels）会把当时读到的文案捕获进去，所以只能在启动时合并，而合并必然带
 * 副作用。因此每个用例都得把动过的条目还原，避免同文件内互相影响。
 *
 * agent 目录用 PI_CODING_AGENT_DIR 指到临时目录；getAgentDir() 认这个环境
 * 变量，所以不需要碰真实的家目录。
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { applyCopyOverrides } from "../extensions/copy-overrides.ts";
import { zh } from "../extensions/zh.ts";
import { ENV_AGENT_DIR } from "./helpers.ts";

/**
 * 在临时目录里摆好设置文件跑一次覆盖，返回收到的提示。
 *
 * @param settings 全局 settings.json 的内容；传字符串可模拟坏 JSON，传
 *   undefined 表示不建这个文件
 * @param opts trusted 项目是否受信任；project 为项目本地设置的内容
 */
function runOverrides(
  settings: unknown,
  opts: { trusted?: boolean; project?: unknown } = {},
): string[] {
  const agentDir = mkdtempSync(join(tmpdir(), "pi-zh-cn-agent-"));
  const cwd = mkdtempSync(join(tmpdir(), "pi-zh-cn-cwd-"));
  const previous = process.env[ENV_AGENT_DIR];
  const notices: string[] = [];
  try {
    process.env[ENV_AGENT_DIR] = agentDir;
    if (settings !== undefined) {
      writeFileSync(
        join(agentDir, "settings.json"),
        typeof settings === "string" ? settings : JSON.stringify(settings),
      );
    }
    if (opts.project !== undefined) {
      mkdirSync(join(cwd, ".pi"), { recursive: true });
      writeFileSync(
        join(cwd, ".pi", "settings.json"),
        JSON.stringify(opts.project),
      );
    }
    applyCopyOverrides({
      cwd,
      isProjectTrusted: () => opts.trusted === true,
      ui: { notify: (message: string) => notices.push(message) },
    } as any);
  } finally {
    if (previous === undefined) delete process.env[ENV_AGENT_DIR];
    else process.env[ENV_AGENT_DIR] = previous;
    rmSync(agentDir, { recursive: true, force: true });
    rmSync(cwd, { recursive: true, force: true });
  }
  return notices;
}

test("覆盖生效：按 zh.ts 的结构深合并，未提到的条目不动", () => {
  const original = {
    cwdPrefix: zh.footer.cwdPrefix,
    done: zh.tools.bash.done,
    interrupt: zh.header.compact.interrupt,
    workingMessage: zh.workingMessage,
    exportCommand: zh.builtinCommands.export,
    failed: zh.tools.bash.failed,
  };
  try {
    const notices = runOverrides({
      "pi-zh-cn": {
        copy: {
          footer: { cwdPrefix: "目录：" },
          tools: { bash: { done: "跑完了" } },
          header: { compact: { interrupt: "打断" } },
          workingMessage: "处理中…",
          builtinCommands: { export: "导出会话" },
        },
      },
    });

    assert.deepEqual(notices, [], "全部命中时不该有提示");
    assert.equal(zh.footer.cwdPrefix, "目录：");
    assert.equal(zh.tools.bash.done, "跑完了");
    assert.equal(zh.header.compact.interrupt, "打断");
    assert.equal(zh.workingMessage, "处理中…");
    assert.equal(zh.builtinCommands.export, "导出会话");
    // 同一层里没写到的条目保持原样
    assert.equal(zh.tools.bash.failed, original.failed);
  } finally {
    zh.footer.cwdPrefix = original.cwdPrefix;
    zh.tools.bash.done = original.done;
    zh.header.compact.interrupt = original.interrupt;
    zh.workingMessage = original.workingMessage;
    zh.builtinCommands.export = original.exportCommand;
  }
});

test("函数条目与拼错的键名都不生效，全落空时提示一次", () => {
  const before = zh.tools.bash.lines(3);
  const notices = runOverrides({
    // lines 是函数（要拼数字），JSON 表达不了；donee 是 done 的错拼。
    "pi-zh-cn": { copy: { tools: { bash: { lines: "X 行", donee: "错别字" } } } },
  });

  assert.equal(zh.tools.bash.lines(3), before, "函数条目不该被字符串顶掉");
  assert.equal((zh.tools.bash as any).donee, undefined, "不该凭空长出键");
  assert.equal(notices.length, 1, "一条都没命中时应有提示，否则用户只会看到「改了没反应」");
  assert.match(notices[0], /没有一条能对上/);
});

test("settings.json 坏掉：提示一次且不改动词条", () => {
  const before = zh.footer.cwdPrefix;
  const notices = runOverrides("{ 这不是合法 JSON");

  assert.equal(zh.footer.cwdPrefix, before, "解析失败时不该改任何条目");
  assert.equal(notices.length, 1);
  assert.match(notices[0], /解析失败/);
});

test("项目本地设置覆盖全局；项目不受信任时不读它", () => {
  const original = zh.footer.cwdPrefix;
  const globalLayer = { "pi-zh-cn": { copy: { footer: { cwdPrefix: "全局：" } } } };
  const projectLayer = { "pi-zh-cn": { copy: { footer: { cwdPrefix: "项目：" } } } };
  try {
    runOverrides(globalLayer, { trusted: true, project: projectLayer });
    assert.equal(zh.footer.cwdPrefix, "项目：", "项目层应覆盖全局层");

    zh.footer.cwdPrefix = original;
    runOverrides(globalLayer, { trusted: false, project: projectLayer });
    assert.equal(
      zh.footer.cwdPrefix,
      "全局：",
      "项目不受信任时不该读它的设置，与内置设置的信任边界一致",
    );
  } finally {
    zh.footer.cwdPrefix = original;
  }
});

test("没有设置文件：静默跳过，不打扰用户", () => {
  const before = zh.footer.cwdPrefix;
  const notices = runOverrides(undefined);

  assert.deepEqual(notices, [], "没写过设置的人不该收到任何提示");
  assert.equal(zh.footer.cwdPrefix, before);
});

test("删掉覆盖后再次应用，译法回到默认（不残留到重启为止）", () => {
  // 先归零，保证 original 就是默认值，而不是某个前面用例留下的覆盖。
  runOverrides(undefined);
  const original = zh.footer.cwdPrefix;
  try {
    runOverrides({ "pi-zh-cn": { copy: { footer: { cwdPrefix: "目录：" } } } });
    assert.equal(zh.footer.cwdPrefix, "目录：", "前提：覆盖应已生效");

    // 用户删掉了这条覆盖，设置文件里已经没有它。/reload、/new、/resume、/fork
    // 都会在同一个进程里再次进入 session_start，这里模拟的就是那次重新应用。
    runOverrides({});
    assert.equal(
      zh.footer.cwdPrefix,
      original,
      "设置里已经没有这条覆盖，译法也应回到默认，而不是残留在内存里直到重启 pi",
    );
  } finally {
    zh.footer.cwdPrefix = original;
  }
});
