import fs from "fs";
import path from "path";
import { execSync } from "child_process";
import PnpmBase from "./pnpm";
import { Appexit, type PackageJsonRecord } from "./base";
import FileTplCore from "./fileTpl";

export { Appexit } from "./base";

export type ProjectIdentity = {
    packageName: string;
    repositoryName: string;
    author?: string;
    githubOwner?: string;
    repositoryUrl?: string;
    homepage?: string;
    bugsUrl?: string;
    license: string;
};

export type GitRemote = {
    owner: string;
    repo: string;
};

export default class GitBase extends PnpmBase {
    private githubLoginCache?: string;

    public static gitRootFind(startPath = process.cwd()): string | undefined {
        let dir = path.resolve(startPath);
        while (path.dirname(dir) !== dir) {
            if (fs.existsSync(path.join(dir, ".git"))) {
                return dir;
            }
            dir = path.dirname(dir);
        }
        return undefined;
    }

    protected rewritePackageJsonIdentity(targetPath: string, packageName: string): ProjectIdentity {
        const pkgPath = path.join(targetPath, "package.json");
        const pkg = this.readJsonFile<PackageJsonRecord>(pkgPath) ?? {};
        const sourceRepo = this.githubRemoteParse(this.repositoryUrlGet(pkg));
        const projectRepo = this.githubProjectRepoGet(packageName);
        const repositoryUrl = projectRepo ? `https://github.com/${projectRepo.owner}/${projectRepo.repo}.git` : undefined;
        const homepage = projectRepo ? `https://github.com/${projectRepo.owner}/${projectRepo.repo}` : undefined;
        const identity: ProjectIdentity = {
            packageName,
            repositoryName: projectRepo?.repo ?? this.githubRepositoryNameGet(packageName),
            author: this.gitConfigGet("user.name") ?? pkg.author,
            githubOwner: projectRepo?.owner,
            repositoryUrl,
            homepage,
            bugsUrl: homepage ? `${homepage}/issues` : undefined,
            license: pkg.license ?? "MIT",
        };

        pkg.name = identity.packageName;
        pkg.author = identity.author;
        pkg.license = identity.license;
        if (identity.repositoryUrl) {
            pkg.repository = { type: "git", url: identity.repositoryUrl };
        } else {
            delete pkg.repository;
        }
        if (identity.homepage) {
            pkg.homepage = identity.homepage;
        } else {
            delete pkg.homepage;
        }
        if (identity.bugsUrl) {
            pkg.bugs = { url: identity.bugsUrl };
        } else {
            delete pkg.bugs;
        }

        this.writeJsonFile(pkgPath, pkg);
        this.readmeIdentitySet(targetPath, sourceRepo, identity);
        return identity;
    }

    protected async finalizeProjectOutput(targetPath: string, packageName: string): Promise<ProjectIdentity> {
        const normalizedPackageName = this.toPackageName(packageName);
        await this.targetPathsConfirm(this.identityModifiedFiles(targetPath));
        const identity = this.rewritePackageJsonIdentity(targetPath, normalizedPackageName);
        await this.gitProjectFilesPrepare(targetPath);
        await this.gitProjectEnsure(targetPath, normalizedPackageName);
        await this.publishWorkflowAsk(targetPath, identity);
        return identity;
    }

    public async rewriteCurrentPackageIdentity(): Promise<void> {
        const prompts = await import("prompts");
        const response = await prompts.default({
            type: "text",
            name: "packageName",
            message: "请输入 package.json name",
            initial: this.cwdProjectInfo.jsonInfo.name ?? path.basename(this.cwdProjectInfo.pkgPath),
        });

        if (!response.packageName) {
            throw new Error("user-cancelled");
        }

        const packageName = String(response.packageName).trim();
        await this.githubProjectRepoEnsure(packageName);
        await this.targetPathsConfirm(this.identityModifiedFiles(this.cwdProjectInfo.pkgPath));
        const identity = this.rewritePackageJsonIdentity(this.cwdProjectInfo.pkgPath, packageName);
        console.log(`已重写 package.json 身份信息: ${identity.packageName}`);
        console.log("modified files:");
        for (const filePath of this.identityModifiedFiles(this.cwdProjectInfo.pkgPath)) {
            console.log(`- ${this.pathDisplay(filePath)}`);
        }
    }

