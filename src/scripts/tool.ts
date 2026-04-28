import type { PackageJson } from 'type-fest';
import path from 'path';
import fs from "fs"
import { execSync, ExecSyncOptionsWithStringEncoding } from 'child_process';
import type prompts from 'prompts';

/**应用程序退出错误类 - 用于表示程序无法处理的致命异常情况*/
export class Appexit extends Error {
    /**
     * 构造应用程序退出错误
     * @param message 错误消息，描述发生的错误
     */
    constructor(message: string) {
        super(message);
        this.name = this.constructor.name;
        Error.captureStackTrace(this, this.constructor);
    }
}
interface cwdProjectInfo_t {
    pkgPath: string;
    jsonInfo: PackageJson;
    jsonPath: string,
    cwdPath: string
}
/**基类 - 提供通用的工具方法和项目信息访问*/
export default class LibBase {
    protected readonly cwdProjectInfo: cwdProjectInfo_t
    constructor() {
        this.cwdProjectInfo = this.getcwdProjectInfo()
    }

    /**获取当前工作目录的项目信息 - 递归查找package.json*/
    private getcwdProjectInfo(): cwdProjectInfo_t {
        let dir = process.cwd();
        while (dir !== path.parse(dir).root) {
            const jsonPath = path.join(dir, 'package.json');
            if (fs.existsSync(jsonPath)) {
                const pkgContent = fs.readFileSync(jsonPath, 'utf-8');
                const jsonInfo: PackageJson = JSON.parse(pkgContent);
                return { pkgPath: dir, cwdPath: process.cwd(), jsonPath: jsonPath, jsonInfo };
            }
            dir = path.dirname(dir);
        }
        throw new Appexit('不存在 package.json 文件');
    }

    /**执行Git命令并处理错误 - 统一Git操作的错误处理（工具方法）*/
    protected runGitCommand(cmd: string, options?: ExecSyncOptionsWithStringEncoding, throwOnError: boolean = true): string | null {
        try {
            // 禁止LF/CRLF警告输出，提升用户体验
            const result = execSync(`git -c core.safecrlf=false ${cmd}`, {
                stdio: 'pipe',
                cwd: process.cwd(),
                ...(options || {})
            });
            return result.toString().trim();
        } catch (error: any) {
            if (throwOnError) {
                // 致命错误
                throw new Appexit(`Git命令执行失败: ${cmd}`);
            }
            // 非致命错误，返回null
            return null;
        }
    }

    /**执行交互式命令 - 用于需要用户交互的命令（工具方法）*/
    protected runInteractiveCommand(cmd: string, throwOnError: boolean = true): void {
        try {
            // 如果是git命令，添加参数禁止LF/CRLF警告
            if (cmd.startsWith('git')) {
                cmd = cmd.replace('git', 'git -c core.safecrlf=false');
            }
            execSync(cmd, { stdio: 'inherit', cwd: process.cwd() });
        } catch (error: any) {
            if (throwOnError) {
                // 交互式命令执行失败是致命错误
                throw new Appexit('交互式命令执行失败');
            }
            // 非致命错误，静默失败
        }
    }

    /**执行通用命令并返回结果 - 支持非致命错误模式（工具方法）*/
    protected runCommand(cmd: string, options?: ExecSyncOptionsWithStringEncoding, throwOnError: boolean = true): string | null {
        try {
            const result = execSync(cmd, {
                stdio: 'pipe',
                cwd: process.cwd(),
                ...(options || {})
            });
            return result.toString().trim();
        } catch (error: any) {
            if (throwOnError) {
                // 致命错误
                throw new Appexit(`命令执行失败: ${cmd}`);
            }
            // 非致命错误，返回null
            return null;
        }
    }

