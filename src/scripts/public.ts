import type { PackageJson } from 'type-fest';
import path from 'path';
import fs from "fs"
import { execSync, spawn } from 'child_process';
import { fileURLToPath } from "node:url";
import type prompts from 'prompts';
import Mustache from 'mustache';
import cliPkg from "../../package.json" with { type: "json" };

/** Application exit error. */
export class Appexit extends Error {
    /**
     * @param message Error message.
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

type ConfirmOutputNameOptions = {
    basePath?: string;
    initialName?: string;
    defaultName: string;
    message: string;
    targetLabel: string;
    existsError?: boolean;
};

type LocalPathMode = "directory" | "file";

type LocalPathOptions = {
    fileExtensions?: string[];
    initialPath?: string;
    mode: LocalPathMode;
    shouldConfirm?: boolean;
};

type LocalPathChoice = {
    title: string;
    value: string;
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

type TplBinCommandContext = {
    commandName: string;
    entryRelativePath: string;
    rootRelativePath: string;
};

type TplPublishJobContext = {
    githubPreleaseCliRepo?: string;
    pnpmVersion: string;
    workingDirectory?: string;
};

/** 文件模板核心渲染器，只在本文件内给具体模板基类复用。 */
class FileTplCore {
    private readonly templateRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../codetpl");

    public pnpm_workspace_yaml_create(): string {
        return this.templateRead("pnpm-workspace.yaml");
    }

    public pnpm_workspace_yaml_release_create(packagePaths: string[]): string {
        return `packages:
${packagePaths.map(packagePath => `  - "${packagePath}"`).join("\n")}
`;
    }

    public bin_command_js_create(context: TplBinCommandContext): string {
        return this.templateRender("command.js", {
            commandNameJson: JSON.stringify(context.commandName),
            entryRelativePathJson: JSON.stringify(context.entryRelativePath),
            rootRelativePathJson: JSON.stringify(context.rootRelativePath),
        });
    }

    public command_shell_create(wrapperPath: string): string {
        return this.tplRender(`#!/usr/bin/env sh
exec node {{{wrapperPathJson}}} $@
`, { wrapperPathJson: JSON.stringify(wrapperPath) });
    }

    public command_cmd_create(wrapperPath: string): string {
        return this.tplRender(`@ECHO off
node {{{wrapperPathJson}}} %*
`, { wrapperPathJson: JSON.stringify(wrapperPath) });
    }

    public command_ps1_create(wrapperPath: string): string {
        return this.tplRender(`& node {{{wrapperPathJson}}} @args
exit $LASTEXITCODE
`, { wrapperPathJson: JSON.stringify(wrapperPath) });
    }

    public publish_yml_create(packageName: string): string {
        return this.templateRender("publish.yml", { packageName });
    }

    public publish_yml_job_npmjs_create(context: TplPublishJobContext): string {
        return this.templateRender("publish-job-npmjs.yml", this.publish_yml_jobView(context));
    }

    public publish_yml_job_github_packages_create(context: TplPublishJobContext): string {
        return this.templateRender("publish-job-github-packages.yml", this.publish_yml_jobView(context));
    }

    public publish_yml_job_github_prelease_create(context: Pick<TplPublishJobContext, "githubPreleaseCliRepo" | "pnpmVersion">): string {
        return this.templateRender("publish-job-github-prelease.yml", this.publish_yml_jobView(context));
    }

    private publish_yml_defaults_create(workingDirectory = "."): string {
        if (!workingDirectory || workingDirectory === ".") {
            return "";
        }
        return `
    defaults:
      run:
        working-directory: ${workingDirectory.replace(/\\/g, "/")}`;
    }

    private publish_yml_jobView(context: TplPublishJobContext): Record<string, string> {
        return {
            jobDefaultsContent: this.publish_yml_defaults_create(context.workingDirectory),
            githubPreleaseCliRepo: context.githubPreleaseCliRepo ?? "",
            githubToken: "{{ secrets.GITHUB_TOKEN }}",
            npmToken: "{{ secrets.NPM_TOKEN }}",
            pnpmVersion: context.pnpmVersion,
        };
    }

    public templateLines(name: string): string[] {
        return this.templateRead(name)
            .split(/\r?\n/)
            .map(line => line.trim())
            .filter(Boolean);
    }

