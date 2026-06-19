import type { PackageJson } from 'type-fest';
import path from 'path';
import fs from "fs"
import { execSync, ExecSyncOptionsWithStringEncoding } from 'child_process';
import type prompts from 'prompts';

/**应用程序退出错误类 - 用于表示程序无法处理的致命异常情况*/
export class Appexit extends Error {
    /**
     * 构造应用程序退出错误
     * @param message 错误消息，描述发生的错误
     */
    constructor(message: string) {
        super(message);
        this.name = this.constructor.name;
        Error.captureStackTrace(this, this.constructor);
    }
}
interface cwdProjectInfo_t {
    pkgPath: string;
    workspacePath: string;
    jsonInfo: PackageJson;
    jsonPath: string,
    cwdPath: string
}

type GithubPublishConfig = {
    packageName: string;
    targetPath: string;
    workingDirectory?: string;
};

type ConfirmOutputNameOptions = {
    basePath?: string;
    initialName?: string;
    defaultName: string;
    message: string;
    targetLabel: string;
    existsError?: boolean;
};

type OutputTarget = {
    name: string;
    path: string;
};

type LocalPathMode = "directory" | "file";

type LocalPathOptions = {
    fileExtensions?: string[];
    initialPath?: string;
    mode: LocalPathMode;
    shouldConfirm?: boolean;
};

type PackageJsonRecord = {
    name?: string;
    version?: string;
    description?: string;
    author?: string;
    license?: string;
    private?: boolean;
    packageManager?: string;
    repository?: string | { type?: string; url?: string };
    homepage?: string;
    bugs?: string | { url?: string };
    publishConfig?: { access?: "public" | "restricted" };
    workspaces?: string[];
    pnpm?: { overrides?: Record<string, string> } & Record<string, unknown>;
    scripts?: Record<string, string>;
    devDependencies?: Record<string, string>;
    dependencies?: Record<string, string>;
} & Record<string, unknown>;

type ProjectIdentity = {
    packageName: string;
    repositoryName: string;
    author?: string;
    githubOwner?: string;
    repositoryUrl?: string;
    homepage?: string;
    bugsUrl?: string;
    license: string;
};

type GitHubRepo = {
    owner: string;
    repo: string;
};
/**基类 - 提供通用的工具方法和项目信息访问*/
export default class LibBase {
    protected readonly cwdProjectInfo: cwdProjectInfo_t
    constructor() {
        this.cwdProjectInfo = this.getcwdProjectInfo()
    }

    /**获取当前工作目录的项目信息 - 递归查找package.json*/
    private getcwdProjectInfo(): cwdProjectInfo_t {
        const cwdPath = process.cwd();
        let dir = cwdPath;
        let pkgPath: string | undefined;
        let workspacePath: string | undefined;
        let jsonInfo: PackageJson | undefined;
        let jsonPath = "";
        while (true) {
            const candidateJsonPath = path.join(dir, 'package.json');
            if (fs.existsSync(candidateJsonPath)) {
                const pkgContent = fs.readFileSync(candidateJsonPath, 'utf-8');
                const candidateJsonInfo = JSON.parse(pkgContent) as PackageJson;
                if (!jsonInfo) {
                    pkgPath = dir;
                    jsonPath = candidateJsonPath;
                    jsonInfo = candidateJsonInfo;
                }
                workspacePath = dir;
            }
            const parentDir = path.dirname(dir);
            if (parentDir === dir) break;
            dir = parentDir;
        }
        if (!jsonInfo || !pkgPath || !workspacePath) {
            throw new Appexit('不存在 package.json 文件');
        }
        return { pkgPath, workspacePath, cwdPath, jsonPath, jsonInfo };
    }

    /**执行Git命令并处理错误 - 统一Git操作的错误处理（工具方法）*/
    protected runGitCommand(cmd: string, options?: ExecSyncOptionsWithStringEncoding, throwOnError: boolean = true): string | null {
        try {
            // 禁止LF/CRLF警告输出，提升用户体验
            const result = execSync(`git -c core.safecrlf=false ${cmd}`, {
                stdio: 'pipe',
                cwd: process.cwd(),
                ...(options || {})
            });
            return result.toString().trim();
        } catch (error: any) {
            if (throwOnError) {
                // 致命错误
                throw new Appexit(`Git命令执行失败: ${cmd}`);
            }
            // 非致命错误，返回null
            return null;
        }
    }

