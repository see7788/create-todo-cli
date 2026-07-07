## 快速使用

前置条件：
- 已安装 Node.js 和 pnpm
- 已安装并配置好 Codex CLI

使用方式：
```bash
pnpm dlx github:see7788/create-todo-cli
pnpm dlx github:see7788/create-todo-cli help
pnpm dlx github:see7788/create-todo-cli nodeScript
pnpm dlx github:see7788/create-todo-cli nodeScript/nodePkgCreate
pnpm dlx github:see7788/create-todo-cli nodeScript/nodePkgDist
pnpm dlx github:see7788/create-todo-cli nodeScript/nodePackageIdentityInit
pnpm dlx github:see7788/create-todo-cli nodeScript/nodePkgFinalize
pnpm dlx github:see7788/create-todo-cli nodeScript/nodePackageBinInit
pnpm dlx github:see7788/create-todo-cli pnpmScript
pnpm dlx github:see7788/create-todo-cli pnpmScript/pnpmInsert
pnpm dlx github:see7788/create-todo-cli pnpmScript/pnpmWorkspaceInit
pnpm dlx github:see7788/create-todo-cli gitScript
pnpm dlx github:see7788/create-todo-cli gitScript/gitPush
pnpm dlx github:see7788/create-todo-cli gitScript/gitAutoPush
pnpm dlx github:see7788/create-todo-cli gitScript/gitignoreInit
pnpm dlx github:see7788/create-todo-cli githubScript
pnpm dlx github:see7788/create-todo-cli githubScript/githubPublishYmlInit
```


## 源码说明

交互式 TypeScript 项目脚手架工具，主要能力包括：创建项目、抽取 npm 包、初始化 package 配置、初始化 GitHub 仓库，以及显式补齐 pnpm workspace 中的外部兄弟目录包。

入口位于 `src/index.ts`。命令名采用“环境/对象在前，动作在后”的风格。命令行只负责直达交互分支，不做参数预填。新增命令时，能力 `index.ts` 的 `cmds` 只写命令名字符串，实现写同名 `xxxRun`。

`xxxScript` 是用户可选择的命令入口，`project / git / pnpm / github` 是共享能力边界；命令入口调用共享能力，共享能力不反向调用命令入口。

## 文件结构

```txt
src/
├─ index.ts -> create-todo-cli
├─ base.ts -> Appexit / path / json / shell / prompt
├─ script.ts -> 命令菜单 / help / 无后续处理命令运行
├─ fileTpl.ts -> tpl 模板读取
├─ project.ts -> project/packageIdentity + project/nodePkgFinalize
├─ git.ts -> git/gitignoreInit + git/repoEnsure
├─ pnpm.ts -> pnpm/workspaceInit
├─ github.ts -> github/publishYmlInit
├─ nodeScript/
│  ├─ index.ts -> nodeScript
│  ├─ nodePkgCreate.ts -> nodePkgCreate
│  ├─ nodePkgDist.ts -> nodePkgDist
│  ├─ nodePkgFinalize.ts -> nodePkgFinalize
│  └─ nodePackageBinInit.ts -> nodePackageBinInit
├─ pnpmScript/
│  ├─ index.ts -> pnpmScript
│  └─ pnpmInsert.ts -> pnpmInsert
├─ gitScript/
│  ├─ index.ts -> gitScript
│  ├─ gitPush.ts -> gitPush
│  └─ gitAutoPush.ts -> gitAutoPush
├─ githubScript/
│  └─ index.ts -> githubScript
└─ tpl/ -> git / pnpm / github 模板
```

## 命令树

```txt
create-todo-cli
├─ help -> 输出 README.md
├─ nodeScript
│  ├─ nodePkgCreate
│  │  ├─ 交互确认项目产物目录
│  │  ├─ 选择创建来源并生成项目
│  │  └─ project/nodePkgFinalize
│  ├─ nodePkgDist
│  │  ├─ 交互确认 npm 包产物目录
│  │  ├─ 选择抽取方式和入口文件
│  │  ├─ 生成 npm 包产物
│  │  └─ project/nodePkgFinalize
│  ├─ nodePackageIdentityInit -> project/packageIdentity
│  ├─ nodePkgFinalize -> project/nodePkgFinalize
│  └─ nodePackageBinInit
│     ├─ 交互确认 bin 命令名和入口文件
│     ├─ 生成 package.json bin wrapper
│     └─ 执行 pnpm install / pnpm link
├─ pnpmScript
│  ├─ pnpmInsert
│  │  └─ 根据 pnpm-workspace.yaml 克隆缺失的 ../ 兄弟目录包
│  ├─ pnpmWorkspaceInit -> pnpm/workspaceInit
│  └─ 无后续处理的命令选择运行目录后直接执行
│     ├─ pnpm dlx github:see7788/codexhono dev
│     ├─ ...许许多多
├─ gitScript
│  ├─ gitPush
│  │  ├─ git/repoEnsure
│  │  ├─ git/gitignoreInit
│  │  ├─ pnpm/workspaceInit
│  │  ├─ 写入 path.md
│  │  ├─ git add / commit
│  │  └─ git push
│  ├─ gitAutoPush
│  │  ├─ gitScript/gitPush
│  │  └─ 按分钟间隔自动 commit/tag/push
│  └─ gitignoreInit -> git/gitignoreInit
└─ githubScript
   └─ githubPublishYmlInit -> github/publishYmlInit
```

`project/nodePkgFinalize` 不执行 `git push`。需要提交到 GitHub 时，单独执行 `gitScript/gitPush`。