    /**从盘符路径直至选择文件的交互式方法 - 支持多级目录导航和文件选择 */
    protected async askLocalFilePath(fileExtensions: string[] = ['.js', '.jsx', '.ts', '.tsx'], initialPath?: string): Promise<string> {
        const prompts = await import('prompts');
        console.log('📁 开始文件选择...');

        // 首先获取可用的磁盘驱动器
        let availableDrives: string[] = [];
        if (process.platform === 'win32') {
            // Windows平台获取所有可用磁盘
            try {
                const drivesOutput = execSync('wmic logicaldisk get caption', { encoding: 'utf8' });
                availableDrives = drivesOutput
                    .split('\n')
                    .map(line => line.trim())
                    .filter(line => /^[A-Z]:$/.test(line));

                // 添加当前目录作为快速访问选项
                const currentDrive = process.cwd().split(':')[0] + ':';
                if (!availableDrives.includes(currentDrive)) {
                    availableDrives.push(currentDrive);
                }
            } catch (error) {
                console.warn('⚠️ 无法获取磁盘列表，使用默认路径');
                availableDrives = ['C:', process.cwd().split(':')[0] + ':'];
            }
        } else {
            // 非Windows平台默认使用根目录和当前目录
            availableDrives = ['/', process.cwd()];
        }

        // 如果提供了初始路径，直接使用它
        let currentPath = initialPath || process.cwd();

        // 如果没有初始路径，让用户选择磁盘/根目录
        if (!initialPath) {
            console.log('\n🔍 第1步：选择磁盘驱动器');
            const driveResponse = await prompts.default({
                type: 'select',
                name: 'drive',
                message: '请选择要查找文件的磁盘驱动器',
                choices: availableDrives.map(drive => ({
                    title: drive === process.cwd().split(':')[0] + ':' ? `${drive} (当前磁盘)` : drive,
                    value: drive
                }))
            });

            if (!driveResponse.drive) {
                const error = new Error('user-cancelled');
                throw error;
            }

            console.log(`✅ 已选择: ${driveResponse.drive}`);
            currentPath = driveResponse.drive;
        }

        let navigationLevel = initialPath ? 1 : 2; // 导航层级计数

        // 多级导航选择目录和文件
        while (true) {
            navigationLevel++;
            console.log(`\n🔍 第${navigationLevel}步：浏览目录结构`);

            // 获取当前目录下的所有文件和文件夹
            let items: { name: string; path: string; isDirectory: boolean }[] = [];
            try {
                const files = fs.readdirSync(currentPath);
                items = files
                    .map(name => {
                        const itemPath = path.join(currentPath, name);
                        try {
                            const stats = fs.statSync(itemPath);
                            return { name, path: itemPath, isDirectory: stats.isDirectory() };
                        } catch (error) {
                            // 跳过无法访问的文件/文件夹
                            return null;
                        }
                    })
                    .filter((item): item is { name: string; path: string; isDirectory: boolean } => item !== null) // 类型断言过滤null值
                    .sort((a, b) => {
                        // 文件夹排在前面，文件排在后面
                        if (a.isDirectory && !b.isDirectory) return -1;
                        if (!a.isDirectory && b.isDirectory) return 1;
                        // 同类项按名称排序
                        return a.name.localeCompare(b.name);
                    });
            } catch (error) {
                console.error('❌ 无法读取目录内容:', error);
                // 让用户重试或取消
                const retryResponse = await prompts.default({
                    type: 'confirm',
                    name: 'retry',
                    message: '是否重试访问该目录？',
                    initial: true
                });

                if (!retryResponse.retry) {
                    // 给用户返回上一级的选项
                    const goBackResponse = await prompts.default({
                        type: 'confirm',
                        name: 'goBack',
                        message: '是否返回上一级目录？',
                        initial: true
                    });

                    if (goBackResponse.goBack) {
                        const parentPath = path.dirname(currentPath);
                        if (parentPath !== currentPath) {
                            currentPath = parentPath;
                            navigationLevel--;
                            continue;
                        }
                    }

                    const error = new Error('user-cancelled');
                    throw error;
                }
                continue;
            }

            // 添加特殊选项
            const specialChoices = [
                { title: '.. (上一级目录)', value: '..' },
                { title: '🏠 当前工作目录', value: 'current' },
                { title: '❌ 取消选择', value: 'cancel' }
            ];

            // 构建文件/文件夹选项
            const itemChoices = items.map(item => {
                const isTargetFile = !item.isDirectory && fileExtensions.some(ext => item.name.toLowerCase().endsWith(ext));
                return {
                    title: item.isDirectory
                        ? `📁 ${item.name}${this.isProjectDirectory(item.path) ? ' (项目目录)' : ''}`
                        : isTargetFile
                            ? `🎯 ${item.name} (目标文件)`
                            : `📄 ${item.name}`,
                    value: item.path,
                    disabled: !item.isDirectory && !isTargetFile // 禁用非目标文件类型
                };
            });

            // 组合所有选项
            const choices = [...specialChoices, ...itemChoices];

            // 询问用户选择
            const selectionResponse = await prompts.default({
                type: 'select',
                name: 'selection',
                message: `\n当前位置: ${currentPath}\n请选择一个目录进入，或选择一个目标文件`,
                choices
            });

            // 处理特殊选择
            if (!selectionResponse.selection) {
                const error = new Error('user-cancelled');
                throw error;
            }

            // 处理特殊选项
            if (selectionResponse.selection === 'cancel') {
                const error = new Error('user-cancelled');
                throw error;
            } else if (selectionResponse.selection === 'current') {
                currentPath = process.cwd();
                console.log(`📂 已切换到当前工作目录: ${currentPath}`);
                continue;
            } else if (selectionResponse.selection === '..') {
                // 向上一级
                const parentPath = path.dirname(currentPath);
                if (parentPath !== currentPath) { // 防止到达根目录时无限循环
                    console.log(`⬆️ 返回上一级目录`);
                    currentPath = parentPath;
                    navigationLevel--;
                } else {
                    console.log('⚠️ 已经到达根目录，无法继续向上');
                }
                continue;
            }

            // 处理常规选择
            try {
                const stats = fs.statSync(selectionResponse.selection);
                if (stats.isDirectory()) {
                    // 进入子目录
                    currentPath = selectionResponse.selection;
                    console.log(`📂 已进入目录: ${path.basename(currentPath)}`);
                } else {
                    // 选择了文件，检查是否为目标文件类型
                    const isTargetFile = fileExtensions.some(ext =>
                        selectionResponse.selection.toLowerCase().endsWith(ext)
                    );

                    if (isTargetFile) {
                        // 确认选择
                        const confirmResponse = await prompts.default({
                            type: 'confirm',
                            name: 'confirm',
                            message: `\n已选择文件: ${selectionResponse.selection}\n是否确认使用此文件？`,
                            initial: true
                        });

                        if (confirmResponse.confirm) {
                            console.log(`\n✅ 已选择文件: ${selectionResponse.selection}`);
                            return selectionResponse.selection;
                        }
                    }
                }
            } catch (error) {
                console.error('❌ 无法访问选定的项目:', error);
                continue;
            }
        }
    }

    /**检查目录是否为有效的项目目录 */
    private isProjectDirectory(dirPath: string): boolean {
        try {
            return fs.existsSync(path.join(dirPath, 'package.json'));
        } catch (error) {
            return false;
        }
    }
}