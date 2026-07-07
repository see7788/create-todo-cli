import GitBase from "../public/git";
import ScriptBase, { type ScriptCmds } from "../public/script";
import NodePackageBinInit from "./nodePackageBinInit";
import NodePkgCreate from "./nodePkgCreate";
import NodePkgDist from "./nodePkgDist";

export default class NodeScript extends ScriptBase {
  public readonly scriptName = "nodeScript";

  protected readonly cmds: ScriptCmds = [
    "nodePkgCreate",
    "nodePkgDist",
    "nodePackageBinInit",
    "nodePackageIdentityInit",
  ];

  protected nodePkgCreateRun(): Promise<void> {
    return new NodePkgCreate().task1();
  }

  protected nodePkgDistRun(): Promise<void> {
    return new NodePkgDist().task1();
  }

  protected nodePackageBinInitRun(): Promise<void> {
    return new NodePackageBinInit().task1();
  }

  protected async nodePackageIdentityInitRun(): Promise<void> {
    await new GitBase().rewriteCurrentPackageIdentity();
  }

}
