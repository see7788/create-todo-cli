#!/usr/bin/env node
import * as fs from 'node:fs';
import path from 'path';
import { fileURLToPath } from 'url';
import LibBase, { Appexit } from "./tool.js";
import { build as tsupBuild } from 'tsup';
class DistPackageBuilder extends LibBase {
    //入口文件路径
    entryFilePath;
    //产物目录名称
    distDirName = "dist";
    get distPath() {
        return path.join(this.cwdProjectInfo.cwdPath, this.distDirName);
    }
    constructor() {
        super();
    }
    async task1() {
        console.log('\n🚀 开始抽取流程');
        console.log('📋 1. 交互定义dist目录名称');
        await this.askDistDirName();
        console.log('📋 2. 交互定义入口文件');
        await this.askEntryFilePath();
        console.log('⚙️3. 抽取js,.d.ts,插件里实现依赖抽取和package.json生成');
        await this.buildJsFile();
        console.log('\n🚀 完成抽取流程');
    }
    async askDistDirName() {
        const prompts = await import('prompts');
        let isValid = false;
        let dirName = this.distDirName;
        while (!isValid) {
            const response = await prompts.default({
                type: 'text',
                name: 'distName',
                message: '请输入输出目录名称 (可直接回车使用默认值)',
                initial: dirName,
                validate: (value) => {
                    const trimmedValue = value.trim();
                    const validNameRegex = /^[a-zA-Z0-9-_]+$/;
                    if (!trimmedValue)
                        return '目录名不能为空';
                    if (!validNameRegex.test(trimmedValue))
                        return '目录名只能包含字母、数字、- 和 _';
                    // 检查是否存在同名目录
                    const targetPath = path.join(this.cwdProjectInfo.cwdPath, trimmedValue);
                    if (fs.existsSync(targetPath) && fs.statSync(targetPath).isDirectory()) {
                        return `目录名 '${trimmedValue}' 已存在，请选择其他名称`;
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
    async askEntryFilePath() {
        // 使用当前执行命令时的工作目录
        const currentCwd = this.cwdProjectInfo.cwdPath;
        console.log(`[DEBUG] 当前工作目录: ${currentCwd}`, process.argv);
        // 读取当前目录内的文件，过滤保留特定扩展名的文件
        const list = fs.readdirSync(currentCwd, { withFileTypes: true })
            .filter((dirent) => dirent.isFile() && /\.(js|jsx|ts|tsx|cjs|mjs)$/i.test(dirent.name))
            .map((dirent) => dirent.name);
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
        }
        else {
            throw new Appexit('未找到有效的入口文件');
        }
    }
    /**构建JS文件和类型定义 - 使用tsup构建系统*/
    async buildJsFile() {
        fs.mkdirSync(this.distPath, { recursive: true });
        try {
            await tsupBuild({
                entry: {
                    index: path.basename(this.entryFilePath)
                },
                esbuildPlugins: [{
                        name: 'dependency-collector',
                        setup: (build) => {
                            build.onEnd(result => {
                                if (result.metafile) {
                                    this.createPackageJson(result.metafile);
                                }
                            });
                        }
                    }],
                outDir: this.distPath,
                bundle: true,
                platform: 'node',
                target: 'node18',
                format: ['esm'],
                sourcemap: true,
                dts: true,
                external: ['node:*'],
                clean: true,
            });
        }
        catch (error) {
            const errorMessage = error instanceof Error ? error.message : String(error);
            throw new Appexit(`[DEBUG] 构建错误来源: tsup工具\n原始错误: ${errorMessage}`);
        }
    }
    /**分析并提取使用的依赖项 - 结合esbuild分析 */
    async createPackageJson(metafile) {
        console.log("开始提取依赖");
        const imported = new Set();
        for (const key in metafile.inputs) {
            const matches = key.matchAll(/node_modules[/\\](?:\.pnpm[/\\])?((?:@[^/\\]+[/\\][^/\\]+)|[^/\\]+)/g);
            for (const match of matches) {
                imported.add(match[1].replace(/@[^/\\]+$/, ""));
            }
        }
        const rootPkg = this.cwdProjectInfo.jsonInfo;
        const usedDeps = {};
        const usedDevDeps = {};
        for (const name of imported) {
            if (rootPkg.dependencies?.[name]) {
                usedDeps[name] = rootPkg.dependencies[name];
            }
            else if (rootPkg.devDependencies?.[name]) {
                usedDevDeps[name] = rootPkg.devDependencies[name];
            }
        }
        const distPkg = {
            name: this.distDirName,
            version: rootPkg.version || '1.0.0',
            description: rootPkg.description || '',
            author: rootPkg.author || '',
            license: rootPkg.license || 'MIT',
            repository: rootPkg.repository || { type: 'git', url: '' },
            type: 'module',
            main: './index.mjs',
            module: './index.mjs',
            types: './index.d.mts',
            exports: {
                '.': {
                    types: './index.d.mts',
                    import: './index.mjs',
                    require: './index.mjs',
                },
            },
            dependencies: usedDeps,
            devDependencies: usedDevDeps,
        };
        console.log("生成package.json");
        fs.mkdirSync(this.distPath, { recursive: true });
        fs.writeFileSync(path.join(this.distPath, "package.json"), JSON.stringify(distPkg, null, 2));
    }
}
if (path.resolve(fileURLToPath(import.meta.url)) === path.resolve(process.argv[1])) {
    new DistPackageBuilder().task1();
}
export default DistPackageBuilder;
