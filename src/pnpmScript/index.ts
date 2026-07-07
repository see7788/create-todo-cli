import PnpmBase from "../pnpm";
import ScriptBase from "../script";
import PnpmInsert from "./pnpmInsert";

export default class PnpmScript extends ScriptBase {
  public readonly scriptName = "pnpmScript";

  protected readonly cmds = [
    "pnpmInsert",
    "pnpmWorkspaceInit",
    "pnpm dlx github:see7788/codexhono dev",
    "pnpm dlx github:see7788/codexhono stop",
    "pnpm dlx github:see7788/codexhono restart",
  ];

  protected async pnpmInsertRun(): Promise<void> {
    await new PnpmInsert().task1();
  }

  protected async pnpmWorkspaceInitRun(): Promise<void> {
    await new PnpmBase({ requirePackage: false }).workspaceInit();
  }
}
