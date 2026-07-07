import ProjectBase from "../project";
import ScriptBase from "../script";
import NodePackageBinInit from "./nodePackageBinInit";
import NodePkgCreate from "./nodePkgCreate";
import NodePkgDist from "./nodePkgDist";
import NodePkgFinalize from "./nodePkgFinalize";

export default class NodeScript extends ScriptBase {
  public readonly scriptName = "nodeScript";

  protected readonly cmds = [
    "nodePkgCreate",
    "nodePkgDist",
    "nodePackageIdentityInit",
    "nodePkgFinalize",
    "nodePackageBinInit",
  ];

  protected nodePkgCreateRun(): Promise<void> {
    return new NodePkgCreate().task1();
  }

  protected nodePkgDistRun(): Promise<void> {
    return new NodePkgDist().task1();
  }

  protected async nodePackageIdentityInitRun(): Promise<void> {
    await new ProjectBase().packageIdentity();
  }

  protected nodePkgFinalizeRun(): Promise<void> {
    return new NodePkgFinalize().task1();
  }

  protected nodePackageBinInitRun(): Promise<void> {
    return new NodePackageBinInit().task1();
  }

}
