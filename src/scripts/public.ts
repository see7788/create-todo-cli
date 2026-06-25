import type { PackageJson } from 'type-fest';
import path from 'path';
import fs from "fs"
import { execSync, spawn } from 'child_process';
import type prompts from 'prompts';
import Mustache from 'mustache';
import PublishYml from './publishYml.js';

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
    pnpmVersion: string;
    workingDirectory?: string;
};

/** 文件模板集中出口 - 先不接入调用方，只收敛散落的完整文件文本。 */
export class TplBase {
    public package_json_create(packageName: string): string {
        return this.tplRender(`{
  "name": {{{packageNameJson}}},
  "version": "0.0.0",
  "type": "module",
  "main": "./src/index.ts",
  "module": "./src/index.ts",
  "types": "./src/index.ts",
  "exports": {
    ".": {
      "types": "./src/index.ts",
      "import": "./src/index.ts",
      "default": "./src/index.ts"
    }
  },
  "files": [
    "src",
    "README.md"
  ],
  "scripts": {
    "dev": "tsx src/index.ts",
    "build": "tsc --noEmit"
  },
  "devDependencies": {
    "tsx": "^4.20.0",
    "typescript": "^5.8.0"
  }
}
`, {
            packageNameJson: JSON.stringify(packageName),
        });
    }

    public tsconfig_json_create(): string {
        return `{
  "compilerOptions": {
    "target": "ESNext",
    "module": "ESNext",
    "moduleResolution": "Bundler",
    "strict": true,
    "skipLibCheck": true,
    "esModuleInterop": true,
    "resolveJsonModule": true
  },
  "include": [
    "src"
  ]
}
`;
    }

    public index_ts_create(): string {
        return `export {};
`;
    }

    public README_md_create(packageName: string): string {
        return this.tplRender(`# {{{packageName}}}
`, { packageName });
    }

    public pnpm_workspace_yaml_create(): string {
        return `packages:
  - "libs/*"
  - "apps/*"
`;
    }

    public pnpm_workspace_yaml_release_create(packagePaths: string[]): string {
        return `packages:
${packagePaths.map(packagePath => `  - "${packagePath}"`).join("\n")}
`;
    }

