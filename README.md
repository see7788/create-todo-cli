# create-todo-cli

用于快速创建 TypeScript 项目、从现有文件拆出独立包，并在创建完成后补齐项目身份信息和可选工程配置。

## 核心能力

### 创建项目

- 从内置 GitHub 模板创建项目
- 从本地项目或入口文件抽取项目
- 创建完成后重写 `package.json` 中属于模板作者的信息
- 根据当前目录环境，可选初始化 pnpm workspace 根
- 可选创建 GitHub Actions 发布配置

### 拆出独立包

- 从 `.js`、`.ts`、`.jsx`、`.tsx` 等入口文件分析依赖
- 生成独立 `package.json`
- 构建 JavaScript 输出和 TypeScript 声明文件
- 适合把已有项目中的某个工具、组件或库抽成单独 npm 包

## 使用

```bash
pnpm create create-todo-cli
pnpm create create-todo-cli my-app
pnpm create create-todo-cli create my-app
pnpm create create-todo-cli dist
```

## 创建项目流程

```txt
输入项目名
选择模板来源
复制或抽取项目
重写项目身份信息
按需初始化 pnpm 根
按需创建 publish.yml
输出下一步命令
```

### 模板来源

- `see7788/ts-template`：TypeScript 基础项目
- `see7788/electron-template`：Electron 项目
- 本地项目：从已有项目或入口文件抽取

### 项目身份信息

模板只提供结构，新项目不应继续保留模板作者的仓库、作者和包名信息。

创建完成后会尽量自动推断并改写：

- `package.json` 的 `name`
- `package.json` 的 `author`
- `package.json` 的 `repository.url`
- `package.json` 的 `homepage`
- `package.json` 的 `bugs.url`
- README 中明显属于模板仓库的链接

推断来源按优先级使用：

```txt
当前 git remote origin
GitHub CLI 当前登录用户
git config user.name
目标项目名
模板 package.json 原值
```

除非必须确认，创建流程不逐项询问 GitHub 用户名、仓库名、npm scope、author、license 等信息。

## pnpm 根初始化

如果当前目录不是 pnpm workspace 根，创建项目后会询问是否把当前目录初始化为 pnpm 根。

选择后生成或补齐：

- `pnpm-workspace.yaml`
- `.npmrc`
- `.gitignore`
- 根 `package.json`

默认约定：

```yaml
packages:
  - "libs/*"
  - "apps/*"
```

默认 `.npmrc`：

```txt
store-dir=./.pnpm-store
```

默认 `.gitignore` 至少包含：

```txt
.pnpm-store/**
**/node_modules/**
**/dist/**
**/**_bak/
**/**.bak
```

## publish.yml

创建项目时不会默认强制添加发布配置。

如果用户选择创建 `publish.yml`，工具会根据推断出的项目身份生成 GitHub Actions 配置，并尽量避免保留模板作者信息。

发布配置只负责生成工作流文件，不执行发布命令、不创建 Git 标签、不推送远程仓库。

## dist 命令

在需要拆包的项目目录执行：

```bash
pnpm create create-todo-cli dist
```

流程：

```txt
选择入口文件
选择输出目录
分析本地依赖和三方依赖
生成 package.json
构建 JS 和 d.ts
```

## 命令

```txt
help             显示帮助
h                显示帮助
create <?name>   创建新项目
init <?name>     创建新项目
template <?name> 创建新项目
dist             抽取 npm 包
```

## 开发

```bash
pnpm install
pnpm run build
pnpm run dev
```

## 要求

- Node.js >= 18
- pnpm、npm 或 yarn
- Git，可用于模板克隆和身份信息推断

## License

MIT
