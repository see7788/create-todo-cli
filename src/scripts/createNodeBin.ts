import { mkdirSync, writeFileSync } from "node:fs";
import { basename, dirname, isAbsolute, relative, resolve } from "node:path";
import prompts from "prompts";
import LibBase from "./tool.js";

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
  public async task1(): Promise<void> {
    const packageJsonPath = this.packagePath("package.json");
    const pkg = this.readRequiredJsonFile<NodeBinPackageJson>(packageJsonPath);
    const target = await this.nodeBinTargetAsk(pkg);
    const wrapperPath = this.packagePath(target.wrapperPath);

    this.nodeBinWrapperWrite(target);
    this.packageJsonSet(packageJsonPath, pkg, target);
    this.pnpmLinkRun();

    console.log(`已生成 node bin wrapper: ${this.pathDisplay(wrapperPath)}`);
    console.log(`入口文件: ${target.entryPath}`);
    console.log(`package.json: ${this.pathDisplay(packageJsonPath)}`);
    console.log(`命令: ${this.lifecycleCommandNames(target.commandName).join(", ")}`);
    console.log("已执行 pnpm link");
  }

  private async nodeBinTargetAsk(pkg: NodeBinPackageJson): Promise<NodeBinTarget> {
    const entryPath = await this.askLocalFilePath([".ts", ".tsx", ".js", ".jsx", ".mjs", ".cjs"], this.cwdProjectInfo.cwdPath, false);
    const entryRelativePath = this.packageRelativePath(entryPath);
    if (entryRelativePath.startsWith("..") || isAbsolute(entryRelativePath)) {
      throw new Error("bin 入口文件必须位于当前项目内");
    }

    const commandName = this.commandNameDefault(pkg);
    const wrapperPath = this.wrapperPathDefault(commandName, pkg);
    const target = {
      commandName,
      wrapperPath,
      entryPath,
    };
    const confirmed = await prompts({
      type: "confirm",
      name: "value",
      message: [
        `入口文件: ${target.entryPath}`,
        `wrapper: ${this.packagePath(target.wrapperPath)}`,
        `命令: ${this.lifecycleCommandNames(target.commandName).join(", ")}`,
        "是否生成并执行 pnpm link？",
      ].join("\n"),
      initial: true,
    });
    if (confirmed.value === undefined) {
      throw new Error("user-cancelled");
    }
    if (!confirmed.value) {
      throw new Error("user-cancelled");
    }
    return target;
  }

  private commandNameDefault(pkg: NodeBinPackageJson): string {
    const existingCommandName = this.binCommandNames(pkg)
      .map(commandName => commandName.replace(/-(dev|start|stop|restart)$/, ""))
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
import { basename, dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const wrapperDir = dirname(fileURLToPath(import.meta.url));
const packageRoot = resolve(wrapperDir, ${JSON.stringify(rootRelativePath)});
const entry = resolve(wrapperDir, ${JSON.stringify(entryRelativePath)});
const tsx = join(packageRoot, "node_modules", "tsx", "dist", "cli.mjs");
const commandName = ${JSON.stringify(target.commandName)};
const commandArg = process.argv[2];
const binName = basename(process.argv[1] ?? "");
const lifecycleCommandFromArg = commandArg === "dev" || commandArg === "start" || commandArg === "stop" || commandArg === "restart"
  ? commandArg
  : undefined;
const lifecycleCommandFromBin = binName.endsWith("-stop")
  ? "stop"
  : binName.endsWith("-start")
    ? "start"
  : binName.endsWith("-restart")
    ? "restart"
  : binName.endsWith("-dev")
    ? "dev"
    : undefined;
const command = lifecycleCommandFromArg ?? lifecycleCommandFromBin;
const passthroughArgs = lifecycleCommandFromArg ? process.argv.slice(3) : process.argv.slice(2);

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
    pkg.bin = {
      ...(pkg.bin && typeof pkg.bin === "object" ? pkg.bin : {}),
      ...Object.fromEntries(this.lifecycleCommandNames(target.commandName).map(commandName => [commandName, wrapperPackagePath])),
    };
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

  private pnpmLinkRun(): void {
    const cwd = process.cwd();
    try {
      process.chdir(this.cwdProjectInfo.pkgPath);
      this.runInteractiveCommand("pnpm link");
    } finally {
      process.chdir(cwd);
    }
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

  private lifecycleCommandNames(commandName: string): string[] {
    return [commandName, `${commandName}-dev`, `${commandName}-start`, `${commandName}-stop`, `${commandName}-restart`];
  }

  private nodeImportPath(fromDir: string, toFile: string): string {
    const relativePath = relative(fromDir, toFile).replace(/\\/g, "/");
    return relativePath.startsWith(".") ? relativePath : `./${relativePath}`;
  }
}

export default CreateNodeBin;
