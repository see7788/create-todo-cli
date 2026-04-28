#!/usr/bin/env node
import LibBase from "./tool.js";
/**发布管理器类 - 采用流畅异步模式的发布流程管理*/
declare class ReleaseManager extends LibBase {
    nextVersion: string;
    constructor();
    /**执行版本发布工作流 - 编排各个业务步骤的具体执行*/
    task1(): Promise<void>;
    /**检查Git状态并推送到远程仓库 - 合并原checkGitStatus和pushChangesToRemote方法的功能*/
    private checkAndPushGitChanges;
    /**设置下一个版本号*/
    private nextVersionSet;
}
export default ReleaseManager;
//# sourceMappingURL=release.d.ts.map