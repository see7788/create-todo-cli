import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import Mustache from "mustache";
import prompts from "prompts";
import GitBase from "../public/git";

type PackageJsonRecord = {
  name?: string;
  packageManager?: string;
  repository?: string | { type?: string; url?: string };
  homepage?: string;
  publishConfig?: Record<string, unknown>;
  scripts?: Record<string, string>;
} & Record<string, unknown>;

type PublishTask = "npmjs" | "github-packages" | "manual-npmjs";

type GithubPublishYmlContext = {
  packageName: string;
  targetPath: string;
  workingDirectory?: string;
  githubOwner?: string;
};

type GithubPublishYmlResult = {
  files: string[];
  tasks: PublishTask[];
};

const scriptPath = path.dirname(fileURLToPath(import.meta.url));

export class GithubPublishYmlInit extends GitBase {
  constructor() {
    super({ requirePackage: false });
  }

  public async createCurrent(startPath = process.cwd()): Promise<GithubPublishYmlResult | undefined> {
    const targetPath = this.packageRootFind(startPath);
    const pkg = this.readJsonFile<PackageJsonRecord>(path.join(targetPath, "package.json")) ?? {};
    const packageName = String(pkg.name ?? path.basename(targetPath));
    const result = await this.createForProject({
      packageName,
      targetPath,
      githubOwner: this.githubRemoteOptional(targetPath)?.owner ?? this.githubOwnerFromPackage(pkg),
    });

    if (result) {
      console.log(`已写入发布配置: ${result.files.map(filePath => path.resolve(filePath)).join(", ")}`);
    }
    return result;
  }

  public async createForProject(context: GithubPublishYmlContext): Promise<GithubPublishYmlResult | undefined> {
    const tasks = await this.tasksAsk();
    if (tasks.length === 0) {
      console.log("跳过发布配置");
      return undefined;
    }

    await this.targetPathsConfirm(this.taskTargetFiles(tasks, context));
    const files = new Set<string>();
    for (const task of tasks) {
      for (const filePath of this.taskSet(task, context)) {
        files.add(filePath);
      }
    }

    return { files: [...files], tasks };
  }

  private taskTargetFiles(tasks: PublishTask[], context: GithubPublishYmlContext): string[] {
    const files = new Set<string>();
    for (const task of tasks) {
      if (task === "npmjs" || task === "manual-npmjs" || task === "github-packages") {
        files.add(path.join(context.targetPath, "package.json"));
      }
      if (task === "npmjs" || task === "github-packages") {
        files.add(path.join(context.targetPath, ".github", "workflows", "publish.yml"));
      }
      if (task === "github-packages") {
        files.add(path.join(context.targetPath, ".npmrc"));
      }
    }
    return [...files];
  }

  private taskSet(task: PublishTask, context: GithubPublishYmlContext): string[] {
    switch (task) {
      case "npmjs":
        return this.npmjsSet(context);
      case "github-packages":
        return this.githubPackagesSet(context);
      case "manual-npmjs":
        return this.manualNpmjsSet(context);
      default:
        return [];
    }
  }

  private async tasksAsk(): Promise<PublishTask[]> {
    const response = await prompts({
      type: "multiselect",
      name: "tasks",
      message: "请选择要添加/覆盖的发布任务",
      choices: [
        { title: "publish.yml job: npmjs 发布", value: "npmjs" },
        { title: "publish.yml job: GitHub Packages 发布", value: "github-packages" },
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

  private npmjsSet(context: GithubPublishYmlContext): string[] {
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

  private githubPackagesSet(context: GithubPublishYmlContext): string[] {
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
    this.publishLinesFileEnsure(npmrcPath, [`@${scope}:registry=https://npm.pkg.github.com`]);
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

  private manualNpmjsSet(context: GithubPublishYmlContext): string[] {
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
    context: GithubPublishYmlContext,
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

  private workflowBaseContent(context: GithubPublishYmlContext): string {
    return this.templateRender("publish.yml", { packageName: context.packageName });
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
    return this.templateRender("publish-job-npmjs.yml", this.publishJobView(config));
  }

  private githubPackagesJobContent(config: {
    workingDirectory?: string;
    pnpmVersion: string;
  }): string {
    return this.templateRender("publish-job-github-packages.yml", this.publishJobView(config));
  }

  private publishJobView(config: {
    workingDirectory?: string;
    pnpmVersion: string;
  }): Record<string, string> {
    return {
      jobDefaultsContent: this.publishJobDefaultsContent(config.workingDirectory),
      githubToken: "{{ secrets.GITHUB_TOKEN }}",
      npmToken: "{{ secrets.NPM_TOKEN }}",
      pnpmVersion: config.pnpmVersion,
    };
  }

  private publishJobDefaultsContent(workingDirectory = "."): string {
    if (!workingDirectory || workingDirectory === ".") {
      return "";
    }
    return `
    defaults:
      run:
        working-directory: ${workingDirectory.replace(/\\/g, "/")}`;
  }

  private templateRender(name: string, view: Record<string, unknown>): string {
    return Mustache.render(fs.readFileSync(path.join(scriptPath, name), "utf-8"), view);
  }

  private githubScopeGet(context: GithubPublishYmlContext, pkg: PackageJsonRecord): string {
    const packageScope = String(pkg.name ?? context.packageName).match(/^@([^/]+)\//)?.[1];
    const githubOwner = context.githubOwner ?? this.githubRemoteOptional(context.targetPath)?.owner ?? this.githubOwnerFromPackage(pkg);
    const scope = packageScope ?? githubOwner;
    if (!scope) {
      throw new Error("无法从 package.json 或 git remote 推断 GitHub owner/scope");
    }
    return scope.replace(/^@/, "");
  }

  private pnpmVersionGet(targetPath: string): string {
    const packageJson = this.readJsonFile<PackageJsonRecord>(path.join(targetPath, "package.json"));
    const packageManager = packageJson?.packageManager;
    if (packageManager?.startsWith("pnpm@")) {
      return packageManager.slice("pnpm@".length);
    }
    return "10";
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

  private publishLinesFileEnsure(filePath: string, lines: string[]): void {
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

class GithubScript {
  public readonly menu = {
    "githubScript/githubPublishYmlInit  init publish.yml set": this.githubPublishYmlInit,
  } as const;

  public readonly command = {
    githubPublishYmlInit: this.githubPublishYmlInit,
  } as const;

  private async githubPublishYmlInit(): Promise<void> {
    await new GithubPublishYmlInit().createCurrent();
  }
}

export const githubScript = new GithubScript();

export default githubScript;