    /**执行交互式命令 - 用于需要用户交互的命令（工具方法）*/
    protected runInteractiveCommand(cmd: string, throwOnError: boolean = true): void {
        try {
            // 如果是git命令，添加参数禁止LF/CRLF警告
            if (cmd.startsWith('git')) {
                cmd = cmd.replace('git', 'git -c core.safecrlf=false');
            }
            execSync(cmd, { stdio: 'inherit', cwd: process.cwd() });
        } catch (error: any) {
            if (throwOnError) {
                // 交互式命令执行失败是致命错误
                throw new Appexit('交互式命令执行失败');
            }
            // 非致命错误，静默失败
        }
    }

    /**执行通用命令并返回结果 - 支持非致命错误模式（工具方法）*/
    protected runCommand(cmd: string, options?: ExecSyncOptionsWithStringEncoding, throwOnError: boolean = true): string | null {
        try {
            const result = execSync(cmd, {
                stdio: 'pipe',
                cwd: process.cwd(),
                ...(options || {})
            });
            return result.toString().trim();
        } catch (error: any) {
            if (throwOnError) {
                // 致命错误
                throw new Appexit(`命令执行失败: ${cmd}`);
            }
            // 非致命错误，返回null
            return null;
        }
    }

    protected async confirmOutputTarget(options: ConfirmOutputNameOptions): Promise<OutputTarget> {
        const name = await this.confirmOutputName(options);
        const basePath = options.basePath ?? this.cwdProjectInfo.cwdPath;
        return {
            name,
            path: path.resolve(basePath, name),
        };
    }

