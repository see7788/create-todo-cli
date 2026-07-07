import fs from "fs";
import path from "path";
import prompts from "prompts";
import LibBase, { Appexit, type PackageJsonRecord } from "./base";
import FileTplCore from "./fileTpl";

export { Appexit } from "./base";

export type GitRemote = {
  owner: string;
  repo: string;
};

export default class GitBase extends LibBase {
  private readonly githubLoginCache = new Map<string, string | undefined>();

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

  public async gitignoreInit(targetPath = this.cwdProjectInfo.workspacePath): Promise<void> {
    const filePath = path.join(targetPath, ".gitignore");
    await this.targetPathsConfirm([filePath]);
    this.gitignoreSet(targetPath);
    console.log(`.gitignore 已初始化: ${this.pathDisplay(filePath)}`);
  }

  public async repoEnsure(targetPath: string, repoName: string): Promise<GitRemote | undefined> {
    const projectRepo = this.githubProjectRepoGet(repoName, targetPath);
    if (!projectRepo) {
      console.log("GitHub owner not detected, skip repository creation");
      return undefined;
    }

    if (!fs.existsSync(path.join(targetPath, ".git"))) {
      await this.commandRunInherit("git init -b master", targetPath, "git init");
      console.log(`已初始化 git 仓库: ${this.pathDisplay(targetPath)}`);
    }

    if (this.githubRepoExists(projectRepo, targetPath)) {
      console.log(`GitHub repository exists, bind to ${projectRepo.owner}/${projectRepo.repo}`);
    } else {
      const response = await prompts({
        type: "select",
        name: "visibility",
        message: `GitHub repository ${projectRepo.owner}/${projectRepo.repo} does not exist. Create as:`,
        choices: [
          { title: "public", value: "public" },
          { title: "private", value: "private" },
        ],
        initial: 0,
      });
      if (!response.visibility) {
        throw new Error("user-cancelled");
      }
      await this.commandRunInherit(
        `gh repo create ${this.shellArg(`${projectRepo.owner}/${projectRepo.repo}`)} --${response.visibility} --clone=false`,
        targetPath,
        `gh repo create ${projectRepo.owner}/${projectRepo.repo}`,
      );
      console.log(`Created GitHub ${response.visibility} repository: ${projectRepo.owner}/${projectRepo.repo}`);
    }

    await this.githubOriginRemoteEnsure(targetPath, projectRepo);
    return projectRepo;
  }

  protected parentGitRootFind(targetPath: string): string | undefined {
    const targetRoot = path.resolve(targetPath);
    const parentRoot = path.dirname(targetRoot);
    const gitRoot = GitBase.gitRootFind(parentRoot);
    return gitRoot && !GitBase.pathEqual(gitRoot, targetRoot) ? gitRoot : undefined;
  }

  protected gitignoreSet(targetPath: string): void {
    this.linesFileEnsure(path.join(targetPath, ".gitignore"), new FileTplCore().gitGitignoreLines());
  }

  protected githubRemoteParse(value: string | undefined): GitRemote | undefined {
    const match = value?.match(/github\.com[:/]([^/]+)\/(.+?)(?:\.git)?$/i);
    if (!match?.[1] || !match[2]) {
      return undefined;
    }
    return { owner: match[1], repo: match[2] };
  }

  protected githubRemoteOptional(cwd = process.cwd()): GitRemote | undefined {
    const remote = this.commandReadOptional("git remote get-url origin", cwd);
    return this.githubRemoteParse(remote);
  }

  protected githubRemoteRead(cwd = process.cwd()): GitRemote {
    const remote = this.commandRead("git remote get-url origin", cwd);
    const parsedRemote = this.githubRemoteParse(remote);
    if (!parsedRemote) {
      throw new Appexit(`无法解析 origin: ${remote}`);
    }
    return parsedRemote;
  }

  protected githubOwnerFromPackage(pkg: PackageJsonRecord): string | undefined {
    const repositoryUrl = this.repositoryUrlGet(pkg);
    const value = repositoryUrl ?? pkg.homepage;
    return this.githubRemoteParse(value)?.owner;
  }

  protected githubProjectRepoGet(packageName: string, cwd = this.cwdProjectInfo.pkgPath): GitRemote | undefined {
    const currentRepo = this.currentGitHubRepoGet(cwd);
    const owner = currentRepo?.owner ?? this.githubLoginGet(cwd);
    if (!owner) {
      return undefined;
    }
    return {
      owner,
      repo: this.githubRepositoryNameGet(packageName),
    };
  }

  protected githubRepositoryNameGet(packageName: string): string {
    return packageName
      .replace(/^@/, "")
      .replace(/[\\/]+/g, "-")
      .replace(/[^a-zA-Z0-9._-]+/g, "-");
  }

  protected repositoryUrlGet(pkg: PackageJsonRecord): string | undefined {
    if (typeof pkg.repository === "string") {
      return pkg.repository;
    }
    return pkg.repository?.url;
  }

  protected gitConfigGet(key: string, cwd = process.cwd()): string | undefined {
    return this.commandReadOptional(`git config --get ${key}`, cwd);
  }

  private githubRepoExists(repo: GitRemote, cwd: string): boolean {
    console.log(`check GitHub repository: ${repo.owner}/${repo.repo}`);
    return this.commandOk(`gh repo view ${this.shellArg(`${repo.owner}/${repo.repo}`)}`, cwd);
  }

  private async githubOriginRemoteEnsure(targetPath: string, projectRepo: GitRemote): Promise<void> {
    const targetUrl = `https://github.com/${projectRepo.owner}/${projectRepo.repo}.git`;
    const currentUrl = this.commandReadOptional("git config --get remote.origin.url", targetPath);
    if (currentUrl === targetUrl) {
      return;
    }

    if (currentUrl) {
      await this.commandRunInherit(`git remote set-url origin ${this.shellArg(targetUrl)}`, targetPath, "git remote set-url");
    } else {
      await this.commandRunInherit(`git remote add origin ${this.shellArg(targetUrl)}`, targetPath, "git remote add");
    }
    console.log(`已设置 origin: ${targetUrl}`);
  }

  private currentGitHubRepoGet(cwd: string): GitRemote | undefined {
    const remote = this.commandReadOptional("git config --get remote.origin.url", cwd);
    return this.githubRemoteParse(remote);
  }

  private githubLoginGet(cwd: string): string | undefined {
    const cacheKey = path.resolve(cwd);
    if (this.githubLoginCache.has(cacheKey)) {
      return this.githubLoginCache.get(cacheKey);
    }
    console.log("detect GitHub login");
    const login = this.commandReadOptional("gh api user --jq .login", cwd);
    this.githubLoginCache.set(cacheKey, login);
    return login;
  }
}
