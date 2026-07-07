import fs from "fs";
import path from "path";
import LibBase, { type PackageJsonRecord } from "./base";
import FileTplCore from "./fileTpl";

export default class PnpmBase extends LibBase {
    public static pnpmWorkspaceRootFind(startPath = process.cwd()): string | undefined {
        let dir = path.resolve(startPath);
        while (path.dirname(dir) !== dir) {
            if (fs.existsSync(path.join(dir, "pnpm-workspace.yaml"))) {
                return dir;
            }
            dir = path.dirname(dir);
        }
        return undefined;
    }

    public static pnpmWorkspacePackagesParse(text: string): string[] {
        const packages: string[] = [];
        let inPackages = false;

        for (const line of text.split(/\r?\n/)) {
            if (/^\s*packages\s*:\s*$/.test(line)) {
                inPackages = true;
                continue;
            }
            if (inPackages && /^\S/.test(line) && !line.startsWith("packages:")) {
                break;
            }

            const match = line.match(/^\s*-\s*["']?([^"']+)["']?\s*$/);
            if (inPackages && match?.[1]) {
                packages.push(match[1]);
            }
        }

        return packages;
    }

    public async workspaceInit(targetPath = this.cwdProjectInfo.workspacePath): Promise<void> {
        await this.pnpmRootSetupAsk(targetPath);
    }

    protected async pnpmRootSetupAsk(targetPath: string): Promise<void> {
        if (this.isPnpmWorkspaceRoot(targetPath)) {
            console.log("Current directory is already a pnpm workspace root");
            return;
        }

        const prompts = await import("prompts");
        const response = await prompts.default({
            type: "confirm",
            name: "enabled",
            message: "当前目录不是 pnpm 根，是否初始化 pnpm workspace 根？",
            initial: false,
        });

        if (response.enabled === undefined) {
            throw new Error("user-cancelled");
        }
        if (!response.enabled) {
            console.log("跳过 pnpm 根初始化");
            return;
        }

        await this.targetPathsConfirm([
            path.join(targetPath, "pnpm-workspace.yaml"),
            path.join(targetPath, ".npmrc"),
            path.join(targetPath, "package.json"),
        ]);
        this.pnpmWorkspaceFileSet(targetPath);
        this.npmrcSet(targetPath);
        this.rootPackageJsonSet(targetPath);
        console.log(`pnpm workspace 根配置已补齐: ${this.pathDisplay(targetPath)}`);
        console.log("modified files:");
        for (const filePath of [
            path.join(targetPath, "pnpm-workspace.yaml"),
            path.join(targetPath, ".npmrc"),
            path.join(targetPath, "package.json"),
        ]) {
            console.log(`- ${this.pathDisplay(filePath)}`);
        }
    }

    private pnpmWorkspaceFileSet(targetPath: string): void {
        const filePath = path.join(targetPath, "pnpm-workspace.yaml");
        if (fs.existsSync(filePath)) {
            return;
        }
        fs.writeFileSync(filePath, new FileTplCore().pnpmWorkspaceYamlCreate(), "utf-8");
    }

    private npmrcSet(targetPath: string): void {
        this.linesFileEnsure(path.join(targetPath, ".npmrc"), new FileTplCore().pnpmNpmrcLines());
    }

    private rootPackageJsonSet(targetPath: string): void {
        const filePath = path.join(targetPath, "package.json");
        const pkg = this.readJsonFile<PackageJsonRecord>(filePath) ?? {
            name: path.basename(targetPath),
            version: "1.0.0",
            private: true,
        };

        pkg.private = true;
        pkg.workspaces = Array.from(new Set([...(pkg.workspaces ?? []), "libs", "apps"]));
        pkg.pnpm = {
            ...(pkg.pnpm ?? {}),
            overrides: {
                ...(pkg.pnpm?.overrides ?? {}),
                tsx: pkg.pnpm?.overrides?.tsx ?? "^4.20.0",
                typescript: pkg.pnpm?.overrides?.typescript ?? "^5.8.0",
            },
        };
        this.writeJsonFile(filePath, pkg);
    }

    private isPnpmWorkspaceRoot(dirPath: string): boolean {
        return fs.existsSync(path.join(dirPath, "pnpm-workspace.yaml"));
    }
}
