/**
 * 上游跟进报告的纯函数：树读取、差异归类、CHANGELOG 截断。
 *
 * 联网与解压那部分不进测试——那是编排（下载、调用 tar），出问题会当场报错；
 * 这里只钉三处「错了会给出误导性报告」的判断逻辑，因为它们错了不会报错，
 * 只会让人对着错误的清单干活。
 *
 * 注意文件名是 upstream-report.test.ts：脚本靠 basename 精确比对来决定要不
 * 要执行主流程，所以 import 它不会联网。
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  changelogSince,
  diffTrees,
  readTree,
} from "../scripts/upstream-report.ts";

test("readTree：递归收集，排除 bundle/ 与 sourcemap", () => {
  const root = mkdtempSync(join(tmpdir(), "pi-tree-"));
  try {
    mkdirSync(join(root, "core"), { recursive: true });
    mkdirSync(join(root, "bundle", "chunks"), { recursive: true });
    writeFileSync(join(root, "core", "a.js"), "a");
    writeFileSync(join(root, "core", "a.js.map"), "{}");
    writeFileSync(join(root, "bundle", "chunks", "x.js"), "x");
    writeFileSync(join(root, "index.js"), "i");

    // bundle/ 里的文件名带内容哈希，每次发版全变；不排掉会淹没真正的变更。
    assert.deepEqual(
      [...readTree(root).keys()].sort(),
      ["core/a.js", "index.js"],
    );
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("diffTrees：新增 / 修改 / 删除各归其类", () => {
  const before = new Map([
    ["same.js", "x"],
    ["gone.js", "y"],
    ["edited.js", "1"],
  ]);
  const after = new Map([
    ["same.js", "x"],
    ["edited.js", "2"],
    ["fresh.js", "z"],
  ]);

  assert.deepEqual(diffTrees(before, after), {
    added: ["fresh.js"],
    changed: ["edited.js"],
    removed: ["gone.js"],
  });
});

test("changelogSince：只留比基线新的条目；基线不在其中时不假装没有", () => {
  const markdown = [
    "# Changelog",
    "",
    "## [1.2.0] - 2026-10-12",
    "- 新的",
    "",
    "## [1.1.0] - 2026-10-07",
    "- 旧的",
    "",
  ].join("\n");

  const since = changelogSince(markdown, "1.1.0");
  assert.match(since, /1\.2\.0/, "应含比基线新的条目");
  assert.doesNotMatch(
    since,
    /## \[1\.1\.0\]/,
    "基线自身的条目不该出现在「要跟的内容」里",
  );

  // 基线不在 changelog 里（改名、或基线还没进 changelog）时退回全文，
  // 给人多点上下文，而不是假装「没有要跟的」。
  assert.equal(changelogSince(markdown, "9.9.9"), markdown.trim());
});
