#!/usr/bin/env node
import { spawnSync } from "node:child_process";
import { existsSync } from "node:fs";
import { createRequire } from "node:module";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const require = createRequire(import.meta.url);
const root = dirname(dirname(fileURLToPath(import.meta.url)));
const entry = join(root, "src", "index.ts");

const tsxResolve = () => {
  const localTsx = join(root, "node_modules", "tsx", "dist", "cli.mjs");
  if (existsSync(localTsx)) {
    return localTsx;
  }
  try {
    return require.resolve("tsx/dist/cli.mjs");
  } catch {
    return undefined;
  }
};

const tsx = tsxResolve();
if (!tsx) {
  console.error("缺少 tsx，create-todo-cli 依赖安装不完整");
  process.exit(1);
}

const result = spawnSync(process.execPath, [tsx, entry, ...process.argv.slice(2)], {
  stdio: "inherit",
  shell: false,
});

if (result.error) {
  console.error(result.error.message);
  process.exit(1);
}

process.exit(result.status ?? 0);
