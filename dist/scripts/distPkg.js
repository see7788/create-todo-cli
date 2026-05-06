import { copyFileSync, existsSync, mkdirSync, readdirSync, renameSync, rmSync, statSync, writeFileSync } from "node:fs";
import { basename, dirname, join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import LibBase, { Appexit } from "./tool.js";
class DistPkg extends LibBase {
    packageName = "dist";
    entryIndex = "";
    get outputPath() {
        return resolve(this.cwdProjectInfo.cwdPath, this.packageName);
    }
    async task1(initialPackageName, initialMode) {
        this.packageName = await this.confirmOutputName({
            initialName: initialPackageName,
            defaultName: "dist",
            message: "请输入 npm 包输出目录名",
            targetLabel: "将创建 npm 包产物到",
        });
        if ((initialMode ?? await this.modeAsk()) === "source") {
            const result = this.copySourceProject(this.outputPath, await this.selectLocalProjectPath());
            console.log(`\n完成源码 npm 包抽取: ${result.dist}`);
            console.log(`来源项目: ${result.source}`);
            console.log(`package.json: ${result.packageJson}`);
            await this.finalizeProjectOutput(result.dist, this.toPackageName(basename(result.dist)));
            return;
        }
        this.entryIndex = await this.askLocalFilePath([".js", ".jsx", ".ts", ".tsx", ".cjs", ".mjs"], this.cwdProjectInfo.cwdPath);
        const result = await this.build({
            dist: this.outputPath,
            entryIndex: this.entryIndex,
        });
        console.log(`\n完成 npm 包抽取: ${result.dist}`);
        console.log(`package.json: ${result.packageJson}`);
        await this.finalizeProjectOutput(result.dist, this.toPackageName(basename(result.dist)));
    }
    async taskBundle(initialPackageName) {
        await this.task1(initialPackageName, "bundle");
    }
    async taskSource(initialPackageName) {
        await this.task1(initialPackageName, "source");
    }
    async build({ dist, entryIndex, entryMore = {} }) {
        const outDir = resolve(dist);
        const entries = {
            index: resolve(entryIndex),
            ...Object.fromEntries(Object.entries(entryMore).map(([name, file]) => [name, resolve(file)])),
        };
        const packageRoot = this.findPackageRoot(entries.index);
        const sourceTsconfig = existsSync(join(packageRoot, "tsconfig.app.json"))
            ? join(packageRoot, "tsconfig.app.json")
            : join(packageRoot, "tsconfig.json");
        const external = this.packageDeps(packageRoot);
        const importNames = this.entryImportNames(entries);
        for (const [name, file] of Object.entries(entries)) {
            if (!existsSync(file)) {
                throw new Appexit(`entry ${name} not found: ${file}`);
            }
        }
        if (!existsSync(sourceTsconfig)) {
            throw new Appexit(`tsconfig not found: ${sourceTsconfig}`);
        }
        rmSync(outDir, { force: true, recursive: true });
        mkdirSync(outDir, { recursive: true });
        const tsconfig = join(outDir, "tsconfig.distPkg.json");
        writeFileSync(tsconfig, `${JSON.stringify({
            extends: sourceTsconfig,
            compilerOptions: {
                ignoreDeprecations: "6.0",
            },
        }, null, 2)}\n`, "utf8");
        const originalCwd = process.cwd();
        try {
            process.chdir(packageRoot);
            for (const [name, file] of Object.entries(entries)) {
                this.runInteractiveCommand([
                    "pnpm exec tsup",
                    this.shellArg(file),
                    "--format esm,cjs",
                    "--dts",
                    "--out-dir",
                    this.shellArg(outDir),
                    "--tsconfig",
                    this.shellArg(tsconfig),
                    ...external.flatMap(name => ["--external", this.shellArg(name)]),
                ].join(" "));
                const sourceName = basename(file).replace(/\.[^.]+$/, "");
                if (sourceName !== name) {
                    for (const ext of [".js", ".cjs", ".d.ts", ".d.cts"]) {
                        const source = join(outDir, `${sourceName}${ext}`);
                        if (existsSync(source)) {
                            renameSync(source, join(outDir, `${name}${ext}`));
                        }
                    }
                }
                this.replaceText(join(outDir, `${name}.js`), Object.fromEntries(Object.entries(importNames).map(([from, to]) => [from, `./${to}.js`])));
                this.replaceText(join(outDir, `${name}.cjs`), Object.fromEntries(Object.entries(importNames).map(([from, to]) => [from, `./${to}.cjs`])));
                this.replaceText(join(outDir, `${name}.d.ts`), Object.fromEntries(Object.entries(importNames).map(([from, to]) => [from, `./${to}`])));
                this.replaceText(join(outDir, `${name}.d.cts`), Object.fromEntries(Object.entries(importNames).map(([from, to]) => [from, `./${to}`])));
            }
        }
        finally {
            process.chdir(originalCwd);
        }
        rmSync(tsconfig, { force: true });
        const name = this.toPackageName(basename(outDir));
        const files = Object.keys(entries).flatMap(name => [
            `${name}.js`,
            `${name}.cjs`,
            `${name}.d.ts`,
            `${name}.d.cts`,
        ]);
        const exports = Object.fromEntries(Object.keys(entries).map(name => [
            name === "index" ? "." : `./${name}`,
            {
                types: `./${name}.d.ts`,
                import: `./${name}.js`,
                require: `./${name}.cjs`,
            },
        ]));
        const packageJson = join(outDir, "package.json");
        writeFileSync(packageJson, `${JSON.stringify({
            name,
            version: "0.0.0",
            type: "module",
            main: "./index.cjs",
            module: "./index.js",
            types: "./index.d.ts",
            exports,
            files,
            peerDependencies: Object.fromEntries(external.map(name => [name, "*"])),
        }, null, 2)}\n`, "utf8");
        return {
            dist: outDir,
            entries,
            packageJson,
            dts: Object.fromEntries(Object.keys(entries).map(name => [name, join(outDir, `${name}.d.ts`)])),
            js: Object.fromEntries(Object.keys(entries).map(name => [name, join(outDir, `${name}.js`)])),
        };
    }
    packageDeps(root) {
        const pkg = this.readRequiredJsonFile(join(root, "package.json"));
        const deps = { ...pkg.dependencies, ...pkg.peerDependencies };
        return Object.entries(deps)
            .filter(([, version]) => !version.startsWith("workspace:"))
            .map(([name]) => name);
    }
    entryImportNames(entries) {
        return Object.fromEntries(Object.entries(entries).flatMap(([name, file]) => {
            const root = this.findPackageRoot(file);
            const pkg = this.readRequiredJsonFile(join(root, "package.json"));
            const subpath = relative(root, file).replace(/\\/g, "/").replace(/\.[^.]+$/, "");
            return [[`${pkg.name}/${subpath}`, name]];
        }));
    }
    async modeAsk() {
        const prompts = await import("prompts");
        const response = await prompts.default({
            type: "select",
            name: "mode",
            message: "请选择 npm 包抽取方式",
            choices: [
                { title: "构建产物：入口文件转 ESM / CJS / d.ts", value: "bundle" },
                { title: "源码产物：从本地项目抽取源码，不转 JS", value: "source" },
            ],
        });
        if (!response.mode) {
            throw new Error("user-cancelled");
        }
        return response.mode;
    }
    async selectLocalProjectPath() {
        const prompts = await import("prompts");
        let currentPath = this.cwdProjectInfo.cwdPath;
        while (true) {
            const items = readdirSync(currentPath)
                .map(name => {
                const itemPath = join(currentPath, name);
                try {
                    return { name, path: itemPath, isDirectory: statSync(itemPath).isDirectory() };
                }
                catch {
                    return undefined;
                }
            })
                .filter((item) => Boolean(item))
                .sort((a, b) => Number(b.isDirectory) - Number(a.isDirectory) || a.name.localeCompare(b.name));
            const response = await prompts.default({
                type: "select",
                name: "selection",
                message: `当前位置: ${currentPath}\n请选择本地项目目录，或选择项目内文件`,
                choices: [
                    { title: ".. 上一级目录", value: ".." },
                    { title: "取消", value: "cancel" },
                    ...items.map(item => ({
                        title: item.isDirectory
                            ? `${item.name}${this.isLocalProjectDirectory(item.path) ? " (项目目录)" : ""}`
                            : item.name,
                        value: item.path,
                        disabled: !item.isDirectory && !this.isSourcePickFile(item.name),
                    })),
                ],
            });
            if (!response.selection || response.selection === "cancel") {
                throw new Error("user-cancelled");
            }
            if (response.selection === "..") {
                const parentPath = dirname(currentPath);
                currentPath = parentPath === currentPath ? currentPath : parentPath;
                continue;
            }
            const stats = statSync(response.selection);
            if (stats.isFile()) {
                return response.selection;
            }
            currentPath = response.selection;
            if (!this.isLocalProjectDirectory(currentPath)) {
                continue;
            }
            const confirm = await prompts.default({
                type: "confirm",
                name: "enabled",
                message: `已找到项目目录: ${currentPath}\n是否使用此目录作为源码来源？`,
                initial: true,
            });
            if (confirm.enabled === undefined) {
                throw new Error("user-cancelled");
            }
            if (confirm.enabled) {
                return currentPath;
            }
        }
    }
    isLocalProjectDirectory(dirPath) {
        return existsSync(join(dirPath, "package.json"));
    }
    isSourcePickFile(name) {
        return [".js", ".jsx", ".ts", ".tsx", ".cjs", ".mjs", ".json"].some(ext => name.toLowerCase().endsWith(ext));
    }
    copySourceProject(dist, localProjectPath) {
        const source = statSync(localProjectPath).isDirectory()
            ? resolve(localProjectPath)
            : this.findPackageRoot(localProjectPath);
        if (!existsSync(join(source, "package.json"))) {
            throw new Appexit(`本地项目缺少 package.json: ${source}`);
        }
        const outDir = resolve(dist);
        rmSync(outDir, { force: true, recursive: true });
        mkdirSync(outDir, { recursive: true });
        this.copyDirectory(source, outDir);
        return {
            dist: outDir,
            source,
            packageJson: join(outDir, "package.json"),
        };
    }
    copyDirectory(source, target) {
        mkdirSync(target, { recursive: true });
        for (const name of readdirSync(source)) {
            if (this.shouldSkipCopy(name)) {
                continue;
            }
            const sourcePath = join(source, name);
            const targetPath = join(target, name);
            if (statSync(sourcePath).isDirectory()) {
                this.copyDirectory(sourcePath, targetPath);
            }
            else {
                mkdirSync(dirname(targetPath), { recursive: true });
                copyFileSync(sourcePath, targetPath);
            }
        }
    }
    shouldSkipCopy(name) {
        return [".git", "node_modules", "dist", ".pnpm-store"].includes(name);
    }
}
if (resolve(fileURLToPath(import.meta.url)) === resolve(process.argv[1])) {
    new DistPkg().task1();
}
export default DistPkg;
