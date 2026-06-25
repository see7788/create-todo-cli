// scripts/createPkg.ts
import * as fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import prompts from 'prompts';
import degit from 'degit';
import LibBase, { Appexit } from "./public.js";

type CreateTarget = {
  name: string;
  path: string;
};

type CreateSource =
  | { type: "vite"; template?: string }
  | { type: "github"; repo: string }
  | { type: "workspace-package" };

class CreatePkg extends LibBase {
  private readonly builtinTemplates: [repo: string, remark: string][] = [
    ["see7788/electron-template", "牛x的 electron 脚手架"],
    ["see7788/ts-template", "TypeScript 基本脚手架"],
  ];
  private target!: CreateTarget;
  private targetCreated = false;

  constructor() {
    super({ requirePackage: false });
  }

  async task1(initialProjectName?: string, initialSource?: string): Promise<void> {
    try {
      console.log('\n开始项目创建流程');
      const targetName = await this.askValidOutputName({
        initialName: initialProjectName,
        defaultName: "my-app",
        message: "请输入项目名",
        targetLabel: "将创建项目到",
        existsError: true,
      });
      this.target = {
        name: targetName,
        path: path.resolve(this.cwdProjectInfo.cwdPath, targetName),
      };
      const source = await this.sourceAsk(initialSource);
      await this.createFromSource(source);
      this.targetCreated = true;
      const packageName = this.toPackageName(this.target.name);
      const identity = await this.finalizeProjectOutput(this.target.path, packageName);
      console.log(`package.json identity set: ${identity.packageName}`);
      console.log('\n完成项目创建流程');
      console.log(`项目路径: ${this.pathDisplay(this.target.path)}`);
      console.log('\n下一步操作:');
      console.log(`   cd ${this.target.name}`);
      console.log('   pnpm install');
      console.log('   pnpm run dev');
    } catch (error: unknown) {
      this.targetPathDelete();
      throw error;
    }
  }

  private async sourceAsk(initialSource?: string): Promise<CreateSource> {
    if (initialSource) {
      return this.sourceFromInput(initialSource);
    }

    const response = await prompts({
      type: 'select',
      name: 'source',
      message: '请选择项目来源',
      choices: [
        { title: 'Vite 官方模板', value: 'vite' },
        { title: 'pnpm workspace package', value: 'workspace-package' },
        ...this.builtinTemplates.map(([repo, remark]) => ({
          title: `${remark} (${repo})`,
          value: `github:${repo}`,
        })),
        { title: '输入 GitHub 仓库地址', value: 'github-input' },
      ],
    });

    if (!response.source) {
      throw new Error('user-cancelled');
    }

    if (response.source === "vite") {
      return { type: "vite" };
    }
    if (response.source === "workspace-package") {
      return { type: "workspace-package" };
    }
    if (response.source === "github-input") {
      return { type: "github", repo: await this.githubRepoAsk() };
    }
    return this.sourceFromInput(response.source);
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

  private sourceFromInput(input: string): CreateSource {
    if (input === "workspace-package" || input === "pnpm" || input === "package") {
      return { type: "workspace-package" };
    }
    if (input.startsWith("vite:")) {
      const template = input.slice("vite:".length).trim();
      if (!template) {
        throw new Appexit("Vite 模板不能为空");
      }
      return { type: "vite", template };
    }
    if (input.startsWith("github:")) {
      return { type: "github", repo: this.githubRepoNormalize(input.slice("github:".length)) };
    }
    return { type: "github", repo: this.githubRepoNormalize(input) };
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

  private async createFromSource(source: CreateSource): Promise<void> {
    if (source.type === "vite") {
      this.createFromVite(source.template);
      return;
    }

    if (source.type === "workspace-package") {
      this.createWorkspacePackage();
      return;
    }

    await this.createFromDegit(source.repo);
  }

  private createFromVite(template?: string): void {
    console.log(`\n创建 Vite 项目: ${this.target.name}`);
    if (template) {
      console.log(`模板: ${template}`);
    }
    const command = [
      "pnpm create vite",
      this.shellArg(this.target.name),
      ...(template ? ["--", "--template", this.shellArg(template)] : []),
    ].join(" ");
    this.runInteractiveCommand(command);
  }

  private createWorkspacePackage(): void {
    const packageName = this.toPackageName(this.target.name);
    console.log(`\n创建 pnpm workspace package: ${packageName}`);

    fs.mkdirSync(path.join(this.target.path, "src"), { recursive: true });
    this.writeJsonFile(path.join(this.target.path, "package.json"), {
      name: packageName,
      version: "0.0.0",
      type: "module",
      main: "./src/index.ts",
      module: "./src/index.ts",
      types: "./src/index.ts",
      exports: {
        ".": {
          types: "./src/index.ts",
          import: "./src/index.ts",
          default: "./src/index.ts",
        },
      },
      files: [
        "src",
        "README.md",
      ],
      scripts: {
        dev: "tsx src/index.ts",
        build: "tsc --noEmit",
      },
      devDependencies: {
        tsx: "^4.20.0",
        typescript: "^5.8.0",
      },
    });
    fs.writeFileSync(
      path.join(this.target.path, "tsconfig.json"),
      `${JSON.stringify({
        compilerOptions: {
          target: "ESNext",
          module: "ESNext",
          moduleResolution: "Bundler",
          strict: true,
          skipLibCheck: true,
          esModuleInterop: true,
          resolveJsonModule: true,
        },
        include: ["src"],
      }, null, 2)}\n`,
      "utf-8",
    );
    fs.writeFileSync(path.join(this.target.path, "src", "index.ts"), "export {};\n", "utf-8");
    fs.writeFileSync(path.join(this.target.path, "README.md"), `# ${packageName}\n`, "utf-8");
    this.gitignoreSet(this.target.path);
  }

  private async createFromDegit(repoUrl: string): Promise<void> {
    console.log(`\n创建项目: ${this.target.name}`);
    console.log(`使用 degit 从 ${repoUrl} 获取模板...\n`);

    const emitter = degit(repoUrl, {
      cache: false,
      force: true,
      verbose: true,
    });

    emitter.on('info', info => console.log(info.message));
    emitter.on('warn', warn => console.warn(warn.message));
    await emitter.clone(this.target.path);
    console.log('已自动移除 .git 目录（degit 特性）');
  }

  private targetPathDelete(): void {
    if (this.targetCreated || !this.target) {
      return;
    }

    const targetPath = path.resolve(this.target.path);
    if (
      targetPath === process.cwd()
      || targetPath === path.parse(targetPath).root
      || targetPath === path.resolve(process.env.HOME ?? "")
      || targetPath === path.resolve(process.env.USERPROFILE ?? "")
    ) {
      throw new Appexit(`拒绝清理危险目录: ${targetPath}`);
    }

    if (fs.existsSync(targetPath)) {
      console.log(`清理失败的项目目录: ${targetPath}`);
      fs.rmSync(targetPath, { recursive: true, force: true });
    }
  }
}

if (path.resolve(fileURLToPath(import.meta.url)) === path.resolve(process.argv[1])) {
  new CreatePkg().task1();
}

export default CreatePkg;
