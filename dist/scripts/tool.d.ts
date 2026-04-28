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
    protected askLocalFilePath(fileExtensions?: string[], initialPath?: string): Promise<string>;
    /**检查目录是否为有效的项目目录 */
    private isProjectDirectory;
}
export {};
//# sourceMappingURL=tool.d.ts.map