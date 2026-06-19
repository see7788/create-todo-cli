#!/usr/bin/env node
import { spawnSync } from "node:child_process";
import { existsSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = dirname(dirname(fileURLToPath(import.meta.url)));
const entry = join(root, "src", "index.ts");
const tsx = join(root, "node_modules", "tsx", "dist", "cli.mjs");

if (!existsSync(tsx)) {
  console.error("缺少 tsx，请先安装依赖");
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
