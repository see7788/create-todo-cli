import GithubBase from "../github";
import ScriptBase from "../script";

export default class GithubScript extends ScriptBase {
  public readonly scriptName = "githubScript";

  protected readonly cmds = [
    "githubPublishYmlInit",
  ];

  protected async githubPublishYmlInitRun(): Promise<void> {
    await new GithubBase().publishYmlInit();
  }
}
