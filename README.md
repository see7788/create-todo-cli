## 快速使用

前置条件：
- 已安装 Node.js 和 pnpm
- 已安装并配置好 Codex CLI
- 已安装 tsx 依赖

使用方式：
```bash
pnpm dlx github:see7788/create-todo-cli
pnpm dlx github:see7788/create-todo-cli help
pnpm dlx github:see7788/create-todo-cli nodePkgCreate my-vite-app vite:react-ts
pnpm dlx github:see7788/create-todo-cli nodePkgDist my-package
pnpm dlx github:see7788/create-todo-cli nodePackageBinInit my-command
pnpm dlx github:see7788/create-todo-cli nodePackageIdentityInit
pnpm dlx github:see7788/create-todo-cli pnpmInsert
pnpm dlx github:see7788/create-todo-cli pnpmWorkspaceInit
pnpm dlx github:see7788/create-todo-cli gitPush
pnpm dlx github:see7788/create-todo-cli gitAutoPush
pnpm dlx github:see7788/create-todo-cli gitignoreInit
pnpm dlx github:see7788/create-todo-cli githubPublishYmlInit
```


## 源码说明

交互式 TypeScript 项目脚手架工具，主要能力包括：创建项目、抽取 npm 包、初始化 package 配置、初始化 GitHub 仓库，以及显式补齐 pnpm workspace 中的外部兄弟目录包。

入口位于 `src/index.ts`。命令名采用“环境/对象在前，动作在后”的风格。外部只需要看各能力目录 `index.ts` 公开的 `menu / command`。

## 树

```txt
create-todo-cli/
├─ src/
│  ├─ index.ts
│  │  ├─ CLI 入口
│  │  ├─ help / --help / -h
│  │  └─ 无参数或未知命令时展示以下命令树
│  ├─ nodeScript/
│  │  └─ index.ts -> nodeScript
│  │     ├─ nodeScript/nodePkgCreate  create project <?name> <?source>；先提示项目产物目录，再选择来源
│  │     ├─ nodeScript/nodePkgDist  dist npm package <?name>；先提示 npm 包产物目录，再选择抽取方式和入口文件
│  │     ├─ nodeScript/nodePackageBinInit  init package.json bin TS/JS entry <?commandName>；先提示 wrapper 产物路径，再选择入口文件
│  │     └─ nodeScript/nodePackageIdentityInit  init package.json identity
│  ├─ pnpmScript/
│  │  └─ index.ts -> pnpmScript
│  │     ├─ pnpmScript/pnpmInsert  clone missing ../ pnpm workspace packages
│  │     └─ pnpmScript/pnpmWorkspaceInit  init pnpm workspace
│  ├─ gitScript/
│  │  └─ index.ts -> gitScript
│  │     ├─ gitScript/gitPush  init GitHub repo and push
│  │     ├─ gitScript/gitAutoPush  auto GitHub repo push
│  │     └─ gitScript/gitignoreInit  init .gitignore
│  ├─ githubScript/
│  │  └─ index.ts -> githubScript
│  │     └─ githubScript/githubPublishYmlInit  init publish.yml set
│  └─ public/
│     ├─ base.ts -> LibBase / Appexit / path / json / shell / prompt
│     ├─ fileTpl.ts -> 模板读取
│     ├─ pnpm.ts -> pnpm workspace / .npmrc
│     └─ git.ts -> git / GitHub / .gitignore / 项目身份
├─ scripts/
│  └─ create-todo-cli.js
│     └─ package bin 运行产物，不作为源码入口维护
├─ package.json
└─ README.md
```
