# TODO

## 错误处理清理

目标：把“没有处理好”的错误出口统一起来，让脚本失败时信息明确、退出一致，同时保留必要的交互重试和可接受的静默探测。

### codetpl/command.js

- [ ] 统一错误退出函数
  - 位置：`codetpl/command.js:19`、`codetpl/command.js:136`、`codetpl/command.js:160`
  - 问题：多处直接 `console.error(...)` + `process.exit(1)`。
  - 建议：增加 `exitWithError(error)`，统一输出错误消息并退出。

- [ ] `tsx` 缺失提示补充可执行修复方式
  - 位置：`codetpl/command.js:19`
  - 问题：只提示“缺少 tsx，请先安装依赖”，不知道应在哪个目录执行什么命令。
  - 建议：输出 `packageRoot` 和 `pnpm install`，例如 `请在 <packageRoot> 执行 pnpm install`。

- [ ] 进程查询失败信息本地化并补上下文
  - 位置：`codetpl/command.js:41`、`codetpl/command.js:43`、`codetpl/command.js:53`、`codetpl/command.js:55`
  - 问题：直接抛底层错误或英文 `Failed to query...`，用户不容易判断是 `stop/restart` 失败。
  - 建议：统一包装成“查询运行进程失败”，附带平台、命令 stderr/stdout。

- [ ] `ps` 输出解析失败不要直接中断全部流程
  - 位置：`codetpl/command.js:62`
  - 问题：单行解析失败会导致整个 stop/restart 失败。
  - 建议：跳过无法解析的行，或在最终错误里说明具体异常行。

- [ ] 停止进程失败信息补充命令和 pid
  - 位置：`codetpl/command.js:115`、`codetpl/command.js:117`
  - 问题：`stopResult.error` 直接 throw，失败信息不稳定。
  - 建议：包装为“停止进程失败”，输出 pid 列表和底层错误。

### src/scripts/public.ts

- [ ] 统一 `user-cancelled` 表达
  - 位置：`src/scripts/public.ts:317`、`353`、`375`、`491`、`530`、`563`、`628`、`772`、`1021`、`1053`
  - 问题：多处使用普通 `Error("user-cancelled")`。
  - 建议：增加 `isUserCancelled()` / `userCancelled()` 或专用错误类型，避免到处比较字符串。

- [ ] `runInteractiveCommand` 保留原始失败信息
  - 位置：`src/scripts/public.ts:288`
  - 问题：失败统一变成 `Interactive command failed`，丢失具体命令和错误。
  - 建议：错误信息包含命令；`throwOnError=false` 时至少可选 debug 日志，不要完全吞掉。

- [ ] `askValidOutputName` / `confirmOutputName` 的重试错误输出统一
  - 位置：`src/scripts/public.ts:330`、`383`
  - 问题：直接 `console.error`，和其他 `Appexit` 风格不一致。
  - 建议：提取 `printInputError(error)`，只在交互重试场景使用。

- [ ] GitHub 仓库创建和 origin 设置保留底层错误
  - 位置：`src/scripts/public.ts:638`、`655`、`781`、`912`
  - 问题：catch 后只输出概括信息，丢失 gh/git 的具体失败原因。
  - 建议：包装错误时附带原始 `error.message`。

- [ ] 初始提交失败路径减少重复 catch
  - 位置：`src/scripts/public.ts:812`、`824`、`840`、`862`
  - 问题：`git add`、普通 commit、空 commit 多段 try/catch，逻辑偏绕。
  - 建议：提取 `gitCommitAllowEmpty(targetPath, reason)` 和 `gitStatusGet(targetPath)`。

- [ ] `commandGet` 的静默失败使用场景分类
  - 位置：`src/scripts/public.ts:989`
  - 问题：所有命令失败都返回 `undefined`，适合探测，但不适合必需命令。
  - 建议：保留 `commandGetOptional`，必需场景改用会抛出清晰错误的 `commandGetRequired`。

- [ ] 路径读取失败不要永久静默
  - 位置：`src/scripts/public.ts:1125`、`1154`
  - 问题：目录读取/文件读取失败直接返回空结果或 false，用户可能不知道是权限问题。
  - 建议：只对预期不存在静默；权限/解析错误给出提示。

### src/scripts/createPkg.ts

- [ ] 交互输入错误输出统一
  - 位置：`src/scripts/createPkg.ts:155`、`178`
  - 问题：和 `public.ts` 的交互重试错误输出重复。
  - 建议：复用 `printInputError(error)`。

