import { existsSync, readdirSync, readFileSync } from "node:fs";
import { basename, dirname, join, resolve } from "node:path";
import prompts from "prompts";
import GitBase, { Appexit, type GitRemote } from "../public/git";

type PlatformPushMode = "current" | "siblings";

export default class GitPush extends GitBase {
  private projectRoot!: string;
  private projectRepoName!: string;
  private platformGithubLoginCache?: string;

  constructor() {
    super({ requirePackage: false });
  }

  public async task1(): Promise<void> {
    this.projectRoot = this.projectRootFind();
    this.projectRepoName = basename(this.projectRoot);
    await this.platformProjectPush();
  }

  private async platformProjectPush(): Promise<void> {
    const mode = await this.platformPushModeSelect();
    if (mode === "siblings") {
      await this.platformSiblingProjectsPush();
      return;
    }

    await this.platformProjectPushTarget(this.projectRoot);
  }

  private async platformPushModeSelect(): Promise<PlatformPushMode> {
    if (!this.platformSiblingPaths().length) {
      return "current";
    }

    const response = await prompts({
      type: "select",
      name: "mode",
      message: "选择平台项目 Git push 分支",
      choices: [
        { title: "git push", value: "current" },
        { title: "git push for 兄弟目录", value: "siblings" },
      ],
      initial: 0,
    });
    if (!response.mode) {
      throw new Error("user-cancelled");
    }
    return response.mode as PlatformPushMode;
  }

  private async platformSiblingProjectsPush(): Promise<void> {
    const siblings = this.platformSiblingPaths();
    if (siblings.length === 0) {
      return;
    }

    console.log(`Run gitPush for 兄弟目录: ${siblings.length}`);
    const failed: string[] = [];
    for (const [index, siblingPath] of siblings.entries()) {
      const progress = `[${index + 1}/${siblings.length}]`;
      try {
        console.log(`\n${progress} gitPush: ${this.pathDisplay(siblingPath)}`);
        await this.platformProjectPushTarget(siblingPath);
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        failed.push(`${this.pathDisplay(siblingPath)}: ${message}`);
        console.error(`${progress} skip after failure: ${this.pathDisplay(siblingPath)}`);
        console.error(message);
      }
    }

    if (failed.length) {
      console.error(`gitPush sibling failures: ${failed.length}`);
      for (const item of failed) {
        console.error(`- ${item}`);
      }
    }
  }

  private platformSiblingPaths(): string[] {
    const currentPath = resolve(this.projectRoot);
    const parentPath = dirname(currentPath);
    return readdirSync(parentPath, { withFileTypes: true })
      .filter(item => item.isDirectory())
      .filter(item => !item.name.startsWith("."))
      .filter(item => !["node_modules", "dist"].includes(item.name))
      .map(item => join(parentPath, item.name))
      .filter(itemPath => resolve(itemPath) !== currentPath);
  }

  private async platformProjectPushTarget(targetPath: string): Promise<void> {
    console.log(`GitHub 提交源路径: ${this.pathDisplay(targetPath)}`);
    const repoName = this.projectRepoNameGet(targetPath);
    const projectRepo = this.platformGithubProjectRepoGet(repoName, targetPath);
    if (!projectRepo) {
      throw new Appexit("无法推断 GitHub owner，无法初始化 GitHub 仓库");
    }

    await this.platformGitProjectEnsure(targetPath, repoName);
    await this.gitProjectFilesPrepare(targetPath);
    await this.platformGitEnsureInitialCommit(targetPath);
    await this.platformGitPushHead(targetPath);

    console.log(`GitHub repo initialized and pushed: https://github.com/${projectRepo.owner}/${projectRepo.repo}`);
  }

  private projectRootFind(startPath = process.cwd()): string {
    let dir = resolve(startPath);
    while (dirname(dir) !== dir) {
      if (existsSync(join(dir, ".git"))) {
        return dir;
      }
      dir = dirname(dir);
    }
    return resolve(startPath);
  }

  private packageNameRead(packageRoot: string): string {
    const pkg = JSON.parse(readFileSync(join(packageRoot, "package.json"), "utf-8")) as { name?: string };
    return String(pkg.name ?? basename(packageRoot));
  }

  private projectRepoNameGet(projectRoot: string): string {
    if (existsSync(join(projectRoot, "package.json"))) {
      return this.packageNameRead(projectRoot);
    }
    return basename(projectRoot);
  }

