# create-todo-cli

一个功能强大的前端工具集，提供三大核心能力：从模板创建项目、从文件拆出独立项目、自动化版本发布，简化开发全流程。

## 🚀 核心功能

### 1️⃣ 从模板创建项目
- 支持从GitHub仓库或本地项目快速创建新项目
- 内置多种预设模板，包括TypeScript基础脚手架、Electron应用模板等
- 交互式选择项目名称、模板类型和配置选项
- 自动创建GitHub Actions发布配置

### 2️⃣ 从文件拆出独立项目
- 将现有项目中的单个入口文件抽取为完整的npm包
- 智能分析依赖并生成package.json
- 自动构建JavaScript和TypeScript声明文件
- 自定义输出目录名称，灵活适配不同项目结构

### 3️⃣ 自动化版本发布
- 一键更新版本号并创建Git标签
- 自动检查和提交未暂存的更改
- 推送代码和标签到远程仓库
- 与GitHub Actions集成，自动发布到 npm

## 📦 安装与使用

无需全局安装，直接通过包管理器的`create`命令使用：

```bash
# 使用pnpm（推荐）
pnpm create create-todo-cli

# 使用npm
npm create create-todo-cli

# 使用yarn
yarn create create-todo-cli
```

## 📋 详细使用指南

### 1. 从模板创建项目

**直接指定项目名称：**
```bash
# 创建名为my-app的项目
pnpm create create-todo-cli my-app
```

**交互式创建：**
```bash
pnpm create create-todo-cli
# 或使用create命令
pnpm create create-todo-cli create
```

创建流程：
1. 输入项目名称（自动验证有效性）
2. 选择模板类型（GitHub模板或本地项目）
3. 如选择本地项目，通过文件浏览器选择项目路径
4. 自动生成项目并配置

### 2. 从文件拆出独立项目

在需要拆出文件的项目目录下执行：
```bash
# 使用交互式模式
pnpm create create-todo-cli dist
```

拆包流程：
1. 指定输出目录名称（默认为dist）
2. 选择入口文件（支持.js, .ts, .jsx, .tsx等）
3. 自动分析依赖并构建项目
4. 生成包含JavaScript和TypeScript声明的独立包

### 3. 自动化版本发布

在项目根目录下执行：
```bash
# 发布新版本
pnpm create create-todo-cli release
```

发布流程：
1. 自动递增版本号（patch级别）
2. 创建对应的 Git 标签
3. 更新package.json并提交更改
4. 创建Git标签
5. 推送到远程仓库并触发 GitHub Actions 发布 npm 包

## ⚙️ 支持的模板

- **从本地项目抽取**：从现有项目创建新模板
- **see7788/ts-template**：TypeScript基础脚手架
- **see7788/electron-template**：增强型Electron应用模板

## 🛠️ 系统要求

- Node.js >= 18
- Git（用于版本管理和模板克隆）
- 任一支持的包管理器：pnpm、npm或yarn

## 🔧 核心依赖

- **degit**：从Git仓库高效克隆模板
- **prompts**：提供友好的交互式命令行界面
- **tsup**：零配置TypeScript构建工具
- **esbuild**：极速JavaScript/TypeScript打包

## 📁 项目结构

```
src/
├── index.ts           # 主入口，命令行参数处理
└── scripts/
    ├── template.ts    # 模板创建功能
    ├── dist.ts        # 文件抽取功能
    ├── release.ts     # 版本发布功能
    └── tool.ts        # 工具函数
```

## 💻 开发指南

如果您想参与项目开发：

```bash
# 克隆仓库
git clone https://github.com/see7788/create-todo-cli.git
cd create-todo-cli

# 安装依赖
pnpm install

# 构建项目
pnpm run build

# 本地测试
pnpm run dev
```

## 📄 许可证

MIT License © 2024 create-todo-cli 项目团队

## 🐛 问题反馈

如有任何问题或建议，请在 [GitHub Issues](https://github.com/see7788/create-todo-cli/issues) 提交反馈。

## 🤝 贡献

欢迎提交Pull Request来改进本项目。请确保在提交前进行适当的测试。
