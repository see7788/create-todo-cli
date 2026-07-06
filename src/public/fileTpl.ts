import fs from "fs";
import path from "path";
import { fileURLToPath } from "node:url";

/** 公共模板读取器，只放多个基础流程共用的模板。 */
export default class FileTplCore {
    private readonly scriptRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

    public pnpm_workspace_yaml_create(): string {
        return this.templateRead("pnpmScript", "pnpm-workspace.yaml");
    }

    public pnpm_workspace_yaml_release_create(packagePaths: string[]): string {
        return `packages:
${packagePaths.map(packagePath => `  - "${packagePath}"`).join("\n")}
`;
    }

    public pnpmNpmrcLines(): string[] {
        return this.templateLines("pnpmScript", "npmrc");
    }

    public gitGitignoreLines(): string[] {
        return this.templateLines("gitScript", "gitignore");
    }

    private templateLines(scriptName: string, name: string): string[] {
        return this.templateRead(scriptName, name)
            .split(/\r?\n/)
            .map(line => line.trim())
            .filter(Boolean);
    }

    private templateRead(scriptName: string, name: string): string {
        return fs.readFileSync(path.join(this.scriptRoot, scriptName, name), "utf-8");
    }
}
