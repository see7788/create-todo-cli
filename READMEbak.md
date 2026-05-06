# create-todo-cli

一个交互式 TypeScript 项目脚手架工具，支持从内置模板创建新项目，也支持把现有项目里的入口文件抽取成独立 npm 包。

## 功能

- 创建 TypeScript 或 Electron 项目模板。
- 从本地项目或入口文件抽取可独立发布的包。
- 自动重写新项目的 `package.json` 身份信息，包括 `name`、`author`、`repository`、`homepage`、`bugs`。
- 可选初始化当前目录为 pnpm workspace。
- 可选生成 GitHub Actions `publish.yml` 发布配置。

## 使用

```bash
pnpm create create-todo-cli
pnpm create create-todo-cli my-app
pnpm create create-todo-cli create my-app
pnpm create create-todo-cli dist
```

不传命令时会进入交互菜单。

## 命令

| 命令 | 说明 |
| --- | --- |
| `help`、`h`、`--help`、`-h` | 显示帮助 |
| `create <?name>` | 创建新项目 |
| `init <?name>` | 创建新项目 |
| `template <?name>` | 创建新项目 |
| `dist` | 从当前项目抽取 npm 包 |

## 创建项目

```bash
pnpm create create-todo-cli create my-app
```

创建流程：

1. 输入或确认项目名。
2. 选择模板来源。
3. 复制远程模板，或从本地项目抽取模板。
4. 重写项目身份信息。
5. 按需初始化 pnpm workspace。
6. 按需生成 `.github/workflows/publish.yml`。

内置模板：

- `see7788/ts-template`：TypeScript 基础项目。
- `see7788/electron-template`：Electron 项目。
- 本地项目：从已有项目目录或入口文件生成新项目。

## 抽取 npm 包

```bash
pnpm create create-todo-cli dist
```

`dist` 命令会在当前项目中交互选择入口文件，并生成一个可发布目录：

- 使用 `tsup` 构建 ESM 输出。
- 生成 TypeScript 声明文件。
- 根据构建分析生成独立 `package.json`。
- 只保留入口实际用到的依赖。

## pnpm workspace

创建项目后，如果当前目录还不是 pnpm workspace，可以选择自动补齐：

- `pnpm-workspace.yaml`
- `.npmrc`
- `.gitignore`
- 根目录 `package.json`

默认 workspace 包路径：

```yaml
packages:
  - "libs/*"
  - "apps/*"
```

## 发布配置

选择生成发布配置后，会创建：

```txt
.github/workflows/publish.yml
```

该文件只负责生成 GitHub Actions 工作流，不会执行发布、不创建 Git 标签，也不会推送远程仓库。

## 开发

```bash
pnpm install
pnpm run build
pnpm run dev
```

## 环境要求

- Node.js >= 18
- pnpm、npm 或 yarn
- Git，可用于克隆模板和推断仓库信息

## License

MIT
