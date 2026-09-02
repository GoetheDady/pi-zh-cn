/**
 * 冒烟测试：扩展入口可被 pi 正常加载。
 *
 * 不调用 LLM，只验证 extensions/index.ts 能被动态导入（语法、导入路径
 * 与上游 API 引用在加载期即执行，破裂时抛错）且默认导出是一个函数。
 */
import { test } from "node:test";
import assert from "node:assert/strict";

test("扩展入口可加载且默认导出为函数", async () => {
  const entry = await import("../extensions/index.ts");
  assert.equal(typeof entry.default, "function", "默认导出应为 pi 扩展入口函数");
});
