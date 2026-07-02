import { existsSync, rmSync } from "node:fs";
import path from "path";
import { fileURLToPath } from "url";
import prompts from "prompts";
import LibBase, { Appexit } from "./public.js";

type CreateTarget = { name: string; path: string };

type SourceChoice = {
  title: string;
  create: (c: CreateTarget) => string | Promise<string>;
};

class CreatePkg extends LibBase {
  private sourceChoices: SourceChoice[] = [
    { title: "Vite", create: (c) => `pnpm create vite "${c.name}"` },
    { title: "VSCode", create: (c) => `pnpm create vscode-extension "${c.name}"` },
    { title: "Electron", create: (c) => `degit see7788/electron-template "${c.name}"` },
    { title: "TS", create: (c) => `degit see7788/ts-template "${c.name}"` },
    { title: "Hono", create: (c) => `pnpm create hono "${c.name}"` },
    {
      title: "GitHub",
      create: async () => {
        const repo = await this.askRepo();
        return `degit ${repo} "${repo.split("/")[1]}"`;
      }
    },
    {
      title: "Custom",
      create: async (c) => {
        const cmd = await this.askCmd();
        return cmd.replaceAll("{name}", c.name).replaceAll("{path}", c.path);
      }
    }
  ];

  async task1(initial?: string) {
    const target = await this.askTarget(initial);
    const source = await this.askSource();

    try {
      const cmd = await source.create(target);
      this.runInteractiveCommand(cmd);
      await this.finalizeProjectOutput(target.path, target.name);
      this.done(target);
    } catch (e) {
      this.clean(target);
      throw e;
    }
  }

  async askTarget(initial?: string): Promise<CreateTarget> {
    const name = await this.confirmOutputName({
      initialName: initial,
      defaultName: "my-app",
      message: "name",
      targetLabel: "create",
      existsError: true
    });

    return {
      name,
      path: path.resolve(this.cwdProjectInfo.cwdPath, name)
    };
  }

  async askSource(): Promise<SourceChoice> {
    const r = await prompts({
      type: "select",
      name: "v",
      message: "source",
      choices: this.sourceChoices.map((i, k) => ({
        title: i.title,
        value: k
      }))
    });

    if (r.v === undefined) throw new Error("cancel");
    return this.sourceChoices[r.v];
  }

  async askRepo() {
    const r = await prompts({
      type: "text",
      name: "v",
      message: "repo"
    });

    if (!r.v) throw new Error("cancel");

    const v = String(r.v).trim();
    const m = this.parseGitHubRepo(v);
    if (!m) throw new Error("bad repo");

    return `${m.owner}/${m.repo}`;
  }

  async askCmd() {
    const r = await prompts({
      type: "text",
      name: "v",
      message: "cmd",
      initial: "pnpm create hono {name}"
    });

    if (!r.v) throw new Error("cancel");
    return String(r.v).trim();
  }

  clean(t: CreateTarget) {
    const p = path.resolve(t.path);
    if (!existsSync(p)) return;
    if (p === process.cwd() || p === path.parse(p).root) {
      throw new Appexit("danger");
    }
    rmSync(p, { recursive: true, force: true });
  }

  done(t: CreateTarget) {
    console.log(`cd ${t.name}`);
    console.log("pnpm i");
    console.log("pnpm dev");
  }
}

if (path.resolve(fileURLToPath(import.meta.url)) === path.resolve(process.argv[1])) {
  new CreatePkg().task1();
}

export default CreatePkg;