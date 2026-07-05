#!/usr/bin/env node
import { spawn, spawnSync } from "node:child_process";
import { existsSync } from "node:fs";
import { createRequire } from "node:module";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const wrapperDir = dirname(fileURLToPath(import.meta.url));
const packageRoot = resolve(wrapperDir, {{{rootRelativePathJson}}});
const entry = resolve(wrapperDir, {{{entryRelativePathJson}}});
const require = createRequire(import.meta.url);
const tsxResolve = () => {
  const localTsx = resolve(packageRoot, "node_modules", "tsx", "dist", "cli.mjs");
  if (existsSync(localTsx)) return localTsx;
  try {
    return require.resolve("tsx/dist/cli.mjs", { paths: [packageRoot] });
  } catch {
    return undefined;
  }
};
let tsx = tsxResolve();
const commandName = {{{commandNameJson}}};
const commandArg = process.argv[2];
const command = commandArg === "dev" || commandArg === "start" || commandArg === "stop" || commandArg === "restart"
  ? commandArg
  : undefined;
const passthroughArgs = command ? process.argv.slice(3) : process.argv.slice(2);

const tsxInstall = () => {
  console.log(`缺少 tsx，正在项目目录自动执行 pnpm install: ${packageRoot}`);
  const installResult = spawnSync(process.platform === "win32" ? "pnpm.cmd" : "pnpm", ["install"], {
    cwd: packageRoot,
    stdio: "inherit",
    shell: false,
    windowsHide: true,
  });
  if (installResult.error) {
    console.error(`自动安装依赖失败: ${installResult.error.message}`);
    process.exit(1);
  }
  if (typeof installResult.status === "number" && installResult.status !== 0) {
    console.error(`自动安装依赖失败，pnpm install 退出码: ${installResult.status}`);
    process.exit(installResult.status);
  }
};

if (!tsx) {
  tsxInstall();
  tsx = tsxResolve();
}

if (!tsx) {
  console.error([
    "自动安装后仍缺少 tsx，无法运行 TypeScript 入口。",
    `项目目录: ${packageRoot}`,
    "如果仍然失败，请确认 package.json 的 dependencies 中包含 tsx。",
  ].join("\n"));
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