    public override async setupPnpmWorkspaceRoot(): Promise<void> {
        const packageName = this.cwdProjectInfo.jsonInfo.name ?? path.basename(this.cwdProjectInfo.pkgPath);
        await this.githubProjectRepoEnsure(packageName);
        await this.targetPathsConfirm([path.join(this.cwdProjectInfo.workspacePath, ".gitignore")]);
        this.gitignoreSet(this.cwdProjectInfo.workspacePath);
        await this.pnpmRootSetupAsk(this.cwdProjectInfo.workspacePath);
    }

    public async initCurrentGitignore(): Promise<void> {
        await this.targetPathsConfirm([path.join(this.cwdProjectInfo.workspacePath, ".gitignore")]);
        this.gitignoreSet(this.cwdProjectInfo.workspacePath);
        console.log(`.gitignore 已初始化: ${this.pathDisplay(path.join(this.cwdProjectInfo.workspacePath, ".gitignore"))}`);
    }

    protected async gitProjectFilesPrepare(targetPath: string): Promise<void> {
        await this.targetPathsConfirm([path.join(targetPath, ".gitignore")]);
        this.gitignoreSet(targetPath);
        await this.pnpmRootSetupAsk(targetPath);
    }

    protected async publishWorkflowAsk(targetPath: string, identity: ProjectIdentity): Promise<void> {
        const prompts = await import("prompts");
        const response = await prompts.default({
            type: "confirm",
            name: "enabled",
            message: "Create publish config for current project?",
            initial: false,
        });

        if (response.enabled === undefined) {
            throw new Error("user-cancelled");
        }
        if (!response.enabled) {
            console.log("跳过 publish.yml");
            return;
        }

        const { default: GithubPublishYmlInit } = await import("../githubScript/githubPublishYmlInit");
        const result = await new GithubPublishYmlInit().createForProject({
            packageName: identity.packageName,
            targetPath,
            githubOwner: identity.githubOwner,
        });
        if (!result) {
            return;
        }
        console.log(`已创建发布配置: ${result.files.map(filePath => this.pathDisplay(filePath)).join(", ")}`);
        return;
    }

    protected gitignoreSet(targetPath: string): void {
        this.linesFileEnsure(path.join(targetPath, ".gitignore"), new FileTplCore().gitGitignoreLines());
    }

    protected async gitProjectEnsure(targetPath: string, packageName: string): Promise<GitRemote | undefined> {
        const parentGitRoot = this.parentGitRootFind(targetPath);
        if (parentGitRoot) {
            console.log(`父级已存在 git 仓库，跳过子项目 git/GitHub 初始化: ${this.pathDisplay(parentGitRoot)}`);
            return undefined;
        }

        const normalizedPackageName = this.toPackageName(packageName);
        const projectRepo = this.githubProjectRepoGet(normalizedPackageName);
        if (!projectRepo) {
            console.log("GitHub owner not detected, skip repository creation");
            return undefined;
        }

        if (!fs.existsSync(path.join(targetPath, ".git"))) {
            await this.commandRunInherit("git init -b master", targetPath, "git init");
            console.log(`已初始化 git 仓库: ${this.pathDisplay(targetPath)}`);
        }

        const targetUrl = `https://github.com/${projectRepo.owner}/${projectRepo.repo}.git`;
        if (this.githubRepoExists(projectRepo)) {
            console.log(`GitHub repository exists, bind to ${projectRepo.owner}/${projectRepo.repo}`);
        } else {
            const prompts = await import("prompts");
            const visibilityResponse = await prompts.default({
                type: "select",
                name: "visibility",
                message: `GitHub repository ${projectRepo.owner}/${projectRepo.repo} does not exist. Create as:`,
                choices: [
                    { title: "public", value: "public" },
                    { title: "private", value: "private" },
                ],
                initial: 0,
            });
            if (!visibilityResponse.visibility) {
                throw new Error("user-cancelled");
            }
            const visibility = visibilityResponse.visibility as "public" | "private";
            try {
                await this.commandRunInherit(
                    `gh repo create ${this.shellArg(`${projectRepo.owner}/${projectRepo.repo}`)} --${visibility} --clone=false`,
                    targetPath,
                    `gh repo create ${projectRepo.owner}/${projectRepo.repo}`,
                );
                console.log(`Created GitHub ${visibility} repository: ${projectRepo.owner}/${projectRepo.repo}`);
            } catch {
                throw new Appexit(`GitHub repository create failed: ${projectRepo.owner}/${projectRepo.repo}`);
            }
        }

        const currentUrl = this.commandReadOptional("git config --get remote.origin.url", targetPath);
        if (currentUrl === targetUrl) {
            return projectRepo;
        }

        try {
            if (currentUrl) {
                await this.commandRunInherit(`git remote set-url origin ${this.shellArg(targetUrl)}`, targetPath, "git remote set-url");
            } else {
                await this.commandRunInherit(`git remote add origin ${this.shellArg(targetUrl)}`, targetPath, "git remote add");
            }
            console.log(`已设置 origin: ${targetUrl}`);
        } catch {
            throw new Appexit(`GitHub origin 设置失败: ${targetUrl}`);
        }

        return projectRepo;
    }

