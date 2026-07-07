import { existsSync, readFileSync, readdirSync, statSync } from "node:fs";
import { basename, dirname, join, resolve } from "node:path";
import { Appexit } from "../base";
import GitBase, { type GitRemote } from "../git";
import PnpmBase from "../pnpm";

export default class PnpmInsert extends GitBase {
  constructor() {
    super({ requirePackage: false });
  }

  public async task1(): Promise<void> {
    const workspaceRoot = PnpmBase.pnpmWorkspaceRootFind();
    if (!workspaceRoot) {
      throw new Appexit("当前目录不在 pnpm workspace 内");
    }

    const workspaceFile = join(workspaceRoot, "pnpm-workspace.yaml");
    const externalSpecs = PnpmBase.pnpmWorkspacePackagesParse(readFileSync(workspaceFile, "utf-8"))
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
      await this.workspaceExternalInsert(workspaceRoot, spec, sourceRemote);
    }
  }

  private async workspaceExternalInsert(workspaceRoot: string, spec: string, sourceRemote: GitRemote): Promise<void> {
    const normalizedSpec = spec.replace(/\\/g, "/").trim();
    const targetPath = resolve(workspaceRoot, normalizedSpec);
    const repoName = basename(targetPath);
    const remoteUrl = `https://github.com/${sourceRemote.owner}/${repoName}.git`;
    if (existsSync(targetPath)) {
      await this.workspaceExternalExistingCheck(targetPath, remoteUrl);
      return;
    }

    await this.workspaceExternalClone(remoteUrl, targetPath);
  }

  private async workspaceExternalExistingCheck(targetPath: string, remoteUrl: string): Promise<void> {
    if (!statSync(targetPath).isDirectory()) {
      throw new Appexit(`外部包目标已存在但不是目录: ${targetPath}`);
    }
    if (existsSync(join(targetPath, ".git"))) {
      this.workspaceExternalGitRepoCheck(targetPath, remoteUrl);
      console.log(`skip existed git repo: ${this.pathDisplay(targetPath)}`);
      return;
    }
    if (readdirSync(targetPath).length === 0) {
      await this.workspaceExternalClone(remoteUrl, targetPath);
      return;
    }
    throw new Appexit(`外部包目标已存在且非空，为避免覆盖已停止: ${targetPath}`);
  }

  private async workspaceExternalClone(remoteUrl: string, targetPath: string): Promise<void> {
    console.log(`clone ${remoteUrl} -> ${this.pathDisplay(targetPath)}`);
    await this.commandRunInherit(
      `git clone ${this.shellArg(remoteUrl)} ${this.shellArg(targetPath)}`,
      dirname(targetPath),
      `git clone ${basename(targetPath)}`,
    );
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
