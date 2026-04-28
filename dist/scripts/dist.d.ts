#!/usr/bin/env node
import LibBase from "./tool.js";
declare class DistPackageBuilder extends LibBase {
    private entryFilePath;
    private distDirName;
    private get distPath();
    constructor();
    task1(): Promise<void>;
    private askDistDirName;
    private askEntryFilePath;
    /**构建JS文件和类型定义 - 使用tsup构建系统*/
    private buildJsFile;
    /**分析并提取使用的依赖项 - 结合esbuild分析 */
    private createPackageJson;
}
export default DistPackageBuilder;
//# sourceMappingURL=dist.d.ts.map