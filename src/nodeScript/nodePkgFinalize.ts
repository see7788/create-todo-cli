import { existsSync } from "node:fs";
import { basename, join } from "node:path";
import ProjectBase from "../project";
import { Appexit, type PackageJsonRecord } from "../base";

class NodePkgFinalize extends ProjectBase {
  constructor() {
    super({ requirePackage: false });
  }

  public async task1(): Promise<void> {
    const targetPath = await this.targetPathAsk();
    const packageName = this.packageNameGet(targetPath);
    await this.nodePkgFinalize(targetPath, packageName);
    console.log(`node package finalized: ${this.pathDisplay(targetPath)}`);
  }

  private async targetPathAsk(): Promise<string> {
    const targetPath = await this.askLocalPath({
      initialPath: this.cwdProjectInfo.cwdPath,
      mode: "directory",
      shouldConfirm: true,
    });

    if (!existsSync(join(targetPath, "package.json"))) {
      throw new Appexit(`目标目录不存在 package.json: ${this.pathDisplay(targetPath)}`);
    }
    return targetPath;
  }

  private packageNameGet(targetPath: string): string {
    const pkg = this.readRequiredJsonFile<PackageJsonRecord>(join(targetPath, "package.json"));
    const packageName = this.toPackageName(pkg.name ?? basename(targetPath));
    if (!packageName) {
      throw new Appexit("package name is empty");
    }
    return packageName;
  }
}

export default NodePkgFinalize;
