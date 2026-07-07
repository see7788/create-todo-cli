import ScriptBase, { type ScriptCmds } from "../public/script";
import GitBase from "../public/git";
import GitAutoPush from "./gitAutoPush";
import GitPush from "./gitPush";

export default class GitScript extends ScriptBase {
  public readonly scriptName = "gitScript";

  protected readonly cmds: ScriptCmds = [
    "gitPush",
    "gitAutoPush",
    "gitignoreInit",
  ];

  protected async gitPushRun(): Promise<void> {
    await new GitPush().task1();
  }

  protected async gitAutoPushRun(): Promise<void> {
    await new GitAutoPush().task1();
  }

  protected async gitignoreInitRun(): Promise<void> {
    await new GitBase().initCurrentGitignore();
  }
}
