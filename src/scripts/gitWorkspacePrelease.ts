import { execSync } from "node:child_process";
import {
  copyFileSync,
  existsSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  rmSync,
  statSync,
  writeFileSync,
} from "node:fs";
import { basename, dirname, isAbsolute, join, relative, resolve } from "node:path";
import prompts from "prompts";
import LibBase, { Appexit } from "./tool.js";

type GitRemote = {
  owner: string;
  repo: string;
};

type WorkspacePlan = {
  internalPackages: string[];
  externalPackages: string[];
};

class GitWorkspacePrelease extends LibBase {
  private readonly projectRoot = this.workspaceRootFind();
  private readonly packageName = this.projectPackageNameRead();
  private readonly releaseRepoName = `${this.releaseNamePart(this.packageName)}_release`;
  private readonly releaseRoot = resolve(dirname(this.projectRoot), this.releaseRepoName);

  public async task1(): Promise<void> {
    const workspacePlan = this.workspacePlanRead();
    if (workspacePlan.externalPackages.length === 0) {
      throw new Appexit("pnpm-workspace.yaml 中没有 ../ 开头的外部 workspace 包");
    }

    const sourceRemote = this.sourceRemoteRead();
    this.sourceRepoCommitIfDirty();
    await this.githubReleaseRepoEnsure(sourceRemote);
    this.releaseRepoLocalEnsure(sourceRemote);
    this.releaseRootReset();
    this.projectFilesCopy(this.projectRoot, this.releaseRoot);
    this.externalPackagesCopy(workspacePlan.externalPackages);
    this.releaseWorkspaceWrite(workspacePlan);
    this.releaseLockfileRefresh();
    this.releaseRepoCommitAndPush();

    console.log(`git workspace prelease 完成: ${sourceRemote.owner}/${this.releaseRepoName}`);
    console.log(`本地 release 目录: ${this.pathDisplay(this.releaseRoot)}`);
  }

  private workspacePlanRead(): WorkspacePlan {
    const workspacePath = join(this.projectRoot, "pnpm-workspace.yaml");
    if (!existsSync(workspacePath)) {
      throw new Appexit(`不存在 pnpm-workspace.yaml: ${workspacePath}`);
    }

    const packages = this.workspacePackagesParse(readFileSync(workspacePath, "utf-8"));
    return {
      internalPackages: packages.filter(item => !item.startsWith("../")),
      externalPackages: packages.filter(item => item.startsWith("../")),
    };
  }

  private workspaceRootFind(): string {
    let dir = process.cwd();
    while (dirname(dir) !== dir) {
      if (existsSync(join(dir, "pnpm-workspace.yaml"))) {
        return dir;
      }
      dir = dirname(dir);
    }
    throw new Appexit("当前 cwd 不在 pnpm workspace 内，未找到 pnpm-workspace.yaml");
  }

  private projectPackageNameRead(): string {
    const packageJsonPath = join(this.projectRoot, "package.json");
    if (!existsSync(packageJsonPath)) {
      return basename(this.projectRoot);
    }

    const pkg = JSON.parse(readFileSync(packageJsonPath, "utf-8")) as { name?: string };
    return String(pkg.name ?? basename(this.projectRoot));
  }

