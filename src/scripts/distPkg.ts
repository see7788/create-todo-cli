import { copyFileSync, existsSync, mkdirSync, readFileSync, renameSync, rmSync, statSync, writeFileSync } from "node:fs";
import { basename, dirname, extname, isAbsolute, join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { buildSync } from "esbuild";
import LibBase, { Appexit } from "./public.js";

type DistNpmPkgOptions = {
  dist: string;
  entryIndex: string;
  entryMore?: Record<string, string>;
};

type PackageJson = {
  dependencies?: Record<string, string>;
  peerDependencies?: Record<string, string>;
};

type DistNpmPkgResult = {
  dist: string;
  entries: Record<string, string>;
  packageJson: string;
  dts: Record<string, string>;
  js: Record<string, string>;
};

type DistPkgMode = "bundle" | "source";

type SourcePkgResult = {
  dist: string;
  source: string;
  entry: string;
  packageJson: string;
};

type SourcePathAlias = {
  prefix: string;
  suffix: string;
  targetPrefix: string;
  targetSuffix: string;
  baseUrl: string;
};

type DistTarget = {
  name: string;
  path: string;
};

class DistPkg extends LibBase {
  private target!: DistTarget;
  private entryIndex = "";

  public async task1(initialPackageName?: string, initialMode?: DistPkgMode): Promise<void> {
    const targetName = await this.confirmOutputName({
      basePath: dirname(this.cwdProjectInfo.pkgPath),
      initialName: initialPackageName,
      defaultName: `${basename(this.cwdProjectInfo.pkgPath)}_dist`,
      message: "请输入 npm 包输出目录名",
      targetLabel: "将创建 npm 包产物到",
    });
    this.target = {
      name: targetName,
      path: resolve(dirname(this.cwdProjectInfo.pkgPath), targetName),
    };    const mode = initialMode ?? await this.modeAsk();
    if (mode === "source") {
      this.entryIndex = await this.askLocalFilePath([".js", ".jsx", ".ts", ".tsx", ".cjs", ".mjs", ".json"], this.cwdProjectInfo.cwdPath);
      const result = this.copySourceProject(
        this.target.path,
        this.entryIndex,
      );
      console.log(`\n完成源码 npm 包抽取: ${this.pathDisplay(result.dist)}`);
      console.log(`来源项目: ${result.source}`);
      console.log(`入口文件: ${result.entry}`);
      console.log(`package.json: ${result.packageJson}`);
      await this.finalizeProjectOutput(result.dist, this.toPackageName(basename(result.dist)));
      return;
    }

    this.entryIndex = await this.askLocalFilePath([".js", ".jsx", ".ts", ".tsx", ".cjs", ".mjs"], this.cwdProjectInfo.cwdPath);
    const result = await this.build({
      dist: this.target.path,
      entryIndex: this.entryIndex,
    });

    console.log(`\n完成 npm 包抽取: ${this.pathDisplay(result.dist)}`);
    console.log(`来源项目: ${this.findPackageRoot(this.entryIndex)}`);
    console.log(`入口文件: ${this.entryIndex}`);
    console.log(`package.json: ${result.packageJson}`);
    await this.finalizeProjectOutput(result.dist, this.toPackageName(basename(result.dist)));
  }

  public async taskBundle(initialPackageName?: string): Promise<void> {
    await this.task1(initialPackageName, "bundle");
  }

  public async taskSource(initialPackageName?: string): Promise<void> {
    await this.task1(initialPackageName, "source");
  }

  private async build({ dist, entryIndex, entryMore = {} }: DistNpmPkgOptions): Promise<DistNpmPkgResult> {
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
    writeFileSync(
      tsconfig,
      `${JSON.stringify(
        {
          extends: sourceTsconfig,
          compilerOptions: {
            ignoreDeprecations: "6.0",
          },
        },
        null,
        2,
      )}\n`,
      "utf8",
    );

    const originalCwd = process.cwd();
    try {
      process.chdir(packageRoot);
      for (const [name, file] of Object.entries(entries)) {
        this.runInteractiveCommand(
          [
            "pnpm exec tsup",
            this.shellArg(file),
            "--format esm,cjs",
            "--dts",
            "--out-dir",
            this.shellArg(outDir),
            "--tsconfig",
            this.shellArg(tsconfig),
            ...external.flatMap(name => ["--external", this.shellArg(name)]),
          ].join(" "),
        );

        const sourceName = basename(file).replace(/\.[^.]+$/, "");
        if (sourceName !== name) {
          for (const ext of [".js", ".cjs", ".d.ts", ".d.cts"]) {
            const source = join(outDir, `${sourceName}${ext}`);
            if (existsSync(source)) {
              renameSync(source, join(outDir, `${name}${ext}`));
            }
          }
        }

        this.replaceText(
          join(outDir, `${name}.js`),
          Object.fromEntries(Object.entries(importNames).map(([from, to]) => [from, `./${to}.js`])),
        );
        this.replaceText(
          join(outDir, `${name}.cjs`),
          Object.fromEntries(Object.entries(importNames).map(([from, to]) => [from, `./${to}.cjs`])),
        );
        this.replaceText(
          join(outDir, `${name}.d.ts`),
          Object.fromEntries(Object.entries(importNames).map(([from, to]) => [from, `./${to}`])),
        );
        this.replaceText(
          join(outDir, `${name}.d.cts`),
          Object.fromEntries(Object.entries(importNames).map(([from, to]) => [from, `./${to}`])),
        );
      }
    } finally {
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
    const exports = Object.fromEntries(
      Object.keys(entries).map(name => [
        name === "index" ? "." : `./${name}`,
        {
          types: `./${name}.d.ts`,
          import: `./${name}.js`,
          require: `./${name}.cjs`,
        },
      ]),
    );
    const packageJson = join(outDir, "package.json");
    writeFileSync(
      packageJson,
      `${JSON.stringify(
        {
          name,
          version: "0.0.0",
          type: "module",
          main: "./index.cjs",
          module: "./index.js",
          types: "./index.d.ts",
          exports,
          files,
          peerDependencies: Object.fromEntries(external.map(name => [name, "*"])),
        },
        null,
        2,
      )}\n`,
      "utf8",
    );

    return {
      dist: outDir,
      entries,
      packageJson,
      dts: Object.fromEntries(Object.keys(entries).map(name => [name, join(outDir, `${name}.d.ts`)])),
      js: Object.fromEntries(Object.keys(entries).map(name => [name, join(outDir, `${name}.js`)])),
    };
  }

  private packageDeps(root: string): string[] {
    const pkg = this.readRequiredJsonFile<PackageJson>(join(root, "package.json"));
    const deps = { ...pkg.dependencies, ...pkg.peerDependencies };
    return Object.entries(deps)
      .filter(([, version]) => !version.startsWith("workspace:"))
      .map(([name]) => name);
  }

  private entryImportNames(entries: Record<string, string>): Record<string, string> {
    return Object.fromEntries(
      Object.entries(entries).flatMap(([name, file]) => {
        const root = this.findPackageRoot(file);
        const pkg = this.readRequiredJsonFile<{ name: string }>(join(root, "package.json"));
        const subpath = relative(root, file).replace(/\\/g, "/").replace(/\.[^.]+$/, "");
        return [[`${pkg.name}/${subpath}`, name]];
      }),
    );
  }

  private async modeAsk(): Promise<DistPkgMode> {
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

  private copySourceProject(dist: string, entryFile: string): SourcePkgResult {
    const entry = resolve(entryFile);
    if (!existsSync(entry) || !statSync(entry).isFile()) {
      throw new Appexit(`入口文件不存在: ${entry}`);
    }

    const source = this.findPackageRoot(entry);

    if (!existsSync(join(source, "package.json"))) {
      throw new Appexit(`本地项目缺少 package.json: ${source}`);
    }

    const outDir = resolve(dist);
    const files = this.sourceFilesCollect(source, entry);
    const sourceRoot = dirname(entry);
    rmSync(outDir, { force: true, recursive: true });
    mkdirSync(outDir, { recursive: true });
    copyFileSync(join(source, "package.json"), join(outDir, "package.json"));
    for (const file of files) {
      const target = this.sourceTargetPath(outDir, source, sourceRoot, file);
      mkdirSync(dirname(target), { recursive: true });
      this.copySourceFile(outDir, source, sourceRoot, file, target);
    }
    this.sourceTsconfigWrite(outDir, source, sourceRoot, files);
    this.sourcePackageEntrySet(outDir, source, sourceRoot, entry, files);

    return {
      dist: outDir,
      source,
      entry,
      packageJson: join(outDir, "package.json"),
    };
  }

  private sourcePackageEntrySet(outDir: string, source: string, sourceRoot: string, entry: string, files: string[]): void {
    const packageJson = join(outDir, "package.json");
    const entryPath = `./${relative(sourceRoot, entry).replace(/\\/g, "/")}`;
    const pkg = this.readRequiredJsonFile<
      PackageJson & {
        bin?: Record<string, string> | string;
        main?: string;
        module?: string;
        types?: string;
        exports?: Record<string, string | Record<string, string>>;
        files?: string[];
      }
    >(packageJson);
    const dtsPath = `${entryPath.replace(/\.[^.]+$/, "")}.d.ts`;

    pkg.main = entryPath;
    pkg.module = entryPath;
    if (entryPath.endsWith(".ts") || entryPath.endsWith(".tsx") || existsSync(join(outDir, dtsPath.slice(2)))) {
      pkg.types = entryPath.endsWith(".ts") || entryPath.endsWith(".tsx") ? entryPath : dtsPath;
    } else {
      delete pkg.types;
    }
    pkg.exports = {
      ".": {
        ...(pkg.types ? { types: pkg.types } : {}),
        import: entryPath,
        default: entryPath,
      },
    };
    pkg.files = this.sourcePackageFiles(outDir, source, sourceRoot, files);
    delete pkg.bin;
    this.writeJsonFile(packageJson, pkg);
  }

  private sourceFilesCollect(root: string, entry: string): string[] {
    return Array.from(
      new Set([
        ...this.sourceFilesCollectByBuild(root, entry),
        ...this.sourceFilesCollectByText(root, entry),
      ]),
    ).sort((a, b) => a.localeCompare(b));
  }

  private sourceFilesCollectByBuild(root: string, entry: string): string[] {
    try {
      const metafile = buildSync({
        entryPoints: [entry],
        absWorkingDir: root,
        bundle: true,
        write: false,
        metafile: true,
        format: "esm",
        platform: "neutral",
        packages: "external",
        tsconfig: this.sourceTsconfigPath(root),
        logLevel: "silent",
      }).metafile;

      return Object.keys(metafile.inputs)
        .map(file => resolve(root, file))
        .filter(file => existsSync(file) && statSync(file).isFile() && this.isSubPath(root, file));
    } catch {
      return [];
    }
  }

  private sourceFilesCollectByText(root: string, entry: string): string[] {
    const files: string[] = [];
    const pending = [entry];
    const seen = new Set<string>();

    while (pending.length > 0) {
      const file = pending.pop();
      if (!file || seen.has(file)) {
        continue;
      }
      seen.add(file);
      files.push(file);

      if (!this.shouldParseSourceImports(file)) {
        continue;
      }

      for (const importPath of this.sourceImportPaths(readFileSync(file, "utf-8"))) {
        const resolvedFile = this.resolveSourceImport(root, file, importPath);
        if (resolvedFile && !seen.has(resolvedFile)) {
          pending.push(resolvedFile);
        }
      }
    }

    return files.sort((a, b) => a.localeCompare(b));
  }

  private sourceTsconfigWrite(outDir: string, source: string, sourceRoot: string, files: string[]): void {
    const include = Array.from(
      new Set(
        files
          .filter(file => [".ts", ".tsx", ".js", ".jsx"].includes(extname(file)))
          .map(file => relative(outDir, this.sourceTargetPath(outDir, source, sourceRoot, file)).replace(/\\/g, "/")),
      ),
    );

    writeFileSync(
      join(outDir, "tsconfig.json"),
      `${JSON.stringify(
        {
          compilerOptions: {
            target: "ESNext",
            module: "ESNext",
            moduleResolution: "Bundler",
            strict: true,
            skipLibCheck: true,
            esModuleInterop: true,
            resolveJsonModule: true,
            jsx: "preserve",
          },
          include,
        },
        null,
        2,
      )}\n`,
      "utf-8",
    );
  }

  private sourcePackageFiles(outDir: string, source: string, sourceRoot: string, files: string[]): string[] {
    return Array.from(
      new Set(
        [
          ...files.map(file => relative(outDir, this.sourceTargetPath(outDir, source, sourceRoot, file)).replace(/\\/g, "/")),
          "tsconfig.json",
        ].filter(file => file !== "package.json").map(file => file.split("/")[0]),
      ),
    ).sort((a, b) => a.localeCompare(b));
  }

  private copySourceFile(outDir: string, source: string, sourceRoot: string, file: string, target: string): void {
    if (!this.shouldParseSourceImports(file)) {
      copyFileSync(file, target);
      return;
    }

    let text = readFileSync(file, "utf-8");
    for (const importPath of this.sourceImportPaths(text)) {
      const resolvedFile = this.resolveSourceImport(source, file, importPath);
      if (!resolvedFile) {
        continue;
      }

      const fromTarget = this.sourceTargetPath(outDir, source, sourceRoot, file);
      const toTarget = this.sourceTargetPath(outDir, source, sourceRoot, resolvedFile);
      text = text.split(importPath).join(this.toRelativeImportPath(dirname(fromTarget), toTarget, importPath));
    }
    writeFileSync(target, text, "utf-8");
  }

  private sourceTargetPath(outDir: string, source: string, sourceRoot: string, file: string): string {
    const relativePath = relative(sourceRoot, file);
    if (!relativePath.startsWith("..") && !isAbsolute(relativePath)) {
      return join(outDir, relativePath);
    }
    return join(outDir, relative(source, file));
  }

  private toRelativeImportPath(fromDir: string, toFile: string, originalImportPath: string): string {
    const originalExt = extname(originalImportPath.split("?")[0]);
    const targetExt = extname(toFile);
    const targetPath = originalExt && targetExt
      ? `${toFile.slice(0, -targetExt.length)}${originalExt}`
      : originalExt
        ? `${toFile}${originalExt}`
      : targetExt
        ? toFile.slice(0, -targetExt.length)
        : toFile;
    const importPath = relative(fromDir, targetPath).replace(/\\/g, "/");
    return importPath.startsWith(".") ? importPath : `./${importPath}`;
  }

  private sourceImportPaths(text: string): string[] {
    const importPaths: string[] = [];
    const patterns = [
      /\bimport\s+(?:type\s+)?[\s\S]*?\bfrom\s*["']([^"']+)["']/g,
      /\bexport\s+(?:type\s+)?[\s\S]*?\bfrom\s*["']([^"']+)["']/g,
      /\bimport\s*["']([^"']+)["']/g,
      /\bimport\s*\(\s*["']([^"']+)["']\s*\)/g,
      /\brequire\s*\(\s*["']([^"']+)["']\s*\)/g,
    ];

    for (const pattern of patterns) {
      for (const match of text.matchAll(pattern)) {
        importPaths.push(match[1]);
      }
    }

    return Array.from(new Set(importPaths));
  }

  private resolveSourceImport(root: string, fromFile: string, importPath: string): string | undefined {
    for (const resolvedPath of this.sourceImportBasePaths(root, fromFile, importPath)) {
      for (const file of this.sourceImportCandidates(resolvedPath)) {
        if (existsSync(file) && statSync(file).isFile() && this.isSubPath(root, file)) {
          return file;
        }
      }
    }

    return undefined;
  }

  private sourceImportBasePaths(root: string, fromFile: string, importPath: string): string[] {
    const cleanPath = importPath.split("?")[0];
    if (cleanPath.startsWith(".")) {
      return [resolve(dirname(fromFile), cleanPath)];
    }

    return [
      ...this.sourceTsconfigAliasPaths(root, cleanPath),
      ...this.sourcePackageSelfPaths(root, cleanPath),
    ];
  }

  private sourceTsconfigAliasPaths(root: string, importPath: string): string[] {
    return this.sourceTsconfigAliases(root).flatMap(alias => {
      if (!importPath.startsWith(alias.prefix) || !importPath.endsWith(alias.suffix)) {
        return [];
      }

      const matchedPath = importPath.slice(alias.prefix.length, importPath.length - alias.suffix.length);
      return [resolve(alias.baseUrl, `${alias.targetPrefix}${matchedPath}${alias.targetSuffix}`)];
    });
  }

  private sourcePackageSelfPaths(root: string, importPath: string): string[] {
    const pkg = this.readJsonFile<{ name?: string }>(join(root, "package.json"));
    if (!pkg?.name || (importPath !== pkg.name && !importPath.startsWith(`${pkg.name}/`))) {
      return [];
    }

    return [resolve(root, importPath === pkg.name ? "." : importPath.slice(pkg.name.length + 1))];
  }

  private sourceTsconfigAliases(root: string): SourcePathAlias[] {
    const tsconfigPath = this.sourceTsconfigPath(root);
    if (!tsconfigPath) {
      return [];
    }

    const tsconfig = this.sourceJsonFileRead<{
      compilerOptions?: {
        baseUrl?: string;
        paths?: Record<string, string[]>;
      };
    }>(tsconfigPath);
    const compilerOptions = tsconfig?.compilerOptions;
    if (!compilerOptions?.paths) {
      return [];
    }

    const baseUrl = resolve(dirname(tsconfigPath), compilerOptions.baseUrl ?? ".");
    return Object.entries(compilerOptions.paths).flatMap(([aliasPath, targetPaths]) => {
      const aliasStarIndex = aliasPath.indexOf("*");
      const prefix = aliasStarIndex >= 0 ? aliasPath.slice(0, aliasStarIndex) : aliasPath;
      const suffix = aliasStarIndex >= 0 ? aliasPath.slice(aliasStarIndex + 1) : "";

      return targetPaths.map(targetPath => {
        const targetStarIndex = targetPath.indexOf("*");
        return {
          prefix,
          suffix,
          targetPrefix: targetStarIndex >= 0 ? targetPath.slice(0, targetStarIndex) : targetPath,
          targetSuffix: targetStarIndex >= 0 ? targetPath.slice(targetStarIndex + 1) : "",
          baseUrl,
        };
      });
    });
  }

  private sourceTsconfigPath(root: string): string | undefined {
    for (const name of ["tsconfig.app.json", "tsconfig.json"]) {
      const file = join(root, name);
      if (existsSync(file)) {
        return file;
      }
    }
    return undefined;
  }

  private sourceJsonFileRead<T>(filePath: string): T | undefined {
    if (!existsSync(filePath)) {
      return undefined;
    }
    return JSON.parse(this.jsonCommentsRemove(readFileSync(filePath, "utf-8"))) as T;
  }

  private jsonCommentsRemove(text: string): string {
    return text
      .replace(/^\uFEFF/, "")
      .replace(/\/\*[\s\S]*?\*\//g, "")
      .replace(/(^|[^:])\/\/.*$/gm, "$1");
  }

  private sourceImportCandidates(resolvedPath: string): string[] {
    const extensions = [".ts", ".tsx", ".js", ".jsx", ".mjs", ".cjs", ".json", ".d.ts", ".css", ".scss", ".sass", ".less", ".vue", ".svelte"];
    const currentExt = extname(resolvedPath);
    const basePath = currentExt ? resolvedPath.slice(0, -currentExt.length) : resolvedPath;
    const fileCandidates = currentExt
      ? [resolvedPath, ...[".js", ".jsx", ".mjs", ".cjs"].includes(currentExt) ? extensions.map(ext => `${basePath}${ext}`) : []]
      : extensions.map(ext => `${resolvedPath}${ext}`);

    return [
      ...fileCandidates,
      ...extensions.map(ext => join(resolvedPath, `index${ext}`)),
    ];
  }

  private shouldParseSourceImports(file: string): boolean {
    return [".ts", ".tsx", ".js", ".jsx", ".mjs", ".cjs", ".vue", ".svelte"].includes(extname(file));
  }

  private findPackageRoot(filePath: string): string {
    let dir = statSync(filePath).isDirectory() ? filePath : dirname(filePath);
    while (dirname(dir) !== dir) {
      if (existsSync(join(dir, "package.json"))) {
        return dir;
      }
      dir = dirname(dir);
    }
    throw new Appexit(`package.json not found from: ${filePath}`);
  }

  private isSubPath(root: string, file: string): boolean {
    const relativePath = relative(root, file);
    return Boolean(relativePath) && !relativePath.startsWith("..") && !isAbsolute(relativePath);
  }
}

if (resolve(fileURLToPath(import.meta.url)) === resolve(process.argv[1])) {
  new DistPkg().task1();
}

export default DistPkg;
