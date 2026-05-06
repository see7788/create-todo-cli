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
│  │  │  ├─ distPkg <?name> //抽取 npm 包，并交互选择 bundle/source 分支
│  │  │  ├─ distPkgBundle <?name> //从入口文件构建 ESM / CJS / d.ts npm 包
│  │  │  └─ distPkgSource <?name> // 从本地项目抽取源码 npm 包，不转 JS
│  │  └─ 无参数或未知命令时打开交互菜单
│  └─ scripts/
│     ├─ createPkg.ts
│     │  ├─ 从 GitHub 模板创建新项目
│     │  └─ 执行 tool.ts 公共收尾
│     ├─ distPkg.ts
│     │  ├─ bundle 分支：选择入口文件，调用 tsup 生成 ESM / CJS / d.ts
│     │  ├─ source 分支：从本地项目抽取源码创建 npm 包，不转 JS
│     │  ├─ 生成或复用 package.json
│     │  └─ 执行 tool.ts 公共收尾
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
└─ tpls/
   └─ 本地模板目录
```
