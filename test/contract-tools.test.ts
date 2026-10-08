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
  createEditToolDefinition,
  createFindTool,
  createGrepTool,
  createLsTool,
  createReadTool,
  createWriteTool,
  initTheme,
} from "@earendil-works/pi-coding-agent";
import { registerLocalizedTools } from "../extensions/localized-tools.ts";
import { shellRenders } from "../extensions/tool-renders.ts";
import { zh } from "../extensions/zh.ts";

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

test("bash：失败命令标记 isError，错误文本含「Command exited with code N」句式", async () => {
  const dir = tmpProject();
  try {
    const tool = createBashTool(dir);
    const ok = await run(tool, { command: "echo hello" });
    assert.ok(textOf(ok).includes("hello"));

    // pi 0.99 起非零退出不再抛错，改为 resolve 一个 isError: true 的结果
    // （超时/中止仍然抛错）。tool-renders.ts 的 failureState 优先读渲染
    // 上下文的 isError，并靠
    // /(?:exit code:\s*|command exited with code\s+)(\d+)/i 解析退出码，
    // 上游改标记或错误文案句式时这里报警。
    const failed = await run(tool, { command: "echo boom; exit 3" });
    assert.equal(failed.isError, true, "非零退出应标记 isError");
    assert.match(textOf(failed), /command exited with code 3/i);
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

/** 注册全部汉化工具，返回 name → 工具定义。 */
function registerAll(dir: string): Map<string, any> {
  const names = ["read", "bash", "edit", "write", "grep", "find", "ls", "powershell"];
  const defs = new Map<string, any>();
  registerLocalizedTools(
    {
      getActiveTools: () => names,
      getAllTools: () => names.map((name) => ({ name, sourceInfo: { source: "builtin" } })),
      setActiveTools: () => {},
      registerTool: (def: any) => defs.set(def.name, def),
    } as any,
    dir,
  );
  return defs;
}

/** 只透传文字的假 theme：渲染测试不关心颜色。 */
const plainTheme = {
  fg: (_color: string, text: string) => text,
  bg: (_color: string, text: string) => text,
  bold: (text: string) => text,
  inverse: (text: string) => text,
} as any;

/** 只填渲染所需字段的假 ToolRenderContext。 */
const renderCtx = (args: any, dir: string, expanded = false) =>
  ({
    args,
    state: {},
    lastComponent: undefined,
    cwd: dir,
    isError: false,
    expanded,
    isPartial: false,
    showImages: false,
    argsComplete: true,
    toolCallId: "render-test",
    executionStarted: true,
    invalidate: () => {},
  }) as any;

test("bash 渲染：只有 isError 标记时也显示中文失败态", () => {
  // pi 1.x 的非零退出走 isError 通道，文本未必带可解析的退出码句式；
  // isError 在 renderResult 的第 4 个参数（渲染上下文）上。
  const { renderResult } = shellRenders(zh.tools.bash) as any;
  const render = (context: any) =>
    renderResult(
      { content: [{ type: "text", text: "boom" }] },
      { expanded: false, isPartial: false },
      plainTheme,
      context,
    )
      .render(80)
      .join("\n");
  const ctx = renderCtx({ command: "boom" }, process.cwd());

  const failedOut = render({ ...ctx, isError: true });
  assert.ok(
    failedOut.includes(zh.tools.bash.failed),
    `isError 结果应显示「${zh.tools.bash.failed}」，实际：${failedOut}`,
  );
  assert.ok(
    render({ ...ctx, isError: false }).includes(zh.tools.bash.done),
    "成功结果仍应显示完成态",
  );
  // 旧版 pi 不传渲染上下文：退化为文本推断，不能抛错。
  assert.ok(render(undefined).includes(zh.tools.bash.done));
});

test("edit：折叠态回落内置 diff 渲染（本地化不吞掉改动内容）", async () => {
  const dir = tmpProject();
  try {
    // 内置 diff 渲染读全局 theme 单例，未初始化会抛错。
    initTheme("dark");

    const plugin = registerAll(dir).get("edit");
    const builtIn = createEditToolDefinition(dir);
    assert.equal(
      plugin.renderResult,
      undefined,
      "插件覆盖了 edit 的 renderResult，折叠态会看不到 diff",
    );
    // ToolExecutionComponent 的解析顺序：插件 renderResult ?? 内置 renderResult
    const renderResult = builtIn.renderResult!;

    const args = { path: "sample.txt", edits: [{ oldText: "beta", newText: "beta2" }] };
    const result = await run(plugin, args);
    const out = renderResult(
      result,
      { expanded: false, isPartial: false },
      plainTheme,
      renderCtx(args, dir),
    )
      .render(80)
      .join("\n");

    assert.match(out, /-2 beta/, `折叠态应含删除行，实际渲染：\n${out}`);
    assert.match(out, /\+2 beta2/, `折叠态应含新增行，实际渲染：\n${out}`);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("write：renderCall 预览文件内容（折叠 10 行 + 中文展开提示，展开全量）", () => {
  const dir = tmpProject();
  try {
    initTheme("dark");
    const plugin = registerAll(dir).get("write");
    const content = Array.from({ length: 15 }, (_, i) => `line${i}`).join("\n");
    const args = { path: "sample.txt", content };

    const collapsed = plugin.renderCall(args, plainTheme, renderCtx(args, dir)).render(120).join("\n");
    assert.match(collapsed, /line0/, `折叠态应预览内容，实际渲染：\n${collapsed}`);
    assert.doesNotMatch(collapsed, /line14/, `折叠态不应显示第 11 行以后，实际渲染：\n${collapsed}`);
    assert.match(collapsed, /还有 5 行，共 15 行/, `折叠态应提示剩余行数，实际渲染：\n${collapsed}`);
    assert.match(collapsed, /展开/, `展开提示应为中文，实际渲染：\n${collapsed}`);

    const expanded = plugin.renderCall(args, plainTheme, renderCtx(args, dir, true)).render(120).join("\n");
    assert.match(expanded, /line14/, `展开态应显示全部行，实际渲染：\n${expanded}`);
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

test("bash：无退出码的终止提示判为失败（0.86.0 新增句式）", () => {
  const dir = tmpProject();
  try {
    initTheme("dark");
    const plugin = registerAll(dir).get("bash");
    // 上游 appendStatus 把状态串拼在输出之后；输出为空时它位于文本开头。
    const render = (text: string) =>
      plugin
        .renderResult(
          { content: [{ type: "text", text }], isError: true },
          { expanded: false, isPartial: false },
          plainTheme,
        )
        .render(120)
        .join("\n");

    for (const text of [
      "Command terminated without an exit code",
      "(no output)\n\nCommand terminated without an exit code",
    ]) {
      const out = render(text);
      assert.match(out, /执行失败/, `无退出码应判为失败，实际渲染：${out}`);
      assert.doesNotMatch(out, /完成/, `无退出码不应显示完成，实际渲染：${out}`);
    }

    assert.match(render("hello"), /完成/, "正常输出仍应显示完成");
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