    private parentGitRootFind(targetPath: string): string | undefined {
        const targetRoot = path.resolve(targetPath);
        const parentRoot = path.dirname(targetRoot);
        const gitRoot = GitBase.gitRootFind(parentRoot);
        return gitRoot && !GitBase.pathEqual(gitRoot, targetRoot) ? gitRoot : undefined;
    }

    protected githubRemoteParse(value: string | undefined): GitRemote | undefined {
        const match = value?.match(/github\.com[:/]([^/]+)\/(.+?)(?:\.git)?$/i);
        if (!match?.[1] || !match[2]) {
            return undefined;
        }
        return { owner: match[1], repo: match[2] };
    }

    protected githubRemoteOptional(cwd = process.cwd()): GitRemote | undefined {
        const remote = this.commandReadOptional("git remote get-url origin", cwd);
        return this.githubRemoteParse(remote);
    }

    protected githubRemoteRead(cwd = process.cwd()): GitRemote {
        const remote = this.commandRead("git remote get-url origin", cwd);
        const parsedRemote = this.githubRemoteParse(remote);
        if (!parsedRemote) {
            throw new Appexit(`无法解析 origin: ${remote}`);
        }
        return parsedRemote;
    }

    protected githubOwnerFromPackage(pkg: PackageJsonRecord): string | undefined {
        const repositoryUrl = this.repositoryUrlGet(pkg);
        const value = repositoryUrl ?? pkg.homepage;
        return this.githubRemoteParse(value)?.owner;
    }

    private readmeIdentitySet(targetPath: string, sourceRepo: GitRemote | undefined, identity: ProjectIdentity): void {
        const readmePath = path.join(targetPath, "README.md");
        if (!fs.existsSync(readmePath)) {
            return;
        }

        let content = fs.readFileSync(readmePath, "utf-8");
        if (sourceRepo && identity.githubOwner) {
            content = content.replaceAll(`github.com/${sourceRepo.owner}/${sourceRepo.repo}`, `github.com/${identity.githubOwner}/${identity.repositoryName}`);
            content = content.replaceAll(`${sourceRepo.owner}/${sourceRepo.repo}`, `${identity.githubOwner}/${identity.repositoryName}`);
        }
        content = content.replaceAll(/name:\s*["']?[^"'\n]+["']?/gi, `name: ${identity.packageName}`);
        fs.writeFileSync(readmePath, content, "utf-8");
    }

    private identityModifiedFiles(targetPath: string): string[] {
        return [
            path.join(targetPath, "package.json"),
            path.join(targetPath, "README.md"),
        ].filter(filePath => fs.existsSync(filePath));
    }

