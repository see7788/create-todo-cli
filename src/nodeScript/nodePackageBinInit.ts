import { chmodSync, existsSync, mkdirSync, readFileSync, readdirSync, rmSync, statSync, writeFileSync } from "node:fs";
import { execSync } from "node:child_process";
import { basename, dirname, isAbsolute, join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import Mustache from "mustache";
import LibBase from "../public/base";

type NodeBinPackageJson = {
  name?: string;
  type?: string;
  bin?: string | Record<string, string>;
  files?: string[];
  dependencies?: Record<string, string>;
  devDependencies?: Record<string, string>;
} & Record<string, unknown>;

type NodeBinTarget = {
  commandName: string;
  wrapperPath: string;
  entryPath: string;
};

const scriptPath = dirname(fileURLToPath(import.meta.url));

class NodePackageBinInit extends LibBase {
  public async task1(initialCommandName?: string): Promise<void> {
    const packageJsonPath = this.packagePath("package.json");
    const pkg = this.readRequiredJsonFile<NodeBinPackageJson>(packageJsonPath);
    const target = await this.nodeBinTargetAsk(pkg, initialCommandName);
    const wrapperPath = this.packagePath(target.wrapperPath);

    this.packageJsonSet(packageJsonPath, pkg, target);
    this.nodeBinWrapperWrite(target);
    const linkedFiles = await this.pnpmLinkRun(pkg);

    console.log("init package bin complete");
    console.log(`source entry: ${target.entryPath}`);
    console.log(`output wrapper: ${wrapperPath}`);
    console.log(`command: ${target.commandName} [dev|start|stop|restart]`);
    console.log("changed files:");
    console.log(`- ${this.pathDisplay(packageJsonPath)}`);
    console.log(`- ${this.pathDisplay(wrapperPath)}`);
    console.log("linked files:");
    for (const filePath of linkedFiles) {
      console.log(`- ${filePath}`);
    }
  }

  private async nodeBinTargetAsk(pkg: NodeBinPackageJson, initialCommandName?: string): Promise<NodeBinTarget> {
    const commandName = await this.commandNameAsk(pkg, initialCommandName);
    const wrapperPath = this.wrapperPathDefault(commandName, pkg);
    await this.targetPathsConfirm([
      this.packagePath("package.json"),
      this.packagePath(wrapperPath),
    ]);

    const entryPath = await this.entryPathAsk();
    const entryRelativePath = this.packageRelativePath(entryPath);
    if (entryRelativePath.startsWith("..") || isAbsolute(entryRelativePath)) {
      throw new Error("bin 入口文件必须位于当前项目内");
    }

    const target = {
      commandName,
      wrapperPath,
      entryPath,
    };
    return target;
  }

  private async commandNameAsk(pkg: NodeBinPackageJson, initialCommandName?: string): Promise<string> {
    if (initialCommandName) {
      return this.commandNameNormalize(initialCommandName);
    }
    const prompts = await import("prompts");
    const response = await prompts.default({
      type: "text",
      name: "commandName",
      message: "请输入 bin 命令名",
      initial: this.commandNameDefault(pkg),
    });
    if (!response.commandName) {
      throw new Error("user-cancelled");
    }
    return this.commandNameNormalize(String(response.commandName));
  }

  private commandNameNormalize(commandName: string): string {
    const normalizedName = this.toPackageName(commandName.trim());
    if (!normalizedName) {
      throw new Error("Command name is empty");
    }
    return normalizedName;
  }

  private async entryPathAsk(): Promise<string> {
    return this.askLocalFilePath(
      [".ts", ".tsx", ".js", ".jsx", ".mjs", ".cjs"],
      this.entryPathDefault(),
      true,
      this.cwdProjectInfo.pkgPath,
    );
  }

  private entryPathDefault(): string {
    for (const relativePath of ["src/index.ts", "src/index.tsx", "src/index.js", "index.ts", "index.js"]) {
      const filePath = this.packagePath(relativePath);
      if (existsSync(filePath) && statSync(filePath).isFile()) {
        return filePath;
      }
    }
    return this.packagePath();
  }

  private entryPathResolve(inputPath: string): string {
    const resolvedPath = resolve(inputPath);
    if (!existsSync(resolvedPath) || !statSync(resolvedPath).isFile()) {
      throw new Error(`Entry file not found: ${resolvedPath}`);
    }
    if (![".ts", ".tsx", ".js", ".jsx", ".mjs", ".cjs"].some(ext => resolvedPath.endsWith(ext))) {
      throw new Error(`Unsupported entry file: ${resolvedPath}`);
    }
    return resolvedPath;
  }

  private commandNameDefault(pkg: NodeBinPackageJson): string {
    const existingCommandName = this.binCommandNames(pkg)
      .find(Boolean);
    return existingCommandName ?? this.toPackageName(pkg.name ?? basename(this.cwdProjectInfo.pkgPath));
  }

  private wrapperPathDefault(commandName: string, pkg: NodeBinPackageJson): string {
    return pkg.type === "module" ? `bin/${commandName}.js` : `bin/${commandName}.mjs`;
  }

  private binCommandNames(pkg: NodeBinPackageJson): string[] {
    if (typeof pkg.bin === "string") {
      return [this.toPackageName(pkg.name ?? basename(this.cwdProjectInfo.pkgPath))];
    }
    if (pkg.bin && typeof pkg.bin === "object") {
      return Object.keys(pkg.bin);
    }
    return [];
  }

  private nodeBinWrapperWrite(target: NodeBinTarget): void {
    const wrapperPath = this.packagePath(target.wrapperPath);
    const entryPath = resolve(target.entryPath);
    const rootRelativePath = this.nodeImportPath(dirname(wrapperPath), this.packagePath());
    const entryRelativePath = this.nodeImportPath(dirname(wrapperPath), entryPath);
    mkdirSync(dirname(wrapperPath), { recursive: true });
    writeFileSync(
      wrapperPath,
      this.nodeBinWrapperSourceCreate({
        commandName: target.commandName,
        rootRelativePath,
        entryRelativePath,
      }),
      "utf-8",
    );
  }

  private nodeBinWrapperSourceCreate(context: {
    commandName: string;
    rootRelativePath: string;
    entryRelativePath: string;
  }): string {
    return Mustache.render(readFileSync(join(scriptPath, "command.js"), "utf-8"), {
      commandNameJson: JSON.stringify(context.commandName),
      entryRelativePathJson: JSON.stringify(context.entryRelativePath),
      rootRelativePathJson: JSON.stringify(context.rootRelativePath),
    });
  }

  private packageJsonSet(packageJsonPath: string, pkg: NodeBinPackageJson, target: NodeBinTarget): void {
    const wrapperPackagePath = `./${target.wrapperPath.replace(/\\/g, "/").replace(/^\.\//, "")}`;
    pkg.bin = { [target.commandName]: wrapperPackagePath };
    pkg.files = this.packageFilesNext(pkg.files, target);

    const tsxVersion = pkg.dependencies?.tsx ?? pkg.devDependencies?.tsx ?? "^4.20.6";
    pkg.dependencies = {
      ...(pkg.dependencies ?? {}),
      tsx: tsxVersion,
    };
    if (pkg.devDependencies?.tsx) {
      delete pkg.devDependencies.tsx;
      if (Object.keys(pkg.devDependencies).length === 0) {
        delete pkg.devDependencies;
      }
    }

    this.writeJsonFile(packageJsonPath, pkg);
  }

  private async pnpmLinkRun(pkg: NodeBinPackageJson): Promise<string[]> {
    const cwd = process.cwd();
    try {
      process.chdir(this.cwdProjectInfo.pkgPath);
      this.runInteractiveCommand("pnpm install");
      this.runInteractiveCommand("pnpm link");
    } finally {
      process.chdir(cwd);
    }
    return this.globalBinLinksWrite(pkg);
  }

  private async globalBinLinksWrite(pkg: NodeBinPackageJson): Promise<string[]> {
    const binEntries = this.binEntries(pkg);
    if (binEntries.length === 0) {
      throw new Error("package.json bin is empty");
    }

    const globalBin = execSync("pnpm bin -g", {
      cwd: this.cwdProjectInfo.pkgPath,
      encoding: "utf-8",
      stdio: ["ignore", "pipe", "pipe"],
    }).trim();
    if (!globalBin) {
      throw new Error("Cannot resolve pnpm global bin directory");
    }

    mkdirSync(globalBin, { recursive: true });
    const commandNames = new Set(binEntries.map(([commandName]) => commandName));
    const removedFiles = this.globalBinStaleLinksFind(globalBin, commandNames);
    const linkTargets = binEntries.flatMap(([commandName]) => {
      const commandPath = resolve(globalBin, commandName);
      return process.platform === "win32"
        ? [commandPath, `${commandPath}.cmd`, `${commandPath}.ps1`]
        : [commandPath];
    });
    await this.targetPathsConfirm([...removedFiles, ...linkTargets]);
    for (const filePath of removedFiles) {
      rmSync(filePath, { force: true });
    }

    const linkedFiles: string[] = [];
    for (const [commandName, binPath] of binEntries) {
      const wrapperPath = resolve(this.cwdProjectInfo.pkgPath, binPath);
      const commandPath = resolve(globalBin, commandName);
      writeFileSync(commandPath, this.commandShellCreate(wrapperPath), "utf-8");
      linkedFiles.push(commandPath);
      try {
        chmodSync(commandPath, 0o755);
      } catch {
        // chmod is best-effort on Windows.
      }

      if (process.platform === "win32") {
        writeFileSync(`${commandPath}.cmd`, this.commandCmdCreate(wrapperPath).replace(/\n/g, "\r\n"), "utf-8");
        writeFileSync(`${commandPath}.ps1`, this.commandPs1Create(wrapperPath).replace(/\n/g, "\r\n"), "utf-8");
        linkedFiles.push(`${commandPath}.cmd`, `${commandPath}.ps1`);
      }

      console.log(`linked command: ${commandName} -> ${wrapperPath}`);
    }
    return [...removedFiles.map(filePath => `removed ${filePath}`), ...linkedFiles];
  }

  private globalBinStaleLinksFind(globalBin: string, commandNames: Set<string>): string[] {
    const packagePath = LibBase.pathNormalize(this.cwdProjectInfo.pkgPath);
    const staleFiles: string[] = [];
    const knownExtensions = ["", ".cmd", ".ps1"];
    for (const filePath of this.globalBinFiles(globalBin)) {
      const commandName = this.globalBinCommandName(filePath);
      if (!commandName || commandNames.has(commandName)) {
        continue;
      }
      if (!this.globalBinFileBelongsToPackage(filePath, packagePath)) {
        continue;
      }

      for (const extension of knownExtensions) {
        const linkedFile = resolve(globalBin, `${commandName}${extension}`);
        if (existsSync(linkedFile)) {
          staleFiles.push(linkedFile);
        }
      }
    }
    return staleFiles;
  }

  private globalBinFiles(globalBin: string): string[] {
    return readdirSync(globalBin, { withFileTypes: true })
      .filter(item => item.isFile())
      .map(item => resolve(globalBin, item.name));
  }

  private globalBinCommandName(filePath: string): string | undefined {
    const fileName = basename(filePath);
    return fileName.replace(/\.(cmd|ps1)$/i, "");
  }

  private globalBinFileBelongsToPackage(filePath: string, packagePath: string): boolean {
    try {
      return LibBase.pathNormalize(readFileSync(filePath, "utf-8")).includes(packagePath);
    } catch {
      return false;
    }
  }

  private binEntries(pkg: NodeBinPackageJson): [string, string][] {
    if (typeof pkg.bin === "string") {
      return [[this.toPackageName(pkg.name ?? basename(this.cwdProjectInfo.pkgPath)), pkg.bin]];
    }
    if (pkg.bin && typeof pkg.bin === "object") {
      return Object.entries(pkg.bin);
    }
    return [];
  }

  private packageFilesNext(files: string[] | undefined, target: NodeBinTarget): string[] {
    return Array.from(new Set([
      ...(files ?? []),
      this.packageFileEntry(target.wrapperPath),
      this.packageFileEntry(this.packageRelativePath(target.entryPath)),
    ]));
  }

  private packageFileEntry(filePath: string): string {
    const normalizedPath = filePath.replace(/\\/g, "/").replace(/^\.\//, "");
    const [topPath, ...childPaths] = normalizedPath.split("/");
    return childPaths.length > 0 ? `${topPath}/` : normalizedPath;
  }

  private nodeImportPath(fromDir: string, toFile: string): string {
    const relativePath = relative(fromDir, toFile).replace(/\\/g, "/");
    return relativePath.startsWith(".") ? relativePath : `./${relativePath}`;
  }

  private commandShellCreate(wrapperPath: string): string {
    return Mustache.render(`#!/usr/bin/env sh
exec node {{{wrapperPathJson}}} $@
`, { wrapperPathJson: JSON.stringify(wrapperPath) });
  }

  private commandCmdCreate(wrapperPath: string): string {
    return Mustache.render(`@ECHO off
node {{{wrapperPathJson}}} %*
`, { wrapperPathJson: JSON.stringify(wrapperPath) });
  }

  private commandPs1Create(wrapperPath: string): string {
    return Mustache.render(`& node {{{wrapperPathJson}}} @args
exit $LASTEXITCODE
`, { wrapperPathJson: JSON.stringify(wrapperPath) });
  }
}

export default NodePackageBinInit;
