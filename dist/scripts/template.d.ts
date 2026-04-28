declare class ProjectTemplateCreator {
    /**模板列表*/
    private readonly templates;
    /**确定项目名*/
    private validProjectName;
    /**确定模版 */
    private templatesIndex;
    /**本地项目路径 */
    private localProjectPath;
    /**目标目录路径 - 动态计算项目创建的完整目标目录绝对路径，用于模板克隆和文件操作 */
    private get targetPath();
    /**执行项目创建工作流 - 编排各个业务步骤的具体执行*/
    task1(initialProjectName?: string): Promise<void>;
    /**交互确定项目名称*/
    private validProjectNameSet;
    /**选择模板索引*/
    private templatesIndexSet;
    /**选择本地项目路径 - 优化的多级选择体验 */
    private selectLocalProjectPath;
    /**检查目录是否为有效的项目目录 */
    private isProjectDirectory;
    /**从本地项目生成模板 - 使用子进程调用dist功能 */
    private createFromLocalProject;
    /**使用子进程运行dist命令 */
    private runDistCommand;
    /**复制目录函数 - 递归复制目录内容 */
    private copyDirectory;
    /**用degit创建项目*/
    private createFromdegit;
    private githubpublishFileAdd;
    /**更新package.json中的name字段*/
    private packageJsonNameSet;
    /**清理失败的项目目录 - 仅在有目标目录时执行*/
    private targetPathDEl;
}
export default ProjectTemplateCreator;
//# sourceMappingURL=template.d.ts.map