    public bin_command_js_create(context: TplBinCommandContext): string {
        return this.tplRender(`#!/usr/bin/env node
import { spawn, spawnSync } from "node:child_process";
import { existsSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const wrapperDir = dirname(fileURLToPath(import.meta.url));
const packageRoot = resolve(wrapperDir, {{{rootRelativePathJson}}});
const entry = resolve(wrapperDir, {{{entryRelativePathJson}}});
const tsx = join(packageRoot, "node_modules", "tsx", "dist", "cli.mjs");
const commandName = {{{commandNameJson}}};
const commandArg = process.argv[2];
const command = commandArg === "dev" || commandArg === "start" || commandArg === "stop" || commandArg === "restart"
  ? commandArg
  : undefined;
const passthroughArgs = command ? process.argv.slice(3) : process.argv.slice(2);

if (!existsSync(tsx)) {
  console.error("缺少 tsx，请先安装依赖");
  process.exit(1);
}

const pathNormalize = (pathValue) => pathValue.toLowerCase().replaceAll("\\\\", "/");
const nodeEnv = command === "dev"
  ? "development"
  : command === "start"
    ? "production"
    : process.env.NODE_ENV;
const shouldWatch = command === "dev" || command === "restart";

const processInfosGet = () => {
  if (process.platform === "win32") {
    const processResult = spawnSync("powershell.exe", [
      "-NoProfile",
      "-Command",
      "Get-CimInstance Win32_Process | Select-Object ProcessId,ParentProcessId,CommandLine | ConvertTo-Json -Compress",
    ], {
      encoding: "utf8",
      windowsHide: true,
    });
    if (processResult.error) throw processResult.error;
    if (processResult.status !== 0) {
      throw new Error(\`Failed to query Windows processes: \${processResult.stderr || processResult.stdout}\`);
    }
    const parsed = JSON.parse(processResult.stdout || "[]");
    return Array.isArray(parsed) ? parsed : [parsed];
  }

  const processResult = spawnSync("ps", ["-eo", "pid=,ppid=,command="], {
    encoding: "utf8",
    windowsHide: true,
  });
  if (processResult.error) throw processResult.error;
  if (processResult.status !== 0) {
    throw new Error(\`Failed to query processes: \${processResult.stderr || processResult.stdout}\`);
  }
  return (processResult.stdout ?? "")
    .split(/\\r?\\n/)
    .filter(Boolean)
    .map((line) => {
      const match = line.trim().match(/^(\\d+)\\s+(\\d+)\\s+(.*)$/);
      if (!match) throw new Error(\`Cannot parse ps output line: \${line}\`);
      return {
        ProcessId: Number(match[1]),
        ParentProcessId: Number(match[2]),
        CommandLine: match[3],
      };
    });
};

const currentProcessIdsGet = (processInfos) => {
  const processMap = new Map(processInfos.map((processInfo) => [
    Number(processInfo.ProcessId),
    Number(processInfo.ParentProcessId),
  ]));
  const currentProcessIds = new Set([process.pid]);
  for (let processId = process.pid; processMap.has(processId);) {
    const parentProcessId = processMap.get(processId);
    if (parentProcessId === undefined || !Number.isInteger(parentProcessId) || currentProcessIds.has(parentProcessId)) break;
    currentProcessIds.add(parentProcessId);
    processId = parentProcessId;
  }
  return currentProcessIds;
};

const devStop = () => {
  const processInfos = processInfosGet();
  const currentProcessIds = currentProcessIdsGet(processInfos);
  const entryPath = pathNormalize(entry);
  const matchedProcesses = processInfos
    .map((processInfo) => ({
      processId: Number(processInfo.ProcessId),
      parentProcessId: Number(processInfo.ParentProcessId),
      commandLine: pathNormalize(String(processInfo.CommandLine ?? "")),
    }))
    .filter(({ processId, commandLine }) => (
      Number.isInteger(processId)
      && !currentProcessIds.has(processId)
      && commandLine.includes(entryPath)
    ));
  const matchedProcessIds = new Set(matchedProcesses.map(({ processId }) => processId));
  const processIds = matchedProcesses
    .filter(({ parentProcessId }) => !matchedProcessIds.has(parentProcessId))
    .map(({ processId }) => processId);

  if (processIds.length === 0) {
    console.log(\`\${commandName} is not running\`);
    return;
  }

  const uniqueProcessIds = [...new Set(processIds)];
  const stopResult = process.platform === "win32"
    ? spawnSync("taskkill", [...uniqueProcessIds.flatMap((processId) => ["/PID", String(processId)]), "/T", "/F"], { stdio: "inherit", windowsHide: true })
    : spawnSync("kill", ["-TERM", ...uniqueProcessIds.map(String)], { stdio: "inherit", windowsHide: true });
  if (stopResult.error) throw stopResult.error;
  if (typeof stopResult.status === "number" && stopResult.status !== 0) {
    throw new Error(\`Failed to stop process ids: \${uniqueProcessIds.join(", ")}\`);
  }
  console.log(\`\${commandName} stopped \${processIds.length} process\${processIds.length === 1 ? "" : "es"}\`);
};

if (command === "stop") {
  devStop();
  process.exit(0);
}
if (command === "restart") devStop();

let isStopping = false;
const devStopAndExit = (exitCode) => {
  if (isStopping) return;
  isStopping = true;
  try {
    devStop();
    process.exit(exitCode);
  } catch (error) {
    console.error(error instanceof Error ? error.message : error);
    process.exit(1);
  }
};

const childArgs = shouldWatch
  ? [tsx, "watch", "--clear-screen=false", entry, ...passthroughArgs]
  : [tsx, entry, ...passthroughArgs];
const child = spawn(process.execPath, childArgs, {
  env: {
    ...process.env,
    ...(nodeEnv ? { NODE_ENV: nodeEnv } : {}),
  },
  stdio: "inherit",
  shell: false,
  windowsHide: true,
});

if (shouldWatch) {
  process.once("SIGINT", () => devStopAndExit(130));
  process.once("SIGTERM", () => devStopAndExit(143));
}

child.once("error", (error) => {
  console.error(error.message);
  process.exit(1);
});

child.once("exit", (code, signal) => {
  if (isStopping) return;
  if (signal) {
    process.kill(process.pid, signal);
    return;
  }
  process.exit(code ?? 0);
});
`, {
            commandNameJson: JSON.stringify(context.commandName),
            entryRelativePathJson: JSON.stringify(context.entryRelativePath),
            rootRelativePathJson: JSON.stringify(context.rootRelativePath),
        });
    }

