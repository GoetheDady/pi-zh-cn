/**
 * 上游契约测试：内置工具结果结构。
 *
 * 实际执行 createXxxTool 生成的内置工具，断言 extensions/localized-tools.ts
 * 与 tool-renders.ts 的中文渲染所依赖的结果形态不变：content[0].text、
 * details.truncation / matchLimitReached / resultLimitReached /
 * entryLimitReached、edit 的 details.diff、bash 失败时错误文本中的
 * 「Command exited with code N」句式、无匹配哨兵串。任一失败说明上游
 * 工具结果结构变了，需核对对应的 zh.tools.* 文案与渲染逻辑。
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  createBashTool,
  createEditTool,
  createFindTool,
  createGrepTool,
  createLsTool,
  createReadTool,
  createWriteTool,
} from "@earendil-works/pi-coding-agent";

/** 建一个带样例文件的临时项目目录，测试结束后清理。 */
function tmpProject(): string {
  const dir = mkdtempSync(join(tmpdir(), "pi-zh-cn-tools-"));
  writeFileSync(join(dir, "sample.txt"), "alpha\nbeta\ngamma\n");
  return dir;
}

/** 按 AgentTool.execute 的真实签名调用工具。 */
const run = (tool: any, params: any) =>
  tool.execute("contract-test-call", params, undefined, undefined);

const textOf = (result: any): string => result.content?.[0]?.text ?? "";

test("read：文本走 content[0].text；超限文件带 truncation.truncated 与 totalLines", async () => {
  const dir = tmpProject();
  try {
    const tool = createReadTool(dir);
    const small = await run(tool, { path: "sample.txt" });
    assert.equal(textOf(small), "alpha\nbeta\ngamma\n");
    assert.equal(small.details?.truncation, undefined);

    // 超过 DEFAULT_MAX_LINES（2000 行）触发截断；zh.tools.read.truncatedFrom
    // 读取 truncation.totalLines。
    const big = Array.from({ length: 2500 }, (_, i) => `line${i}`).join("\n");
    writeFileSync(join(dir, "big.txt"), `${big}\n`);
    const truncated = await run(tool, { path: "big.txt" });
    assert.equal(
      truncated.details?.truncation?.truncated,
      true,
      `超限读取应标记 truncation.truncated，details：${JSON.stringify(truncated.details)}`,
    );
    assert.equal(
      typeof truncated.details.truncation.totalLines,
      "number",
      "truncation.totalLines 缺失，zh.tools.read.truncatedFrom 需核对",
    );
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("bash：失败命令抛错，错误文本含「Command exited with code N」句式", async () => {
  const dir = tmpProject();
  try {
    const tool = createBashTool(dir);
    const ok = await run(tool, { command: "echo hello" });
    assert.ok(textOf(ok).includes("hello"));

    // tool-renders.ts 的 failureState 靠匹配
    // /(?:exit code:\s*|command exited with code\s+)(\d+)/i 判定失败，
    // 上游改错误文案句式时这里报警。
    await assert.rejects(
      () => run(tool, { command: "echo boom; exit 3" }),
      (error: any) => {
        const text = String(error?.message ?? error);
        assert.match(text, /command exited with code 3/i);
        return true;
      },
    );
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("edit：成功结果带 details.diff（+/- 行），供增删行统计", async () => {
  const dir = tmpProject();
  try {
    const tool = createEditTool(dir);
    const result = await run(tool, {
      path: "sample.txt",
      edits: [{ oldText: "beta", newText: "beta2" }],
    });
    const diff = result.details?.diff;
    assert.equal(typeof diff, "string", `details.diff 缺失：${JSON.stringify(result.details)}`);
    assert.ok(diff.split("\n").some((l: string) => l.startsWith("+")), "diff 应含 + 行");
    assert.ok(diff.split("\n").some((l: string) => l.startsWith("-")), "diff 应含 - 行");
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("write：成功写入", async () => {
  const dir = tmpProject();
  try {
    const result = await run(createWriteTool(dir), {
      path: "out.txt",
      content: "written\n",
    });
    assert.ok(textOf(result).length > 0, "write 成功结果应有文本内容");
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("grep：无匹配哨兵串与 matchLimitReached 字段", async () => {
  const dir = tmpProject();
  try {
    const tool = createGrepTool(dir);
    const hit = await run(tool, { pattern: "beta", path: dir });
    assert.ok(textOf(hit).includes("beta"));
    assert.equal(hit.details?.matchLimitReached, undefined);

    const none = await run(tool, { pattern: "zzzz", path: dir });
    // countResultRender 靠哨兵串识别「无匹配」；上游改文案时报警。
    assert.equal(textOf(none), "No matches found", "grep 无匹配哨兵串变了，需核对 countResultRender 调用");

    const limited = await run(tool, { pattern: "alpha", path: dir, limit: 1 });
    assert.equal(
      typeof limited.details?.matchLimitReached,
      "number",
      "matchLimitReached 字段缺失，zh.tools.grep.matchLimit 需核对",
    );
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("find：无匹配哨兵串与 resultLimitReached 字段", async () => {
  const dir = tmpProject();
  try {
    const tool = createFindTool(dir);
    const hit = await run(tool, { pattern: "sample*", path: dir });
    assert.ok(textOf(hit).includes("sample.txt"));

    const none = await run(tool, { pattern: "zzzz*", path: dir });
    assert.equal(
      textOf(none),
      "No files found matching pattern",
      "find 无匹配哨兵串变了，需核对 countResultRender 调用",
    );

    for (let i = 0; i < 5; i++) writeFileSync(join(dir, `f${i}.txt`), "x");
    const limited = await run(tool, { pattern: "f*.txt", path: dir, limit: 2 });
    assert.equal(
      typeof limited.details?.resultLimitReached,
      "number",
      "resultLimitReached 字段缺失，zh.tools.find.resultLimit 需核对",
    );
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("ls：空目录哨兵串与 entryLimitReached 字段", async () => {
  const dir = tmpProject();
  try {
    const tool = createLsTool(dir);
    // tmpProject 里已有文件，空目录哨兵用新空的子目录验证。
    mkdirSync(join(dir, "empty"), { recursive: true });
    const empty = await run(tool, { path: join(dir, "empty") });
    assert.equal(
      textOf(empty),
      "(empty directory)",
      "ls 空目录哨兵串变了，需核对 countResultRender 调用",
    );

    for (let i = 0; i < 10; i++) writeFileSync(join(dir, `f${i}.txt`), "x");
    const limited = await run(tool, { path: dir, limit: 3 });
    assert.equal(
      typeof limited.details?.entryLimitReached,
      "number",
      "entryLimitReached 字段缺失，zh.tools.ls.entryLimit 需核对",
    );
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
