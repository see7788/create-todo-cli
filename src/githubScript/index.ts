import ScriptBase, { type ScriptCmds } from "../public/script";
import GithubPublishYmlInit from "./githubPublishYmlInit";

export default class GithubScript extends ScriptBase {
  public readonly scriptName = "githubScript";

  protected readonly cmds: ScriptCmds = [
    "githubPublishYmlInit",
  ];

  protected async githubPublishYmlInitRun(): Promise<void> {
    await new GithubPublishYmlInit().createCurrent();
  }
}
