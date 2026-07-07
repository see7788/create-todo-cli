import ScriptBase, { type ScriptCmds } from "../public/script";
import GitBase from "../public/git";
import PnpmInsert from "./pnpmInsert";

export default class PnpmScript extends ScriptBase {
  public readonly scriptName = "pnpmScript";

  protected readonly cmds: ScriptCmds = [
    "pnpmInsert",
    "pnpmWorkspaceInit",
  ];

  protected async pnpmInsertRun(): Promise<void> {
    await new PnpmInsert().task1();
  }

  protected async pnpmWorkspaceInitRun(): Promise<void> {
    await new GitBase().setupPnpmWorkspaceRoot();
  }
}
