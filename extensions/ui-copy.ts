/**
 * UI 文案模块：流式加载提示、thinking 折叠块标签，
 * 以及 TUI 模式下中文化内置斜杠命令描述。
 */
import type { ExtensionContext } from "@earendil-works/pi-coding-agent";
import { zh } from "./zh.ts";

// 替换是幂等的，跨 session 只包一次。
let autocompleteTranslated = false;

/**
 * 中文化内置斜杠命令的补全描述（仅 TUI 模式）。
 *
 * 做法：在现有 autocomplete provider 外再包一层——`getSuggestions` 只把
 * 命令项的 `description` 换成中文（zh.builtinCommands 按命令名查找，无对应
 * 条目的项原样透传），文件路径等其他建议不改动；`applyCompletion` 直接
 * 委托原实现。
 *
 * 整个进程只包装一次（跨 session 幂等），避免重复叠加翻译层。
 */
function translateBuiltinCommands(ctx: ExtensionContext) {
  if (ctx.mode !== "tui" || autocompleteTranslated) return;
  autocompleteTranslated = true;
  ctx.ui.addAutocompleteProvider((current) => ({
    ...(current.triggerCharacters ? { triggerCharacters: current.triggerCharacters } : {}),
    getSuggestions: async (lines, cursorLine, cursorCol, options) => {
      const suggestions = await current.getSuggestions(lines, cursorLine, cursorCol, options);
      if (!suggestions) return null;
      return {
        ...suggestions,
        items: suggestions.items.map((item) => {
          const key = item.value.replace(/^\//, "") as keyof typeof zh.builtinCommands;
          const zhDesc = zh.builtinCommands[key];
          return zhDesc ? { ...item, description: zhDesc } : item;
        }),
      };
    },
    applyCompletion: (lines, cursorLine, cursorCol, item, prefix) =>
      current.applyCompletion(lines, cursorLine, cursorCol, item, prefix),
  }));
}

/**
 * 应用所有会话启动时的 UI 文案：流式加载提示、折叠 thinking 标签，
 * 以及（TUI 模式下）内置斜杠命令的中文描述。
 *
 * @param ctx 当前会话上下文（要求 hasUI 为 true，由调用方保证）
 */
export function applyUiCopy(ctx: ExtensionContext) {
  ctx.ui.setWorkingMessage(zh.workingMessage);
  ctx.ui.setHiddenThinkingLabel(zh.hiddenThinkingLabel);
  translateBuiltinCommands(ctx);
}
