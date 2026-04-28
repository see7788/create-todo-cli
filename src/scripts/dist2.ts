// scripts/extract-preload.ts
import { Project, SyntaxKind, SourceFile } from "ts-morph";
import path from 'path';
import fs from "fs"
import ts from "typescript"
import LibBase, { Appexit } from "./tool.js";
import prompts from "prompts"
export default class extends LibBase {
    //入口文件路径
    private entryFilePath!: string
    //产物目录名称，作为项目名称
    private distDirName: string = "dist";
    private dependencies: Set<string> = new Set()
    private get distPath() {
        return path.join(this.cwdProjectInfo.cwdPath, this.distDirName)
    }
    constructor() {
        super()
    }
    async task1(): Promise<void> {
        console.log('\n🚀 开始抽取流程');

        console.log('📋 1. 交互定义dist目录名称');
        await this.askDistDirName();

        console.log('📋 2. 交互定义入口文件');
        await this.askEntryFilePath();

        console.log('⚙️3. 源码依赖抽取、依赖抽取');
        await this.extractToFile();

        console.log('⚙️4. 生成package.json');
        await this.createJson();
        console.log('\n🚀 完成抽取流程');
    }
    private async askDistDirName(): Promise<void> {
        let isValid = false;
        let dirName = this.distDirName;

        while (!isValid) {
            const response = await prompts({
                type: 'text',
                name: 'distName',
                message: '请输入目录名称 (同时是作为package.name，可直接回车使用默认值)',
                initial: dirName,
                validate: (value: string) => {
                    const trimmedValue = value.trim();
                    const validNameRegex = /^[a-zA-Z0-9-_]+$/;

                    if (!trimmedValue) return '目录名不能为空';
                    if (!validNameRegex.test(trimmedValue)) return '目录名只能包含字母、数字、- 和 _';

                    // 检查是否存在同名目录
                    const targetPath = path.join(this.cwdProjectInfo.cwdPath, trimmedValue);
                    if (fs.existsSync(targetPath) && fs.statSync(targetPath).isDirectory()) {
                        return `${targetPath} 已存在，请选择其他名称`;
                    } else {
                        fs.mkdirSync(targetPath, { recursive: true });
                    }
                    return true;
                }
            });

            // 用户取消操作
            if (response.distName === undefined) {
                const error = new Error('user-cancelled');
                throw error;
            }

            dirName = response.distName.trim();
            isValid = true;
        }

        // 更新目录名称
        this.distDirName = dirName;
        console.log(`📁 输出目录已设置为: ${this.distPath}`);
    }
    private async askEntryFilePath(): Promise<void> {
        // 使用当前执行命令时的工作目录
        const currentCwd = this.cwdProjectInfo.cwdPath
        console.log(`[DEBUG] 当前工作目录: ${currentCwd}`, process.argv);

        // 读取当前目录内的文件，过滤保留特定扩展名的文件
        const list = fs.readdirSync(currentCwd, { withFileTypes: true })
            .filter((dirent: fs.Dirent) => dirent.isFile() && /\.(js|jsx|ts|tsx|cjs|mjs)$/i.test(dirent.name))
            .map((dirent: fs.Dirent) => dirent.name);

        if (list.length > 0) {
            // 简单按文件名排序
            list.sort((a, b) => a.localeCompare(b));

            // 默认选择第一个文件
            const defaultIndex = 0;

            // 使用prompts让用户选择
            const prompts = await import('prompts');
            const response = await prompts.default({
                type: 'select',
                name: 'entryFile',
                message: '请选择入口文件',
                choices: list.map((file, index) => ({
                    title: file,
                    value: file
                })),
                initial: defaultIndex
            });

            // 用户取消操作
            if (response.entryFile === undefined) {
                const error = new Error('user-cancelled');
                throw error;
            }

            // 设置完整的入口文件路径
            this.entryFilePath = path.join(currentCwd, response.entryFile);
            console.log(`✅ 已选择入口文件: ${response.entryFile}`);
        } else {
            throw new Appexit('未找到有效的入口文件');
        }
    }
    private async createJson() {
        const dependencies = { ...this.cwdProjectInfo.jsonInfo.dependencies, ...this.cwdProjectInfo.jsonInfo.devDependencies }
       const result:Record<string,string>={}
        for (const name of this.dependencies) {
            if (dependencies[name]) {
                result[name] = dependencies[name];
            }
        }
        console.log({result})
    }
    private async extractToFile(): Promise<void> {
        const project = new Project({
            tsConfigFilePath: path.join(this.cwdProjectInfo.pkgPath, 'tsconfig.json'),
            skipFileDependencyResolution: true,
        });

        const sourceFile = project.getSourceFileOrThrow(this.entryFilePath);
        const entryExt = path.extname(this.entryFilePath);
        const entryBasename = path.basename(this.entryFilePath, entryExt);
        const outputDirForEntry = path.join(this.distPath, entryBasename);

        // 创建输出目录
        fs.mkdirSync(outputDirForEntry, { recursive: true });

        const emittedFileNames = new Set<string>();
        const processedFiles = new Set<string>();

        // ========== 工具函数 ==========

        /**
         * 解析相对模块路径（支持 ./ ../ index 文件 扩展名补全）
         */
        const resolveModulePath = (specifier: string, fromDir: string): string | null => {
            if (!specifier.startsWith('.')) return null;
            let resolved = path.resolve(fromDir, specifier);
            if (fs.existsSync(resolved) && fs.statSync(resolved).isFile()) return resolved;

            for (const ext of ['.ts', '.tsx', '.js', '.jsx', '.mjs', '.cjs']) {
                const indexPath = path.join(resolved, `index${ext}`);
                if (fs.existsSync(indexPath)) return indexPath;
            }

            for (const ext of ['.ts', '.tsx', '.js', '.jsx', '.mjs', '.cjs']) {
                const fullPath = resolved + ext;
                if (fs.existsSync(fullPath)) return fullPath;
            }

            return null;
        };

        /**
         * 使用 ts.printer 移除代码中的注释
         */
        const removeComments = (code: string, filePath: string): string => {
            const sf = ts.createSourceFile(filePath, code, ts.ScriptTarget.Latest, false, ts.ScriptKind.TS);
            const printer = ts.createPrinter({ removeComments: true });
            return printer.printFile(sf);
        };

        /**Tree Shaking：移除未使用的导入/变量/函数等*/
        const treeShaking = (f: SourceFile) => {
            // 1. 命名导入
            f.getImportDeclarations().forEach(decl => {
                const namedImports = decl.getNamedImports();
                const unused = namedImports.filter(imp => {
                    const name = imp.getName();
                    const refs = f.getDescendantsOfKind(SyntaxKind.Identifier).filter(id => id.getText() === name);
                    return refs.length === 0;
                });
                unused.forEach(imp => imp.remove());
                if (!decl.getNamedImports().length && !decl.getDefaultImport() && !decl.getNamespaceImport()) {
                    decl.remove();
                }
            });

            // 2. 变量声明
            f.getVariableStatements().forEach(stmt => {
                if (stmt.isExported()) return;
                const declarations = stmt.getDeclarations();
                const toKeep = declarations.filter(decl => {
                    const name = decl.getName();
                    const refs = f.getDescendantsOfKind(SyntaxKind.Identifier).filter(id => id.getText() === name);
                    return refs.length > 1;
                });
                if (toKeep.length === 0) {
                    stmt.remove();
                } else if (toKeep.length < declarations.length) {
                    const names = toKeep.map(d => d.getName()).join(', ');
                    const type = toKeep[0].getTypeNode() ? `: ${toKeep[0].getTypeNode()?.getText()}` : '';
                    const init = toKeep[0].getInitializer() ? ` = ${toKeep[0].getInitializer()?.getText()}` : '';
                    stmt.replaceWithText(`const ${names}${type}${init};`);
                }
            });

            // 3. 函数
            f.getFunctions().forEach(fn => {
                if (fn.isExported()) return;
                const name = fn.getName();
                if (!name) return;
                const refs = f.getDescendantsOfKind(SyntaxKind.Identifier).filter(id => id.getText() === name);
                if (refs.length <= 1) fn.remove();
            });

            // 4. 类
            f.getClasses().forEach(cls => {
                if (cls.isExported()) return;
                const name = cls.getName();
                if (!name) return;
                const refs = f.getDescendantsOfKind(SyntaxKind.Identifier).filter(id => id.getText() === name);
                if (refs.length <= 1) cls.remove();
            });

            // 5. 类型别名
            f.getTypeAliases().forEach(ta => {
                if (ta.isExported()) return;
                const name = ta.getName();
                const refs = f.getDescendantsOfKind(SyntaxKind.Identifier).filter(id => id.getText() === name);
                if (refs.length <= 1) ta.remove();
            });

            // 6. 接口
            f.getInterfaces().forEach(iface => {
                if (iface.isExported()) return;
                const name = iface.getName();
                if (!name) return;
                const refs = f.getDescendantsOfKind(SyntaxKind.Identifier).filter(id => id.getText() === name);
                if (refs.length <= 1) iface.remove();
            });
        };

        /**
         * 生成输出文件名：
         * - 入口文件 → index.ts
         * - 其他文件 → dir_file.ts（扁平化防重名）
         */
        const getOutputFileName = (filePath: string): string => {
            const normalizedFilePath = path.normalize(filePath);
            const normalizedEntryPath = path.normalize(this.entryFilePath);

            if (normalizedFilePath === normalizedEntryPath) {
                return `index${entryExt}`;
            }
            const relative = path.relative(this.cwdProjectInfo.pkgPath, filePath);
            const ext = path.extname(relative);
            return relative.replace(/\\/g, '/').replace(/[\\/]/g, '_').replace(ext, '') + ext;
        };

        /**
         * 处理单个文件：重写导入、shaking、输出
         */
        const processFile = (file: SourceFile) => {
            const filePath = file.getFilePath();
            if (processedFiles.has(filePath)) return;
            processedFiles.add(filePath);

            const fileName = getOutputFileName(filePath);
            const outputPath = path.join(outputDirForEntry, fileName);

            if (emittedFileNames.has(fileName)) {
                console.warn(`⚠️ 同名文件已存在，跳过: ${fileName}`);
                return;
            }

            const dirPath = path.dirname(filePath);

            // 重写 import './xxx'
            file.getImportDeclarations().forEach(decl => {
                const specifier = decl.getModuleSpecifierValue();
                if (!specifier || !specifier.startsWith('.')) return;
                const resolvedPath = resolveModulePath(specifier, dirPath);
                if (!resolvedPath) {
                    console.warn(`⚠️ 未找到模块，跳过导入: ${specifier}`);
                    return;
                }
                const importedFileName = getOutputFileName(resolvedPath);
                const importPathWithoutExt = importedFileName.replace(/\.(ts|tsx|js|jsx|mjs|cjs)$/, ''); // ✅ 移除扩展名
                const relativeImport = path.relative(path.dirname(outputPath), path.join(outputDirForEntry, importPathWithoutExt));
                decl.setModuleSpecifier(relativeImport.startsWith('.') ? relativeImport : `./${relativeImport}`);
            });

            // 重写 export from './xxx'
            file.getExportDeclarations().forEach(decl => {
                if (!decl.hasModuleSpecifier()) return;
                const specifier = decl.getModuleSpecifierValue();
                if (!specifier || !specifier.startsWith('.')) return;
                const resolvedPath = resolveModulePath(specifier, dirPath);
                if (!resolvedPath) {
                    console.warn(`⚠️ 未找到导出模块，跳过: ${specifier}`);
                    return;
                }
                const exportedFileName = getOutputFileName(resolvedPath);
                const exportPathWithoutExt = exportedFileName.replace(/\.(ts|tsx|js|jsx|mjs|cjs)$/, ''); // ✅ 移除扩展名
                const relativeImport = path.relative(path.dirname(outputPath), path.join(outputDirForEntry, exportPathWithoutExt));
                decl.setModuleSpecifier(relativeImport.startsWith('.') ? relativeImport : `./${relativeImport}`);
            });

            // 收集外部依赖
            [...file.getImportDeclarations(), ...file.getExportDeclarations()]
                .map(decl => decl.getModuleSpecifierValue())
                .filter((mod): mod is string => !!mod && !mod.startsWith('.'))
                .forEach(mod => {
                    const pkg = mod.split('/')[0];
                    this.dependencies.add(pkg)
                });

            // Tree Shaking
            treeShaking(file);

            // 输出文件（保留 .ts 扩展名的物理文件）
            const code = removeComments(file.getFullText(), filePath);
            fs.mkdirSync(path.dirname(outputPath), { recursive: true });
            fs.writeFileSync(outputPath, code, 'utf8');
            emittedFileNames.add(fileName);

            const displayPath = path.relative(this.distPath, outputPath);
            console.log(`📄 已输出: ${displayPath}`);
        };

        /**
         * 深度遍历依赖图
         */
        const traverse = (file: SourceFile) => {
            const dirPath = path.dirname(file.getFilePath());

            // 收集 import './xxx'
            file.getImportDeclarations()
                .map(decl => decl.getModuleSpecifierValue())
                .filter((s): s is string => !!s && s.startsWith('.'))
                .map(specifier => resolveModulePath(specifier, dirPath))
                .filter((p): p is string => !!p)
                .forEach(resolvedPath => {
                    const depFile = project.addSourceFileAtPath(resolvedPath);
                    traverse(depFile);
                });

            // 收集 export from './xxx'
            file.getExportDeclarations()
                .filter(decl => decl.hasModuleSpecifier())
                .map(decl => decl.getModuleSpecifierValue())
                .filter((s): s is string => !!s && s.startsWith('.'))
                .map(specifier => resolveModulePath(specifier, dirPath))
                .filter((p): p is string => !!p)
                .forEach(resolvedPath => {
                    const depFile = project.addSourceFileAtPath(resolvedPath);
                    traverse(depFile);
                });

            processFile(file);
        };

        // ========== 主流程 ==========
        traverse(sourceFile);
        console.log(`✅ 抽取完成，共输出 ${emittedFileNames.size} 个文件`);
        console.log(`📁 入口文件路径: ${entryBasename}/index${entryExt}`);
    }
}