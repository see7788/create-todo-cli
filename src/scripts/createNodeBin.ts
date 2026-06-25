import { chmodSync, existsSync, mkdirSync, readFileSync, readdirSync, rmSync, statSync, writeFileSync } from "node:fs";
import { execSync } from "node:child_process";
import { basename, dirname, isAbsolute, join, relative, resolve } from "node:path";
import prompts from "prompts";
import LibBase from "./public.js";

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

class CreateNodeBin extends LibBase {
  public async task1(initialCommandName?: string): Promise<void> {
    const packageJsonPath = this.packagePath("package.json");
    const pkg = this.readRequiredJsonFile<NodeBinPackageJson>(packageJsonPath);
    const target = await this.nodeBinTargetAsk(pkg, initialCommandName);
    const wrapperPath = this.packagePath(target.wrapperPath);

    this.nodeBinWrapperWrite(target);
    this.packageJsonSet(packageJsonPath, pkg, target);
    const linkedFiles = this.pnpmLinkRun(pkg);

    console.log("init package bin complete");
    console.log(`entry: ${target.entryPath}`);
    console.log(`wrapper: ${wrapperPath}`);
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
    const entryPath = await this.entryPathAsk();
    const entryRelativePath = this.packageRelativePath(entryPath);
    if (entryRelativePath.startsWith("..") || isAbsolute(entryRelativePath)) {
      throw new Error("bin 入口文件必须位于当前项目内");
    }

    const commandName = await this.commandNameAsk(pkg, initialCommandName);
    const wrapperPath = this.wrapperPathDefault(commandName, pkg);
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
    return this.commandNameDefault(pkg);
  }

  private commandNameNormalize(commandName: string): string {
    const normalizedName = this.toPackageName(commandName.trim());
    if (!normalizedName) {
      throw new Error("Command name is empty");
    }
    return normalizedName;
  }

  private async entryPathAsk(): Promise<string> {
    const response = await prompts({
      type: "text",
      name: "entryPath",
      message: "Entry file path or directory",
      initial: this.entryPathDefault(),
    });
    if (!response.entryPath) {
      throw new Error("user-cancelled");
    }

    return this.entryPathResolve(String(response.entryPath).trim());
  }

  private entryPathDefault(): string {
    for (const relativePath of ["src/index.ts", "src/index.tsx", "src/index.js", "index.ts", "index.js"]) {
      const filePath = this.packagePath(relativePath);
      if (existsSync(filePath) && statSync(filePath).isFile()) {
        return filePath;
      }
    }
    return this.packagePath("src/index.ts");
  }

