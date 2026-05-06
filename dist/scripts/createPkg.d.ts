import LibBase from "./tool.js";
declare class CreatePkg extends LibBase {
    private readonly templates;
    private validProjectName;
    private templatesIndex;
    private localProjectPath;
    private targetCreated;
    private get targetPath();
    task1(initialProjectName?: string): Promise<void>;
    /**选择模板索引*/
    private templatesIndexSet;
    /**选择本地项目路径 - 优化的多级选择体验 */
    private selectLocalProjectPath;
    /**检查目录是否为有效的项目目录 */
    private isLocalProjectDirectory;
    /**从本地项目抽取源码，不执行打包转换 */
    private createFromLocalProject;
    /**复制目录函数 - 递归复制目录内容 */
    private copyDirectory;
    private shouldSkipCopy;
    /**用degit创建项目*/
    private createFromdegit;
    /**清理失败的项目目录 - 仅在有目标目录时执行*/
    private targetPathDEl;
}
export default CreatePkg;
//# sourceMappingURL=createPkg.d.ts.map