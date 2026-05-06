import LibBase from "./tool.js";
export type DistNpmPkgOptions = {
    dist: string;
    entryIndex: string;
    entryMore?: Record<string, string>;
};
type DistNpmPkgResult = {
    dist: string;
    entries: Record<string, string>;
    packageJson: string;
    dts: Record<string, string>;
    js: Record<string, string>;
};
type DistPkgMode = "bundle" | "source";
declare class DistPkg extends LibBase {
    private packageName;
    private entryIndex;
    private get outputPath();
    task1(initialPackageName?: string, initialMode?: DistPkgMode): Promise<void>;
    taskBundle(initialPackageName?: string): Promise<void>;
    taskSource(initialPackageName?: string): Promise<void>;
    build({ dist, entryIndex, entryMore }: DistNpmPkgOptions): Promise<DistNpmPkgResult>;
    private packageDeps;
    private entryImportNames;
    private modeAsk;
    private copySourceProject;
    private sourcePackageEntrySet;
    private copyDirectory;
    private shouldSkipCopy;
}
export default DistPkg;
//# sourceMappingURL=distPkg.d.ts.map