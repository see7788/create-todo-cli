import fs from "fs";
import path from "path";
import prompts from "prompts";
import GitBase, { type GitRemote } from "./git";
import GithubBase from "./github";
import PnpmBase from "./pnpm";
import { type PackageJsonRecord } from "./base";

export type ProjectIdentity = {
  packageName: string;
  repositoryName: string;
  author?: string;
  githubOwner?: string;
  repositoryUrl?: string;
  homepage?: string;
  bugsUrl?: string;
  license: string;
};

export default class ProjectBase extends GitBase {
  public async packageIdentity(): Promise<void> {
    const packageName = await this.packageNameAsk();
    await this.targetPathsConfirm(this.identityModifiedFiles(this.cwdProjectInfo.pkgPath));
    const identity = this.packageIdentitySet(this.cwdProjectInfo.pkgPath, packageName);
    console.log(`已重写 package.json 身份信息: ${identity.packageName}`);
    console.log("modified files:");
    for (const filePath of this.identityModifiedFiles(this.cwdProjectInfo.pkgPath)) {
      console.log(`- ${this.pathDisplay(filePath)}`);
    }
  }

  public async nodePkgFinalize(targetPath: string, packageName: string): Promise<ProjectIdentity> {
    const normalizedPackageName = this.toPackageName(packageName);
    await this.targetPathsConfirm(this.identityModifiedFiles(targetPath));
    const identity = this.packageIdentitySet(targetPath, normalizedPackageName);
    await this.gitignoreInit(targetPath);
    await new PnpmBase({ requirePackage: false }).workspaceInit(targetPath);
    await this.projectRepoEnsure(targetPath, normalizedPackageName);
    await this.publishWorkflowAsk(targetPath, identity);
    return identity;
  }

  private async packageNameAsk(): Promise<string> {
    const response = await prompts({
      type: "text",
      name: "packageName",
      message: "请输入 package.json name",
      initial: this.cwdProjectInfo.jsonInfo.name ?? path.basename(this.cwdProjectInfo.pkgPath),
    });

    if (!response.packageName) {
      throw new Error("user-cancelled");
    }
    return String(response.packageName).trim();
  }

  private packageIdentitySet(targetPath: string, packageName: string): ProjectIdentity {
    const packageJsonPath = path.join(targetPath, "package.json");
    const pkg = this.readJsonFile<PackageJsonRecord>(packageJsonPath) ?? {};
    const sourceRepo = this.githubRemoteParse(this.repositoryUrlGet(pkg));
    const projectRepo = this.githubProjectRepoGet(packageName, targetPath);
    const repositoryUrl = projectRepo ? `https://github.com/${projectRepo.owner}/${projectRepo.repo}.git` : undefined;
    const homepage = projectRepo ? `https://github.com/${projectRepo.owner}/${projectRepo.repo}` : undefined;
    const identity: ProjectIdentity = {
      packageName,
      repositoryName: projectRepo?.repo ?? this.githubRepositoryNameGet(packageName),
      author: this.gitConfigGet("user.name", targetPath) ?? pkg.author,
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

    this.writeJsonFile(packageJsonPath, pkg);
    this.readmeIdentitySet(targetPath, sourceRepo, identity);
    return identity;
  }

  private async projectRepoEnsure(targetPath: string, packageName: string): Promise<GitRemote | undefined> {
    const parentGitRoot = this.parentGitRootFind(targetPath);
    if (parentGitRoot) {
      console.log(`父级已存在 git 仓库，跳过子项目 git/GitHub 初始化: ${this.pathDisplay(parentGitRoot)}`);
      return undefined;
    }
    return this.repoEnsure(targetPath, packageName);
  }

  private async publishWorkflowAsk(targetPath: string, identity: ProjectIdentity): Promise<void> {
    const response = await prompts({
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

    const result = await new GithubBase().publishYmlInit({
      packageName: identity.packageName,
      targetPath,
      githubOwner: identity.githubOwner,
    });
    if (!result) {
      return;
    }
    console.log(`已创建发布配置: ${result.files.map(filePath => this.pathDisplay(filePath)).join(", ")}`);
  }

  private readmeIdentitySet(targetPath: string, sourceRepo: GitRemote | undefined, identity: ProjectIdentity): void {
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
}