  private workspacePackagesParse(text: string): string[] {
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

  private sourceRemoteRead(): GitRemote {
    const url = this.commandRead("git remote get-url origin", this.projectRoot);
    const remote = this.gitRemoteParse(url);
    if (!remote) {
      throw new Appexit(`无法解析 origin: ${url}`);
    }
    return remote;
  }

  private sourceRepoCommitIfDirty(): void {
    const status = this.commandRead("git status --porcelain", this.projectRoot);
    if (!status) {
      console.log("源仓库没有变更，跳过提交");
      return;
    }

    this.commandRun("git add -A", this.projectRoot);
    this.commandRun(`git commit -m ${this.shellArg("release: snapshot source workspace")}`, this.projectRoot);
    this.commandRun("git push", this.projectRoot);
    console.log("源仓库已提交，继续执行 release");
  }

  private gitRemoteParse(url: string): GitRemote | undefined {
    const httpsMatch = url.match(/^https:\/\/github\.com\/([^/]+)\/(.+?)(?:\.git)?$/);
    if (httpsMatch?.[1] && httpsMatch[2]) {
      return { owner: httpsMatch[1], repo: httpsMatch[2] };
    }

    const sshMatch = url.match(/^git@github\.com:([^/]+)\/(.+?)(?:\.git)?$/);
    if (sshMatch?.[1] && sshMatch[2]) {
      return { owner: sshMatch[1], repo: sshMatch[2] };
    }

    return undefined;
  }

  private async githubReleaseRepoEnsure(sourceRemote: GitRemote): Promise<void> {
    if (!this.commandOk(`gh repo view ${this.shellArg(`${sourceRemote.owner}/${this.releaseRepoName}`)}`, this.projectRoot)) {
      const enabled = await prompts({
        type: "confirm",
        name: "value",
        message: `GitHub 仓库 ${sourceRemote.owner}/${this.releaseRepoName} 不存在，是否创建？`,
        initial: true,
      });
      if (enabled.value === undefined) {
        throw new Error("user-cancelled");
      }
      if (!enabled.value) {
        throw new Appexit(`缺少 GitHub release 仓库: ${sourceRemote.owner}/${this.releaseRepoName}`);
      }

      const visibility = await prompts({
        type: "select",
        name: "value",
        message: "请选择 release 仓库可见性",
        choices: [
          { title: "private", value: "private" },
          { title: "public", value: "public" },
        ],
        initial: 0,
      });
      if (!visibility.value) {
        throw new Error("user-cancelled");
      }

      this.commandRun(
        `gh repo create ${this.shellArg(`${sourceRemote.owner}/${this.releaseRepoName}`)} --${visibility.value} --clone=false`,
        this.projectRoot,
      );
    }
  }

  private releaseRepoLocalEnsure(sourceRemote: GitRemote): void {
    const remoteUrl = `https://github.com/${sourceRemote.owner}/${this.releaseRepoName}.git`;
    if (!existsSync(this.releaseRoot)) {
      this.commandRun(`git clone ${this.shellArg(remoteUrl)} ${this.shellArg(this.releaseRoot)}`, dirname(this.projectRoot));
      return;
    }

    if (!existsSync(join(this.releaseRoot, ".git"))) {
      throw new Appexit(`release 目录已存在但不是 Git 仓库: ${this.releaseRoot}`);
    }

    const origin = this.commandRead("git remote get-url origin", this.releaseRoot);
    if (origin !== remoteUrl) {
      this.commandRun(`git remote set-url origin ${this.shellArg(remoteUrl)}`, this.releaseRoot);
    }
  }

  private releaseRootReset(): void {
    const source = resolve(this.projectRoot);
    const target = resolve(this.releaseRoot);
    if (source === target || source.startsWith(`${target}\\`) || target.startsWith(`${source}\\`)) {
      throw new Appexit("release 目录不能与源项目互相包含");
    }

    for (const name of readdirSync(this.releaseRoot)) {
      if (name === ".git") {
        continue;
      }
      rmSync(join(this.releaseRoot, name), { recursive: true, force: true });
    }
  }

  private projectFilesCopy(sourceRoot: string, targetRoot: string): void {
    for (const file of this.gitVisibleFiles(sourceRoot)) {
      this.fileCopy(join(sourceRoot, file), join(targetRoot, file));
    }
  }

  private externalPackagesCopy(externalPackages: string[]): void {
    for (const packagePath of externalPackages) {
      const sourceRoot = resolve(this.projectRoot, packagePath);
      if (!existsSync(join(sourceRoot, "package.json"))) {
        throw new Appexit(`外部 workspace 包不存在或缺少 package.json: ${sourceRoot}`);
      }

      const targetRoot = join(this.releaseRoot, "extends", basename(sourceRoot));
      for (const file of this.packageVisibleFiles(sourceRoot)) {
        this.fileCopy(join(sourceRoot, file), join(targetRoot, file));
      }
    }
  }

  private releaseWorkspaceWrite(workspacePlan: WorkspacePlan): void {
    const packages = Array.from(new Set([...workspacePlan.internalPackages, "extends/*"]));
    writeFileSync(
      join(this.releaseRoot, "pnpm-workspace.yaml"),
      `packages:\n${packages.map(item => `  - "${item}"`).join("\n")}\n`,
      "utf-8",
    );
  }

  private releaseLockfileRefresh(): void {
    this.commandRun("pnpm install --lockfile-only", this.releaseRoot);
  }

  private releaseRepoCommitAndPush(): void {
    this.commandRun("git checkout -B main", this.releaseRoot);
    this.commandRun("git add -A", this.releaseRoot);

    if (!this.commandRead("git status --porcelain", this.releaseRoot)) {
      console.log("release 仓库没有变更，跳过提交");
      this.commandRun("git push -u origin main", this.releaseRoot);
      return;
    }

    this.commandRun(`git commit -m ${this.shellArg("release: sync pnpm workspace snapshot")}`, this.releaseRoot);
    this.commandRun("git push -u origin main", this.releaseRoot);
  }

  private gitVisibleFiles(root: string): string[] {
    return this.commandRead("git ls-files -co --exclude-standard", root)
      .split(/\r?\n/)
      .map(item => item.trim())
      .filter(Boolean)
      .filter(file => !this.shouldSkipReleaseFile(file));
  }

  private packageVisibleFiles(root: string): string[] {
    if (existsSync(join(root, ".git"))) {
      return this.gitVisibleFiles(root);
    }
    return this.directoryFiles(root, root).filter(file => !this.shouldSkipReleaseFile(file));
  }

  private directoryFiles(root: string, current: string): string[] {
    const files: string[] = [];
    for (const name of readdirSync(current)) {
      if (this.shouldSkipReleaseFile(name)) {
        continue;
      }

      const file = join(current, name);
      if (statSync(file).isDirectory()) {
        files.push(...this.directoryFiles(root, file));
      } else {
        files.push(relative(root, file).replace(/\\/g, "/"));
      }
    }
    return files;
  }

  private shouldSkipReleaseFile(file: string): boolean {
    const parts = file.replace(/\\/g, "/").split("/");
    return parts.some(part => [".git", "node_modules", ".pnpm-store"].includes(part));
  }

  private fileCopy(source: string, target: string): void {
    mkdirSync(dirname(target), { recursive: true });
    copyFileSync(source, target);
  }

  private releaseNamePart(name: string): string {
    return name.replace(/^@/, "").replace(/[\\/]+/g, "-").replace(/[^a-zA-Z0-9._-]+/g, "-");
  }

  private commandOk(command: string, cwd: string): boolean {
    try {
      execSync(command, { cwd, stdio: "ignore" });
      return true;
    } catch {
      return false;
    }
  }

  private commandRead(command: string, cwd: string): string {
    try {
      return execSync(command, { cwd, encoding: "utf-8", stdio: ["ignore", "pipe", "pipe"] }).trim();
    } catch {
      throw new Appexit(`命令执行失败: ${command}`);
    }
  }

  private commandRun(command: string, cwd: string): void {
    try {
      execSync(command, { cwd, stdio: "inherit" });
    } catch {
      throw new Appexit(`命令执行失败: ${command}`);
    }
  }
}

export default GitWorkspacePrelease;