    private async githubProjectRepoEnsure(packageName: string): Promise<GitRemote | undefined> {
        const projectRepo = this.githubProjectRepoGet(packageName);
        if (!projectRepo) {
            console.log("GitHub owner not detected, skip repository creation");
            return undefined;
        }

        const currentRepo = this.currentGitHubRepoGet();
        const isCurrentProjectRepo = currentRepo?.owner === projectRepo.owner && currentRepo.repo === projectRepo.repo;
        if (!isCurrentProjectRepo) {
            if (this.githubRepoExists(projectRepo)) {
                console.log(`GitHub 仓库已存在: ${projectRepo.owner}/${projectRepo.repo}`);
            } else {
                const prompts = await import("prompts");
                const visibilityResponse = await prompts.default({
                    type: "select",
                    name: "visibility",
                    message: `GitHub 仓库 ${projectRepo.owner}/${projectRepo.repo} 不存在，选择创建为：`,
                    choices: [
                        { title: "public", value: "public" },
                        { title: "private", value: "private" },
                    ],
                    initial: 0,
                });
                if (!visibilityResponse.visibility) {
                    throw new Error("user-cancelled");
                }
                const visibility = visibilityResponse.visibility as "public" | "private";
                try {
                    execSync(
                        `gh repo create ${this.shellArg(`${projectRepo.owner}/${projectRepo.repo}`)} --${visibility} --clone=false`,
                        { cwd: this.cwdProjectInfo.pkgPath, stdio: "inherit" },
                    );
                    console.log(`已创建 GitHub ${visibility} 仓库: ${projectRepo.owner}/${projectRepo.repo}`);
                } catch {
                    throw new Appexit(`GitHub 仓库创建失败: ${projectRepo.owner}/${projectRepo.repo}`);
                }
            }
            this.githubOriginRemoteEnsure(projectRepo, currentRepo);
        }

        return projectRepo;
    }

    private githubProjectRepoGet(packageName: string): GitRemote | undefined {
        const currentRepo = this.currentGitHubRepoGet();
        const owner = currentRepo?.owner ?? this.githubLoginGet();
        if (!owner) {
            return undefined;
        }
        return {
            owner,
            repo: this.githubRepositoryNameGet(packageName),
        };
    }

    private githubRepoExists(repo: GitRemote): boolean {
        try {
            console.log(`check GitHub repository: ${repo.owner}/${repo.repo}`);
            execSync(`gh repo view ${this.shellArg(`${repo.owner}/${repo.repo}`)}`, {
                cwd: this.cwdProjectInfo.pkgPath,
                stdio: "ignore",
                timeout: 30_000,
            });
            return true;
        } catch {
            return false;
        }
    }

    private githubOriginRemoteEnsure(projectRepo: GitRemote, currentRepo: GitRemote | undefined): void {
        const targetUrl = `https://github.com/${projectRepo.owner}/${projectRepo.repo}.git`;
        const currentUrl = this.commandReadOptional("git config --get remote.origin.url");
        if (currentUrl === targetUrl) {
            return;
        }

        if (currentRepo) {
            console.log(`当前 GitHub 仓库 ${currentRepo.owner}/${currentRepo.repo} 与项目名不一致，切换 origin 到 ${projectRepo.owner}/${projectRepo.repo}`);
        } else if (currentUrl) {
            console.log(`当前 origin 不是 GitHub 仓库，切换 origin 到 ${projectRepo.owner}/${projectRepo.repo}`);
        } else {
            console.log(`添加 origin 到 ${projectRepo.owner}/${projectRepo.repo}`);
        }

        try {
            if (currentUrl) {
                execSync(`git remote set-url origin ${this.shellArg(targetUrl)}`, {
                    cwd: this.cwdProjectInfo.pkgPath,
                    stdio: "inherit",
                });
            } else {
                execSync(`git remote add origin ${this.shellArg(targetUrl)}`, {
                    cwd: this.cwdProjectInfo.pkgPath,
                    stdio: "inherit",
                });
            }
        } catch {
            throw new Appexit(`GitHub origin 设置失败: ${targetUrl}`);
        }
    }

    private githubRepositoryNameGet(packageName: string): string {
        return packageName
            .replace(/^@/, "")
            .replace(/[\\/]+/g, "-")
            .replace(/[^a-zA-Z0-9._-]+/g, "-");
    }

    private repositoryUrlGet(pkg: PackageJsonRecord): string | undefined {
        if (typeof pkg.repository === "string") {
            return pkg.repository;
        }
        return pkg.repository?.url;
    }

    private currentGitHubRepoGet(): GitRemote | undefined {
        const remote = this.commandReadOptional("git config --get remote.origin.url");
        return this.githubRemoteParse(remote);
    }

    private githubLoginGet(): string | undefined {
        if (this.githubLoginCache) {
            return this.githubLoginCache;
        }
        console.log("detect GitHub login");
        this.githubLoginCache = this.commandReadOptional("gh api user --jq .login");
        return this.githubLoginCache;
    }

    private gitConfigGet(key: string): string | undefined {
        return this.commandReadOptional(`git config --get ${key}`);
    }
}