    private templateRender(name: string, view: Record<string, unknown>): string {
        return this.tplRender(this.templateRead(name), view);
    }

    private templateRead(name: string): string {
        return fs.readFileSync(path.join(this.templateRoot, name), "utf-8");
    }

    private tplRender(templateText: string, view: Record<string, unknown>): string {
        return Mustache.render(templateText, view);
    }
}

/**基类 - 提供通用的工具方法和项目信息访问*/
export default class LibBase {
    protected readonly cwdProjectInfo: cwdProjectInfo_t
    private githubLoginCache?: string;

    constructor(options: { requirePackage?: boolean } = {}) {
        this.cwdProjectInfo = this.getcwdProjectInfo(options.requirePackage ?? true)
    }

    public static pnpmWorkspaceRootFind(startPath = process.cwd()): string | undefined {
        let dir = path.resolve(startPath);
        while (path.dirname(dir) !== dir) {
            if (fs.existsSync(path.join(dir, "pnpm-workspace.yaml"))) {
                return dir;
            }
            dir = path.dirname(dir);
        }
        return undefined;
    }

    public static pnpmWorkspacePackagesParse(text: string): string[] {
        const packages: string[] = [];
        let inPackages = false;

        for (const line of text.split(/\r?\n/)) {
            if (/^\s*packages\s*:\s*$/.test(line)) {
                inPackages = true;
                continue;
            }
            if (inPackages && /^\S/.test(line) && !line.startsWith("packages:")) {
                break;
            }

            const match = line.match(/^\s*-\s*["']?([^"']+)["']?\s*$/);
            if (inPackages && match?.[1]) {
                packages.push(match[1]);
            }
        }

        return packages;
    }

    public static gitRootFind(startPath = process.cwd()): string | undefined {
        let dir = path.resolve(startPath);
        while (path.dirname(dir) !== dir) {
            if (fs.existsSync(path.join(dir, ".git"))) {
                return dir;
            }
            dir = path.dirname(dir);
        }
        return undefined;
    }

    public static pathNormalize(filePath: string): string {
        return path.resolve(filePath).replace(/\\/g, "/").toLowerCase();
    }

    public static pathEqual(leftPath: string, rightPath: string): boolean {
        return this.pathNormalize(leftPath) === this.pathNormalize(rightPath);
    }

    public static hasExternalPnpmWorkspace(startPath = process.cwd()): boolean {
        const workspaceRoot = this.pnpmWorkspaceRootFind(startPath);
        if (!workspaceRoot) {
            return false;
        }

        return this.pnpmWorkspacePackagesParse(
            fs.readFileSync(path.join(workspaceRoot, "pnpm-workspace.yaml"), "utf-8"),
        ).some(item => item.startsWith("../"));
    }

    /** 获取当前工作目录的项目信息 - 递归查找 package.json */
    private getcwdProjectInfo(requirePackage: boolean): cwdProjectInfo_t {
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
            if (!requirePackage) {
                return {
                    pkgPath: cwdPath,
                    workspacePath: cwdPath,
                    cwdPath,
                    jsonPath: path.join(cwdPath, "package.json"),
                    jsonInfo: {},
                };
            }
            throw new Appexit("不存在 package.json 文件");
        }
        return { pkgPath, workspacePath, cwdPath, jsonPath, jsonInfo };
    }

