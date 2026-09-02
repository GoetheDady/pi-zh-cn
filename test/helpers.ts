/**
 * 契约测试共享工具：加载上游 pi 包的内部模块与文件。
 *
 * 部分上游结构（trust-manager、footer-data-provider、slash-commands）
 * 未从包顶层导出且 dist 子路径不在 package.json exports 里，统一按
 * 文件 URL 加载；dist 内部的相对导入不受影响。
 */
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

/** 上游包内文件的绝对路径。 */
export const dist = (...parts: string[]): string =>
  fileURLToPath(
    new URL(
      `../node_modules/@earendil-works/pi-coding-agent/dist/${parts.join("/")}`,
      import.meta.url,
    ),
  );

/** 读取上游包内文件内容。 */
export const readDist = (...parts: string[]): string =>
  readFileSync(dist(...parts), "utf8");

/** 按文件 URL 加载上游 dist 模块（顶层 exports 不含的子路径）。 */
export const loadDist = async <T = any>(...parts: string[]): Promise<T> =>
  import(new URL(`file://${dist(...parts)}`).href) as Promise<T>;
