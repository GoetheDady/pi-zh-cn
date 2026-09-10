# 发版流程

一句话：**改版本号 → 打 tag 推上去 → 剩下的 CI 全包**。不需要本地 npm 登录，也不需要 `NPM_TOKEN`。

## 认证方式

发布走 npm Trusted Publishing（OIDC）：npm 只接受来自本仓库 `.github/workflows/publish.yml`
的发布请求，凭据由 GitHub 每次运行时临时签发、用完即废。旧的长期 token 会过期、会泄漏
（2026-09-10 就因为 token 过期卡过一次发版）。顺带 npm 会自动生成 provenance 来源证明。

前置条件（一次性，已完成；换仓库或换包名时才需重做）：

```text
npmjs.com → 包页面 → Settings → Trusted Publisher → GitHub Actions
  Organization or user: GoetheDady
  Repository:           pi-zh-cn
  Workflow filename:    publish.yml      ← 只填文件名，不带路径，大小写敏感
  Environment name:     留空              ← 本仓库的 workflow 没设 environment
  Allowed actions:      勾选 Allow npm publish
  Label:                可留空
```

## 步骤

### 1. 改版本号并提交

```bash
npm version patch --no-git-tag-version   # 同时改 package.json 与 package-lock.json
git commit -am "0.2.7: 一句话说明"
```

`patch` 还是 `minor` 由改动性质定。**npm 不允许重发同一版本，发出去就收不回。**

### 2. 打 tag 并推送

```bash
git tag -a v0.2.7 -m "0.2.7: 一句话说明"
git push origin main
git push origin v0.2.7        # 这一步触发发布
```

### 3. 看流水线

```bash
gh run list --workflow=Publish --limit 1
gh run view <run-id>          # 或 gh run watch <run-id>
```

流水线四步：`npm ci` → 核对 tag 与 `package.json` 版本一致 → `npm test` → `npm publish`。
tag 与版本不一致会**在发布前**被拦下（退出码 1），不会发出错版本。

### 4. 核对真的发出去了

```bash
npm view pi-zh-cn version            # 应为新版本
npm view pi-zh-cn dist-tags          # latest 应指向新版本
npm view pi-zh-cn@0.2.7 dist --json  # 应含 attestations.provenance
```

再确认「发出去的 == tag 里的」（0.2.6 发版时这么校验过）：

```bash
W=$(mktemp -d) && mkdir -p "$W/tar" "$W/repo"
(cd "$W/tar" && npm pack pi-zh-cn@0.2.7 >/dev/null && tar xzf pi-zh-cn-0.2.7.tgz)
git archive v0.2.7 | tar -x -C "$W/repo"
diff -rq "$W/repo/extensions" "$W/tar/package/extensions"   # 无输出 = 逐字节一致
```

### 5. 建 GitHub Release

改动记录都在 Release 正文里（README 不再维护版本表），正文手写：

```bash
gh release create v0.2.7 --title "0.2.7 一句话标题" --notes-file /tmp/rel.md --latest
```

## 常见故障

### 发布步骤报 `ENEEDAUTH`（认证失败）

按顺序查，任意一条不符都只会在**真正发布那一刻**才报错——npm 保存配置时不校验：

1. **workflow 文件名**与 npm 上配置的是否完全一致（含 `.yml`、大小写敏感）。改名 workflow 必须同步改 npm 配置。
2. workflow 是否有 `id-token: write` 权限。
3. 是否用 GitHub 托管 runner（**不支持 self-hosted**）。
4. `package.json` 的 `repository.url` 是否与仓库一致（fork 出去发版最容易踩）。
5. npm 侧 Environment name 与 workflow 是否一致（本仓库两边都留空）。

### publish 失败了怎么重试

**不要改版本号**——那版还没发出去，重跑同一次即可：

```bash
gh run rerun <run-id>
```

### tag 打错了（名字错、或指向的提交不对）

```bash
git tag -d v0.2.7
git tag -a v0.2.7 -m "..." <正确提交>
git push --force origin v0.2.7
```

已发布的版本撤不回，只能发下一个版本号。

### 补打历史版本的 tag

Release 列表按 **tag 时间**排序（不是创建时间），补打时要带上原始时间，否则历史版本会排到列表顶部：

```bash
GIT_COMMITTER_DATE="2026-08-25T07:53:56Z" git tag -a v0.1.0 -m "..." <提交>
git push origin v0.1.0
```

补打前建议先用 npm 上已发布的 tarball 校验 tag 指向的提交对不对（比对 `extensions/` 与 `package.json`）。

## 依赖基线怎么跟进

pi 发版很快（近一个月 0.84.0 → 0.85.1 共 6 个版本），所以基线不靠人工升级：

- **Dependabot** 每日开 PR 升级 devDependencies（pi 三个包合成一个 PR）。**它的 PR 的 CI 就是对新版跑一遍契约测试**——绿了合并即完成升级，红了就是兼容性破损警报。
- **上游金丝雀**（`ci.yml` 的 schedule，每两天）忽略 lockfile 直接拉最新版 pi 跑同一套测试，覆盖「用户已经在用新版、我们还没合并基线」的窗口。
- `peerDependencies` 只设下限（`>=0.84.0`）、不设上限，永不拦住用户。

基线升级与发版是两件事：基线跟进通常不需要发版。

## 有意不自动化的事

- **版本号**：手动 bump，避免 CI 在无人决策时发布。
- **Release 正文**：手写改动说明，不自动生成 commit 列表。
- **GitHub Release**：由 `gh release create` 单独建，发布流水线只管 npm。
