import { execSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import prompts from "prompts";

type PackageJsonRecord = {
  name?: string;
  packageManager?: string;
  repository?: string | { type?: string; url?: string };
  homepage?: string;
  publishConfig?: Record<string, unknown>;
  scripts?: Record<string, string>;
} & Record<string, unknown>;

type GitRemote = {
  owner: string;
  repo: string;
};

type PublishTask = "npmjs" | "github-packages" | "github-prelease" | "manual-npmjs";

type PublishYmlContext = {
  packageName: string;
  targetPath: string;
  workingDirectory?: string;
  githubOwner?: string;
};

type PublishYmlResult = {
  files: string[];
  tasks: PublishTask[];
};

class PublishYml {
  public async createCurrent(startPath = process.cwd()): Promise<PublishYmlResult | undefined> {
    const targetPath = this.packageRootFind(startPath);
    const pkg = this.readJsonFile<PackageJsonRecord>(path.join(targetPath, "package.json")) ?? {};
    const packageName = String(pkg.name ?? path.basename(targetPath));
    const result = await this.createForProject({
      packageName,
      targetPath,
      githubOwner: this.githubRemoteGet(targetPath)?.owner ?? this.githubOwnerFromPackage(pkg),
    });

    if (result) {
      console.log(`已写入发布配置: ${result.files.map(filePath => path.resolve(filePath)).join(", ")}`);
    }
    return result;
  }

  public async createForProject(context: PublishYmlContext): Promise<PublishYmlResult | undefined> {
    const tasks = await this.tasksAsk(context);
    if (tasks.length === 0) {
      console.log("跳过发布配置");
      return undefined;
    }

    const files = new Set<string>();
    for (const task of tasks) {
      for (const filePath of this.taskSet(task, context)) {
        files.add(filePath);
      }
    }

    return { files: [...files], tasks };
  }

  private taskSet(task: PublishTask, context: PublishYmlContext): string[] {
    switch (task) {
      case "npmjs":
        return this.npmjsSet(context);
      case "github-packages":
        return this.githubPackagesSet(context);
      case "github-prelease":
        return this.githubPreleaseSet(context);
      case "manual-npmjs":
        return this.manualNpmjsSet(context);
      default:
        return [];
    }
  }

  private async tasksAsk(context: PublishYmlContext): Promise<PublishTask[]> {
    const hasExternalWorkspace = this.hasExternalWorkspace(context.targetPath);
    const response = await prompts({
      type: "multiselect",
      name: "tasks",
      message: "请选择要添加/覆盖的发布任务",
      choices: [
        { title: "publish.yml job: npmjs 发布", value: "npmjs" },
        { title: "publish.yml job: GitHub Packages 发布", value: "github-packages" },
        {
          title: hasExternalWorkspace
            ? "publish.yml job: GitHub prelease"
            : "publish.yml job: GitHub prelease（需要 pnpm-workspace.yaml 存在 ../ 外部包）",
          value: "github-prelease",
          disabled: !hasExternalWorkspace,
        },
        { title: "package.json script: 手动 npmjs 发布", value: "manual-npmjs" },
      ],
      hint: "- Space 选择，Enter 确认",
      instructions: false,
    });

    if (!response.tasks) {
      throw new Error("user-cancelled");
    }
    return response.tasks;
  }

  private npmjsSet(context: PublishYmlContext): string[] {
    const packageJsonPath = path.join(context.targetPath, "package.json");
    const pkg = this.readJsonFile<PackageJsonRecord>(packageJsonPath) ?? {};
    pkg.publishConfig = {
      ...(pkg.publishConfig ?? {}),
      access: pkg.publishConfig?.access ?? "public",
    };
    this.writeJsonFile(packageJsonPath, pkg);

    const workflowPath = this.workflowJobsSet(context, {
      npmjs: this.npmjsJobContent({
        workingDirectory: context.workingDirectory,
        pnpmVersion: this.pnpmVersionGet(context.targetPath),
      }),
    }, ["publish"]);
    console.log("npmjs 发布需要 GitHub Secret: NPM_TOKEN");
    return [packageJsonPath, workflowPath];
  }

  private githubPackagesSet(context: PublishYmlContext): string[] {
    const packageJsonPath = path.join(context.targetPath, "package.json");
    const pkg = this.readJsonFile<PackageJsonRecord>(packageJsonPath) ?? {};
    const scope = this.githubScopeGet(context, pkg);
    const files: string[] = [];

    if (!String(pkg.name ?? "").startsWith("@")) {
      pkg.name = `@${scope}/${context.packageName.replace(/^@[^/]+\//, "")}`;
      this.writeJsonFile(packageJsonPath, pkg);
      files.push(packageJsonPath);
    }

    const npmrcPath = path.join(context.targetPath, ".npmrc");
    this.linesFileEnsure(npmrcPath, [`@${scope}:registry=https://npm.pkg.github.com`]);
    files.push(npmrcPath);

    files.push(this.workflowJobsSet(context, {
      github_packages: this.githubPackagesJobContent({
        workingDirectory: context.workingDirectory,
        pnpmVersion: this.pnpmVersionGet(context.targetPath),
      }),
    }));
    console.log("GitHub Packages 发布使用 GitHub Actions GITHUB_TOKEN");
    return files;
  }

  private githubPreleaseSet(context: PublishYmlContext): string[] {
    const workflowPath = this.workflowJobsSet(context, {
      github_prelease: this.githubPreleaseJobContent({
        pnpmVersion: this.pnpmVersionGet(context.targetPath),
      }),
    });
    console.log("GitHub prelease 需要 Actions 具备创建/推送 release 仓库权限");
    return [workflowPath];
  }

  private manualNpmjsSet(context: PublishYmlContext): string[] {
    const packageJsonPath = path.join(context.targetPath, "package.json");
    const pkg = this.readJsonFile<PackageJsonRecord>(packageJsonPath) ?? {};
    pkg.scripts = {
      ...(pkg.scripts ?? {}),
      "publish:npm": "pnpm publish --access public --no-git-checks --provenance",
    };
    pkg.publishConfig = {
      ...(pkg.publishConfig ?? {}),
      access: pkg.publishConfig?.access ?? "public",
    };
    this.writeJsonFile(packageJsonPath, pkg);
    return [packageJsonPath];
  }

  private workflowJobsSet(
    context: PublishYmlContext,
    jobs: Record<string, string>,
    removeAliases: string[] = [],
  ): string {
    const workflowPath = path.join(context.targetPath, ".github", "workflows", "publish.yml");
    const existing = fs.existsSync(workflowPath)
      ? fs.readFileSync(workflowPath, "utf-8")
      : this.workflowBaseContent(context);
    const next = this.workflowJobsUpsert(existing, jobs, removeAliases);

    fs.mkdirSync(path.dirname(workflowPath), { recursive: true });
    fs.writeFileSync(workflowPath, next, "utf-8");
    return workflowPath;
  }

  private workflowBaseContent(context: PublishYmlContext): string {
    return `name: Publish ${context.packageName}

on:
  push:
    branches:
      - master
  workflow_dispatch:

jobs:
`;
  }

  private workflowJobsUpsert(content: string, jobs: Record<string, string>, removeAliases: string[]): string {
    let next = content.replace(/\s+$/, "\n");
    if (!/^jobs:\s*$/m.test(next)) {
      next = `${next}\njobs:\n`;
    }

    for (const jobName of [...Object.keys(jobs), ...removeAliases]) {
      next = this.workflowJobRemove(next, jobName);
    }

    const jobContent = Object.values(jobs)
      .map(job => job.replace(/\s+$/, ""))
      .join("\n\n");
    return `${next.replace(/\s+$/, "")}\n\n${jobContent}\n`;
  }

  private workflowJobRemove(content: string, jobName: string): string {
    const lines = content.split(/\r?\n/);
    const start = lines.findIndex(line => line === `  ${jobName}:`);
    if (start < 0) {
      return content;
    }

    let end = lines.length;
    for (let index = start + 1; index < lines.length; index++) {
      if (/^  [A-Za-z0-9_-]+:\s*$/.test(lines[index])) {
        end = index;
        break;
      }
    }

    lines.splice(start, end - start);
    return `${lines.join("\n").replace(/\s+$/, "")}\n`;
  }

  private npmjsJobContent(config: {
    workingDirectory?: string;
    pnpmVersion: string;
  }): string {
    return `  npmjs:
    runs-on: ubuntu-latest
    permissions:
      contents: read
      id-token: write${this.jobDefaultsContent(config.workingDirectory)}
    steps:
      - uses: actions/checkout@v4
      - uses: pnpm/action-setup@v4
        with:
          version: ${config.pnpmVersion}
      - uses: actions/setup-node@v4
        with:
          node-version: 20
          registry-url: https://registry.npmjs.org
      - run: pnpm install --no-frozen-lockfile
      - run: pnpm run build --if-present
      - run: pnpm publish --access public --no-git-checks --provenance
        env:
          NODE_AUTH_TOKEN: \${{ secrets.NPM_TOKEN }}`;
  }

  private githubPackagesJobContent(config: {
    workingDirectory?: string;
    pnpmVersion: string;
  }): string {
    return `  github_packages:
    runs-on: ubuntu-latest
    permissions:
      contents: read
      packages: write${this.jobDefaultsContent(config.workingDirectory)}
    steps:
      - uses: actions/checkout@v4
      - uses: pnpm/action-setup@v4
        with:
          version: ${config.pnpmVersion}
      - uses: actions/setup-node@v4
        with:
          node-version: 20
          registry-url: https://npm.pkg.github.com
      - run: pnpm install --no-frozen-lockfile
      - run: pnpm run build --if-present
      - run: pnpm publish --no-git-checks
        env:
          NODE_AUTH_TOKEN: \${{ secrets.GITHUB_TOKEN }}`;
  }

  private githubPreleaseJobContent(config: {
    pnpmVersion: string;
  }): string {
    return `  github_prelease:
    runs-on: ubuntu-latest
    permissions:
      contents: write
    steps:
      - uses: actions/checkout@v4
        with:
          fetch-depth: 0
      - uses: pnpm/action-setup@v4
        with:
          version: ${config.pnpmVersion}
      - uses: actions/setup-node@v4
        with:
          node-version: 20
      - run: pnpm install --no-frozen-lockfile
      - run: pnpm dlx github:see7788/create-todo-cli initGithubPkg
        env:
          GH_TOKEN: \${{ secrets.GITHUB_TOKEN }}`;
  }

  private jobDefaultsContent(workingDirectory = "."): string {
    if (!workingDirectory || workingDirectory === ".") {
      return "";
    }
    return `
    defaults:
      run:
        working-directory: ${workingDirectory.replace(/\\/g, "/")}`;
  }

  private githubScopeGet(context: PublishYmlContext, pkg: PackageJsonRecord): string {
    const packageScope = String(pkg.name ?? context.packageName).match(/^@([^/]+)\//)?.[1];
    const githubOwner = context.githubOwner ?? this.githubRemoteGet(context.targetPath)?.owner ?? this.githubOwnerFromPackage(pkg);
    const scope = packageScope ?? githubOwner;
    if (!scope) {
      throw new Error("无法从 package.json 或 git remote 推断 GitHub owner/scope");
    }
    return scope.replace(/^@/, "");
  }

  private githubOwnerFromPackage(pkg: PackageJsonRecord): string | undefined {
    const repositoryUrl = typeof pkg.repository === "string" ? pkg.repository : pkg.repository?.url;
    const value = repositoryUrl ?? pkg.homepage;
    return value?.match(/github\.com[:/]([^/]+)\//i)?.[1];
  }

  private githubRemoteGet(targetPath: string): GitRemote | undefined {
    try {
      const value = execSync("git remote get-url origin", {
        cwd: targetPath,
        encoding: "utf-8",
        stdio: ["ignore", "pipe", "ignore"],
      }).trim();
      const match = value.match(/github\.com[:/]([^/]+)\/(.+?)(?:\.git)?$/i);
      if (!match?.[1] || !match[2]) {
        return undefined;
      }
      return { owner: match[1], repo: match[2] };
    } catch {
      return undefined;
    }
  }

  private hasExternalWorkspace(targetPath: string): boolean {
    const workspacePath = path.join(targetPath, "pnpm-workspace.yaml");
    if (!fs.existsSync(workspacePath)) {
      return false;
    }
    return fs.readFileSync(workspacePath, "utf-8")
      .split(/\r?\n/)
      .some(line => /^\s*-\s*["']?\.\.\//.test(line));
  }

  private pnpmVersionGet(targetPath: string): string {
    const packageJson = this.readJsonFile<PackageJsonRecord>(path.join(targetPath, "package.json"));
    const packageManager = packageJson?.packageManager;
    if (packageManager?.startsWith("pnpm@")) {
      return packageManager.slice("pnpm@".length);
    }
    return "10";
  }

  private readJsonFile<T>(filePath: string): T | undefined {
    if (!fs.existsSync(filePath)) {
      return undefined;
    }
    return JSON.parse(fs.readFileSync(filePath, "utf-8")) as T;
  }

  private packageRootFind(startPath: string): string {
    let dir = path.resolve(startPath);
    while (path.dirname(dir) !== dir) {
      if (fs.existsSync(path.join(dir, "package.json"))) {
        return dir;
      }
      dir = path.dirname(dir);
    }
    throw new Error(`未找到 package.json: ${startPath}`);
  }

  private writeJsonFile(filePath: string, value: PackageJsonRecord): void {
    fs.writeFileSync(filePath, `${JSON.stringify(value, null, 2)}\n`, "utf-8");
  }

  private linesFileEnsure(filePath: string, lines: string[]): void {
    const existing = fs.existsSync(filePath) ? fs.readFileSync(filePath, "utf-8") : "";
    const existingLines = new Set(existing.split(/\r?\n/).map(line => line.trim()).filter(Boolean));
    const missingLines = lines.filter(line => !existingLines.has(line.trim()));
    if (missingLines.length === 0) {
      return;
    }

    const next = [
      existing.replace(/\s*$/, ""),
      ...missingLines,
    ].filter(Boolean).join("\n");
    fs.writeFileSync(filePath, `${next}\n`, "utf-8");
  }
}

export default PublishYml;
