## 快速使用

前置条件：
- 已安装 Node.js 和 pnpm
- 已安装并配置好 Codex CLI
- 已安装 tsx 依赖

使用方式：
```bash
pnpm dlx github:see7788/create-todo-cli
pnpm dlx github:see7788/create-todo-cli help
pnpm dlx github:see7788/create-todo-cli nodeScript
pnpm dlx github:see7788/create-todo-cli nodeScript/nodePkgCreate
pnpm dlx github:see7788/create-todo-cli nodeScript/nodePkgDist
pnpm dlx github:see7788/create-todo-cli nodeScript/nodePackageBinInit
pnpm dlx github:see7788/create-todo-cli nodeScript/nodePackageIdentityInit
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

## 命令树

```txt
create-todo-cli
├─ help
│  └─ 输出 README.md
├─ nodeScript
│  ├─ nodePkgCreate
│  │  └─ 交互确认项目产物目录，再选择创建来源
│  ├─ nodePkgDist
│  │  └─ 交互确认 npm 包产物目录，再选择抽取方式和入口文件
│  ├─ nodePackageBinInit
│  │  └─ 交互确认 bin 命令名和入口文件，生成 package.json bin wrapper
│  └─ nodePackageIdentityInit
│     └─ 交互重写当前 package.json 项目身份
├─ pnpmScript
│  ├─ pnpmInsert
│  │  └─ 根据 pnpm-workspace.yaml 克隆缺失的 ../ 兄弟目录包
│  └─ pnpmWorkspaceInit
│     └─ 初始化 pnpm workspace、.npmrc、pnpm-workspace.yaml
├─ gitScript
│  ├─ gitPush
│  │  └─ 初始化 git / GitHub 仓库，补齐基础配置并 push
│  ├─ gitAutoPush
│  │  └─ 先执行 gitPush，再按分钟间隔自动提交和 push
│  └─ gitignoreInit
│     └─ 初始化 .gitignore
└─ githubScript
   └─ githubPublishYmlInit
      └─ 交互选择并写入 GitHub Actions 发布配置
```
