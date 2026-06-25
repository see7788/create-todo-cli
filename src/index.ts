#!/usr/bin/env node
import prompts from "prompts";
import CreatePkg from "./scripts/createPkg.js";
import CreateNodeBin from "./scripts/createNodeBin.js";
import DistPkg from "./scripts/distPkg.js";
import GitPush from "./scripts/gitPush.js";
import PublishYml from "./scripts/publishYml.js";
import LibBase, { Appexit } from "./scripts/public.js";
import pkg from "../package.json" with { type: "json" };

type CommandContext = {
  param?: string;
  source?: string;
};

type CommandConfig = {
  title: string;
  hidden?: () => boolean;
  menu?: boolean;
  run: (context: CommandContext) => Promise<void> | void;
};

const commands = {
  createPkg: {
    title: "create project",
    run: ({ param, source }) => new CreatePkg().task1(param, source),
  },
  distPkg: {
    title: "dist npm package",
    menu: false,
    run: ({ param }) => new DistPkg().task1(param),
  },
  distPkgBundle: {
    title: "dist npm package: bundle ESM/CJS/d.ts",
    run: ({ param }) => new DistPkg().taskBundle(param),
  },
  distPkgSource: {
    title: "dist npm package: copy source",
    run: ({ param }) => new DistPkg().taskSource(param),
  },
  initPublishYml: {
    title: "init publish.yml set",
    run: async () => {
      await new PublishYml().createCurrent();
    },
  },
  initPkgBin: {
    title: "init package.json bin TS/JS entry",
    run: ({ param }) => new CreateNodeBin().task1(param),
  },
  initPnpmWorkspace: {
    title: "init pnpm workspace",
    run: () => new LibBase().setupPnpmWorkspaceRoot(),
  },
  initGithubPkg: {
    title: "init GitHub repo and push",
    run: () => new GitPush().task1(),
  },
  initPackageIdentity: {
    title: "init package.json identity",
    run: () => new LibBase().rewriteCurrentPackageIdentity(),
  },
  initGitignore: {
    title: "init .gitignore",
    run: () => new LibBase().initCurrentGitignore(),
  },
} as const satisfies Record<string, CommandConfig>;

type CommandName = keyof typeof commands;

const isCommandName = (value: string | undefined): value is CommandName => (
  Boolean(value && value in commands)
);

const commandEntries = () => Object.entries(commands) as [CommandName, CommandConfig][];

const menuCommandEntries = () => commandEntries()
  .filter(([, command]) => command.menu !== false)
  .filter(([, command]) => !command.hidden?.());

const primaryCommandEntries = () => menuCommandEntries()
  .filter(([name]) => !name.startsWith("init"));

const initCommandEntries = () => menuCommandEntries()
  .filter(([name]) => name.startsWith("init"));

const toPromptChoices = (entries: [CommandName, CommandConfig][]) => entries
  .map(([value, command]) => ({
    title: `${value} - ${command.title}`,
    value,
  }));

class CLI {
  private readonly args: string[];

  constructor() {
    this.args = process.argv.slice(2);
    console.log("pkg.version:", pkg.version);
  }

  private showHelp(): void {
    const primaryHelp = primaryCommandEntries();
    const initHelp = initCommandEntries();

    console.log([
      "help - show help",
      ...primaryHelp.map(([value, command]) => `${value} - ${command.title}`),
      "other",
      ...initHelp.map(([value, command]) => `${value} - ${command.title}`),
    ].join("\n"));
    process.exit(0);
  }

  private async handleCommand(cmd?: string, param?: string, source?: string): Promise<void> {
    switch (cmd) {
      case "--help":
      case "-h":
      case "help":
        this.showHelp();
        return;
      default:
        if (isCommandName(cmd)) {
          await commands[cmd].run({ param, source });
          return;
        }
        await this.showInteractiveMenu();
    }
  }

  private async showInteractiveMenu(): Promise<void> {
    const response = await prompts({
      type: "select",
      name: "action",
      message: "Select action",
      choices: [
        ...toPromptChoices(primaryCommandEntries()),
        { title: "other", value: "__other__", disabled: true },
        ...toPromptChoices(initCommandEntries()),
      ],
    });

    if (!isCommandName(response.action)) {
      console.log("cancelled");
      process.exit(0);
    }

    await commands[response.action].run({});
  }

  public async run(): Promise<void> {
    try {
      const [cmd, param, source] = this.args;
      await this.handleCommand(cmd, param, source);
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