  private entryPathResolve(inputPath: string): string {
    const resolvedPath = resolve(inputPath);
    if (existsSync(resolvedPath) && statSync(resolvedPath).isDirectory()) {
      for (const fileName of ["index.ts", "index.tsx", "index.js", "index.jsx", "index.mjs", "index.cjs"]) {
        const candidate = join(resolvedPath, fileName);
        if (existsSync(candidate) && statSync(candidate).isFile()) {
          return candidate;
        }
      }
      throw new Error(`No entry file found in directory: ${resolvedPath}`);
    }

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
      `#!/usr/bin/env node
import { spawn, spawnSync } from "node:child_process";
import { existsSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const wrapperDir = dirname(fileURLToPath(import.meta.url));
const packageRoot = resolve(wrapperDir, ${JSON.stringify(rootRelativePath)});
const entry = resolve(wrapperDir, ${JSON.stringify(entryRelativePath)});
const tsx = join(packageRoot, "node_modules", "tsx", "dist", "cli.mjs");
const commandName = ${JSON.stringify(target.commandName)};
const commandArg = process.argv[2];
const command = commandArg === "dev" || commandArg === "start" || commandArg === "stop" || commandArg === "restart"
  ? commandArg
  : undefined;
const passthroughArgs = command ? process.argv.slice(3) : process.argv.slice(2);

if (!existsSync(tsx)) {
  console.error("缺少 tsx，请先安装依赖");
  process.exit(1);
}

const pathNormalize = (pathValue) => pathValue.toLowerCase().replaceAll("\\\\", "/");
const nodeEnv = command === "dev"
  ? "development"
  : command === "start"
    ? "production"
    : process.env.NODE_ENV;
const shouldWatch = command === "dev" || command === "restart";

const processInfosGet = () => {
  if (process.platform === "win32") {
    const processResult = spawnSync("powershell.exe", [
      "-NoProfile",
      "-Command",
      "Get-CimInstance Win32_Process | Select-Object ProcessId,ParentProcessId,CommandLine | ConvertTo-Json -Compress",
    ], {
      encoding: "utf8",
      windowsHide: true,
    });
    if (processResult.error) throw processResult.error;
    if (processResult.status !== 0) {
      throw new Error(\`Failed to query Windows processes: \${processResult.stderr || processResult.stdout}\`);
    }
    const parsed = JSON.parse(processResult.stdout || "[]");
    return Array.isArray(parsed) ? parsed : [parsed];
  }

  const processResult = spawnSync("ps", ["-eo", "pid=,ppid=,command="], {
    encoding: "utf8",
    windowsHide: true,
  });
  if (processResult.error) throw processResult.error;
  if (processResult.status !== 0) {
    throw new Error(\`Failed to query processes: \${processResult.stderr || processResult.stdout}\`);
  }
  return (processResult.stdout ?? "")
    .split(/\\r?\\n/)
    .filter(Boolean)
    .map((line) => {
      const match = line.trim().match(/^(\\d+)\\s+(\\d+)\\s+(.*)$/);
      if (!match) throw new Error(\`Cannot parse ps output line: \${line}\`);
      return {
        ProcessId: Number(match[1]),
        ParentProcessId: Number(match[2]),
        CommandLine: match[3],
      };
    });
};

const currentProcessIdsGet = (processInfos) => {
  const processMap = new Map(processInfos.map((processInfo) => [
    Number(processInfo.ProcessId),
    Number(processInfo.ParentProcessId),
  ]));
  const currentProcessIds = new Set([process.pid]);
  for (let processId = process.pid; processMap.has(processId);) {
    const parentProcessId = processMap.get(processId);
    if (parentProcessId === undefined || !Number.isInteger(parentProcessId) || currentProcessIds.has(parentProcessId)) break;
    currentProcessIds.add(parentProcessId);
    processId = parentProcessId;
  }
  return currentProcessIds;
};

const devStop = () => {
  const processInfos = processInfosGet();
  const currentProcessIds = currentProcessIdsGet(processInfos);
  const entryPath = pathNormalize(entry);
  const matchedProcesses = processInfos
    .map((processInfo) => ({
      processId: Number(processInfo.ProcessId),
      parentProcessId: Number(processInfo.ParentProcessId),
      commandLine: pathNormalize(String(processInfo.CommandLine ?? "")),
    }))
    .filter(({ processId, commandLine }) => (
      Number.isInteger(processId)
      && !currentProcessIds.has(processId)
      && commandLine.includes(entryPath)
    ));
  const matchedProcessIds = new Set(matchedProcesses.map(({ processId }) => processId));
  const processIds = matchedProcesses
    .filter(({ parentProcessId }) => !matchedProcessIds.has(parentProcessId))
    .map(({ processId }) => processId);

  if (processIds.length === 0) {
    console.log(\`\${commandName} is not running\`);
    return;
  }

  const uniqueProcessIds = [...new Set(processIds)];
  const stopResult = process.platform === "win32"
    ? spawnSync("taskkill", [...uniqueProcessIds.flatMap((processId) => ["/PID", String(processId)]), "/T", "/F"], { stdio: "inherit", windowsHide: true })
    : spawnSync("kill", ["-TERM", ...uniqueProcessIds.map(String)], { stdio: "inherit", windowsHide: true });
  if (stopResult.error) throw stopResult.error;
  if (typeof stopResult.status === "number" && stopResult.status !== 0) {
    throw new Error(\`Failed to stop process ids: \${uniqueProcessIds.join(", ")}\`);
  }
  console.log(\`\${commandName} stopped \${processIds.length} process\${processIds.length === 1 ? "" : "es"}\`);
};

if (command === "stop") {
  devStop();
  process.exit(0);
}
if (command === "restart") devStop();

let isStopping = false;
const devStopAndExit = (exitCode) => {
  if (isStopping) return;
  isStopping = true;
  try {
    devStop();
    process.exit(exitCode);
  } catch (error) {
    console.error(error instanceof Error ? error.message : error);
    process.exit(1);
  }
};

const childArgs = shouldWatch
  ? [tsx, "watch", "--clear-screen=false", entry, ...passthroughArgs]
  : [tsx, entry, ...passthroughArgs];
const child = spawn(process.execPath, childArgs, {
  env: {
    ...process.env,
    ...(nodeEnv ? { NODE_ENV: nodeEnv } : {}),
  },
  stdio: "inherit",
  shell: false,
  windowsHide: true,
});

if (shouldWatch) {
  process.once("SIGINT", () => devStopAndExit(130));
  process.once("SIGTERM", () => devStopAndExit(143));
}

child.once("error", (error) => {
  console.error(error.message);
  process.exit(1);
});

child.once("exit", (code, signal) => {
  if (isStopping) return;
  if (signal) {
    process.kill(process.pid, signal);
    return;
  }
  process.exit(code ?? 0);
});
`,
      "utf-8",
    );
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

