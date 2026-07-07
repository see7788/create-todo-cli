import { existsSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { basename, dirname, join, resolve } from "node:path";
import prompts from "prompts";
import { Appexit } from "../base";
import GitBase from "../git";
import PnpmBase from "../pnpm";

type PlatformPushMode = "current" | "siblings";

export default class GitPush extends GitBase {
  private projectRoot!: string;

  constructor() {
    super({ requirePackage: false });
  }

  public async task1(): Promise<void> {
    this.projectRoot = this.projectRootFind();
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
    const projectRepo = await this.repoEnsure(targetPath, repoName);
    if (!projectRepo) {
      throw new Appexit("无法推断 GitHub owner，无法初始化 GitHub 仓库");
    }

    await this.gitignoreInit(targetPath);
    await new PnpmBase({ requirePackage: false }).workspaceInit(targetPath);
    await this.platformPathFileSet(targetPath);
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

  private async platformPathFileSet(targetPath: string): Promise<void> {
    const filePath = join(targetPath, "path.md");
    await this.targetPathsConfirm([filePath]);
    writeFileSync(filePath, `${this.pathDisplay(targetPath)}\n`, "utf-8");
  }

  private async platformGitEnsureInitialCommit(targetPath: string): Promise<void> {
    if (this.commandReadOptional("git rev-parse --verify HEAD", targetPath)) {
      return;
    }

    await this.commandRunInherit("git add -A", targetPath, "git add");
    try {
      await this.commandRunInherit(`git commit -m ${this.shellArg("chore: initial commit")}`, targetPath, "git commit");
      console.log(`已创建初始提交: ${this.pathDisplay(targetPath)}`);
    } catch (error) {
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
      throw error;
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

}
