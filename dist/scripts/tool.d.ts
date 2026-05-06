import type { PackageJson } from 'type-fest';
import { ExecSyncOptionsWithStringEncoding } from 'child_process';
/**应用程序退出错误类 - 用于表示程序无法处理的致命异常情况*/
export declare class Appexit extends Error {
    /**
     * 构造应用程序退出错误
     * @param message 错误消息，描述发生的错误
     */
    constructor(message: string);
}
interface cwdProjectInfo_t {
    pkgPath: string;
    jsonInfo: PackageJson;
    jsonPath: string;
    cwdPath: string;
}
export type GithubPublishConfig = {
    packageName: string;
    targetPath: string;
    workingDirectory?: string;
};
export type ConfirmOutputNameOptions = {
    initialName?: string;
    defaultName: string;
    message: string;
    targetLabel: string;
    existsError?: boolean;
};
export type PackageJsonRecord = {
    name?: string;
    version?: string;
    description?: string;
    author?: string;
    license?: string;
    private?: boolean;
    packageManager?: string;
    repository?: string | {
        type?: string;
        url?: string;
    };
    homepage?: string;
    bugs?: string | {
        url?: string;
    };
    publishConfig?: {
        access?: "public" | "restricted";
    };
    workspaces?: string[];
    pnpm?: {
        overrides?: Record<string, string>;
    } & Record<string, unknown>;
    scripts?: Record<string, string>;
    devDependencies?: Record<string, string>;
    dependencies?: Record<string, string>;
} & Record<string, unknown>;
export type ProjectIdentity = {
    packageName: string;
    repositoryName: string;
    author?: string;
    githubOwner?: string;
    repositoryUrl?: string;
    homepage?: string;
    bugsUrl?: string;
    license: string;
};
/**基类 - 提供通用的工具方法和项目信息访问*/
export default class LibBase {
    protected readonly cwdProjectInfo: cwdProjectInfo_t;
    constructor();
    /**获取当前工作目录的项目信息 - 递归查找package.json*/
    private getcwdProjectInfo;
    /**执行Git命令并处理错误 - 统一Git操作的错误处理（工具方法）*/
    protected runGitCommand(cmd: string, options?: ExecSyncOptionsWithStringEncoding, throwOnError?: boolean): string | null;
    /**执行交互式命令 - 用于需要用户交互的命令（工具方法）*/
    protected runInteractiveCommand(cmd: string, throwOnError?: boolean): void;
    /**执行通用命令并返回结果 - 支持非致命错误模式（工具方法）*/
    protected runCommand(cmd: string, options?: ExecSyncOptionsWithStringEncoding, throwOnError?: boolean): string | null;
    /**从盘符路径直至选择文件的交互式方法 - 支持多级目录导航和文件选择 */
    protected confirmOutputName(options: ConfirmOutputNameOptions): Promise<string>;
    protected rewritePackageJsonIdentity(targetPath: string, packageName: string): ProjectIdentity;
    protected createGithubPublish(config: GithubPublishConfig): string;
    protected finalizeProjectOutput(targetPath: string, packageName: string): Promise<ProjectIdentity>;
    rewriteCurrentPackageIdentity(): Promise<void>;
    setupPnpmWorkspaceRoot(): Promise<void>;
    createCurrentGithubPublish(): Promise<void>;
    private pnpmRootSetupAsk;
    private publishWorkflowAsk;
    private pnpmWorkspaceFileSet;
    private npmrcSet;
    private gitignoreSet;
    private rootPackageJsonSet;
    private linesFileEnsure;
    private isPnpmWorkspaceRoot;
    private githubPublishContent;
    private pnpmVersionGet;
    private validateOutputName;
    protected readJsonFile<T>(filePath: string): T | undefined;
    protected readRequiredJsonFile<T>(filePath: string): T;
    protected writeJsonFile(filePath: string, value: PackageJsonRecord): void;
    protected toPackageName(name: string): string;
    protected findPackageRoot(filePath: string): string;
    protected replaceText(filePath: string, replacements: Record<string, string>): void;
    protected shellArg(value: string): string;
    private readmeIdentitySet;
    private repositoryUrlGet;
    private currentGitHubRepoGet;
    private parseGitHubRepo;
    private githubLoginGet;
    private gitConfigGet;
    private commandGet;
    protected askLocalFilePath(fileExtensions?: string[], initialPath?: string): Promise<string>;
    /**检查目录是否为有效的项目目录 */
    private isProjectDirectory;
}
export {};
//# sourceMappingURL=tool.d.ts.map