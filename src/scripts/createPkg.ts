// scripts/createPkg.ts
import { execSync } from "child_process";
import { existsSync, rmSync } from "node:fs";
import path from "path";
import { fileURLToPath } from "url";
import degit from "degit";
import prompts from "prompts";
import LibBase, { Appexit } from "./public.js";

type CreateTarget = {
  name: string;
  path: string;
};

type SourceChoice = {
  title: string;
  run: (target: CreateTarget) => Promise<void> | void;
};

class CreatePkg extends LibBase {
  private readonly sourceChoices: SourceChoice[] = [
    { title: "Vite 官方模板", run: target => this.createFromCommand(target, this.viteCreateCommand()) },
    { title: "electron 模板", run: target => this.createFromGitClone(target, "see7788/electron-template") },
    { title: "TypeScript 模板", run: target => this.createFromGitClone(target, "see7788/ts-template") },
    { title: "Hono 官方模板", run: target => this.createFromCommand(target, "pnpm create hono {name}") },
    { title: "输入 GitHub 仓库地址", run: async target => this.createFromGitClone(target, await this.githubRepoAsk()) },
    { title: "输入创建命令", run: async target => this.createFromCommand(target, await this.createCommandAsk()) },
  ];
  private createdTarget?: CreateTarget;

  constructor() {
    super({ requirePackage: false });
  }

  async task1(initialProjectName?: string, initialSource?: string): Promise<void> {
    const target = await this.targetResolve(initialProjectName);
    const source = await this.sourceResolve(initialSource);

    try {
      console.log("\n开始项目创建流程");
      console.log(`输出路径: ${this.pathDisplay(target.path)}`);
      console.log(`创建来源: ${source.title}`);

      await source.run(target);
      this.createdTarget = target;

      const identity = await this.finalizeProjectOutput(target.path, this.toPackageName(target.name));
      console.log(`package.json identity set: ${identity.packageName}`);
      this.doneLog(target);
    } catch (error: unknown) {
      this.targetPathDelete(target);
      throw error;
    }
  }

  private async targetResolve(initialProjectName?: string): Promise<CreateTarget> {
    const name = await this.askValidOutputName({
      initialName: initialProjectName,
      defaultName: "my-app",
      message: "请输入项目名",
      targetLabel: "将创建项目到",
      existsError: true,
    });

    return {
      name,
      path: path.resolve(this.cwdProjectInfo.cwdPath, name),
    };
  }

  private async sourceResolve(initialSource?: string): Promise<SourceChoice> {
    if (initialSource) {
      return this.sourceFromInput(initialSource);
    }

    const response = await prompts({
      type: "select",
      name: "source",
      message: "请选择项目来源",
      choices: this.sourceChoices,
    });

    if (!response.source) {
      throw new Error("user-cancelled");
    }
    return response.source;
  }

  private sourceFromInput(input: string): SourceChoice {
    const value = input.trim();
    if (!value) {
      throw new Appexit("项目来源不能为空");
    }
    if (value === "vite") {
      return {
        title: value,
        run: target => this.createFromCommand(target, this.viteCreateCommand()),
      };
    }
    if (value.startsWith("vite:")) {
      const template = value.slice("vite:".length).trim();
      if (!template) {
        throw new Appexit("Vite 模板不能为空");
      }
      return {
        title: value,
        run: target => this.createFromCommand(target, this.viteCreateCommand(template)),
      };
    }
    if (value.startsWith("github:")) {
      const repo = this.githubRepoNormalize(value.slice("github:".length));
      return {
        title: value,
        run: target => this.createFromGitClone(target, repo),
      };
    }
    if (value.startsWith("command:")) {
      const command = this.commandNormalize(value.slice("command:".length));
      return {
        title: value,
        run: target => this.createFromCommand(target, command),
      };
    }
    if (value.startsWith("cmd:")) {
      const command = this.commandNormalize(value.slice("cmd:".length));
      return {
        title: value,
        run: target => this.createFromCommand(target, command),
      };
    }

    const repo = this.githubRepoNormalize(value);
    return {
      title: value,
      run: target => this.createFromGitClone(target, repo),
    };
  }

  private async githubRepoAsk(): Promise<string> {
    let repo = "";
    while (true) {
      const response = await prompts({
        type: "text",
        name: "repo",
        message: "请输入 GitHub 仓库地址或 owner/repo",
        initial: repo,
      });
      if (!response.repo) {
        throw new Error("user-cancelled");
      }
      repo = String(response.repo).trim();

      try {
        return this.githubRepoNormalize(repo);
      } catch (error) {
        console.error(error instanceof Error ? error.message : String(error));
        repo = "";
      }
    }
  }

