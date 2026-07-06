#!/usr/bin/env node
import prompts from "prompts";
import gitScript from "./gitScript/index";
import githubScript from "./githubScript/index";
import nodeScript from "./nodeScript/index";
import pnpmScript from "./pnpmScript/index";
import { Appexit } from "./public/base";
import pkg from "../package.json" with { type: "json" };

class CLI {
  private readonly args: string[];

  private readonly scripts = {
    node: nodeScript,
    pnpm: pnpmScript,
    git: gitScript,
    github: githubScript,
  } as const;

  private readonly command = {
    ...nodeScript.command,
    ...pnpmScript.command,
    ...gitScript.command,
    ...githubScript.command,
  } as const;

  constructor() {
    this.args = process.argv.slice(2);
    console.log("pkg.version:", pkg.version);
  }

  private commandHelpEntries(): [string, string][] {
    return Object.entries(this.command)
      .map(([commandName, commandRun]) => [commandName, this.commandTitleGet(commandRun)]);
  }

  private interactiveChoices() {
    return Object.values(this.scripts).flatMap(script => [
      ...Object.entries(script.menu).map(([title, commandRun]) => ({
        title,
        value: commandRun,
      })),
    ]);
  }

  private commandTitleGet(targetCommand: unknown): string {
    for (const script of Object.values(this.scripts)) {
      for (const [title, commandRun] of Object.entries(script.menu)) {
        if (commandRun === targetCommand) {
          return title;
        }
      }
    }
    return "";
  }

  private showHelp(): void {
    console.log([
      "help - show help",
      ...this.commandHelpEntries().map(([commandName, title]) => `${commandName} - ${title}`),
    ].join("\n"));
    process.exit(0);
  }

  private async handleCommand(commandName?: string, commandParam?: string, commandSource?: string): Promise<void> {
    if (!commandName) {
      await this.showInteractiveMenu();
      return;
    }

    if (commandName === "--help" || commandName === "-h" || commandName === "help") {
      this.showHelp();
      return;
    }

    if (commandName in this.command) {
      const commandRun = this.command[commandName as keyof typeof this.command] as (context: { param?: string; source?: string }) => Promise<void> | void;
      await commandRun({ param: commandParam, source: commandSource });
      return;
    }

    await this.showInteractiveMenu();
  }

  private async showInteractiveMenu(): Promise<void> {
    const response = await prompts({
      type: "select",
      name: "action",
      message: "Select action",
      choices: this.interactiveChoices(),
    });

    if (typeof response.action !== "function") {
      console.log("cancelled");
      process.exit(0);
    }

    await response.action({});
  }

  public async run(): Promise<void> {
    try {
      const [commandName, commandParam, commandSource] = this.args;
      await this.handleCommand(commandName, commandParam, commandSource);
    } catch (err: unknown) {
      if (err instanceof Appexit) {
        console.error(`program error: ${err.message}`);
      } else if (err instanceof Error && err.message === "user-cancelled") {
        console.log("cancelled");
        return;
      } else {
        console.error("program exception:", err instanceof Error ? err.message : err);
      }
      process.exit(1);
    }
  }
}

new CLI().run();
