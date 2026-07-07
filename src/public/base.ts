import type { PackageJson } from 'type-fest';
import path from 'path';
import fs from "fs"
import { execSync, spawn } from 'child_process';
import type prompts from 'prompts';

/** Application exit error. */
export class Appexit extends Error {
    /**
     * @param message Error message.
     */
    constructor(message: string) {
        super(message);
        this.name = this.constructor.name;
        Error.captureStackTrace(this, this.constructor);
    }
}
interface cwdProjectInfo_t {
    pkgPath: string;
    workspacePath: string;
    jsonInfo: PackageJson;
    jsonPath: string,
    cwdPath: string
}

type ConfirmOutputNameOptions = {
    basePath?: string;
    defaultName: string;
    message: string;
    existsError?: boolean;
};

type LocalPathMode = "directory" | "file";

type LocalPathOptions = {
    fileExtensions?: string[];
    initialPath?: string;
    mode: LocalPathMode;
    rootPath?: string;
    shouldConfirm?: boolean;
};

type LocalPathChoice = {
    title: string;
    value: string;
};

export type PackageJsonRecord = {
    name?: string;
    version?: string;
    description?: string;
    author?: string;
    license?: string;
    private?: boolean;
    packageManager?: string;
    repository?: string | { type?: string; url?: string };
    homepage?: string;
    bugs?: string | { url?: string };
    publishConfig?: { access?: "public" | "restricted" };
    workspaces?: string[];
    pnpm?: { overrides?: Record<string, string> } & Record<string, unknown>;
    scripts?: Record<string, string>;
    devDependencies?: Record<string, string>;
    dependencies?: Record<string, string>;
} & Record<string, unknown>;

export default class LibBase {
    protected readonly cwdProjectInfo: cwdProjectInfo_t

    constructor(options: { requirePackage?: boolean } = {}) {
        this.cwdProjectInfo = this.getcwdProjectInfo(options.requirePackage ?? true)
    }

    public static pathNormalize(filePath: string): string {
        return path.resolve(filePath).replace(/\\/g, "/").toLowerCase();
    }

    public static pathEqual(leftPath: string, rightPath: string): boolean {
        return this.pathNormalize(leftPath) === this.pathNormalize(rightPath);
    }

    /** 获取当前工作目录的项目信息 - 递归查找 package.json */
    private getcwdProjectInfo(requirePackage: boolean): cwdProjectInfo_t {
        const cwdPath = process.cwd();
        let dir = cwdPath;
        let pkgPath: string | undefined;
        let workspacePath: string | undefined;
        let jsonInfo: PackageJson | undefined;
        let jsonPath = "";
        while (true) {
            const candidateJsonPath = path.join(dir, 'package.json');
            if (fs.existsSync(candidateJsonPath)) {
                const pkgContent = fs.readFileSync(candidateJsonPath, 'utf-8');
                const candidateJsonInfo = JSON.parse(pkgContent) as PackageJson;
                if (!jsonInfo) {
                    pkgPath = dir;
                    jsonPath = candidateJsonPath;
                    jsonInfo = candidateJsonInfo;
                }
                workspacePath = dir;
            }
            const parentDir = path.dirname(dir);
            if (parentDir === dir) break;
            dir = parentDir;
        }
        if (!jsonInfo || !pkgPath || !workspacePath) {
            if (!requirePackage) {
                return {
                    pkgPath: cwdPath,
                    workspacePath: cwdPath,
                    cwdPath,
                    jsonPath: path.join(cwdPath, "package.json"),
                    jsonInfo: {},
                };
            }
            throw new Appexit("不存在 package.json 文件");
        }
        return { pkgPath, workspacePath, cwdPath, jsonPath, jsonInfo };
    }

