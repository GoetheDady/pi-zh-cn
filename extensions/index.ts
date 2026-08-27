/**
 * pi-zh-cn —— pi 简体中文 TUI 界面汉化扩展（入口）
 *
 * 覆盖范围（扩展 API 所及）：
 * - 流式加载提示 / thinking 折叠块标签 → ui-copy.ts
 * - 启动 header → header.ts
 * - 底部状态栏（/footer 可切换中文与内置样式）→ footer.ts
 * - 项目信任弹窗 → trust.ts
 * - 内置 read/bash/edit/write/grep/find/ls/powershell 工具的渲染文案
 *   （同名重注册，执行委托原实现）→ localized-tools.ts，共享模板在 tool-renders.ts
 *
 * 不改动发给模型的内容（工具 description 保持英文）。
 */

import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { registerProjectTrustDialog } from "./trust.ts";
import { applyUiCopy } from "./ui-copy.ts";
import { setChineseHeader } from "./header.ts";
import { setupChineseFooter } from "./footer.ts";
import { registerLocalizedTools } from "./localized-tools.ts";

/**
 * 扩展入口（由 pi 扩展加载器调用）。
 *
 * 注册内容：
 * - `project_trust` 中文信任弹窗（进程启动时注册一次）；
 * - `/footer` 命令，用于在中文 footer 与内置 footer 之间切换；
 * - `session_start` 时按需应用 UI 文案、中文 header、中文 footer
 *   （TUI 模式限定）并重注册内置工具的中文渲染。
 *
 * @param pi pi 提供的扩展 API 实例
 */
export default function (pi: ExtensionAPI) {
  registerProjectTrustDialog(pi);

  let toggleFooter: (() => void) | undefined;

  // 只注册一次；当前 session 的 footer 实现由 session_start 更新。
  pi.registerCommand("footer", {
    description: "在中文 footer 和内置 footer 之间切换",
    handler: async () => {
      toggleFooter?.();
    },
  });

  pi.on("session_start", (_event, ctx) => {
    if (!ctx.hasUI) return;

    applyUiCopy(ctx);
    setChineseHeader(ctx);
    const toggle = setupChineseFooter(ctx);
    if (toggle) toggleFooter = toggle;

    registerLocalizedTools(pi, ctx.cwd);
  });
}
