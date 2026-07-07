#!/usr/bin/env node
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import prompts from "prompts";
import GitScript from "./gitScript/index";
import GithubScript from "./githubScript/index";
import NodeScript from "./nodeScript/index";
import PnpmScript from "./pnpmScript/index";
import { Appexit } from "./base";

function errorTextRed(text: string): string {
  return process.stderr.isTTY ? `\x1b[31m${text}\x1b[0m` : text;
}

async function run() {
  try {
    const [scriptCommand, ...scriptArgs] = process.argv.slice(2);
    const scripts = [
      new NodeScript(),
      new PnpmScript(),
      new GitScript(),
      new GithubScript(),
    ] as const;

    if (scriptCommand === "--help" || scriptCommand === "-h" || scriptCommand === "help") {
      const rootPath = dirname(dirname(fileURLToPath(import.meta.url)));
      console.log(readFileSync(join(rootPath, "README.md"), "utf-8").trimEnd());
      return;
    }

    if (scriptCommand) {
      const [scriptName, commandName, commandExtra] = scriptCommand.split("/");
      if (commandExtra) {
        throw new Appexit(`命令格式应为 ${scriptName}/<commandName>`);
      }
      const script = scripts.find(item => item.scriptName === scriptName);
      if (script) {
        if (scriptArgs.length && !commandName) {
          throw new Appexit(`命令格式应为 ${script.scriptName}/<commandName>`);
        }
        await script.cmdsRun(commandName ? [commandName, ...scriptArgs] : []);
        return;
      }
      throw new Appexit(`未知命令: ${scriptCommand}`);
    }

    const response = await prompts({
      type: "select",
      name: "action",
      message: "Select action",
      choices: scripts.flatMap(script => script.cmdsAsk()),
    });

    if (typeof response.action !== "function") {
      console.log("cancelled");
      process.exit(0);
    }

    await response.action();
  } catch (err: unknown) {
    if (err instanceof Appexit) {
      console.error(errorTextRed(err.message));
    } else if (err instanceof Error && err.message === "user-cancelled") {
      console.log("cancelled");
      return;
    } else {
      console.error(errorTextRed(err instanceof Error ? (err.stack ?? err.message) : String(err)));
    }
    process.exit(1);
  }
}

run();
