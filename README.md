# create-todo-cli

交互式 TypeScript 项目脚手架工具：创建项目、抽取 npm 包、初始化 package 配置、初始化 GitHub 仓库、同步 pnpm workspace release 仓库。

## 项目结构
```txt
create-todo-cli/
├─ src/
│  ├─ index.ts
│  │  ├─ CLI 入口
│  │  ├─ pkg.version 输出
│  │  ├─ help / --help / -h
│  │  ├─ 命令注册表 commands
│  │  │  ├─ createPkg <?name> <?source>
│  │  │  │  ├─ 创建项目
│  │  │  │  ├─ source 支持：
│  │  │  │  │  ├─ vite:<template>
│  │  │  │  │  ├─ workspace-package / pnpm / package
│  │  │  │  │  ├─ github:<owner/repo>
│  │  │  │  │  └─ owner/repo 或 GitHub URL
│  │  │  │  └─ 创建后执行项目身份、GitHub、pnpm workspace、publish 配置收尾
│  │  │  ├─ distPkg <?name>
│  │  │  │  ├─ 抽取 npm 包
│  │  │  │  ├─ 交互选择 bundle/source
│  │  │  │  └─ 命令行可用，交互菜单隐藏
│  │  │  ├─ distPkgBundle <?name>
│  │  │  │  └─ 抽取 npm 包：构建 ESM / CJS / d.ts
│  │  │  ├─ distPkgSource <?name>
│  │  │  │  └─ 抽取 npm 包：复制源码，不转 JS
│  │  │  ├─ initGithubPkg
│  │  │  │  ├─ 初始化 GitHub 仓库并 push
│  │  │  │  ├─ 向上递归查找 .git，有 .git 时定位到该 Git 根目录
│  │  │  │  ├─ 向上没有 .git 时定位到当前目录
│  │  │  │  ├─ GitHub 仓库名使用定位目录名
│  │  │  │  ├─ 判断定位目录是否存在 ../ 外部 pnpm workspace
│  │  │  │  ├─ 普通平台项目提交
│  │  │  │  │  ├─ git push
│  │  │  │  │  ├─ git push for 兄弟目录
│  │  │  │  │  ├─ 没有 .git 时执行 git init
│  │  │  │  │  ├─ GitHub 同名仓库存在时直接绑定 master
│  │  │  │  │  ├─ GitHub 同名仓库不存在时选择 public / private 后创建
│  │  │  │  │  ├─ 确保初始提交
│  │  │  │  │  ├─ push HEAD 到远程仓库
│  │  │  │  │  ├─ 兄弟目录分支显示 [当前/总数] 进度
│  │  │  │  │  └─ 单个兄弟目录失败后记录并继续后续目录
│  │  │  │  └─ pnpm workspace release 提交
│  │  │  │     ├─ 使用定位目录名提交并推送源仓库
│  │  │  │     ├─ 创建或复用 <目录名>_release GitHub 仓库
│  │  │  │     ├─ clone 或复用本地 ../<项目名>_release
│  │  │  │     ├─ 复制当前 workspace 文件
│  │  │  │     ├─ 复制 ../ 外部 workspace 包到 extends/*
│  │  │  │     ├─ 重写 release pnpm-workspace.yaml
│  │  │  │     ├─ 刷新 lockfile
│  │  │  │     └─ 提交并推送 release 仓库
│  │  │  ├─ initPublishYml
│  │  │  │  └─ 初始化 publish.yml 配置
│  │  │  ├─ initPkgBin
│  │  │  │  └─ 初始化 package.json bin TS/JS 入口
│  │  │  ├─ initPnpmWorkspace
│  │  │  │  └─ 初始化 pnpm workspace
│  │  │  ├─ initPackageIdentity
│  │  │  │  └─ 重写 package.json 身份信息
│  │  │  ├─ initGitignore
│  │  │  │  └─ 初始化 .gitignore
│  │  ├─ 菜单分组
│  │  │  ├─ 命令名以 init 开头的命令进入 other 分组
│  │  │  └─ 无参数或未知命令时打开交互菜单
│  └─ scripts/
│     ├─ createPkg.ts
│     │  ├─ 项目名称和目标路径校验
│     │  ├─ Vite 模板分支
│     │  ├─ pnpm workspace package 分支
│     │  ├─ GitHub 模板 / GitHub URL 分支
│     │  └─ 创建失败时清理半成品目录
│     ├─ createNodeBin.ts
│     │  ├─ 输入当前 package root 内的 TS/JS 入口文件或目录
│     │  ├─ 输入目录时自动解析 index.ts / index.tsx / index.js 等入口
│     │  ├─ 生成 bin/<command>.js 或 bin/<command>.mjs wrapper
│     │  ├─ 完成后输出 entry / wrapper / command / changed files / linked files
│     │  ├─ wrapper 支持 dev / start / stop / restart
│     │  ├─ 更新 package.json bin
│     │  ├─ 更新 package.json files
│     │  ├─ 添加 tsx 运行依赖
│     │  └─ 执行 pnpm link
│     ├─ distPkg.ts
│     │  ├─ bundle 分支
│     │  │  ├─ 选择入口文件
│     │  │  ├─ 调用 tsup 生成 ESM / CJS / d.ts
│     │  │  ├─ 生成 npm package.json
│     │  │  └─ 完成后输出产物路径、入口文件、package.json
│     │  ├─ source 分支
│     │  │  ├─ 从本地项目抽取源码
│     │  │  ├─ 复制源码和必要配置
│     │  │  ├─ 不转 JS
│     │  │  └─ 完成后输出产物路径、来源项目、入口文件、package.json
│     │  ├─ 默认产物路径：../<项目名>_dist
│     │  ├─ 目标存在时提示将替换
│     │  └─ 产物完成后执行公共收尾
│     ├─ gitPush.ts
│     │  ├─ initGithubPkg 命令入口
│     │  ├─ 向上递归查找 .git 并定位项目根
│     │  ├─ 判断定位目录是否存在 ../ 外部 pnpm workspace
│     │  ├─ 普通项目：git 初始化、GitHub 仓库创建或绑定、提交、push
│     │  ├─ 普通项目：git push / git push for 兄弟目录 分支
│     │  └─ release：复制 workspace 和外部包后提交到 <目录名>_release
│     ├─ publishYml.ts
│     │  ├─ 为当前项目生成 publish 配置
│     │  ├─ 更新 package.json publishConfig / repository / homepage / bugs
│     │  ├─ 生成 .npmrc
│     │  └─ 生成 .github/workflows/publish.yml
│     └─ public.ts
│        ├─ cwd package/workspace 信息读取
│        ├─ package.json 读写
│        ├─ package name 归一化
│        ├─ package.json 身份信息重写
│        ├─ README 身份信息替换
│        ├─ .gitignore 初始化
│        ├─ pnpm workspace 初始化
│        ├─ git init / origin 设置
│        ├─ GitHub 同名仓库创建或绑定
│        └─ 通用命令、路径、文本工具
├─ bin/
│  └─ create-todo-cli.js
├─ package.json
└─ README.md
```

## 常用命令

```bash
create-todo-cli
create-todo-cli help
create-todo-cli createPkg my-app vite:react-ts
create-todo-cli createPkg my-lib workspace-package
create-todo-cli distPkgBundle
create-todo-cli distPkgSource
create-todo-cli initPkgBin
create-todo-cli initGithubPkg
```