  private pnpmLinkRun(pkg: NodeBinPackageJson): string[] {
    const cwd = process.cwd();
    try {
      process.chdir(this.cwdProjectInfo.pkgPath);
      this.runInteractiveCommand("pnpm link");
    } finally {
      process.chdir(cwd);
    }
    return this.globalBinLinksWrite(pkg);
  }

  private globalBinLinksWrite(pkg: NodeBinPackageJson): string[] {
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
    const removedFiles = this.globalBinStaleLinksRemove(globalBin, commandNames);
    const linkedFiles: string[] = [];
    for (const [commandName, binPath] of binEntries) {
      const wrapperPath = resolve(this.cwdProjectInfo.pkgPath, binPath);
      const commandPath = resolve(globalBin, commandName);
      writeFileSync(commandPath, `#!/usr/bin/env sh
exec node ${JSON.stringify(wrapperPath)} "$@"
`, "utf-8");
      linkedFiles.push(commandPath);
      try {
        chmodSync(commandPath, 0o755);
      } catch {
        // chmod is best-effort on Windows.
      }

      if (process.platform === "win32") {
        writeFileSync(`${commandPath}.cmd`, `@ECHO off\r\nnode ${JSON.stringify(wrapperPath)} %*\r\n`, "utf-8");
        writeFileSync(`${commandPath}.ps1`, `& node ${JSON.stringify(wrapperPath)} @args\r\nexit $LASTEXITCODE\r\n`, "utf-8");
        linkedFiles.push(`${commandPath}.cmd`, `${commandPath}.ps1`);
      }

      console.log(`linked command: ${commandName} -> ${wrapperPath}`);
    }
    return [...removedFiles.map(filePath => `removed ${filePath}`), ...linkedFiles];
  }

  private globalBinStaleLinksRemove(globalBin: string, commandNames: Set<string>): string[] {
    const packagePath = this.pathNormalize(this.cwdProjectInfo.pkgPath);
    const removedFiles: string[] = [];
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
          rmSync(linkedFile, { force: true });
          removedFiles.push(linkedFile);
        }
      }
    }
    return removedFiles;
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
      return this.pathNormalize(readFileSync(filePath, "utf-8")).includes(packagePath);
    } catch {
      return false;
    }
  }

  private pathNormalize(filePath: string): string {
    return filePath.replace(/\\/g, "/").toLowerCase();
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
}

export default CreateNodeBin;
