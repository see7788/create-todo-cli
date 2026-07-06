import { execSync } from "node:child_process";
import { existsSync, readFileSync, readdirSync, statSync } from "node:fs";
import { basename, dirname, join, resolve } from "node:path";
import GitBase, { Appexit, type GitRemote } from "../public/git";

class PnpmInsert extends GitBase {
  constructor() {
    super({ requirePackage: false });
  }

  public async task1(): Promise<void> {
    const workspaceRoot = GitBase.pnpmWorkspaceRootFind();
    if (!workspaceRoot) {
      throw new Appexit("当前目录不在 pnpm workspace 内");
    }

    const workspaceFile = join(workspaceRoot, "pnpm-workspace.yaml");
    const externalSpecs = GitBase.pnpmWorkspacePackagesParse(readFileSync(workspaceFile, "utf-8"))
      .filter(spec => !spec.trim().startsWith("!"))
      .filter(spec => this.workspaceSpecExternalIs(spec));
    if (externalSpecs.length === 0) {
      console.log("pnpm-workspace.yaml 中没有 ../ 外部包");
      return;
    }

    const sourceRemote = this.githubRemoteRead(workspaceRoot);
    console.log(`pnpmInsert workspace: ${this.pathDisplay(workspaceRoot)}`);
    for (const spec of externalSpecs) {
      this.workspaceExternalSpecCheck(spec);
    }
    await this.targetPathsConfirm(externalSpecs.map(spec => resolve(workspaceRoot, spec)));
    for (const spec of externalSpecs) {
      this.workspaceExternalInsert(workspaceRoot, spec, sourceRemote);
    }
  }

  private workspaceExternalInsert(workspaceRoot: string, spec: string, sourceRemote: GitRemote): void {
    const normalizedSpec = spec.replace(/\\/g, "/").trim();
    const targetPath = resolve(workspaceRoot, normalizedSpec);
    const repoName = basename(targetPath);
    const remoteUrl = `https://github.com/${sourceRemote.owner}/${repoName}.git`;
    if (existsSync(targetPath)) {
      this.workspaceExternalExistingCheck(targetPath, remoteUrl);
      return;
    }

    console.log(`clone ${remoteUrl} -> ${this.pathDisplay(targetPath)}`);
    execSync(`git clone ${this.shellArg(remoteUrl)} ${this.shellArg(targetPath)}`, {
      cwd: dirname(targetPath),
      stdio: "inherit",
    });
  }

  private workspaceExternalExistingCheck(targetPath: string, remoteUrl: string): void {
    if (!statSync(targetPath).isDirectory()) {
      throw new Appexit(`外部包目标已存在但不是目录: ${targetPath}`);
    }
    if (existsSync(join(targetPath, ".git"))) {
      this.workspaceExternalGitRepoCheck(targetPath, remoteUrl);
      console.log(`skip existed git repo: ${this.pathDisplay(targetPath)}`);
      return;
    }
    if (readdirSync(targetPath).length === 0) {
      console.log(`clone ${remoteUrl} -> ${this.pathDisplay(targetPath)}`);
      execSync(`git clone ${this.shellArg(remoteUrl)} ${this.shellArg(targetPath)}`, {
        cwd: dirname(targetPath),
        stdio: "inherit",
      });
      return;
    }
    throw new Appexit(`外部包目标已存在且非空，为避免覆盖已停止: ${targetPath}`);
  }

  private workspaceExternalGitRepoCheck(targetPath: string, remoteUrl: string): void {
    const currentRemote = this.commandReadOptional("git remote get-url origin", targetPath);
    const currentRepo = this.githubRemoteParse(currentRemote);
    const targetRepo = this.githubRemoteParse(remoteUrl);
    if (!currentRepo || !targetRepo || currentRepo.owner !== targetRepo.owner || currentRepo.repo !== targetRepo.repo) {
      throw new Appexit(`外部包目标已存在但不是目标仓库: ${targetPath}`);
    }
  }

  private workspaceSpecExternalIs(spec: string): boolean {
    const normalizedSpec = spec.replace(/\\/g, "/").trim();
    return normalizedSpec.startsWith("../");
  }

  private workspaceExternalSpecCheck(spec: string): void {
    const normalizedSpec = spec.replace(/\\/g, "/").trim();
    if (normalizedSpec.includes("*")) {
      throw new Appexit(`pnpmInsert 暂不支持通配符外部包: ${spec}`);
    }
  }
}

class PnpmScript {
  public readonly menu = {
    "pnpmScript/pnpmInsert  clone missing ../ pnpm workspace packages": this.pnpmInsert,
    "pnpmScript/pnpmWorkspaceInit  init pnpm workspace": this.pnpmWorkspaceInit,
  } as const;

  public readonly command = {
    pnpmInsert: this.pnpmInsert,
    pnpmWorkspaceInit: this.pnpmWorkspaceInit,
  } as const;

  private pnpmInsert(): Promise<void> {
    return new PnpmInsert().task1();
  }

  private pnpmWorkspaceInit(): Promise<void> {
    return new GitBase().setupPnpmWorkspaceRoot();
  }
}

export const pnpmScript = new PnpmScript();

export default pnpmScript;