    /** Run an interactive shell command. */
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
                throw new Appexit("Interactive command failed");
            }
            // 非致命错误，静默失败
        }
    }

    /** Ask for a valid output name. */
    protected async askValidOutputName(options: ConfirmOutputNameOptions): Promise<string> {
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
                const targetExists = fs.existsSync(targetPath);
                if (options.existsError && targetExists) {
                    throw new Error(`目录已存在: ${name}`);
                }

                const prompts = await import("prompts");
                const response = await prompts.default({
                    type: "confirm",
                    name: "confirmed",
                    message: `${options.targetLabel}: ${targetExists ? "将替换" : "将新建"}: ${targetPath}\n是否继续？`,
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

    protected readJsonFile<T = any>(filePath: string): T | undefined {
        try {
            if (!fs.existsSync(filePath)) return undefined;
            return JSON.parse(fs.readFileSync(filePath, 'utf-8')) as T;
        } catch {
            return undefined;
        }
    }

    protected readRequiredJsonFile<T = any>(filePath: string): T {
        const value = this.readJsonFile<T>(filePath);
        if (!value) {
            throw new Appexit(`JSON file not found or invalid: ${filePath}`);
        }
        return value;
    }

    protected writeJsonFile(filePath: string, value: unknown): void {
        fs.writeFileSync(filePath, `${JSON.stringify(value, null, 2)}\n`, 'utf-8');
    }

    protected toPackageName(name: string): string {
        return String(name).trim();
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

    protected async finalizeProjectOutput(targetPath: string, packageName: string): Promise<ProjectIdentity> {
        const normalizedPackageName = this.toPackageName(packageName);
        const identity = this.rewritePackageJsonIdentity(targetPath, normalizedPackageName);
        await this.gitProjectEnsure(targetPath, normalizedPackageName);
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
        await this.githubProjectRepoEnsure(packageName);
        const identity = this.rewritePackageJsonIdentity(this.cwdProjectInfo.pkgPath, packageName);
        console.log(`已重写 package.json 身份信息: ${identity.packageName}`);
        console.log("modified files:");
        for (const filePath of this.identityModifiedFiles(this.cwdProjectInfo.pkgPath)) {
            console.log(`- ${this.pathDisplay(filePath)}`);
        }
    }

    public async setupPnpmWorkspaceRoot(): Promise<void> {
        const packageName = this.cwdProjectInfo.jsonInfo.name ?? path.basename(this.cwdProjectInfo.pkgPath);
        await this.githubProjectRepoEnsure(packageName);
        await this.pnpmRootSetupAsk();
    }

    public initCurrentGitignore(): void {
        this.gitignoreSet(this.cwdProjectInfo.workspacePath);
        console.log(`.gitignore 已初始化: ${this.pathDisplay(path.join(this.cwdProjectInfo.workspacePath, ".gitignore"))}`);
    }

    private async pnpmRootSetupAsk(): Promise<void> {
        if (this.isPnpmWorkspaceRoot(this.cwdProjectInfo.workspacePath)) {
            console.log("Current directory is already a pnpm workspace root");
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
        this.gitignoreSet(this.cwdProjectInfo.workspacePath);
        this.rootPackageJsonSet();
        console.log(`pnpm workspace 根配置已补齐: ${this.pathDisplay(this.cwdProjectInfo.workspacePath)}`);
        console.log("modified files:");
        for (const filePath of [
            path.join(this.cwdProjectInfo.workspacePath, "pnpm-workspace.yaml"),
            path.join(this.cwdProjectInfo.workspacePath, ".npmrc"),
            path.join(this.cwdProjectInfo.workspacePath, ".gitignore"),
            path.join(this.cwdProjectInfo.workspacePath, "package.json"),
        ]) {
            console.log(`- ${this.pathDisplay(filePath)}`);
        }
    }

    protected async publishWorkflowAsk(targetPath: string, identity: ProjectIdentity): Promise<void> {
        const prompts = await import("prompts");
        const response = await prompts.default({
            type: "confirm",
            name: "enabled",
            message: "Create publish config for current project?",
            initial: false,
        });

        if (response.enabled === undefined) {
            throw new Error("user-cancelled");
        }
        if (!response.enabled) {
            console.log("跳过 publish.yml");
            return;
        }

        const { default: PublishYml } = await import("./publishYml.js");
        const result = await new PublishYml().createForProject({
            packageName: identity.packageName,
            targetPath,
            githubOwner: identity.githubOwner,
        });
        if (!result) {
            return;
        }
        console.log(`已创建发布配置: ${result.files.map(filePath => this.pathDisplay(filePath)).join(", ")}`);
        return;
    }

    private pnpmWorkspaceFileSet(): void {
        const filePath = path.join(this.cwdProjectInfo.workspacePath, "pnpm-workspace.yaml");
        if (fs.existsSync(filePath)) {
            return;
        }
        fs.writeFileSync(filePath, new FileTplCore().pnpm_workspace_yaml_create(), "utf-8");
    }

    private npmrcSet(): void {
        this.linesFileEnsure(path.join(this.cwdProjectInfo.workspacePath, ".npmrc"), new FileTplCore().templateLines(".npmrc"));
    }

    protected gitignoreSet(targetPath: string): void {
        this.linesFileEnsure(path.join(targetPath, ".gitignore"), new FileTplCore().templateLines(".gitignore"));
    }

    protected async gitProjectEnsure(targetPath: string, packageName: string): Promise<GitHubRepo | undefined> {
        const parentGitRoot = this.parentGitRootFind(targetPath);
        if (parentGitRoot) {
            console.log(`父级已存在 git 仓库，跳过子项目 git/GitHub 初始化: ${this.pathDisplay(parentGitRoot)}`);
            return undefined;
        }

        const normalizedPackageName = this.toPackageName(packageName);
        const projectRepo = this.githubProjectRepoGet(normalizedPackageName);
        if (!projectRepo) {
            console.log("GitHub owner not detected, skip repository creation");
            return undefined;
        }

        if (!fs.existsSync(path.join(targetPath, ".git"))) {
            await this.commandRunInherit("git init -b master", targetPath, "git init");
            console.log(`已初始化 git 仓库: ${this.pathDisplay(targetPath)}`);
        }

        const targetUrl = `https://github.com/${projectRepo.owner}/${projectRepo.repo}.git`;
        if (this.githubRepoExists(projectRepo)) {
            console.log(`GitHub repository exists, bind to ${projectRepo.owner}/${projectRepo.repo}`);
        } else {
            const prompts = await import("prompts");
            const visibilityResponse = await prompts.default({
                type: "select",
                name: "visibility",
                message: `GitHub repository ${projectRepo.owner}/${projectRepo.repo} does not exist. Create as:`,
                choices: [
                    { title: "public", value: "public" },
                    { title: "private", value: "private" },
                ],
                initial: 0,
            });
            if (!visibilityResponse.visibility) {
                throw new Error("user-cancelled");
            }
            const visibility = visibilityResponse.visibility as "public" | "private";
            try {
                await this.commandRunInherit(
                    `gh repo create ${this.shellArg(`${projectRepo.owner}/${projectRepo.repo}`)} --${visibility} --clone=false`,
                    targetPath,
                    `gh repo create ${projectRepo.owner}/${projectRepo.repo}`,
                );
                console.log(`Created GitHub ${visibility} repository: ${projectRepo.owner}/${projectRepo.repo}`);
            } catch {
                throw new Appexit(`GitHub repository create failed: ${projectRepo.owner}/${projectRepo.repo}`);
            }
        }

        const currentUrl = this.commandGet("git config --get remote.origin.url", targetPath);
        if (currentUrl === targetUrl) {
            return projectRepo;
        }

        try {
            if (currentUrl) {
                await this.commandRunInherit(`git remote set-url origin ${this.shellArg(targetUrl)}`, targetPath, "git remote set-url");
            } else {
                await this.commandRunInherit(`git remote add origin ${this.shellArg(targetUrl)}`, targetPath, "git remote add");
            }
            console.log(`已设置 origin: ${targetUrl}`);
        } catch {
            throw new Appexit(`GitHub origin 设置失败: ${targetUrl}`);
        }

        return projectRepo;
    }

    private parentGitRootFind(targetPath: string): string | undefined {
        const targetRoot = path.resolve(targetPath);
        const parentRoot = path.dirname(targetRoot);
        const gitRoot = LibBase.gitRootFind(parentRoot);
        return gitRoot && !LibBase.pathEqual(gitRoot, targetRoot) ? gitRoot : undefined;
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

    private validateOutputName(name: string): void {
        if (!name || !String(name).trim()) {
            throw new Error("无效的名称：不能为空");
        }
        // 不允许路径分隔符或空白字符
        if (/[\\/\s]/.test(name)) {
            throw new Error("无效的名称：不能包含路径分隔符或空白字符");
        }
        // 保守校验：允许字母、数字、点、下划线、破折号和 @
        if (!/^[a-zA-Z0-9._@\-]+$/.test(name)) {
            throw new Error("无效的名称：包含不支持的字符");
        }
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

    private identityModifiedFiles(targetPath: string): string[] {
        return [
            path.join(targetPath, "package.json"),
            path.join(targetPath, "README.md"),
        ].filter(filePath => fs.existsSync(filePath));
    }

    private async githubProjectRepoEnsure(packageName: string): Promise<GitHubRepo | undefined> {
        const projectRepo = this.githubProjectRepoGet(packageName);
        if (!projectRepo) {
            console.log("GitHub owner not detected, skip repository creation");
            return undefined;
        }

        const currentRepo = this.currentGitHubRepoGet();
        const isCurrentProjectRepo = currentRepo?.owner === projectRepo.owner && currentRepo.repo === projectRepo.repo;
        if (!isCurrentProjectRepo) {
            if (this.githubRepoExists(projectRepo)) {
                console.log(`GitHub 仓库已存在: ${projectRepo.owner}/${projectRepo.repo}`);
            } else {
                const prompts = await import("prompts");
                const visibilityResponse = await prompts.default({
                    type: "select",
                    name: "visibility",
                    message: `GitHub 仓库 ${projectRepo.owner}/${projectRepo.repo} 不存在，选择创建为：`,
                    choices: [
                        { title: "public", value: "public" },
                        { title: "private", value: "private" },
                    ],
                    initial: 0,
                });
                if (!visibilityResponse.visibility) {
                    throw new Error("user-cancelled");
                }
                const visibility = visibilityResponse.visibility as "public" | "private";
                try {
                    execSync(
                        `gh repo create ${this.shellArg(`${projectRepo.owner}/${projectRepo.repo}`)} --${visibility} --clone=false`,
                        { cwd: this.cwdProjectInfo.pkgPath, stdio: "inherit" },
                    );
                    console.log(`已创建 GitHub ${visibility} 仓库: ${projectRepo.owner}/${projectRepo.repo}`);
                } catch {
                    throw new Appexit(`GitHub 仓库创建失败: ${projectRepo.owner}/${projectRepo.repo}`);
                }
            }
            this.githubOriginRemoteEnsure(projectRepo, currentRepo);
        }

        return projectRepo;
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

    private gitEnsureInitialCommit(targetPath: string): void {
        if (this.commandGet("git rev-parse --verify HEAD", targetPath)) {
            return;
        }

        const lockFile = path.join(targetPath, ".git", "index.lock");
        if (fs.existsSync(lockFile)) {
            console.warn(`检测到 .git/index.lock 存在，假定可能有其他 git 进程在运行，跳过添加并尝试创建空提交`);
            try {
                execSync(`git commit --allow-empty -m ${this.shellArg("chore: initial commit")}`, {
                    cwd: targetPath,
                    stdio: "inherit",
                });
                console.log("已创建空提交（因存在 index.lock）");
                return;
            } catch {
                throw new Appexit("由于存在 index.lock，创建空提交失败");
            }
        }

        try {
            execSync("git add -A", { cwd: targetPath, stdio: "inherit" });
        } catch (err) {
            console.warn(`git add -A 失败: ${err instanceof Error ? err.message : String(err)}，尝试空提交`);
            try {
                execSync(`git commit --allow-empty -m ${this.shellArg("chore: initial commit")}`, {
                    cwd: targetPath,
                    stdio: "inherit",
                });
                console.log("已创建空提交（git add 失败降级）");
                return;
            } catch {
                throw new Appexit("创建初始空提交失败");
            }
        }

        try {
            execSync(`git commit -m ${this.shellArg("chore: initial commit")}`, {
                cwd: targetPath,
                stdio: "inherit",
            });
        } catch {
            const status = this.commandGet("git status --porcelain", targetPath);
            if (!status) {
                execSync(`git commit --allow-empty -m ${this.shellArg("chore: initial commit")}`, {
                    cwd: targetPath,
                    stdio: "inherit",
                });
                console.log("工作区无更改，已创建空提交");
                return;
            }
            throw new Appexit("创建初始提交失败");
        }
    }

    // gitCleanupLockFile 已移除；脚本不再尝试自动删除 .git/index.lock

    private gitPushHead(targetPath: string): void {
        try {
            execSync(`git -c credential.helper= -c credential.helper="!gh auth git-credential" push -u origin HEAD`, {
                cwd: targetPath,
                stdio: "inherit",
            });
        } catch {
            throw new Appexit("推送到 GitHub 远程仓库失败");
        }
    }

    private githubRepoExists(repo: GitHubRepo): boolean {
        try {
            console.log(`check GitHub repository: ${repo.owner}/${repo.repo}`);
            execSync(`gh repo view ${this.shellArg(`${repo.owner}/${repo.repo}`)}`, {
                cwd: this.cwdProjectInfo.pkgPath,
                stdio: "ignore",
                timeout: 30_000,
            });
            return true;
        } catch {
            return false;
        }
    }

    private githubOriginRemoteEnsure(projectRepo: GitHubRepo, currentRepo: GitHubRepo | undefined): void {
        const targetUrl = `https://github.com/${projectRepo.owner}/${projectRepo.repo}.git`;
        const currentUrl = this.commandGet("git config --get remote.origin.url");
        if (currentUrl === targetUrl) {
            return;
        }

        if (currentRepo) {
            console.log(`当前 GitHub 仓库 ${currentRepo.owner}/${currentRepo.repo} 与项目名不一致，切换 origin 到 ${projectRepo.owner}/${projectRepo.repo}`);
        } else if (currentUrl) {
            console.log(`当前 origin 不是 GitHub 仓库，切换 origin 到 ${projectRepo.owner}/${projectRepo.repo}`);
        } else {
            console.log(`添加 origin 到 ${projectRepo.owner}/${projectRepo.repo}`);
        }

        try {
            if (currentUrl) {
                execSync(`git remote set-url origin ${this.shellArg(targetUrl)}`, {
                    cwd: this.cwdProjectInfo.pkgPath,
                    stdio: "inherit",
                });
            } else {
                execSync(`git remote add origin ${this.shellArg(targetUrl)}`, {
                    cwd: this.cwdProjectInfo.pkgPath,
                    stdio: "inherit",
                });
            }
        } catch {
            throw new Appexit(`GitHub origin 设置失败: ${targetUrl}`);
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

     parseGitHubRepo(value: string | undefined): GitHubRepo | undefined {
        const match = value?.match(/github\.com[:/]([^/]+)\/(.+?)(?:\.git)?$/i);
        if (!match) {
            return undefined;
        }
        return { owner: match[1], repo: match[2] };
    }

    private githubLoginGet(): string | undefined {
        if (this.githubLoginCache) {
            return this.githubLoginCache;
        }
        console.log("detect GitHub login");
        this.githubLoginCache = this.commandGet("gh api user --jq .login");
        return this.githubLoginCache;
    }

    private gitConfigGet(key: string): string | undefined {
        return this.commandGet(`git config --get ${key}`);
    }

    private async commandRunInherit(command: string, cwd: string, label: string): Promise<void> {
        console.log(`running: ${label}`);
        const startTime = Date.now();
        const child = spawn(command, {
            cwd,
            shell: true,
            stdio: "inherit",
            windowsHide: true,
        });
        const heartbeat = setInterval(() => {
            const seconds = Math.round((Date.now() - startTime) / 1000);
            console.log(`still running (${seconds}s): ${label}`);
        }, 15_000);

        try {
            await new Promise<void>((resolve, reject) => {
                child.once("error", reject);
                child.once("close", code => {
                    if (code === 0) {
                        resolve();
                    } else {
                        reject(new Error(`${label} failed with exit code ${code}`));
                    }
                });
            });
        } finally {
            clearInterval(heartbeat);
        }
    }

    private commandGet(command: string, cwd = process.cwd()): string | undefined {
        try {
            const value = execSync(command, { cwd, encoding: "utf-8", stdio: ["ignore", "pipe", "ignore"], timeout: 30_000 }).trim();
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

    protected async askLocalPath(options: LocalPathOptions): Promise<string> {
        const prompts = await import('prompts');
        const modeName = options.mode === "file" ? "file" : "directory";
        let currentPath = options.initialPath || process.cwd();
        const shouldConfirm = options.shouldConfirm ?? true;

        while (true) {
            const pathChoices = this.localPathChoices(options, currentPath);
            if (pathChoices.length > 0) {
                const response = await prompts.default({
                    type: "select",
                    name: "pathValue",
                    message: `Please select ${modeName} path`,
                    choices: pathChoices,
                });
                if (!response.pathValue) {
                    throw new Error("user-cancelled");
                }
                currentPath = String(response.pathValue);
            } else {
                throw new Appexit(`No selectable ${modeName} path: ${currentPath}`);
            }

            currentPath = path.resolve(currentPath.trim());
            if (options.mode === "file" && fs.existsSync(currentPath) && fs.statSync(currentPath).isDirectory()) {
                continue;
            }

            const exists = fs.existsSync(currentPath);
            const stat = exists ? fs.statSync(currentPath) : undefined;
            const modeMatched = options.mode === "file" ? stat?.isFile() : stat?.isDirectory();
            const extensionMatched = this.localPathExtensionMatched(currentPath, options);

            if (!exists || !modeMatched || !extensionMatched) {
                throw new Appexit(`Invalid ${modeName} path: ${currentPath}`);
            }

            if (!shouldConfirm) {
                return currentPath;
            }

            const confirmResponse = await prompts.default({
                type: "confirm",
                name: "confirmed",
                message: `Use ${modeName}: ${currentPath}?`,
                initial: true,
            });
            if (confirmResponse.confirmed === undefined) {
                throw new Error("user-cancelled");
            }
            if (confirmResponse.confirmed) {
                return currentPath;
            }
        }
    }

    private localPathChoices(options: LocalPathOptions, currentPath: string): LocalPathChoice[] {
        const directoryPath = this.localPathCurrentDirectory(currentPath);
        const defaultPath = path.resolve(currentPath);
        const candidatePaths: LocalPathChoice[] = [];
        const parentPath = path.dirname(directoryPath);

        if (parentPath !== directoryPath) {
            candidatePaths.push({
                title: "../",
                value: parentPath,
            });
        }

        if (this.localPathMatched(defaultPath, options)) {
            candidatePaths.push({
                title: path.basename(defaultPath),
                value: defaultPath,
            });
        }

        const dirents = this.localPathDirents(directoryPath);
        const directories = dirents
            .filter(dirent => dirent.isDirectory())
            .filter(dirent => !this.localPathIgnoredDirectoryName(dirent.name))
            .map(dirent => path.join(directoryPath, dirent.name))
            .sort((leftPath, rightPath) => leftPath.localeCompare(rightPath));
        const files = dirents
            .filter(dirent => dirent.isFile())
            .map(dirent => path.join(directoryPath, dirent.name))
            .filter(filePath => this.localPathMatched(filePath, options))
            .sort((leftPath, rightPath) => leftPath.localeCompare(rightPath));

        for (const directory of directories) {
            candidatePaths.push({
                title: `${path.basename(directory)}/`,
                value: directory,
            });
        }

        for (const file of files) {
            if (file === defaultPath && candidatePaths.some(choice => choice.value === file)) {
                continue;
            }
            candidatePaths.push({
                title: path.basename(file),
                value: file,
            });
        }

        return candidatePaths.slice(0, 40);
    }

    private localPathCurrentDirectory(currentPath: string): string {
        const resolvedPath = path.resolve(currentPath);
        if (!fs.existsSync(resolvedPath)) {
            throw new Appexit(`Path does not exist: ${resolvedPath}`);
        }
        const stat = fs.statSync(resolvedPath);
        return stat.isDirectory() ? resolvedPath : path.dirname(resolvedPath);
    }

    private localPathDirents(directoryPath: string): fs.Dirent[] {
        try {
            return fs.readdirSync(directoryPath, { withFileTypes: true });
        } catch {
            return [];
        }
    }

    private localPathIgnoredDirectoryName(directoryName: string): boolean {
        return new Set([
            ".git",
            ".log",
            ".next",
            ".output",
            ".turbo",
            "build",
            "coverage",
            "dist",
            "node_modules",
        ]).has(directoryName);
    }

    private localPathMatched(filePath: string, options: LocalPathOptions): boolean {
        try {
            if (!fs.existsSync(filePath)) {
                return false;
            }
            const stat = fs.statSync(filePath);
            const modeMatched = options.mode === "file" ? stat.isFile() : stat.isDirectory();
            if (!modeMatched) {
                return false;
            }
        } catch {
            return false;
        }
        return options.mode !== "file"
            || this.localPathExtensionMatched(filePath, options);
    }

    private localPathExtensionMatched(filePath: string, options: LocalPathOptions): boolean {
        if (options.mode !== "file" || !options.fileExtensions?.length) {
            return true;
        }
        if (filePath.endsWith(".d.ts")) {
            return false;
        }
        const fileExtension = path.extname(filePath).toLowerCase();
        return options.fileExtensions
            .map(extension => extension.toLowerCase())
            .includes(fileExtension);
    }

    protected tplStringRequired(name: string, value: string | undefined): string {
        if (!value) {
            throw new Appexit(`Tpl context missing: ${name}`);
        }
        return value;
    }
}

export class WorkspaceTpl extends LibBase {
    private readonly fileTpl = new FileTplCore();
    protected workspaceReleasePackagePaths?: string[];

    protected pnpm_workspace_yaml_create(): string {
        return this.fileTpl.pnpm_workspace_yaml_create();
    }

    protected pnpm_workspace_yaml_release_create(): string {
        if (!this.workspaceReleasePackagePaths) {
            throw new Appexit("Tpl context missing: workspaceReleasePackagePaths");
        }
        return this.fileTpl.pnpm_workspace_yaml_release_create(this.workspaceReleasePackagePaths);
    }
}

export class BinTpl extends LibBase {
    private readonly fileTpl = new FileTplCore();
    protected binCommandName?: string;
    protected binEntryRelativePath?: string;
    protected binRootRelativePath?: string;
    protected commandWrapperPath?: string;

    protected bin_command_js_create(): string {
        return this.fileTpl.bin_command_js_create({
            commandName: this.tplStringRequired("binCommandName", this.binCommandName),
            entryRelativePath: this.tplStringRequired("binEntryRelativePath", this.binEntryRelativePath),
            rootRelativePath: this.tplStringRequired("binRootRelativePath", this.binRootRelativePath),
        });
    }

    protected command_shell_create(): string {
        return this.fileTpl.command_shell_create(this.tplStringRequired("commandWrapperPath", this.commandWrapperPath));
    }

    protected command_cmd_create(): string {
        return this.fileTpl.command_cmd_create(this.tplStringRequired("commandWrapperPath", this.commandWrapperPath));
    }

    protected command_ps1_create(): string {
        return this.fileTpl.command_ps1_create(this.tplStringRequired("commandWrapperPath", this.commandWrapperPath));
    }
}

export class PublishTpl extends LibBase {
    private readonly fileTpl = new FileTplCore();
    protected publishPackageName?: string;
    protected publishPnpmVersion?: string;
    protected publishWorkingDirectory?: string;

    constructor() {
        super({ requirePackage: false });
    }

    protected publish_yml_create(): string {
        return this.fileTpl.publish_yml_create(this.tplStringRequired("publishPackageName", this.publishPackageName));
    }

    protected publish_yml_job_npmjs_create(): string {
        return this.fileTpl.publish_yml_job_npmjs_create({
            pnpmVersion: this.tplStringRequired("publishPnpmVersion", this.publishPnpmVersion),
            workingDirectory: this.publishWorkingDirectory,
        });
    }

    protected publish_yml_job_github_packages_create(): string {
        return this.fileTpl.publish_yml_job_github_packages_create({
            pnpmVersion: this.tplStringRequired("publishPnpmVersion", this.publishPnpmVersion),
            workingDirectory: this.publishWorkingDirectory,
        });
    }

    protected publish_yml_job_github_prelease_create(): string {
        return this.fileTpl.publish_yml_job_github_prelease_create({
            githubPreleaseCliRepo: this.githubPreleaseCliRepoGet(),
            pnpmVersion: this.tplStringRequired("publishPnpmVersion", this.publishPnpmVersion),
        });
    }

    private githubPreleaseCliRepoGet(): string {
        const repositoryUrl = typeof cliPkg.repository === "string" ? cliPkg.repository : cliPkg.repository?.url;
        const sourceUrl = repositoryUrl ?? cliPkg.homepage;
        const match = sourceUrl?.match(/github\.com[:/]([^/]+)\/(.+?)(?:\.git)?$/i);
        if (!match?.[1] || !match[2]) {
            throw new Appexit("Cannot infer create-todo-cli GitHub repository from package.json");
        }
        return `${match[1]}/${match[2]}`;
    }
}