  private async platformGitProjectEnsure(targetPath: string, repoName: string): Promise<GitRemote | undefined> {
    const projectRepo = this.platformGithubProjectRepoGet(repoName, targetPath);
    if (!projectRepo) {
      console.log("GitHub owner not detected, skip repository creation");
      return undefined;
    }

    if (!existsSync(join(targetPath, ".git"))) {
      await this.commandRunInherit("git init -b master", targetPath, "git init");
      console.log(`已初始化 git 仓库: ${this.pathDisplay(targetPath)}`);
    }

    const targetUrl = `https://github.com/${projectRepo.owner}/${projectRepo.repo}.git`;
    if (this.platformGithubRepoExists(projectRepo, targetPath)) {
      console.log(`GitHub repository exists, bind to ${projectRepo.owner}/${projectRepo.repo}`);
    } else {
      const visibilityResponse = await prompts({
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
      await this.commandRunInherit(
        `gh repo create ${this.shellArg(`${projectRepo.owner}/${projectRepo.repo}`)} --${visibility} --clone=false`,
        targetPath,
        `gh repo create ${projectRepo.owner}/${projectRepo.repo}`,
      );
      console.log(`Created GitHub ${visibility} repository: ${projectRepo.owner}/${projectRepo.repo}`);
    }

    const currentUrl = this.commandReadOptional("git config --get remote.origin.url", targetPath);
    if (currentUrl === targetUrl) {
      return projectRepo;
    }
    if (currentUrl) {
      await this.commandRunInherit(`git remote set-url origin ${this.shellArg(targetUrl)}`, targetPath, "git remote set-url");
    } else {
      await this.commandRunInherit(`git remote add origin ${this.shellArg(targetUrl)}`, targetPath, "git remote add");
    }
    console.log(`已设置 origin: ${targetUrl}`);
    return projectRepo;
  }

  private async platformGitEnsureInitialCommit(targetPath: string): Promise<void> {
    if (this.commandReadOptional("git rev-parse --verify HEAD", targetPath)) {
      return;
    }

    await this.commandRunInherit("git add -A", targetPath, "git add");
    try {
      await this.commandRunInherit(`git commit -m ${this.shellArg("chore: initial commit")}`, targetPath, "git commit");
      console.log(`已创建初始提交: ${this.pathDisplay(targetPath)}`);
    } catch {
      const status = this.commandReadOptional("git status --porcelain", targetPath);
      if (!status) {
        await this.commandRunInherit(
          `git commit --allow-empty -m ${this.shellArg("chore: initial commit")}`,
          targetPath,
          "git commit --allow-empty",
        );
        console.log(`工作区无更改，已创建空提交: ${this.pathDisplay(targetPath)}`);
        return;
      }
      throw new Appexit("创建初始提交失败");
    }
  }

  private async platformGitPushHead(targetPath: string): Promise<void> {
    console.log(`GitHub push 源路径: ${this.pathDisplay(targetPath)}`);
    await this.commandRunInherit(
      `git -c credential.helper= -c credential.helper="!gh auth git-credential" push -u origin HEAD`,
      targetPath,
      "git push",
    );
  }

  private platformGithubRepoExists(repo: GitRemote, cwd: string): boolean {
    return this.commandOk(`gh repo view ${this.shellArg(`${repo.owner}/${repo.repo}`)}`, cwd);
  }

  private platformGithubProjectRepoGet(repoName: string, cwd: string): GitRemote | undefined {
    const normalizedRepo = this.platformGithubRepositoryNameGet(repoName);
    const currentRepo = this.platformCurrentGitHubRepoGet(cwd);
    const owner = currentRepo?.owner ?? this.platformGithubLoginGet(cwd);
    if (!owner) {
      return undefined;
    }
    return { owner, repo: normalizedRepo };
  }

  private platformCurrentGitHubRepoGet(cwd: string): GitRemote | undefined {
    const remote = this.commandReadOptional("git config --get remote.origin.url", cwd);
    return this.githubRemoteParse(remote);
  }

  private platformGithubLoginGet(cwd: string): string | undefined {
    if (this.platformGithubLoginCache) {
      return this.platformGithubLoginCache;
    }
    this.platformGithubLoginCache = this.commandReadOptional("gh api user --jq .login", cwd);
    return this.platformGithubLoginCache;
  }

  private platformGithubRepositoryNameGet(repoName: string): string {
    return repoName
      .replace(/^@/, "")
      .replace(/[\\/]+/g, "-")
      .replace(/[^a-zA-Z0-9._-]+/g, "-");
  }

}
