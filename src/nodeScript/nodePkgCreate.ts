import { existsSync, rmSync } from "node:fs";
import path from "path";
import prompts from "prompts";
import GitBase, { Appexit } from "../public/git";

type CreateTarget = { name: string; path: string };

class NodePkgCreate extends GitBase {
  private sourceCreateMap: Record<string, (c: CreateTarget) => string | Promise<string>> = {
    Vite脚手架: (c) => `pnpm create vite "${c.name}"`,
    VSCode插件脚手架: (c) => `pnpm create vscode-extension "${c.name}"`,
    Electron脚手架: (c) => `degit see7788/electron-template "${c.name}"`,
    TS脚手架: (c) => `degit see7788/ts-template "${c.name}"`,
    Hono脚手架: (c) => `pnpm create hono "${c.name}"`,
    degit克隆: async () => {
      const repo = await this.askRepo();
      return `degit ${repo} "${repo.split("/")[1]}"`;
    },
    Custom命令: async (c) => {
      const cmd = await this.askCmd();
      return cmd.replaceAll("{name}", c.name).replaceAll("{path}", c.path);
    },
  };

  async task1() {
    const target = await this.askTarget();
    const sourceCreate = await this.askSource();

    try {
      const cmd = await sourceCreate(target);
      this.runInteractiveCommand(cmd);
      await this.finalizeProjectOutput(target.path, target.name);
      this.done(target);
    } catch (e) {
      this.clean(target);
      throw e;
    }
  }

  async askTarget(): Promise<CreateTarget> {
    const name = await this.confirmOutputName({
      defaultName: "my-app",
      message: "name",
      existsError: true
    });

    return {
      name,
      path: path.resolve(this.cwdProjectInfo.cwdPath, name)
    };
  }

  async askSource(): Promise<(c: CreateTarget) => string | Promise<string>> {
    const r = await prompts({
      type: "select",
      name: "v",
      message: "source",
      choices: Object.keys(this.sourceCreateMap).map(sourceName => ({
        title: sourceName,
        value: sourceName
      }))
    });

    if (r.v === undefined) throw new Error("cancel");
    return this.sourceCreateMap[String(r.v)];
  }

  async askRepo() {
    const r = await prompts({
      type: "text",
      name: "v",
      message: "repo"
    });

    if (!r.v) throw new Error("cancel");

    const v = String(r.v).trim();
    const m = this.githubRemoteParse(v);
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

export default NodePkgCreate;
