import path from 'path';
import fs from "fs";
import { execSync } from 'child_process';
/**应用程序退出错误类 - 用于表示程序无法处理的致命异常情况*/
export class Appexit extends Error {
    /**
     * 构造应用程序退出错误
     * @param message 错误消息，描述发生的错误
     */
    constructor(message) {
        super(message);
        this.name = this.constructor.name;
        Error.captureStackTrace(this, this.constructor);
    }
}
/**基类 - 提供通用的工具方法和项目信息访问*/
export default class LibBase {
    cwdProjectInfo;
    constructor() {
        this.cwdProjectInfo = this.getcwdProjectInfo();
    }
    /**获取当前工作目录的项目信息 - 递归查找package.json*/
    getcwdProjectInfo() {
        let dir = process.cwd();
        while (dir !== path.parse(dir).root) {
            const jsonPath = path.join(dir, 'package.json');
            if (fs.existsSync(jsonPath)) {
                const pkgContent = fs.readFileSync(jsonPath, 'utf-8');
                const jsonInfo = JSON.parse(pkgContent);
                return { pkgPath: dir, cwdPath: process.cwd(), jsonPath: jsonPath, jsonInfo };
            }
            dir = path.dirname(dir);
        }
        throw new Appexit('不存在 package.json 文件');
    }
    /**执行Git命令并处理错误 - 统一Git操作的错误处理（工具方法）*/
    runGitCommand(cmd, options, throwOnError = true) {
        try {
            // 禁止LF/CRLF警告输出，提升用户体验
            const result = execSync(`git -c core.safecrlf=false ${cmd}`, {
                stdio: 'pipe',
                cwd: process.cwd(),
                ...(options || {})
            });
            return result.toString().trim();
        }
        catch (error) {
            if (throwOnError) {
                // 致命错误
                throw new Appexit(`Git命令执行失败: ${cmd}`);
            }
            // 非致命错误，返回null
            return null;
        }
    }
    /**执行交互式命令 - 用于需要用户交互的命令（工具方法）*/
    runInteractiveCommand(cmd, throwOnError = true) {
        try {
            // 如果是git命令，添加参数禁止LF/CRLF警告
            if (cmd.startsWith('git')) {
                cmd = cmd.replace('git', 'git -c core.safecrlf=false');
            }
            execSync(cmd, { stdio: 'inherit', cwd: process.cwd() });
        }
        catch (error) {
            if (throwOnError) {
                // 交互式命令执行失败是致命错误
                throw new Appexit('交互式命令执行失败');
            }
            // 非致命错误，静默失败
        }
    }
    /**执行通用命令并返回结果 - 支持非致命错误模式（工具方法）*/
    runCommand(cmd, options, throwOnError = true) {
        try {
            const result = execSync(cmd, {
                stdio: 'pipe',
                cwd: process.cwd(),
                ...(options || {})
            });
            return result.toString().trim();
        }
        catch (error) {
            if (throwOnError) {
                // 致命错误
                throw new Appexit(`命令执行失败: ${cmd}`);
            }
            // 非致命错误，返回null
            return null;
        }
    }
    /**从盘符路径直至选择文件的交互式方法 - 支持多级目录导航和文件选择 */
    async confirmOutputName(options) {
        let name = options.initialName?.trim() || "";
        while (true) {
            if (!name) {
                const prompts = await import("prompts");
                const response = await prompts.default({
                    type: "text",
                    name: "name",
                    message: options.message,
                    initial: options.defaultName,
                });
                if (!response.name) {
                    throw new Error("user-cancelled");
                }
                name = String(response.name).trim();
            }
            try {
                this.validateOutputName(name);
                const targetPath = path.resolve(this.cwdProjectInfo.cwdPath, name);
                if (options.existsError && fs.existsSync(targetPath)) {
                    throw new Error(`目录已存在: ${name}`);
                }
                const prompts = await import("prompts");
                const response = await prompts.default({
                    type: "confirm",
                    name: "confirmed",
                    message: `${options.targetLabel}: ${targetPath}\n是否继续？`,
                    initial: true,
                });
                if (response.confirmed === undefined) {
                    throw new Error("user-cancelled");
                }
                if (!response.confirmed) {
                    name = "";
                    continue;
                }
                return name;
            }
            catch (error) {
                if (error instanceof Error && error.message === "user-cancelled") {
                    throw error;
                }
                console.error(error instanceof Error ? error.message : String(error));
                name = "";
            }
        }
    }
    rewritePackageJsonIdentity(targetPath, packageName) {
        const pkgPath = path.join(targetPath, "package.json");
        const pkg = this.readJsonFile(pkgPath) ?? {};
        const sourceRepo = this.parseGitHubRepo(this.repositoryUrlGet(pkg));
        const currentRepo = this.currentGitHubRepoGet();
        const githubOwner = currentRepo?.owner ?? this.githubLoginGet();
        const repositoryUrl = githubOwner ? `https://github.com/${githubOwner}/${packageName}.git` : undefined;
        const homepage = githubOwner ? `https://github.com/${githubOwner}/${packageName}` : undefined;
        const identity = {
            packageName,
            repositoryName: packageName,
            author: this.gitConfigGet("user.name") ?? pkg.author,
            githubOwner,
            repositoryUrl,
            homepage,
            bugsUrl: homepage ? `${homepage}/issues` : undefined,
            license: pkg.license ?? "MIT",
        };
        pkg.name = identity.packageName;
        pkg.author = identity.author;
        pkg.license = identity.license;
        if (identity.repositoryUrl) {
            pkg.repository = { type: "git", url: identity.repositoryUrl };
        }
        else {
            delete pkg.repository;
        }
        if (identity.homepage) {
            pkg.homepage = identity.homepage;
        }
        else {
            delete pkg.homepage;
        }
        if (identity.bugsUrl) {
            pkg.bugs = { url: identity.bugsUrl };
        }
        else {
            delete pkg.bugs;
        }
        this.writeJsonFile(pkgPath, pkg);
        this.readmeIdentitySet(targetPath, sourceRepo, identity);
        return identity;
    }
    createGithubPublish(config) {
        const workflowPath = path.join(config.targetPath, ".github", "workflows", "publish.yml");
        fs.mkdirSync(path.dirname(workflowPath), { recursive: true });
        fs.writeFileSync(workflowPath, this.githubPublishContent(config.packageName, config.workingDirectory), "utf-8");
        return workflowPath;
    }
    async finalizeProjectOutput(targetPath, packageName) {
        const identity = this.rewritePackageJsonIdentity(targetPath, packageName);
        await this.pnpmRootSetupAsk();
        await this.publishWorkflowAsk(targetPath, identity);
        return identity;
    }
    async rewriteCurrentPackageIdentity() {
        const prompts = await import("prompts");
        const response = await prompts.default({
            type: "text",
            name: "packageName",
            message: "请输入 package.json name",
            initial: this.cwdProjectInfo.jsonInfo.name ?? path.basename(this.cwdProjectInfo.cwdPath),
        });
        if (!response.packageName) {
            throw new Error("user-cancelled");
        }
        const identity = this.rewritePackageJsonIdentity(this.cwdProjectInfo.cwdPath, String(response.packageName).trim());
        console.log(`已重写 package.json 身份信息: ${identity.packageName}`);
    }
    async setupPnpmWorkspaceRoot() {
        await this.pnpmRootSetupAsk();
    }
    async createCurrentGithubPublish() {
        const packageName = this.cwdProjectInfo.jsonInfo.name ?? path.basename(this.cwdProjectInfo.cwdPath);
        await this.publishWorkflowAsk(this.cwdProjectInfo.cwdPath, {
            packageName,
            repositoryName: packageName,
            author: typeof this.cwdProjectInfo.jsonInfo.author === "string" ? this.cwdProjectInfo.jsonInfo.author : undefined,
            license: this.cwdProjectInfo.jsonInfo.license ?? "MIT",
        });
    }
    async pnpmRootSetupAsk() {
        if (this.isPnpmWorkspaceRoot(process.cwd())) {
            console.log("当前目录已经是 pnpm workspace 根");
            return;
        }
        const prompts = await import("prompts");
        const response = await prompts.default({
            type: "confirm",
            name: "enabled",
            message: "当前目录不是 pnpm 根，是否初始化 pnpm workspace 根？",
            initial: false,
        });
        if (response.enabled === undefined) {
            throw new Error("user-cancelled");
        }
        if (!response.enabled) {
            console.log("跳过 pnpm 根初始化");
            return;
        }
        this.pnpmWorkspaceFileSet();
        this.npmrcSet();
        this.gitignoreSet();
        this.rootPackageJsonSet();
        console.log("pnpm workspace 根配置已补齐");
    }
    async publishWorkflowAsk(targetPath, identity) {
        const prompts = await import("prompts");
        const response = await prompts.default({
            type: "confirm",
            name: "enabled",
            message: "是否为当前项目创建 GitHub Actions publish.yml？",
            initial: false,
        });
        if (response.enabled === undefined) {
            throw new Error("user-cancelled");
        }
        if (!response.enabled) {
            console.log("跳过 publish.yml");
            return;
        }
        const workflowPath = this.createGithubPublish({
            packageName: identity.packageName,
            targetPath,
        });
        console.log(`已创建 ${path.relative(targetPath, workflowPath)}`);
    }
    pnpmWorkspaceFileSet() {
        const filePath = path.join(process.cwd(), "pnpm-workspace.yaml");
        if (fs.existsSync(filePath)) {
            return;
        }
        fs.writeFileSync(filePath, `packages:
  - "libs/*"
  - "apps/*"
`, "utf-8");
    }
    npmrcSet() {
        this.linesFileEnsure(path.join(process.cwd(), ".npmrc"), ["store-dir=./.pnpm-store"]);
    }
    gitignoreSet() {
        this.linesFileEnsure(path.join(process.cwd(), ".gitignore"), [
            ".pnpm-store/**",
            "**/node_modules/**",
            "**/dist/**",
            "**/**_bak/",
            "**/**.bak",
        ]);
    }
    rootPackageJsonSet() {
        const filePath = path.join(process.cwd(), "package.json");
        const pkg = this.readJsonFile(filePath) ?? {
            name: path.basename(process.cwd()),
            version: "1.0.0",
            private: true,
        };
        pkg.private = true;
        pkg.workspaces = Array.from(new Set([...(pkg.workspaces ?? []), "libs", "apps"]));
        pkg.pnpm = {
            ...(pkg.pnpm ?? {}),
            overrides: {
                ...(pkg.pnpm?.overrides ?? {}),
                tsx: pkg.pnpm?.overrides?.tsx ?? "^4.20.0",
                typescript: pkg.pnpm?.overrides?.typescript ?? "^5.8.0",
            },
        };
        this.writeJsonFile(filePath, pkg);
    }
    linesFileEnsure(filePath, lines) {
        const oldLines = fs.existsSync(filePath)
            ? fs.readFileSync(filePath, "utf-8").split(/\r?\n/).filter(Boolean)
            : [];
        const nextLines = Array.from(new Set([...oldLines, ...lines]));
        fs.writeFileSync(filePath, `${nextLines.join("\n")}\n`, "utf-8");
    }
    isPnpmWorkspaceRoot(dirPath) {
        return fs.existsSync(path.join(dirPath, "pnpm-workspace.yaml"));
    }
    githubPublishContent(packageName, workingDirectory = ".") {
        const defaults = workingDirectory === "."
            ? ""
            : `
    defaults:
      run:
        working-directory: ${workingDirectory.replace(/\\/g, "/")}`;
        return `name: Publish ${packageName}

on:
  push:
    branches:
      - main
  workflow_dispatch:

jobs:
  publish:
    runs-on: ubuntu-latest
    permissions:
      contents: read
      id-token: write${defaults}
    steps:
      - uses: actions/checkout@v4
      - uses: pnpm/action-setup@v4
        with:
          version: ${this.pnpmVersionGet()}
      - uses: actions/setup-node@v4
        with:
          node-version: 20
          registry-url: https://registry.npmjs.org
      - run: pnpm install --no-frozen-lockfile
      - run: pnpm run build --if-present
      - run: pnpm publish --access public --no-git-checks --provenance
        env:
          NODE_AUTH_TOKEN: \${{ secrets.NPM_TOKEN }}
`;
    }
    pnpmVersionGet() {
        const packageManager = this.cwdProjectInfo.jsonInfo.packageManager;
        if (packageManager?.startsWith("pnpm@")) {
            return packageManager.slice("pnpm@".length);
        }
        return "10";
    }
    validateOutputName(name) {
        if (!name) {
            throw new Error("名称不能为空");
        }
        if (name.includes("/")) {
            throw new Error("名称不能包含 /");
        }
        if (!/^[a-zA-Z0-9-_]+$/.test(name)) {
            throw new Error("名称只能包含字母、数字、- 和 _");
        }
    }
    readJsonFile(filePath) {
        if (!fs.existsSync(filePath)) {
            return undefined;
        }
        return JSON.parse(fs.readFileSync(filePath, "utf-8"));
    }
    readRequiredJsonFile(filePath) {
        const value = this.readJsonFile(filePath);
        if (!value) {
            throw new Appexit(`JSON 文件不存在: ${filePath}`);
        }
        return value;
    }
    writeJsonFile(filePath, value) {
        fs.writeFileSync(filePath, `${JSON.stringify(value, null, 2)}\n`, "utf-8");
    }
    toPackageName(name) {
        return name
            .replace(/([a-z0-9])([A-Z])/g, "$1-$2")
            .replace(/[^a-zA-Z0-9._~-]+/g, "-")
            .toLowerCase();
    }
    findPackageRoot(filePath) {
        let dir = path.dirname(filePath);
        while (path.dirname(dir) !== dir) {
            if (fs.existsSync(path.join(dir, "package.json"))) {
                return dir;
            }
            dir = path.dirname(dir);
        }
        return this.cwdProjectInfo.pkgPath;
    }
    replaceText(filePath, replacements) {
        if (!fs.existsSync(filePath)) {
            return;
        }
        let text = fs.readFileSync(filePath, "utf-8");
        for (const [from, to] of Object.entries(replacements)) {
            text = text.split(from).join(to);
        }
        fs.writeFileSync(filePath, text, "utf-8");
    }
    shellArg(value) {
        return `"${value.replace(/"/g, '\\"')}"`;
    }
    readmeIdentitySet(targetPath, sourceRepo, identity) {
        const readmePath = path.join(targetPath, "README.md");
        if (!fs.existsSync(readmePath)) {
            return;
        }
        let content = fs.readFileSync(readmePath, "utf-8");
        if (sourceRepo && identity.githubOwner) {
            content = content.replaceAll(`github.com/${sourceRepo.owner}/${sourceRepo.repo}`, `github.com/${identity.githubOwner}/${identity.repositoryName}`);
            content = content.replaceAll(`${sourceRepo.owner}/${sourceRepo.repo}`, `${identity.githubOwner}/${identity.repositoryName}`);
        }
        content = content.replaceAll(/name:\s*["']?[^"'\n]+["']?/gi, `name: ${identity.packageName}`);
        fs.writeFileSync(readmePath, content, "utf-8");
    }
    repositoryUrlGet(pkg) {
        if (typeof pkg.repository === "string") {
            return pkg.repository;
        }
        return pkg.repository?.url;
    }
    currentGitHubRepoGet() {
        const remote = this.commandGet("git config --get remote.origin.url");
        return remote ? this.parseGitHubRepo(remote) : undefined;
    }
    parseGitHubRepo(value) {
        const match = value?.match(/github\.com[:/]([^/]+)\/(.+?)(?:\.git)?$/i);
        if (!match) {
            return undefined;
        }
        return { owner: match[1], repo: match[2] };
    }
    githubLoginGet() {
        return this.commandGet("gh api user --jq .login");
    }
    gitConfigGet(key) {
        return this.commandGet(`git config --get ${key}`);
    }
    commandGet(command) {
        try {
            const value = execSync(command, { cwd: process.cwd(), encoding: "utf-8", stdio: ["ignore", "pipe", "ignore"] }).trim();
            return value || undefined;
        }
        catch {
            return undefined;
        }
    }
    async askLocalFilePath(fileExtensions = ['.js', '.jsx', '.ts', '.tsx'], initialPath) {
        const prompts = await import('prompts');
        console.log('📁 开始文件选择...');
        // 首先获取可用的磁盘驱动器
        let availableDrives = [];
        if (process.platform === 'win32') {
            // Windows平台获取所有可用磁盘
            try {
                const drivesOutput = execSync('wmic logicaldisk get caption', { encoding: 'utf8' });
                availableDrives = drivesOutput
                    .split('\n')
                    .map(line => line.trim())
                    .filter(line => /^[A-Z]:$/.test(line));
                // 添加当前目录作为快速访问选项
                const currentDrive = process.cwd().split(':')[0] + ':';
                if (!availableDrives.includes(currentDrive)) {
                    availableDrives.push(currentDrive);
                }
            }
            catch (error) {
                console.warn('⚠️ 无法获取磁盘列表，使用默认路径');
                availableDrives = ['C:', process.cwd().split(':')[0] + ':'];
            }
        }
        else {
            // 非Windows平台默认使用根目录和当前目录
            availableDrives = ['/', process.cwd()];
        }
        // 如果提供了初始路径，直接使用它
        let currentPath = initialPath || process.cwd();
        // 如果没有初始路径，让用户选择磁盘/根目录
        if (!initialPath) {
            console.log('\n🔍 第1步：选择磁盘驱动器');
            const driveResponse = await prompts.default({
                type: 'select',
                name: 'drive',
                message: '请选择要查找文件的磁盘驱动器',
                choices: availableDrives.map(drive => ({
                    title: drive === process.cwd().split(':')[0] + ':' ? `${drive} (当前磁盘)` : drive,
                    value: drive
                }))
            });
            if (!driveResponse.drive) {
                const error = new Error('user-cancelled');
                throw error;
            }
            console.log(`✅ 已选择: ${driveResponse.drive}`);
            currentPath = driveResponse.drive;
        }
        let navigationLevel = initialPath ? 1 : 2; // 导航层级计数
        // 多级导航选择目录和文件
        while (true) {
            navigationLevel++;
            console.log(`\n🔍 第${navigationLevel}步：浏览目录结构`);
            // 获取当前目录下的所有文件和文件夹
            let items = [];
            try {
                const files = fs.readdirSync(currentPath);
                items = files
                    .map(name => {
                    const itemPath = path.join(currentPath, name);
                    try {
                        const stats = fs.statSync(itemPath);
                        return { name, path: itemPath, isDirectory: stats.isDirectory() };
                    }
                    catch (error) {
                        // 跳过无法访问的文件/文件夹
                        return null;
                    }
                })
                    .filter((item) => item !== null) // 类型断言过滤null值
                    .sort((a, b) => {
                    // 文件夹排在前面，文件排在后面
                    if (a.isDirectory && !b.isDirectory)
                        return -1;
                    if (!a.isDirectory && b.isDirectory)
                        return 1;
                    // 同类项按名称排序
                    return a.name.localeCompare(b.name);
                });
            }
            catch (error) {
                console.error('❌ 无法读取目录内容:', error);
                // 让用户重试或取消
                const retryResponse = await prompts.default({
                    type: 'confirm',
                    name: 'retry',
                    message: '是否重试访问该目录？',
                    initial: true
                });
                if (!retryResponse.retry) {
                    // 给用户返回上一级的选项
                    const goBackResponse = await prompts.default({
                        type: 'confirm',
                        name: 'goBack',
                        message: '是否返回上一级目录？',
                        initial: true
                    });
                    if (goBackResponse.goBack) {
                        const parentPath = path.dirname(currentPath);
                        if (parentPath !== currentPath) {
                            currentPath = parentPath;
                            navigationLevel--;
                            continue;
                        }
                    }
                    const error = new Error('user-cancelled');
                    throw error;
                }
                continue;
            }
            // 添加特殊选项
            const specialChoices = [
                { title: '.. (上一级目录)', value: '..' },
                { title: '🏠 当前工作目录', value: 'current' },
                { title: '❌ 取消选择', value: 'cancel' }
            ];
            // 构建文件/文件夹选项
            const itemChoices = items.map(item => {
                const isTargetFile = !item.isDirectory && fileExtensions.some(ext => item.name.toLowerCase().endsWith(ext));
                return {
                    title: item.isDirectory
                        ? `📁 ${item.name}${this.isProjectDirectory(item.path) ? ' (项目目录)' : ''}`
                        : isTargetFile
                            ? `🎯 ${item.name} (目标文件)`
                            : `📄 ${item.name}`,
                    value: item.path,
                    disabled: !item.isDirectory && !isTargetFile // 禁用非目标文件类型
                };
            });
            // 组合所有选项
            const choices = [...specialChoices, ...itemChoices];
            // 询问用户选择
            const selectionResponse = await prompts.default({
                type: 'select',
                name: 'selection',
                message: `\n当前位置: ${currentPath}\n请选择一个目录进入，或选择一个目标文件`,
                choices
            });
            // 处理特殊选择
            if (!selectionResponse.selection) {
                const error = new Error('user-cancelled');
                throw error;
            }
            // 处理特殊选项
            if (selectionResponse.selection === 'cancel') {
                const error = new Error('user-cancelled');
                throw error;
            }
            else if (selectionResponse.selection === 'current') {
                currentPath = process.cwd();
                console.log(`📂 已切换到当前工作目录: ${currentPath}`);
                continue;
            }
            else if (selectionResponse.selection === '..') {
                // 向上一级
                const parentPath = path.dirname(currentPath);
                if (parentPath !== currentPath) { // 防止到达根目录时无限循环
                    console.log(`⬆️ 返回上一级目录`);
                    currentPath = parentPath;
                    navigationLevel--;
                }
                else {
                    console.log('⚠️ 已经到达根目录，无法继续向上');
                }
                continue;
            }
            // 处理常规选择
            try {
                const stats = fs.statSync(selectionResponse.selection);
                if (stats.isDirectory()) {
                    // 进入子目录
                    currentPath = selectionResponse.selection;
                    console.log(`📂 已进入目录: ${path.basename(currentPath)}`);
                }
                else {
                    // 选择了文件，检查是否为目标文件类型
                    const isTargetFile = fileExtensions.some(ext => selectionResponse.selection.toLowerCase().endsWith(ext));
                    if (isTargetFile) {
                        // 确认选择
                        const confirmResponse = await prompts.default({
                            type: 'confirm',
                            name: 'confirm',
                            message: `\n已选择文件: ${selectionResponse.selection}\n是否确认使用此文件？`,
                            initial: true
                        });
                        if (confirmResponse.confirm) {
                            console.log(`\n✅ 已选择文件: ${selectionResponse.selection}`);
                            return selectionResponse.selection;
                        }
                    }
                }
            }
            catch (error) {
                console.error('❌ 无法访问选定的项目:', error);
                continue;
            }
        }
    }
    /**检查目录是否为有效的项目目录 */
    isProjectDirectory(dirPath) {
        try {
            return fs.existsSync(path.join(dirPath, 'package.json'));
        }
        catch (error) {
            return false;
        }
    }
}
