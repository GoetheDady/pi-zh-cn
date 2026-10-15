/**
 * pi 设置文件的读取路径。
 *
 * 全局一份；受信任项目的本地一份，后者优先。信任边界跟内置设置一致——项目
 * 本地设置只在该项目受信任时才读。
 *
 * footer 的自动压缩标记、copy-overrides 的词条覆盖、header 的 quietStartup
 * 都走这里。三处各自拼路径的话，哪天把信任判断改歪一处，就会出现「某个设置
 * 在不受信任的项目里被读了」这种不好发现的问题。
 */
import { join } from "node:path";
import {
  CONFIG_DIR_NAME,
  getAgentDir,
  type ExtensionContext,
} from "@earendil-works/pi-coding-agent";

/**
 * 全局设置文件路径。
 *
 * 有些设置必须只看这一份：`defaultProjectTrust` 要在「项目是否受信任」有结论
 * 之前生效，而项目本地设置的生效前提正是项目已受信任——先有鸡还是先有蛋。
 * 上游 settings-manager 读它时同样只看全局。
 */
export function globalSettingsFile(): string {
  return join(getAgentDir(), "settings.json");
}

/**
 * 按优先级从低到高返回设置文件路径（先全局，后项目本地）。
 *
 * @param ctx 当前会话上下文
 */
export function settingsFiles(ctx: ExtensionContext): string[] {
  const paths = [globalSettingsFile()];
  if (ctx.isProjectTrusted()) {
    paths.push(join(ctx.cwd, CONFIG_DIR_NAME, "settings.json"));
  }
  return paths;
}