    /**确认输出名称 - 支持命令行传入、默认值、名称校验和目标路径确认 */
    protected async confirmOutputName(options: ConfirmOutputNameOptions): Promise<string> {
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
                const basePath = options.basePath ?? this.cwdProjectInfo.cwdPath;
                const targetPath = path.resolve(basePath, name);
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
            } catch (error) {
                if (error instanceof Error && error.message === "user-cancelled") {
                    throw error;
                }
                console.error(error instanceof Error ? error.message : String(error));
                name = "";
            }
        }
    }

    protected packagePath(...paths: string[]): string {
        return path.resolve(this.cwdProjectInfo.pkgPath, ...paths);
    }

    protected packageRelativePath(filePath: string): string {
        return path.relative(this.cwdProjectInfo.pkgPath, filePath).replace(/\\/g, "/");
    }

    protected pathDisplay(filePath: string): string {
        return path.resolve(filePath);
    }

    protected rewritePackageJsonIdentity(targetPath: string, packageName: string): ProjectIdentity {
        const pkgPath = path.join(targetPath, "package.json");
        const pkg = this.readJsonFile<PackageJsonRecord>(pkgPath) ?? {};
        const sourceRepo = this.parseGitHubRepo(this.repositoryUrlGet(pkg));
        const projectRepo = this.githubProjectRepoGet(packageName);
        const repositoryUrl = projectRepo ? `https://github.com/${projectRepo.owner}/${projectRepo.repo}.git` : undefined;
        const homepage = projectRepo ? `https://github.com/${projectRepo.owner}/${projectRepo.repo}` : undefined;
        const identity: ProjectIdentity = {
            packageName,
            repositoryName: projectRepo?.repo ?? this.githubRepositoryNameGet(packageName),
            author: this.gitConfigGet("user.name") ?? pkg.author,
            githubOwner: projectRepo?.owner,
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
        } else {
            delete pkg.repository;
        }
        if (identity.homepage) {
            pkg.homepage = identity.homepage;
        } else {
            delete pkg.homepage;
        }
        if (identity.bugsUrl) {
            pkg.bugs = { url: identity.bugsUrl };
        } else {
            delete pkg.bugs;
        }

        this.writeJsonFile(pkgPath, pkg);
        this.readmeIdentitySet(targetPath, sourceRepo, identity);
        return identity;
    }

    protected createGithubPublish(config: GithubPublishConfig): string {
        const workflowPath = path.join(config.targetPath, ".github", "workflows", "publish.yml");
        fs.mkdirSync(path.dirname(workflowPath), { recursive: true });
        fs.writeFileSync(workflowPath, this.githubPublishContent(config.packageName, config.workingDirectory), "utf-8");
        return workflowPath;
    }

    protected async finalizeProjectOutput(targetPath: string, packageName: string): Promise<ProjectIdentity> {
        const identity = this.rewritePackageJsonIdentity(targetPath, packageName);
        await this.pnpmRootSetupAsk();
        await this.publishWorkflowAsk(targetPath, identity);
        return identity;
    }

    public async rewriteCurrentPackageIdentity(): Promise<void> {
        const prompts = await import("prompts");
        const response = await prompts.default({
            type: "text",
            name: "packageName",
            message: "请输入 package.json name",
            initial: this.cwdProjectInfo.jsonInfo.name ?? path.basename(this.cwdProjectInfo.pkgPath),
        });

        if (!response.packageName) {
            throw new Error("user-cancelled");
        }

        const packageName = String(response.packageName).trim();
        this.githubProjectRepoEnsure(packageName);
        const identity = this.rewritePackageJsonIdentity(this.cwdProjectInfo.pkgPath, packageName);
        console.log(`已重写 package.json 身份信息: ${identity.packageName}`);
        console.log(`package.json: ${this.pathDisplay(this.packagePath("package.json"))}`);
    }

    public async setupPnpmWorkspaceRoot(): Promise<void> {
        const packageName = this.cwdProjectInfo.jsonInfo.name ?? path.basename(this.cwdProjectInfo.pkgPath);
        this.githubProjectRepoEnsure(packageName);
        await this.pnpmRootSetupAsk();
    }

    public async createCurrentGithubPublish(): Promise<void> {
        const packageName = this.cwdProjectInfo.jsonInfo.name ?? path.basename(this.cwdProjectInfo.pkgPath);
        const projectRepo = this.githubProjectRepoEnsure(packageName);
        await this.publishWorkflowAsk(this.cwdProjectInfo.pkgPath, {
            packageName,
            repositoryName: projectRepo?.repo ?? this.githubRepositoryNameGet(packageName),
            author: typeof this.cwdProjectInfo.jsonInfo.author === "string" ? this.cwdProjectInfo.jsonInfo.author : undefined,
            githubOwner: projectRepo?.owner,
            repositoryUrl: projectRepo ? `https://github.com/${projectRepo.owner}/${projectRepo.repo}.git` : undefined,
            homepage: projectRepo ? `https://github.com/${projectRepo.owner}/${projectRepo.repo}` : undefined,
            bugsUrl: projectRepo ? `https://github.com/${projectRepo.owner}/${projectRepo.repo}/issues` : undefined,
            license: this.cwdProjectInfo.jsonInfo.license ?? "MIT",
        });
    }

    private async pnpmRootSetupAsk(): Promise<void> {
        if (this.isPnpmWorkspaceRoot(this.cwdProjectInfo.workspacePath)) {
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
        console.log(`pnpm workspace 根配置已补齐: ${this.pathDisplay(this.cwdProjectInfo.workspacePath)}`);
    }

    private async publishWorkflowAsk(targetPath: string, identity: ProjectIdentity): Promise<void> {
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
        console.log(`已创建 publish.yml: ${this.pathDisplay(workflowPath)}`);
    }

    private pnpmWorkspaceFileSet(): void {
        const filePath = path.join(this.cwdProjectInfo.workspacePath, "pnpm-workspace.yaml");
        if (fs.existsSync(filePath)) {
            return;
        }
        fs.writeFileSync(filePath, `packages:
  - "libs/*"
  - "apps/*"
`, "utf-8");
    }

    private npmrcSet(): void {
        this.linesFileEnsure(path.join(this.cwdProjectInfo.workspacePath, ".npmrc"), ["store-dir=./.pnpm-store"]);
    }

    private gitignoreSet(): void {
        this.linesFileEnsure(path.join(this.cwdProjectInfo.workspacePath, ".gitignore"), [
            ".pnpm-store/**",
            "**/node_modules/**",
            "**/dist/**",
            "**/**_bak/",
            "**/**.bak",
        ]);
    }

    private rootPackageJsonSet(): void {
        const filePath = path.join(this.cwdProjectInfo.workspacePath, "package.json");
        const pkg = this.readJsonFile<PackageJsonRecord>(filePath) ?? {
            name: path.basename(this.cwdProjectInfo.workspacePath),
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

    private linesFileEnsure(filePath: string, lines: string[]): void {
        const oldLines = fs.existsSync(filePath)
            ? fs.readFileSync(filePath, "utf-8").split(/\r?\n/).filter(Boolean)
            : [];
        const nextLines = Array.from(new Set([...oldLines, ...lines]));
        fs.writeFileSync(filePath, `${nextLines.join("\n")}\n`, "utf-8");
    }

    private isPnpmWorkspaceRoot(dirPath: string): boolean {
        return fs.existsSync(path.join(dirPath, "pnpm-workspace.yaml"));
    }

    private githubPublishContent(packageName: string, workingDirectory = "."): string {
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

    private pnpmVersionGet(): string {
        const packageManager = this.cwdProjectInfo.jsonInfo.packageManager;
        if (packageManager?.startsWith("pnpm@")) {
            return packageManager.slice("pnpm@".length);
        }
        return "10";
    }

    private validateOutputName(name: string): void {
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

    protected readJsonFile<T>(filePath: string): T | undefined {
        if (!fs.existsSync(filePath)) {
            return undefined;
        }
        return JSON.parse(fs.readFileSync(filePath, "utf-8")) as T;
    }

    protected readRequiredJsonFile<T>(filePath: string): T {
        const value = this.readJsonFile<T>(filePath);
        if (!value) {
            throw new Appexit(`JSON 文件不存在: ${filePath}`);
        }
        return value;
    }

    protected writeJsonFile(filePath: string, value: PackageJsonRecord): void {
        fs.writeFileSync(filePath, `${JSON.stringify(value, null, 2)}\n`, "utf-8");
    }

    protected toPackageName(name: string): string {
        return name
            .replace(/([a-z0-9])([A-Z])/g, "$1-$2")
            .replace(/[^a-zA-Z0-9._~-]+/g, "-")
            .toLowerCase();
    }

    protected findPackageRoot(filePath: string): string {
        let dir = path.dirname(filePath);
        while (path.dirname(dir) !== dir) {
            if (fs.existsSync(path.join(dir, "package.json"))) {
                return dir;
            }
            dir = path.dirname(dir);
        }
        return this.cwdProjectInfo.pkgPath;
    }

    protected replaceText(filePath: string, replacements: Record<string, string>): void {
        if (!fs.existsSync(filePath)) {
            return;
        }

        let text = fs.readFileSync(filePath, "utf-8");
        for (const [from, to] of Object.entries(replacements)) {
            text = text.split(from).join(to);
        }
        fs.writeFileSync(filePath, text, "utf-8");
    }

    protected shellArg(value: string): string {
        return `"${value.replace(/"/g, '\\"')}"`;
    }

    private readmeIdentitySet(targetPath: string, sourceRepo: GitHubRepo | undefined, identity: ProjectIdentity): void {
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

    private githubProjectRepoEnsure(packageName: string): GitHubRepo | undefined {
        const projectRepo = this.githubProjectRepoGet(packageName);
        if (!projectRepo) {
            console.log("未检测到 GitHub owner，跳过同名公共仓库创建");
            return undefined;
        }

        const currentRepo = this.currentGitHubRepoGet();
        if (currentRepo?.owner === projectRepo.owner && currentRepo.repo === projectRepo.repo) {
            return projectRepo;
        }

        if (this.githubRepoExists(projectRepo)) {
            console.log(`GitHub 仓库已存在: ${projectRepo.owner}/${projectRepo.repo}`);
            return projectRepo;
        }

        try {
            execSync(
                `gh repo create ${this.shellArg(`${projectRepo.owner}/${projectRepo.repo}`)} --public --clone=false`,
                { cwd: this.cwdProjectInfo.pkgPath, stdio: "inherit" },
            );
            console.log(`已创建 GitHub 公共仓库: ${projectRepo.owner}/${projectRepo.repo}`);
            return projectRepo;
        } catch {
            throw new Appexit(`GitHub 公共仓库创建失败: ${projectRepo.owner}/${projectRepo.repo}`);
        }
    }

    private githubProjectRepoGet(packageName: string): GitHubRepo | undefined {
        const currentRepo = this.currentGitHubRepoGet();
        const owner = currentRepo?.owner ?? this.githubLoginGet();
        if (!owner) {
            return undefined;
        }
        return {
            owner,
            repo: this.githubRepositoryNameGet(packageName),
        };
    }

    private githubRepoExists(repo: GitHubRepo): boolean {
        try {
            execSync(`gh repo view ${this.shellArg(`${repo.owner}/${repo.repo}`)}`, {
                cwd: this.cwdProjectInfo.pkgPath,
                stdio: "ignore",
            });
            return true;
        } catch {
            return false;
        }
    }

    private githubRepositoryNameGet(packageName: string): string {
        return packageName
            .replace(/^@/, "")
            .replace(/[\\/]+/g, "-")
            .replace(/[^a-zA-Z0-9._-]+/g, "-");
    }

    private repositoryUrlGet(pkg: PackageJsonRecord): string | undefined {
        if (typeof pkg.repository === "string") {
            return pkg.repository;
        }
        return pkg.repository?.url;
    }

    private currentGitHubRepoGet(): GitHubRepo | undefined {
        const remote = this.commandGet("git config --get remote.origin.url");
        return remote ? this.parseGitHubRepo(remote) : undefined;
    }

    private parseGitHubRepo(value: string | undefined): GitHubRepo | undefined {
        const match = value?.match(/github\.com[:/]([^/]+)\/(.+?)(?:\.git)?$/i);
        if (!match) {
            return undefined;
        }
        return { owner: match[1], repo: match[2] };
    }

    private githubLoginGet(): string | undefined {
        return this.commandGet("gh api user --jq .login");
    }

    private gitConfigGet(key: string): string | undefined {
        return this.commandGet(`git config --get ${key}`);
    }

    private commandGet(command: string): string | undefined {
        try {
            const value = execSync(command, { cwd: process.cwd(), encoding: "utf-8", stdio: ["ignore", "pipe", "ignore"] }).trim();
            return value || undefined;
        } catch {
            return undefined;
        }
    }

    protected async askLocalFilePath(fileExtensions: string[] = ['.js', '.jsx', '.ts', '.tsx'], initialPath?: string, shouldConfirm = true): Promise<string> {
        return this.askLocalPath({
            fileExtensions,
            initialPath,
            mode: "file",
            shouldConfirm,
        });
    }

    protected async askLocalDirectoryPath(initialPath?: string, shouldConfirm = true): Promise<string> {
        return this.askLocalPath({
            initialPath,
            mode: "directory",
            shouldConfirm,
        });
    }

    protected async askLocalPath(options: LocalPathOptions): Promise<string> {
        const prompts = await import('prompts');
        const modeName = options.mode === "file" ? "文件" : "目录";
        const fileExtensions = options.fileExtensions ?? ['.js', '.jsx', '.ts', '.tsx'];
        const shouldConfirm = options.shouldConfirm ?? true;
        console.log(`📁 开始${modeName}选择...`);

        // 首先获取可用的磁盘驱动器
        let availableDrives: string[] = [];
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
            } catch (error) {
                console.warn('⚠️ 无法获取磁盘列表，使用默认路径');
                availableDrives = ['C:', process.cwd().split(':')[0] + ':'];
            }
        } else {
            // 非Windows平台默认使用根目录和当前目录
            availableDrives = ['/', process.cwd()];
        }

        // 如果提供了初始路径，直接使用它
        let currentPath = options.initialPath || process.cwd();

        // 如果没有初始路径，让用户选择磁盘/根目录
        if (!options.initialPath) {
            console.log('\n🔍 第1步：选择磁盘驱动器');
            const driveResponse = await prompts.default({
                type: 'select',
                name: 'drive',
                message: `请选择要查找${modeName}的磁盘驱动器`,
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

        let navigationLevel = options.initialPath ? 1 : 2; // 导航层级计数

        // 多级导航选择目录和文件
        while (true) {
            navigationLevel++;
            console.log(`\n🔍 第${navigationLevel}步：浏览目录结构`);

            // 获取当前目录下的所有文件和文件夹
            let items: { name: string; path: string; isDirectory: boolean }[] = [];
            try {
                const files = fs.readdirSync(currentPath);
                items = files
                    .map(name => {
                        const itemPath = path.join(currentPath, name);
                        try {
                            const stats = fs.statSync(itemPath);
                            return { name, path: itemPath, isDirectory: stats.isDirectory() };
                        } catch (error) {
                            // 跳过无法访问的文件/文件夹
                            return null;
                        }
                    })
                    .filter((item): item is { name: string; path: string; isDirectory: boolean } => item !== null) // 类型断言过滤null值
                    .sort((a, b) => {
                        // 文件夹排在前面，文件排在后面
                        if (a.isDirectory && !b.isDirectory) return -1;
                        if (!a.isDirectory && b.isDirectory) return 1;
                        // 同类项按名称排序
                        return a.name.localeCompare(b.name);
                    });
            } catch (error) {
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
                ...(options.mode === "directory" ? [{ title: '✅ 选择当前目录', value: 'select-current' }] : []),
                { title: '❌ 取消选择', value: 'cancel' },
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
                    disabled: options.mode === "directory" ? !item.isDirectory : !item.isDirectory && !isTargetFile
                };
            });

            // 组合所有选项
            const choices = [...specialChoices, ...itemChoices];

            // 询问用户选择
            const selectionResponse = await prompts.default({
                type: 'select',
                name: 'selection',
                message: `\n当前位置: ${currentPath}\n请选择一个目录进入${options.mode === "file" ? "，或选择一个目标文件" : "，或选择当前目录"}`,
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
            } else if (selectionResponse.selection === 'current') {
                currentPath = process.cwd();
                console.log(`📂 已切换到当前工作目录: ${currentPath}`);
                continue;
            } else if (selectionResponse.selection === 'select-current') {
                if (!shouldConfirm) {
                    console.log(`\n✅ 已选择目录: ${currentPath}`);
                    return currentPath;
                }

                const confirmResponse = await prompts.default({
                    type: 'confirm',
                    name: 'confirm',
                    message: `\n已选择目录: ${currentPath}\n是否确认使用此目录？`,
                    initial: true,
                });

                if (confirmResponse.confirm) {
                    console.log(`\n✅ 已选择目录: ${currentPath}`);
                    return currentPath;
                }
                continue;
            } else if (selectionResponse.selection === '..') {
                // 向上一级
                const parentPath = path.dirname(currentPath);
                if (parentPath !== currentPath) { // 防止到达根目录时无限循环
                    console.log(`⬆️ 返回上一级目录`);
                    currentPath = parentPath;
                    navigationLevel--;
                } else {
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
                } else {
                    // 选择了文件，检查是否为目标文件类型
                    const isTargetFile = fileExtensions.some(ext =>
                        selectionResponse.selection.toLowerCase().endsWith(ext)
                    );

                    if (isTargetFile) {
                        if (!shouldConfirm) {
                            console.log(`\n✅ 已选择文件: ${selectionResponse.selection}`);
                            return selectionResponse.selection;
                        }

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
            } catch (error) {
                console.error('❌ 无法访问选定的项目:', error);
                continue;
            }
        }
    }

    /**检查目录是否为有效的项目目录 */
    private isProjectDirectory(dirPath: string): boolean {
        try {
            return fs.existsSync(path.join(dirPath, 'package.json'));
        } catch (error) {
            return false;
        }
    }
}