    /** Run an interactive shell command. */
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
                throw new Appexit("Interactive command failed");
            }
            // 非致命错误，静默失败
        }
    }

    /**确认输出名称 - 支持默认值、名称校验和目标路径确认 */
    protected async confirmOutputName(options: ConfirmOutputNameOptions): Promise<string> {
        let name = "";
        while (true) {
            if (!name) {
                const prompts = await import("prompts");
                const response = await prompts.default({
                    type: "text",
                    name: "name",
                    message: options.message,
                    initial: options.defaultName,
                });
                if (!response.name) {
                    throw new Error("user-cancelled");
                }
                name = String(response.name).trim();
            }

            try {
                this.validateOutputName(name);
                const basePath = options.basePath ?? this.cwdProjectInfo.cwdPath;
                const targetPath = path.resolve(basePath, name);
                if (options.existsError && fs.existsSync(targetPath)) {
                    throw new Error(`目录已存在: ${name}`);
                }

                console.log(this.targetPathsMessage([targetPath]));
                return name;
            } catch (error) {
                if (error instanceof Error && error.message === "user-cancelled") {
                    throw error;
                }
                console.error(error instanceof Error ? error.message : String(error));
                name = "";
            }
        }
    }

    protected packagePath(...paths: string[]): string {
        return path.resolve(this.cwdProjectInfo.pkgPath, ...paths);
    }

    protected packageRelativePath(filePath: string): string {
        return path.relative(this.cwdProjectInfo.pkgPath, filePath).replace(/\\/g, "/");
    }

    protected pathDisplay(filePath: string): string {
        return path.resolve(filePath);
    }

    protected readJsonFile<T = any>(filePath: string): T | undefined {
        try {
            if (!fs.existsSync(filePath)) return undefined;
            return JSON.parse(fs.readFileSync(filePath, 'utf-8')) as T;
        } catch {
            return undefined;
        }
    }

    protected readRequiredJsonFile<T = any>(filePath: string): T {
        const value = this.readJsonFile<T>(filePath);
        if (!value) {
            throw new Appexit(`JSON file not found or invalid: ${filePath}`);
        }
        return value;
    }

    protected writeJsonFile(filePath: string, value: unknown): void {
        fs.writeFileSync(filePath, `${JSON.stringify(value, null, 2)}\n`, 'utf-8');
    }

    protected async targetPathsConfirm(filePaths: string[]): Promise<void> {
        const paths = Array.from(new Set(filePaths.map(filePath => path.resolve(filePath))));
        console.log(this.targetPathsMessage(paths));
    }

    private targetPathsMessage(filePaths: string[]): string {
        return filePaths.map(filePath => this.targetPathLine(filePath)).join("\n");
    }

    private targetPathLine(filePath: string): string {
        return `- ${this.pathDisplay(filePath)} ${fs.existsSync(filePath) ? "覆盖" : "生成"}`;
    }

    protected toPackageName(name: string): string {
        return String(name).trim();
    }

    protected linesFileEnsure(filePath: string, lines: string[]): void {
        const oldLines = fs.existsSync(filePath)
            ? fs.readFileSync(filePath, "utf-8").split(/\r?\n/).filter(Boolean)
            : [];
        const nextLines = Array.from(new Set([...oldLines, ...lines]));
        fs.writeFileSync(filePath, `${nextLines.join("\n")}\n`, "utf-8");
    }

    private validateOutputName(name: string): void {
        if (!name || !String(name).trim()) {
            throw new Error("??????????");
        }
        // ?????????????
        if (/[\/s]/.test(name)) {
            throw new Error("????????????????????");
        }
        // ??????????????????????? @
        if (!/^[a-zA-Z0-9._@-]+$/.test(name)) {
            throw new Error("??????????????");
        }
    }

    protected replaceText(filePath: string, replacements: Record<string, string>): void {
        if (!fs.existsSync(filePath)) {
            return;
        }

        let text = fs.readFileSync(filePath, "utf-8");
        for (const [from, to] of Object.entries(replacements)) {
            text = text.split(from).join(to);
        }
        fs.writeFileSync(filePath, text, "utf-8");
    }

    protected shellArg(value: string): string {
        return `"${value.replace(/"/g, '\\"')}"`;
    }

    protected async commandRunInherit(command: string, cwd: string, label: string): Promise<void> {
        console.log(`running: ${label}`);
        const startTime = Date.now();
        const child = spawn(command, {
            cwd,
            shell: true,
            stdio: "inherit",
            windowsHide: true,
        });
        const heartbeat = setInterval(() => {
            const seconds = Math.round((Date.now() - startTime) / 1000);
            console.log(`still running (${seconds}s): ${label}`);
        }, 15_000);

        try {
            await new Promise<void>((resolve, reject) => {
                child.once("error", reject);
                child.once("close", code => {
                    if (code === 0) {
                        resolve();
                    } else {
                        reject(new Error(`${label} failed with exit code ${code}`));
                    }
                });
            });
        } finally {
            clearInterval(heartbeat);
        }
    }

    protected commandOk(command: string, cwd = process.cwd()): boolean {
        try {
            execSync(command, { cwd, stdio: "ignore" });
            return true;
        } catch {
            return false;
        }
    }

    protected commandRead(command: string, cwd = process.cwd()): string {
        try {
            return execSync(command, { cwd, encoding: "utf-8", stdio: ["ignore", "pipe", "pipe"] }).trim();
        } catch {
            throw new Appexit(`命令执行失败: ${command}`);
        }
    }

    protected commandReadOptional(command: string, cwd = process.cwd()): string | undefined {
        try {
            const value = execSync(command, { cwd, encoding: "utf-8", stdio: ["ignore", "pipe", "ignore"], timeout: 30_000 }).trim();
            return value || undefined;
        } catch {
            return undefined;
        }
    }

    protected commandRun(command: string, cwd = process.cwd()): void {
        try {
            execSync(command, { cwd, stdio: "inherit" });
        } catch {
            throw new Appexit(`命令执行失败: ${command}`);
        }
    }

    protected async askLocalFilePath(fileExtensions: string[] = ['.js', '.jsx', '.ts', '.tsx'], initialPath?: string, shouldConfirm = true, rootPath?: string): Promise<string> {
        return this.askLocalPath({
            fileExtensions,
            initialPath,
            mode: "file",
            rootPath,
            shouldConfirm,
        });
    }

    protected async askLocalPath(options: LocalPathOptions): Promise<string> {
        const prompts = await import('prompts');
        const modeName = options.mode === "file" ? "file" : "directory";
        let currentPath = options.initialPath || process.cwd();
        const shouldConfirm = options.shouldConfirm ?? true;

        while (true) {
            const directoryPath = this.localPathCurrentDirectory(currentPath);
            if (options.rootPath && !this.localPathInRoot(directoryPath, options.rootPath)) {
                throw new Appexit(`Path is outside root: ${directoryPath}`);
            }
            const pathChoices = this.localPathChoices(options, currentPath);
            if (pathChoices.length > 0) {
                const response = await prompts.default({
                    type: "select",
                    name: "pathValue",
                    message: `${options.mode === "file" ? "选择入口文件" : "选择目录"}: ${this.pathDisplay(directoryPath)}`,
                    choices: pathChoices,
                });
                if (!response.pathValue) {
                    throw new Error("user-cancelled");
                }
                currentPath = String(response.pathValue);
            } else {
                throw new Appexit(`No selectable ${modeName} path: ${currentPath}`);
            }

            currentPath = path.resolve(currentPath.trim());
            if (options.rootPath && !this.localPathInRoot(currentPath, options.rootPath)) {
                throw new Appexit(`Path is outside root: ${currentPath}`);
            }
            if (options.mode === "file" && fs.existsSync(currentPath) && fs.statSync(currentPath).isDirectory()) {
                continue;
            }

            const exists = fs.existsSync(currentPath);
            const stat = exists ? fs.statSync(currentPath) : undefined;
            const modeMatched = options.mode === "file" ? stat?.isFile() : stat?.isDirectory();
            const extensionMatched = this.localPathExtensionMatched(currentPath, options);

            if (!exists || !modeMatched || !extensionMatched) {
                throw new Appexit(`Invalid ${modeName} path: ${currentPath}`);
            }

            if (!shouldConfirm) {
                return currentPath;
            }

            const confirmResponse = await prompts.default({
                type: "confirm",
                name: "confirmed",
                message: `确认${options.mode === "file" ? "入口文件" : "目录"}: ${this.pathDisplay(currentPath)}?`,
                initial: true,
            });
            if (confirmResponse.confirmed === undefined) {
                throw new Error("user-cancelled");
            }
            if (confirmResponse.confirmed) {
                return currentPath;
            }
        }
    }

    private localPathChoices(options: LocalPathOptions, currentPath: string): LocalPathChoice[] {
        const directoryPath = this.localPathCurrentDirectory(currentPath);
        const defaultPath = path.resolve(currentPath);
        const candidatePaths: LocalPathChoice[] = [];
        const parentPath = path.dirname(directoryPath);
        const workspacePath = this.cwdProjectInfo.workspacePath || this.cwdProjectInfo.pkgPath;

        if (
            parentPath !== directoryPath
            && (!options.rootPath || this.localPathInRoot(parentPath, options.rootPath))
        ) {
            candidatePaths.push({
                title: `返回上级 ${this.localPathChoiceDisplay(parentPath, workspacePath)}/`,
                value: parentPath,
            });
        }

        if (options.mode === "directory" && this.localPathMatched(directoryPath, options)) {
            candidatePaths.push({
                title: `选择当前目录 ${this.localPathChoiceDisplay(directoryPath, workspacePath)}/`,
                value: directoryPath,
            });
        }

        if (
            this.localPathMatched(defaultPath, options)
            && !(options.mode === "directory" && defaultPath === directoryPath)
        ) {
            candidatePaths.push({
                title: `${options.mode === "file" ? "选择文件" : "选择目录"} ${this.localPathChoiceDisplay(defaultPath, workspacePath)}`,
                value: defaultPath,
            });
        }

        const dirents = this.localPathDirents(directoryPath);
        const directories = dirents
            .filter(dirent => dirent.isDirectory())
            .filter(dirent => !this.localPathIgnoredDirectoryName(dirent.name))
            .map(dirent => path.join(directoryPath, dirent.name))
            .filter(directory => !options.rootPath || this.localPathInRoot(directory, options.rootPath))
            .sort((leftPath, rightPath) => leftPath.localeCompare(rightPath));
        const files = dirents
            .filter(dirent => dirent.isFile())
            .map(dirent => path.join(directoryPath, dirent.name))
            .filter(filePath => !options.rootPath || this.localPathInRoot(filePath, options.rootPath))
            .filter(filePath => this.localPathMatched(filePath, options))
            .sort((leftPath, rightPath) => leftPath.localeCompare(rightPath));

        for (const directory of directories) {
            candidatePaths.push({
                title: `进入目录 ${this.localPathChoiceDisplay(directory, workspacePath)}/`,
                value: directory,
            });
        }

        for (const file of files) {
            if (file === defaultPath && candidatePaths.some(choice => choice.value === file)) {
                continue;
            }
            candidatePaths.push({
                title: `选择文件 ${this.localPathChoiceDisplay(file, workspacePath)}`,
                value: file,
            });
        }

        return candidatePaths.slice(0, 40);
    }

    private localPathChoiceDisplay(targetPath: string, basePath: string): string {
        const relativePath = path.relative(basePath, targetPath).replace(/\\/g, "/");
        return relativePath && !relativePath.startsWith("..")
            ? relativePath
            : this.pathDisplay(targetPath);
    }

    private localPathInRoot(targetPath: string, rootPath: string): boolean {
        const normalizedTargetPath = LibBase.pathNormalize(targetPath);
        const normalizedRootPath = LibBase.pathNormalize(rootPath);
        return normalizedTargetPath === normalizedRootPath
            || normalizedTargetPath.startsWith(`${normalizedRootPath}/`);
    }

    private localPathCurrentDirectory(currentPath: string): string {
        const resolvedPath = path.resolve(currentPath);
        if (!fs.existsSync(resolvedPath)) {
            throw new Appexit(`Path does not exist: ${resolvedPath}`);
        }
        const stat = fs.statSync(resolvedPath);
        return stat.isDirectory() ? resolvedPath : path.dirname(resolvedPath);
    }

    private localPathDirents(directoryPath: string): fs.Dirent[] {
        try {
            return fs.readdirSync(directoryPath, { withFileTypes: true });
        } catch {
            return [];
        }
    }

    private localPathIgnoredDirectoryName(directoryName: string): boolean {
        return new Set([
            ".git",
            ".log",
            ".next",
            ".output",
            ".turbo",
            "build",
            "coverage",
            "dist",
            "node_modules",
        ]).has(directoryName);
    }

    private localPathMatched(filePath: string, options: LocalPathOptions): boolean {
        try {
            if (!fs.existsSync(filePath)) {
                return false;
            }
            const stat = fs.statSync(filePath);
            const modeMatched = options.mode === "file" ? stat.isFile() : stat.isDirectory();
            if (!modeMatched) {
                return false;
            }
        } catch {
            return false;
        }
        return options.mode !== "file"
            || this.localPathExtensionMatched(filePath, options);
    }

    private localPathExtensionMatched(filePath: string, options: LocalPathOptions): boolean {
        if (options.mode !== "file" || !options.fileExtensions?.length) {
            return true;
        }
        if (filePath.endsWith(".d.ts")) {
            return false;
        }
        const fileExtension = path.extname(filePath).toLowerCase();
        return options.fileExtensions
            .map(extension => extension.toLowerCase())
            .includes(fileExtension);
    }

}
