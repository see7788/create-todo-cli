import GitBase from "../public/git";
import NodePackageBinInit from "./nodePackageBinInit";
import NodePkgCreate from "./nodePkgCreate";
import NodePkgDist from "./nodePkgDist";

type CommandContext = {
  param?: string;
  source?: string;
};

class NodeScript {
  public readonly menu = {
    "nodeScript/nodePkgCreate  create project": this.nodePkgCreate,
    "nodeScript/nodePkgDist  dist npm package": this.nodePkgDist,
    "nodeScript/nodePackageBinInit  init package.json bin TS/JS entry": this.nodePackageBinInit,
    "nodeScript/nodePackageIdentityInit  init package.json identity": this.nodePackageIdentityInit,
  } as const;

  public readonly command = {
    nodePkgCreate: this.nodePkgCreate,
    nodePkgDist: this.nodePkgDist,
    nodePackageBinInit: this.nodePackageBinInit,
    nodePackageIdentityInit: this.nodePackageIdentityInit,
  } as const;

  private nodePkgCreate({ param, source }: CommandContext): Promise<void> {
    return new NodePkgCreate().task1(param, source);
  }

  private nodePkgDist({ param }: CommandContext): Promise<void> {
    return new NodePkgDist().task1(param);
  }

  private nodePackageBinInit({ param }: CommandContext): Promise<void> {
    return new NodePackageBinInit().task1(param);
  }

  private nodePackageIdentityInit(): Promise<void> {
    return new GitBase().rewriteCurrentPackageIdentity();
  }
}

export const nodeScript = new NodeScript();

export default nodeScript;
