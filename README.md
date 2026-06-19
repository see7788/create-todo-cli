# create-todo-cli

交互式 TypeScript 项目脚手架工具：创建项目，或从已有项目抽取 npm 包。

## 项目结构

```txt
create-todo-cli/
├─ src/
│  ├─ index.ts
│  │  ├─ CLI 入口
│  │  ├─ 命令分支
│  │  │  ├─ help / --help / -h
│  │  │  ├─ createPkg <?name> //创建npm项目
│  │  │  ├─ create-node-bin //为 cwd 项目生成 tsx node bin wrapper
│  │  │  ├─ distPkg <?name> //抽取 npm 包，并交互选择 bundle/source 分支
│  │  │  ├─ distPkgBundle <?name> //从入口文件构建 ESM / CJS / d.ts npm 包
│  │  │  ├─ distPkgSource <?name> // 从本地项目抽取源码 npm 包，不转 JS
│  │  │  └─ gitWorkspacePrelease //把 cwd 的外部 workspace 包同步到 GitHub release 仓库
│  │  └─ 无参数或未知命令时打开交互菜单
│  └─ scripts/
│     ├─ createPkg.ts
│     │  ├─ 从 GitHub 模板创建新项目
│     │  └─ 执行 tool.ts 公共收尾
│     ├─ createNodeBin.ts
│     │  ├─ 选择 cwd 项目内的 TS/JS 入口文件
│     │  ├─ 生成 bin/*.mjs 生命周期 wrapper
│     │  └─ 更新 package.json bin、files 和 tsx 运行依赖
│     ├─ distPkg.ts
│     │  ├─ bundle 分支：选择入口文件，调用 tsup 生成 ESM / CJS / d.ts
│     │  ├─ source 分支：从本地项目抽取源码创建 npm 包，不转 JS
│     │  ├─ 生成或复用 package.json
│     │  └─ 执行 tool.ts 公共收尾
│     ├─ gitWorkspacePrelease.ts
│     │  ├─ 读取 cwd 项目的 pnpm-workspace.yaml
│     │  ├─ 把 ../ 外部 workspace 包同步到 release 仓库的 extends/*
│     │  └─ 创建或更新 package.json.name_release GitHub 仓库
│     ├─ dist_bak.ts
│     │  └─ 原 dist.ts 备份
│     └─ tool.ts
│        ├─ 交互确认名称和产物路径
│        ├─ 读写 package.json
│        ├─ 重写 package.json 身份信息
│        ├─ 可选初始化 pnpm workspace
│        ├─ 可选生成 publish.yml
│        └─ 通用命令、路径、文本工具
├─ dist/
│  └─ TypeScript 编译后的发布产物
```

## create-node-bin

在目标项目目录执行：

```bash
create-todo-cli create-node-bin
```

该命令会围绕当前 `cwd` 项目的 `package.json` 工作：

- 选择一个当前项目内的 `.ts/.tsx/.js/.jsx/.mjs/.cjs` 入口文件。
- 生成一个生命周期 wrapper，默认路径类似 `bin/<command>.mjs`。
- 将 `package.json.bin` 注册为 `<command>`、`<command>-dev`、`<command>-stop`、`<command>-restart`。
- 将 `tsx` 放入 `dependencies`，保证安装后可直接执行源码入口。
- 将 `bin/` 和入口所在顶层目录加入 `files`。
- wrapper 普通运行会用 `tsx <entry>`，`dev/restart` 会用 `tsx watch --clear-screen=false <entry>`；`stop/restart` 通过入口文件路径查找并结束正在运行的进程。