  private async createCommandAsk(): Promise<string> {
    let command = "";
    while (true) {
      const response = await prompts({
        type: "text",
        name: "command",
        message: "请输入创建命令，支持 {name} / {path} 占位符",
        initial: command || "pnpm create hono {name}",
      });
      if (!response.command) {
        throw new Error("user-cancelled");
      }
      command = String(response.command).trim();

      try {
        return this.commandNormalize(command);
      } catch (error) {
        console.error(error instanceof Error ? error.message : String(error));
        command = "";
      }
    }
  }

  private viteCreateCommand(template?: string): string {
    return [
      "pnpm create vite {name}",
      ...(template ? ["--", "--template", this.shellArg(template)] : []),
    ].join(" ");
  }

  private commandNormalize(command: string): string {
    const value = command.trim();
    if (!value) {
      throw new Appexit("创建命令不能为空");
    }
    return value;
  }

  private githubRepoNormalize(input: string): string {
    const value = input.trim().replace(/\/$/, "");
    if (!value) {
      throw new Error("GitHub 仓库不能为空");
    }
    const httpsMatch = value.match(/^https:\/\/github\.com\/([^/]+)\/([^/]+?)(?:\.git)?$/i);
    if (httpsMatch) {
      return `${httpsMatch[1]}/${httpsMatch[2]}`;
    }
    const sshMatch = value.match(/^git@github\.com:([^/]+)\/([^/]+?)(?:\.git)?$/i);
    if (sshMatch) {
      return `${sshMatch[1]}/${sshMatch[2]}`;
    }
    if (/^[^/\s]+\/[^/\s]+$/.test(value)) {
      return value;
    }
    throw new Error("GitHub 仓库格式应为 owner/repo、https://github.com/owner/repo 或 git@github.com:owner/repo.git");
  }

  private createFromCommand(target: CreateTarget, commandTemplate: string): void {
    const command = this.commandRender(target, commandTemplate);
    console.log(`执行创建命令: ${command}\n`);

    try {
      execSync(command, {
        stdio: "inherit",
        cwd: this.cwdProjectInfo.cwdPath,
        windowsHide: true,
      });
    } catch {
      throw new Appexit("创建命令执行失败");
    }
  }

  private commandRender(target: CreateTarget, commandTemplate: string): string {
    const replacements = {
      "{name}": this.shellArg(target.name),
      "{path}": this.shellArg(target.path),
    };
    let command = commandTemplate;
    let hasPlaceholder = false;

    for (const [placeholder, value] of Object.entries(replacements)) {
      if (command.includes(placeholder)) {
        hasPlaceholder = true;
        command = command.split(placeholder).join(value);
      }
    }

    return hasPlaceholder ? command : `${command} ${this.shellArg(target.name)}`;
  }

  private async createFromGitClone(target: CreateTarget, repoUrl: string): Promise<void> {
    console.log(`使用 degit 从 ${repoUrl} 获取模板...\n`);

    const emitter = degit(repoUrl, {
      cache: false,
      force: true,
      verbose: true,
    });

    emitter.on("info", info => console.log(info.message));
    emitter.on("warn", warn => console.warn(warn.message));
    await emitter.clone(target.path);
    console.log("已自动移除 .git 目录（degit 特性）");
  }

  private doneLog(target: CreateTarget): void {
    console.log("\n完成项目创建流程");
    console.log(`项目路径: ${this.pathDisplay(target.path)}`);
    console.log("\n下一步操作");
    console.log(`   cd ${target.name}`);
    console.log("   pnpm install");
    console.log("   pnpm run dev");
  }

  private targetPathDelete(target: CreateTarget): void {
    if (this.createdTarget || !existsSync(target.path)) {
      return;
    }

    const targetPath = path.resolve(target.path);
    if (
      targetPath === process.cwd()
      || targetPath === path.parse(targetPath).root
      || targetPath === path.resolve(process.env.HOME ?? "")
      || targetPath === path.resolve(process.env.USERPROFILE ?? "")
    ) {
      throw new Appexit(`拒绝清理危险目录: ${targetPath}`);
    }

    console.log(`清理失败的项目目录: ${targetPath}`);
    rmSync(targetPath, { recursive: true, force: true });
  }
}

if (path.resolve(fileURLToPath(import.meta.url)) === path.resolve(process.argv[1])) {
  new CreatePkg().task1();
}

export default CreatePkg;