- [ ] 创建命令失败保留原命令和退出原因
  - 位置：`src/scripts/createPkg.ts:224`
  - 问题：失败只显示“创建命令执行失败”。
  - 建议：输出实际 command，附带底层错误 message。

- [ ] degit clone 失败补充模板地址
  - 位置：`src/scripts/createPkg.ts:263`
  - 问题：`emitter.clone` 失败没有统一包装。
  - 建议：catch 后抛 `Appexit("模板拉取失败: <repo>")` 并保留原始错误。

- [ ] `targetPathDelete` 清理失败要提示
  - 位置：`src/scripts/createPkg.ts:291`
  - 问题：`rmSync` 失败会直接抛底层错误。
  - 建议：包装为“清理失败的项目目录失败”，附带路径。

### src/scripts/createNodeBin.ts

- [ ] 普通 `Error` 改成用户可读 `Appexit`
  - 位置：`src/scripts/createNodeBin.ts:49`、`72`、`97`、`100`、`173`、`182`
  - 问题：这些是用户输入/环境问题，用普通 Error 不够明确。
  - 建议：统一使用 `Appexit`，并改成中文或更明确的提示。

- [ ] `pnpm bin -g` 失败补充安装建议
  - 位置：`src/scripts/createNodeBin.ts:176`
  - 问题：无法解析全局 bin 时只报英文。
  - 建议：提示检查 `pnpm setup` / `PNPM_HOME` / shell 环境。

- [ ] stale link 读取失败不要完全吞掉
  - 位置：`src/scripts/createNodeBin.ts:250`
  - 问题：读取全局 bin 文件失败直接 `false`。
  - 建议：只在 debug 或 verbose 下输出被跳过文件。

### src/scripts/distPkg.ts

- [ ] source 文件收集的 build 失败不要完全吞掉
  - 位置：`src/scripts/distPkg.ts:368`
  - 问题：`buildSync` 失败直接返回空数组，后续只靠文本解析，用户不知道降级了。
  - 建议：输出一次“构建分析失败，已降级到文本 import 分析”。

- [ ] bundle/source 的错误文案统一语言
  - 位置：`src/scripts/distPkg.ts:114`、`118`、`276`、`282`、`635`
  - 问题：中英文混用。
  - 建议：统一成中文用户提示，必要时保留路径。

### src/scripts/gitPush.ts

- [ ] 兄弟目录 push 失败结果明确退出
  - 位置：`src/scripts/gitPush.ts:149`、`158`
  - 问题：多个兄弟目录失败后只打印错误，不改变最终任务状态。
  - 建议：最后如果 `failed.length > 0`，抛 `Appexit` 或输出明确“部分失败”状态。

- [ ] GitHub release 仓库创建失败保留底层错误
  - 位置：`src/scripts/gitPush.ts:282`、`299`
  - 问题：用户取消和命令失败混在同一段流程，失败原因可读性一般。
  - 建议：区分取消、仓库不存在、创建失败。

- [ ] 命令读取失败补充 cwd
  - 位置：`src/scripts/gitPush.ts:752`、`799`
  - 问题：只显示命令，不显示在哪个目录执行失败。
  - 建议：错误信息包含 `cwd`。

- [ ] `commandReadOptional` 静默失败分类
  - 位置：`src/scripts/gitPush.ts:760`
  - 问题：适合探测命令，但有些调用可能需要知道失败原因。
  - 建议：保留 optional，只用于探测；必需读取改 `commandRead`。

### src/scripts/publishYml.ts

- [ ] 普通 `Error` 改为用户可读错误
  - 位置：`src/scripts/publishYml.ts:268`、`323`
  - 问题：属于用户环境问题，建议统一成 `Appexit`。
  - 建议：提示需要 package.json、git remote、repository/homepage 中至少一个可推断 GitHub owner。

- [ ] `githubRemoteGet` 静默失败范围确认
  - 位置：`src/scripts/publishYml.ts:291`
  - 问题：当前适合作为探测；如果后续用于必需逻辑，应改成 required 版本。
  - 建议：保留 optional 命名，避免误用。

## 可暂不处理

- `process.exit(0)`、按 child 退出码退出：属于正常 CLI 行为。
- `githubRepoExists`、`commandOk`、`commandReadOptional` 这类探测函数：可以静默失败，但命名必须明确是 optional/probe。
- 交互输入校验中的错误打印：可以保留，但建议统一到一个 helper。
