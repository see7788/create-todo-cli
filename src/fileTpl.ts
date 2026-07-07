import fs from "fs";
import path from "path";
import { fileURLToPath } from "node:url";

/** 公共模板读取器，只放多个基础流程共用的模板。 */
export default class FileTplCore {
    private readonly templateRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "tpl");

    public pnpmWorkspaceYamlCreate(): string {
        return this.templateRead("pnpm-workspace.yaml");
    }

    public pnpmWorkspaceYamlReleaseCreate(packagePaths: string[]): string {
        return `packages:
${packagePaths.map(packagePath => `  - "${packagePath}"`).join("\n")}
`;
    }

    public pnpmNpmrcLines(): string[] {
        return this.templateLines("npmrc");
    }

    public gitGitignoreLines(): string[] {
        return this.templateLines("gitignore");
    }

    private templateLines(name: string): string[] {
        return this.templateRead(name)
            .split(/\r?\n/)
            .map(line => line.trim())
            .filter(Boolean);
    }

    private templateRead(name: string): string {
        return fs.readFileSync(path.join(this.templateRoot, name), "utf-8");
    }
}