    public command_shell_create(wrapperPath: string): string {
        return this.tplRender(`#!/usr/bin/env sh
exec node {{{wrapperPathJson}}} "$@"
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
        return this.tplRender(`name: Publish {{{packageName}}}

on:
  push:
    branches:
      - master
  workflow_dispatch:

jobs:
`, { packageName });
    }

    public publish_yml_job_npmjs_create(context: TplPublishJobContext): string {
        return this.tplRender(`  npmjs:
    runs-on: ubuntu-latest
    permissions:
      contents: read
      id-token: write{{{jobDefaultsContent}}}
    steps:
      - uses: actions/checkout@v4
      - uses: pnpm/action-setup@v4
        with:
          version: {{{pnpmVersion}}}
      - uses: actions/setup-node@v4
        with:
          node-version: 20
          registry-url: https://registry.npmjs.org
      - run: pnpm install --no-frozen-lockfile
      - run: pnpm run build --if-present
      - run: pnpm publish --access public --no-git-checks --provenance
        env:
          NODE_AUTH_TOKEN: \${{ secrets.NPM_TOKEN }}`, this.publish_yml_jobView(context));
    }

    public publish_yml_job_github_packages_create(context: TplPublishJobContext): string {
        return this.tplRender(`  github_packages:
    runs-on: ubuntu-latest
    permissions:
      contents: read
      packages: write{{{jobDefaultsContent}}}
    steps:
      - uses: actions/checkout@v4
      - uses: pnpm/action-setup@v4
        with:
          version: {{{pnpmVersion}}}
      - uses: actions/setup-node@v4
        with:
          node-version: 20
          registry-url: https://npm.pkg.github.com
      - run: pnpm install --no-frozen-lockfile
      - run: pnpm run build --if-present
      - run: pnpm publish --no-git-checks
        env:
          NODE_AUTH_TOKEN: \${{ secrets.GITHUB_TOKEN }}`, this.publish_yml_jobView(context));
    }

    public publish_yml_job_github_prelease_create(context: Pick<TplPublishJobContext, "pnpmVersion">): string {
        return this.tplRender(`  github_prelease:
    runs-on: ubuntu-latest
    permissions:
      contents: write
    steps:
      - uses: actions/checkout@v4
        with:
          fetch-depth: 0
      - uses: pnpm/action-setup@v4
        with:
          version: {{{pnpmVersion}}}
      - uses: actions/setup-node@v4
        with:
          node-version: 20
      - run: pnpm install --no-frozen-lockfile
      - run: pnpm dlx github:see7788/create-todo-cli initGithubPkg
        env:
          GH_TOKEN: \${{ secrets.GITHUB_TOKEN }}`, context);
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
            pnpmVersion: context.pnpmVersion,
        };
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
        console.log(`package.json: ${this.pathDisplay(this.packagePath("package.json"))}`);
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
        fs.writeFileSync(filePath, `packages:
  - "libs/*"
  - "apps/*"
`, "utf-8");
    }

    private npmrcSet(): void {
        this.linesFileEnsure(path.join(this.cwdProjectInfo.workspacePath, ".npmrc"), ["store-dir=./.pnpm-store"]);
    }

    protected gitignoreSet(targetPath: string): void {
        this.linesFileEnsure(path.join(targetPath, ".gitignore"), [
            ".pnpm-store/**",
            "**/node_modules/**",
            "**/dist/**",
            "**/**_bak/",
            "**/**.bak",
        ]);
    }

    protected async gitProjectEnsure(targetPath: string, packageName: string): Promise<GitHubRepo | undefined> {
        const normalizedPackageName = this.toPackageName(packageName);
        const projectRepo = this.githubProjectRepoGet(normalizedPackageName);
        if (!projectRepo) {
            console.log("GitHub owner not detected, skip repository creation");
            return undefined;
        }

        if (!fs.existsSync(path.join(targetPath, ".git"))) {
            try {
                await this.commandRunInherit("git init -b master", targetPath, "git init");
            } catch {
                await this.commandRunInherit("git init", targetPath, "git init");
                await this.commandRunInherit("git checkout -B master", targetPath, "git checkout master");
            }
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

    private parseGitHubRepo(value: string | undefined): GitHubRepo | undefined {
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
            const response = await prompts.default({
                type: "text",
                name: "pathValue",
                message: `Please enter ${modeName} path`,
                initial: currentPath,
            });
            if (!response.pathValue) {
                throw new Error("user-cancelled");
            }

            currentPath = path.resolve(String(response.pathValue).trim());
            const exists = fs.existsSync(currentPath);
            const stat = exists ? fs.statSync(currentPath) : undefined;
            const modeMatched = options.mode === "file" ? stat?.isFile() : stat?.isDirectory();
            const extensionMatched = options.mode !== "file"
                || !options.fileExtensions?.length
                || options.fileExtensions.includes(path.extname(currentPath));

            if (!exists || !modeMatched || !extensionMatched) {
                console.error(`Invalid ${modeName} path: ${currentPath}`);
                currentPath = "";
                continue;
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
}
