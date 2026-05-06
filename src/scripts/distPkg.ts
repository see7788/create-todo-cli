import { copyFileSync, existsSync, mkdirSync, readdirSync, renameSync, rmSync, statSync, writeFileSync } from "node:fs";
import { basename, dirname, join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import LibBase, { Appexit } from "./tool.js";

export type DistNpmPkgOptions = {
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

class DistPkg extends LibBase {
  private packageName = "dist";
  private entryIndex = "";

  private get outputPath(): string {
    return resolve(this.cwdProjectInfo.cwdPath, this.packageName);
  }

  public async task1(initialPackageName?: string, initialMode?: DistPkgMode): Promise<void> {
    this.packageName = await this.confirmOutputName({
      initialName: initialPackageName,
      defaultName: "dist",
      message: "请输入 npm 包输出目录名",
      targetLabel: "将创建 npm 包产物到",
    });

    if ((initialMode ?? await this.modeAsk()) === "source") {
      this.entryIndex = await this.askLocalFilePath([".js", ".jsx", ".ts", ".tsx", ".cjs", ".mjs", ".json"], this.cwdProjectInfo.cwdPath);
      const result = this.copySourceProject(
        this.outputPath,
        this.entryIndex,
      );
      console.log(`\n完成源码 npm 包抽取: ${result.dist}`);
      console.log(`来源项目: ${result.source}`);
      console.log(`入口文件: ${result.entry}`);
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

  public async taskBundle(initialPackageName?: string): Promise<void> {
    await this.task1(initialPackageName, "bundle");
  }

  public async taskSource(initialPackageName?: string): Promise<void> {
    await this.task1(initialPackageName, "source");
  }

  public async build({ dist, entryIndex, entryMore = {} }: DistNpmPkgOptions): Promise<DistNpmPkgResult> {
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
    rmSync(outDir, { force: true, recursive: true });
    mkdirSync(outDir, { recursive: true });
    this.copyDirectory(source, outDir);
    this.sourcePackageEntrySet(outDir, source, entry);

    return {
      dist: outDir,
      source,
      entry,
      packageJson: join(outDir, "package.json"),
    };
  }

  private sourcePackageEntrySet(outDir: string, source: string, entry: string): void {
    const packageJson = join(outDir, "package.json");
    const entryPath = `./${relative(source, entry).replace(/\\/g, "/")}`;
    const pkg = this.readRequiredJsonFile<
      PackageJson & {
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

    if (pkg.files) {
      pkg.files = Array.from(new Set([...pkg.files, entryPath.slice(2).split("/")[0]]));
    }
    this.writeJsonFile(packageJson, pkg);
  }

  private copyDirectory(source: string, target: string): void {
    mkdirSync(target, { recursive: true });
    for (const name of readdirSync(source)) {
      if (this.shouldSkipCopy(name)) {
        continue;
      }

      const sourcePath = join(source, name);
      const targetPath = join(target, name);
      if (statSync(sourcePath).isDirectory()) {
        this.copyDirectory(sourcePath, targetPath);
      } else {
        mkdirSync(dirname(targetPath), { recursive: true });
        copyFileSync(sourcePath, targetPath);
      }
    }
  }

  private shouldSkipCopy(name: string): boolean {
    return [".git", "node_modules", "dist", ".pnpm-store"].includes(name);
  }
}

if (resolve(fileURLToPath(import.meta.url)) === resolve(process.argv[1])) {
  new DistPkg().task1();
}

export default DistPkg;
