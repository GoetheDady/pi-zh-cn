/**
 * 上游契约测试：ui-copy 覆盖点。
 *
 * extensions/ui-copy.ts 依赖 ctx.ui 的三个 setter/注册器，以及
 * zh.builtinCommands 对全部内置斜杠命令的覆盖。断言：
 * 1. 上游 ExtensionContextUi 的这些方法仍存在；
 * 2. BUILTIN_SLASH_COMMANDS 的命令集合与 zh.builtinCommands 键一致——
 *    上游新增或改名命令时报警，补齐对应词条即可。
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import type { ExtensionContext } from "@earendil-works/pi-coding-agent";
import { loadDist, readDist } from "./helpers.ts";
// BUILTIN_SLASH_COMMANDS 未从包顶层导出。
const { BUILTIN_SLASH_COMMANDS } = await loadDist<{
  BUILTIN_SLASH_COMMANDS: ReadonlyArray<{ name: string; description: string }>;
}>("core/slash-commands.js");
import { zh } from "../extensions/zh.ts";

test("ctx.ui 的文案覆盖方法仍存在", () => {
  type Ui = ExtensionContext["ui"];
  // 编译期验证：这三个成员必须存在于 ctx.ui 上；任一缺失则
  // _HasMembers 为 never，`true` 不可赋给 never，tsc 即报错。
  type _HasMembers = Ui extends {
    setWorkingMessage: unknown;
    setHiddenThinkingLabel: unknown;
    addAutocompleteProvider: unknown;
  }
    ? true
    : never;
  const _typeCheck: _HasMembers = true;
  void _typeCheck;
  // 运行时探针：上游类型声明文件中仍声明这些方法。
  const typesDts = readDist("core/extensions/types.d.ts");
  for (const method of [
    "setWorkingMessage",
    "setHiddenThinkingLabel",
    "addAutocompleteProvider",
  ]) {
    assert.ok(
      typesDts.includes(method),
      `ctx.ui.${method} 不存在了，applyUiCopy 需核对`,
    );
  }
});

test("zh.builtinCommands 覆盖全部内置斜杠命令", () => {
  const upstreamNames = BUILTIN_SLASH_COMMANDS.map((c) => c.name);
  const zhKeys = Object.keys(zh.builtinCommands);
  const missing = upstreamNames.filter((n) => !zhKeys.includes(n));
  const extra = zhKeys.filter((k) => !upstreamNames.includes(k));
  assert.deepEqual(
    { missing, extra },
    { missing: [], extra: [] },
    "内置斜杠命令与 zh.builtinCommands 不同步（missing=缺词条，extra=多余词条）",
  );
  // description 契约：上游命令都有描述，词条不允许空串。
  for (const name of upstreamNames) {
    assert.ok(
      (zh.builtinCommands as Record<string, string>)[name]?.length > 0,
      `命令 ${name} 的中文描述为空`,
    );
  }
});
