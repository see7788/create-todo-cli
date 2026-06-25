import { execSync, spawn } from "node:child_process";
import {
  copyFileSync,
  existsSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  rmSync,
  statSync,
  writeFileSync,
} from "node:fs";
import { basename, dirname, isAbsolute, join, parse, relative, resolve } from "node:path";
import prompts from "prompts";
import LibBase, { Appexit } from "./public.js";

type GitRemote = {
  owner: string;
  repo: string;
};

type WorkspacePlan = {
  internalPackages: string[];
  externalPackages: ExternalWorkspacePackage[];
};

type ExternalWorkspacePackage = {
  packageName: string;
  sourceRoot: string;
  targetRelativePath: string;
};

type ExternalWorkspaceCollectState = {
  packages: ExternalWorkspacePackage[];
  packageSources: Set<string>;
  targetSources: Map<string, string>;
  workspaceRoots: Set<string>;
};

type WorkspaceSpecTarget = {
  path: string;
  required: boolean;
};

type PlatformPushMode = "current" | "siblings";

class GitPush extends LibBase {
  private projectRoot!: string;
  private projectRepoName!: string;
  private releaseRepoName!: string;
  private releaseRoot!: string;
  private platformGithubLoginCache?: string;

  constructor() {
    super({ requirePackage: false });
  }

  public async task1(): Promise<void> {
    this.projectRoot = this.projectRootFind();
    this.projectRepoName = basename(this.projectRoot);

    if (!this.projectHasExternalPnpmWorkspace(this.projectRoot)) {
      await this.platformProjectPush();
      return;
    }

    this.releaseContextInit();
    await this.workspaceReleasePush();
  }

  private releaseContextInit(): void {
    this.releaseRepoName = `${this.releaseNamePart(this.projectRepoName)}_release`;
    this.releaseRoot = resolve(dirname(this.projectRoot), this.releaseRepoName);
  }

  private async workspaceReleasePush(): Promise<void> {
    const workspacePlan = this.workspacePlanRead();
    if (workspacePlan.externalPackages.length === 0) {
      throw new Appexit("pnpm-workspace.yaml 中没有 ../ 开头的外部 workspace 包");
    }

    const sourceRepo = await this.platformGitProjectEnsure(this.projectRoot, this.projectRepoName);
    if (!sourceRepo) {
      throw new Appexit("无法推断 GitHub owner，无法初始化 GitHub 仓库");
    }
    this.sourceRepoCommitIfDirty();
    await this.platformGitEnsureInitialCommit(this.projectRoot);
    await this.platformGitPushHead(this.projectRoot);

    const sourceRemote = this.sourceRemoteRead();
    await this.githubReleaseRepoEnsure(sourceRemote);
    this.releaseRepoLocalEnsure(sourceRemote);
    this.releaseRootReset();
    this.projectFilesCopy(this.projectRoot, this.releaseRoot);
    this.externalPackagesCopy(workspacePlan.externalPackages);
    this.releaseWorkspaceWrite(workspacePlan);
    this.releaseLockfileRefresh();
    this.releaseRepoCommitAndPush();
    await this.currentPackagePushIfNeeded();

    console.log(`git workspace prelease 完成: ${sourceRemote.owner}/${this.releaseRepoName}`);
    console.log(`本地 release 目录: ${this.pathDisplay(this.releaseRoot)}`);
  }

  private async platformProjectPush(): Promise<void> {
    const mode = await this.platformPushModeSelect();
    if (mode === "siblings") {
      await this.platformSiblingProjectsPush();
      return;
    }

    await this.platformProjectPushTarget(this.projectRoot);
  }

  private async platformPushModeSelect(): Promise<PlatformPushMode> {
    if (!this.platformSiblingPaths().length) {
      return "current";
    }

    const response = await prompts({
      type: "select",
      name: "mode",
      message: "选择平台项目 Git push 分支",
      choices: [
        { title: "git push", value: "current" },
        { title: "git push for 兄弟目录", value: "siblings" },
      ],
      initial: 0,
    });
    if (!response.mode) {
      throw new Error("user-cancelled");
    }
    return response.mode as PlatformPushMode;
  }

  private async platformSiblingProjectsPush(): Promise<void> {
    const siblings = this.platformSiblingPaths();
    if (siblings.length === 0) {
      return;
    }

    console.log(`Run gitPush for 兄弟目录: ${siblings.length}`);
    const failed: string[] = [];
    for (const [index, siblingPath] of siblings.entries()) {
      const progress = `[${index + 1}/${siblings.length}]`;
      try {
        console.log(`\n${progress} gitPush: ${this.pathDisplay(siblingPath)}`);
        await this.platformProjectPushTarget(siblingPath);
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        failed.push(`${this.pathDisplay(siblingPath)}: ${message}`);
        console.error(`${progress} skip after failure: ${this.pathDisplay(siblingPath)}`);
        console.error(message);
      }
    }

    if (failed.length) {
      console.error(`gitPush sibling failures: ${failed.length}`);
      for (const item of failed) {
        console.error(`- ${item}`);
      }
    }
  }

  private platformSiblingPaths(): string[] {
    const currentPath = resolve(this.projectRoot);
    const parentPath = dirname(currentPath);
    return readdirSync(parentPath, { withFileTypes: true })
      .filter(item => item.isDirectory())
      .filter(item => !item.name.startsWith("."))
      .filter(item => !["node_modules", "dist"].includes(item.name))
      .map(item => join(parentPath, item.name))
      .filter(itemPath => resolve(itemPath) !== currentPath);
  }

  private async platformProjectPushTarget(targetPath: string): Promise<void> {
    const repoName = this.projectRepoNameGet(targetPath);
    const projectRepo = this.platformGithubProjectRepoGet(repoName, targetPath);
    if (!projectRepo) {
      throw new Appexit("无法推断 GitHub owner，无法初始化 GitHub 仓库");
    }

    await this.platformGitProjectEnsure(targetPath, repoName);
    await this.platformGitEnsureInitialCommit(targetPath);
    await this.platformGitPushHead(targetPath);

    console.log(`GitHub repo initialized and pushed: https://github.com/${projectRepo.owner}/${projectRepo.repo}`);
  }

  private async currentPackagePushIfNeeded(): Promise<void> {
    const currentPackageRoot = resolve(this.cwdProjectInfo.pkgPath);
    if (
      currentPackageRoot === resolve(this.projectRoot) ||
      !existsSync(join(currentPackageRoot, "package.json"))
    ) {
      return;
    }

    console.log(`\ninitGithubPkg pnpm: push current package ${this.pathDisplay(currentPackageRoot)}`);
    await this.platformProjectPushTarget(currentPackageRoot);
  }

  private workspacePlanRead(): WorkspacePlan {
    const workspacePath = join(this.projectRoot, "pnpm-workspace.yaml");
    if (!existsSync(workspacePath)) {
      throw new Appexit(`不存在 pnpm-workspace.yaml: ${workspacePath}`);
    }

    const packages = LibBase.pnpmWorkspacePackagesParse(readFileSync(workspacePath, "utf-8"));
    const externalSpecs = packages.filter(item => this.workspaceSpecIsExternal(item));
    return {
      internalPackages: packages.filter(item => !item.startsWith("!") && !this.workspaceSpecIsExternal(item)),
      externalPackages: this.externalWorkspacePackagesCollect(this.projectRoot, externalSpecs),
    };
  }

  private projectRootFind(startPath = process.cwd()): string {
    let dir = resolve(startPath);
    while (dirname(dir) !== dir) {
      if (existsSync(join(dir, ".git"))) {
        return dir;
      }
      dir = dirname(dir);
    }
    return resolve(startPath);
  }

  private projectHasExternalPnpmWorkspace(projectRoot: string): boolean {
    const workspacePath = join(projectRoot, "pnpm-workspace.yaml");
    if (!existsSync(workspacePath)) {
      return false;
    }
    return LibBase.pnpmWorkspacePackagesParse(readFileSync(workspacePath, "utf-8"))
      .some(item => this.workspaceSpecIsExternal(item));
  }

  private sourceRemoteRead(): GitRemote {
    const url = this.commandRead("git remote get-url origin", this.projectRoot);
    const remote = this.gitRemoteParse(url);
    if (!remote) {
      throw new Appexit(`无法解析 origin: ${url}`);
    }
    return remote;
  }

  private sourceRepoCommitIfDirty(): void {
    const status = this.commandRead("git status --porcelain", this.projectRoot);
    if (!status) {
      console.log("源仓库没有变更，跳过提交");
      return;
    }

    this.commandRun("git add -A", this.projectRoot);
    this.commandRun(`git commit -m ${this.shellArg("release: snapshot source workspace")}`, this.projectRoot);
    console.log("源仓库已提交，继续执行 release");
  }

  private gitRemoteParse(url: string): GitRemote | undefined {
    const httpsMatch = url.match(/^https:\/\/github\.com\/([^/]+)\/(.+?)(?:\.git)?$/);
    if (httpsMatch?.[1] && httpsMatch[2]) {
      return { owner: httpsMatch[1], repo: httpsMatch[2] };
    }

    const sshMatch = url.match(/^git@github\.com:([^/]+)\/(.+?)(?:\.git)?$/);
    if (sshMatch?.[1] && sshMatch[2]) {
      return { owner: sshMatch[1], repo: sshMatch[2] };
    }

    return undefined;
  }

  private async githubReleaseRepoEnsure(sourceRemote: GitRemote): Promise<void> {
    if (!this.commandOk(`gh repo view ${this.shellArg(`${sourceRemote.owner}/${this.releaseRepoName}`)}`, this.projectRoot)) {
      const enabled = await prompts({
        type: "confirm",
        name: "value",
        message: `GitHub 仓库 ${sourceRemote.owner}/${this.releaseRepoName} 不存在，是否创建？`,
        initial: true,
      });
      if (enabled.value === undefined) {
        throw new Error("user-cancelled");
      }
      if (!enabled.value) {
        throw new Appexit(`缺少 GitHub release 仓库: ${sourceRemote.owner}/${this.releaseRepoName}`);
      }

      const visibility = await prompts({
        type: "select",
        name: "value",
        message: "请选择 release 仓库可见性",
        choices: [
          { title: "private", value: "private" },
          { title: "public", value: "public" },
        ],
        initial: 0,
      });
      if (!visibility.value) {
        throw new Error("user-cancelled");
      }

      this.commandRun(
        `gh repo create ${this.shellArg(`${sourceRemote.owner}/${this.releaseRepoName}`)} --${visibility.value} --clone=false`,
        this.projectRoot,
      );
    }
  }

  private releaseRepoLocalEnsure(sourceRemote: GitRemote): void {
    const remoteUrl = `https://github.com/${sourceRemote.owner}/${this.releaseRepoName}.git`;
    if (!existsSync(this.releaseRoot)) {
      this.commandRun(`git clone ${this.shellArg(remoteUrl)} ${this.shellArg(this.releaseRoot)}`, dirname(this.projectRoot));
      return;
    }

    if (!existsSync(join(this.releaseRoot, ".git"))) {
      throw new Appexit(`release 目录已存在但不是 Git 仓库: ${this.releaseRoot}`);
    }

    const origin = this.commandRead("git remote get-url origin", this.releaseRoot);
    if (origin !== remoteUrl) {
      this.commandRun(`git remote set-url origin ${this.shellArg(remoteUrl)}`, this.releaseRoot);
    }
  }

  private releaseRootReset(): void {
    const source = resolve(this.projectRoot);
    const target = resolve(this.releaseRoot);
    if (source === target || source.startsWith(`${target}\\`) || target.startsWith(`${source}\\`)) {
      throw new Appexit("release 目录不能与源项目互相包含");
    }

    for (const name of readdirSync(this.releaseRoot)) {
      if (name === ".git") {
        continue;
      }
      rmSync(join(this.releaseRoot, name), { recursive: true, force: true });
    }
  }

  private projectFilesCopy(sourceRoot: string, targetRoot: string): void {
    for (const file of this.gitVisibleFiles(sourceRoot)) {
      this.fileCopy(join(sourceRoot, file), join(targetRoot, file));
    }
  }

  private externalPackagesCopy(externalPackages: ExternalWorkspacePackage[]): void {
    for (const packageItem of externalPackages) {
      const sourceRoot = packageItem.sourceRoot;
      if (!existsSync(join(sourceRoot, "package.json"))) {
        throw new Appexit(`外部 workspace 包不存在或缺少 package.json: ${sourceRoot}`);
      }

      const targetRoot = join(this.releaseRoot, packageItem.targetRelativePath);
      for (const file of this.packageVisibleFiles(sourceRoot)) {
        this.fileCopy(join(sourceRoot, file), join(targetRoot, file));
      }
    }
  }

  private releaseWorkspaceWrite(workspacePlan: WorkspacePlan): void {
    const packages = Array.from(new Set([
      ...workspacePlan.internalPackages,
      ...workspacePlan.externalPackages.map(item => item.targetRelativePath),
    ]));
    writeFileSync(
      join(this.releaseRoot, "pnpm-workspace.yaml"),
      `packages:\n${packages.map(item => `  - "${item}"`).join("\n")}\n`,
      "utf-8",
    );
  }

  private externalWorkspacePackagesCollect(workspaceRoot: string, specs: string[]): ExternalWorkspacePackage[] {
    const state: ExternalWorkspaceCollectState = {
      packages: [],
      packageSources: new Set<string>(),
      targetSources: new Map<string, string>(),
      workspaceRoots: new Set<string>(),
    };

    for (const target of this.workspaceSpecTargets(workspaceRoot, specs)) {
      this.externalWorkspaceTargetCollect(target.path, state, target.required);
    }

    return state.packages;
  }

  private externalWorkspaceTargetCollect(
    targetRoot: string,
    state: ExternalWorkspaceCollectState,
    required: boolean,
  ): void {
    const sourceRoot = resolve(targetRoot);
    const hasPackageJson = existsSync(join(sourceRoot, "package.json"));
    const hasWorkspace = existsSync(join(sourceRoot, "pnpm-workspace.yaml"));

    if (!hasPackageJson && !hasWorkspace) {
      if (required) {
        throw new Appexit(`外部 workspace 路径不是 package 或 pnpm workspace: ${sourceRoot}`);
      }
      return;
    }

    if (hasPackageJson) {
      this.externalPackageAdd(sourceRoot, state);
    }

    if (!hasWorkspace || state.workspaceRoots.has(sourceRoot)) {
      return;
    }

    state.workspaceRoots.add(sourceRoot);
    const specs = LibBase.pnpmWorkspacePackagesParse(
      readFileSync(join(sourceRoot, "pnpm-workspace.yaml"), "utf-8"),
    );
    for (const target of this.workspaceSpecTargets(sourceRoot, specs)) {
      this.externalWorkspaceTargetCollect(target.path, state, target.required);
    }
  }

  private externalPackageAdd(sourceRoot: string, state: ExternalWorkspaceCollectState): void {
    if (state.packageSources.has(sourceRoot)) {
      return;
    }

    const packageName = this.packageNameRead(sourceRoot);
    const targetRelativePath = this.externalPackageTargetPath(packageName, sourceRoot);
    const existingSource = state.targetSources.get(targetRelativePath);
    if (existingSource && existingSource !== sourceRoot) {
      throw new Appexit(`外部 workspace 包目标路径冲突: ${targetRelativePath} (${existingSource}, ${sourceRoot})`);
    }

    state.packageSources.add(sourceRoot);
    state.targetSources.set(targetRelativePath, sourceRoot);
    state.packages.push({ packageName, sourceRoot, targetRelativePath });
  }

  private workspaceSpecTargets(workspaceRoot: string, specs: string[]): WorkspaceSpecTarget[] {
    const includeSpecs = specs.filter(item => !item.startsWith("!"));
    const excludeSpecs = specs
      .filter(item => item.startsWith("!"))
      .map(item => item.slice(1));
    const excluded = new Set(
      excludeSpecs.flatMap(spec => this.workspaceSpecExpand(workspaceRoot, spec).map(item => resolve(item.path))),
    );

    const targets: WorkspaceSpecTarget[] = [];
    const seen = new Set<string>();
    for (const spec of includeSpecs) {
      for (const item of this.workspaceSpecExpand(workspaceRoot, spec)) {
        const targetPath = resolve(item.path);
        if (excluded.has(targetPath) || seen.has(targetPath)) {
          continue;
        }
        if (!item.required && !this.workspaceTargetLooksUseful(targetPath)) {
          continue;
        }
        seen.add(targetPath);
        targets.push({ path: targetPath, required: item.required });
      }
    }

    return targets;
  }

  private workspaceSpecExpand(workspaceRoot: string, spec: string): WorkspaceSpecTarget[] {
    const normalizedSpec = spec.trim();
    if (!normalizedSpec) {
      return [];
    }

    const hasGlob = /[*?]/.test(normalizedSpec);
    const absolutePattern = isAbsolute(normalizedSpec)
      ? resolve(normalizedSpec)
      : resolve(workspaceRoot, normalizedSpec);

    if (!hasGlob) {
      return [{ path: absolutePattern, required: true }];
    }

    const parsed = parse(absolutePattern);
    const segments = relative(parsed.root, absolutePattern)
      .split(/[\\/]/)
      .filter(Boolean);
    return this.globSegmentsExpand(parsed.root, segments).map(item => ({
      path: item,
      required: false,
    }));
  }

  private globSegmentsExpand(current: string, segments: string[]): string[] {
    if (segments.length === 0) {
      return existsSync(current) ? [current] : [];
    }

    const [segment, ...rest] = segments;
    if (!segment) {
      return this.globSegmentsExpand(current, rest);
    }

    if (segment === "**") {
      const matches = this.globSegmentsExpand(current, rest);
      if (!existsSync(current) || !statSync(current).isDirectory()) {
        return matches;
      }
      for (const name of readdirSync(current)) {
        const child = join(current, name);
        if (statSync(child).isDirectory()) {
          matches.push(...this.globSegmentsExpand(child, segments));
        }
      }
      return matches;
    }

    if (/[*?]/.test(segment)) {
      if (!existsSync(current) || !statSync(current).isDirectory()) {
        return [];
      }

      const pattern = this.globSegmentRegex(segment);
      return readdirSync(current)
        .filter(name => pattern.test(name))
        .flatMap(name => this.globSegmentsExpand(join(current, name), rest));
    }

    return this.globSegmentsExpand(join(current, segment), rest);
  }

  private globSegmentRegex(segment: string): RegExp {
    const escaped = segment.replace(/[.+^${}()|[\]\\]/g, "\\$&");
    return new RegExp(`^${escaped.replace(/\*/g, "[^/]*").replace(/\?/g, "[^/]")}$`);
  }

  private workspaceTargetLooksUseful(targetPath: string): boolean {
    return existsSync(join(targetPath, "package.json")) || existsSync(join(targetPath, "pnpm-workspace.yaml"));
  }

  private workspaceSpecIsExternal(spec: string): boolean {
    const normalized = spec.startsWith("!") ? spec.slice(1) : spec;
    return normalized.startsWith("../") || normalized.startsWith("..\\");
  }

  private packageNameRead(packageRoot: string): string {
    const pkg = JSON.parse(readFileSync(join(packageRoot, "package.json"), "utf-8")) as { name?: string };
    return String(pkg.name ?? basename(packageRoot));
  }

  private projectRepoNameGet(projectRoot: string): string {
    if (existsSync(join(projectRoot, "package.json"))) {
      return this.packageNameRead(projectRoot);
    }
    return basename(projectRoot);
  }

  private externalPackageTargetPath(packageName: string, sourceRoot: string): string {
    const rawParts = packageName ? packageName.split("/") : [basename(sourceRoot)];
    const parts = rawParts
      .map(part => part.replace(/[^a-zA-Z0-9@._-]+/g, "-"))
      .filter(Boolean);
    return ["extends", ...parts].join("/");
  }

  private releaseLockfileRefresh(): void {
    this.commandRun("pnpm install --lockfile-only", this.releaseRoot);
  }

  private releaseRepoCommitAndPush(): void {
    this.commandRun("git checkout -B master", this.releaseRoot);
    this.commandRun("git add -A", this.releaseRoot);

    if (!this.commandRead("git status --porcelain", this.releaseRoot)) {
      console.log("release 仓库没有变更，跳过提交");
      this.commandRun("git push -u origin master", this.releaseRoot);
      return;
    }

    this.commandRun(`git commit -m ${this.shellArg("release: sync pnpm workspace snapshot")}`, this.releaseRoot);
    this.commandRun("git push -u origin master", this.releaseRoot);
  }

  private gitVisibleFiles(root: string): string[] {
    return this.commandRead("git ls-files -co --exclude-standard", root)
      .split(/\r?\n/)
      .map(item => item.trim())
      .filter(Boolean)
      .filter(file => !this.shouldSkipReleaseFile(file));
  }

  private packageVisibleFiles(root: string): string[] {
    if (existsSync(join(root, ".git"))) {
      return this.gitVisibleFiles(root);
    }
    return this.directoryFiles(root, root).filter(file => !this.shouldSkipReleaseFile(file));
  }

  private directoryFiles(root: string, current: string): string[] {
    const files: string[] = [];
    for (const name of readdirSync(current)) {
      if (this.shouldSkipReleaseFile(name)) {
        continue;
      }

      const file = join(current, name);
      if (statSync(file).isDirectory()) {
        files.push(...this.directoryFiles(root, file));
      } else {
        files.push(relative(root, file).replace(/\\/g, "/"));
      }
    }
    return files;
  }

  private shouldSkipReleaseFile(file: string): boolean {
    const parts = file.replace(/\\/g, "/").split("/");
    return parts.some(part => [".git", "node_modules", ".pnpm-store"].includes(part));
  }

  private fileCopy(source: string, target: string): void {
    mkdirSync(dirname(target), { recursive: true });
    copyFileSync(source, target);
  }

  private async platformGitProjectEnsure(targetPath: string, repoName: string): Promise<GitRemote | undefined> {
    const projectRepo = this.platformGithubProjectRepoGet(repoName, targetPath);
    if (!projectRepo) {
      console.log("GitHub owner not detected, skip repository creation");
      return undefined;
    }

    if (!existsSync(join(targetPath, ".git"))) {
      try {
        await this.platformCommandRunInherit("git init -b master", targetPath, "git init");
      } catch {
        await this.platformCommandRunInherit("git init", targetPath, "git init");
        await this.platformCommandRunInherit("git checkout -B master", targetPath, "git checkout");
      }
      console.log(`已初始化 git 仓库: ${this.pathDisplay(targetPath)}`);
    }

    const targetUrl = `https://github.com/${projectRepo.owner}/${projectRepo.repo}.git`;
    if (this.platformGithubRepoExists(projectRepo, targetPath)) {
      console.log(`GitHub repository exists, bind to ${projectRepo.owner}/${projectRepo.repo}`);
    } else {
      const visibilityResponse = await prompts({
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
      await this.platformCommandRunInherit(
        `gh repo create ${this.shellArg(`${projectRepo.owner}/${projectRepo.repo}`)} --${visibility} --clone=false`,
        targetPath,
        `gh repo create ${projectRepo.owner}/${projectRepo.repo}`,
      );
      console.log(`Created GitHub ${visibility} repository: ${projectRepo.owner}/${projectRepo.repo}`);
    }

    const currentUrl = this.commandReadOptional("git config --get remote.origin.url", targetPath);
    if (currentUrl === targetUrl) {
      return projectRepo;
    }
    if (currentUrl) {
      await this.platformCommandRunInherit(`git remote set-url origin ${this.shellArg(targetUrl)}`, targetPath, "git remote set-url");
    } else {
      await this.platformCommandRunInherit(`git remote add origin ${this.shellArg(targetUrl)}`, targetPath, "git remote add");
    }
    console.log(`已设置 origin: ${targetUrl}`);
    return projectRepo;
  }

  private async platformGitEnsureInitialCommit(targetPath: string): Promise<void> {
    if (this.commandReadOptional("git rev-parse --verify HEAD", targetPath)) {
      return;
    }

    await this.platformCommandRunInherit("git add -A", targetPath, "git add");
    try {
      await this.platformCommandRunInherit(`git commit -m ${this.shellArg("chore: initial commit")}`, targetPath, "git commit");
    } catch {
      const status = this.commandReadOptional("git status --porcelain", targetPath);
      if (!status) {
        await this.platformCommandRunInherit(
          `git commit --allow-empty -m ${this.shellArg("chore: initial commit")}`,
          targetPath,
          "git commit --allow-empty",
        );
        console.log("工作区无更改，已创建空提交");
        return;
      }
      throw new Appexit("创建初始提交失败");
    }
  }

  private async platformGitPushHead(targetPath: string): Promise<void> {
    await this.platformCommandRunInherit(
      `git -c credential.helper= -c credential.helper="!gh auth git-credential" push -u origin HEAD`,
      targetPath,
      "git push",
    );
  }

  private platformGithubRepoExists(repo: GitRemote, cwd: string): boolean {
    return this.commandOk(`gh repo view ${this.shellArg(`${repo.owner}/${repo.repo}`)}`, cwd);
  }

  private platformGithubProjectRepoGet(repoName: string, cwd: string): GitRemote | undefined {
    const normalizedRepo = this.platformGithubRepositoryNameGet(repoName);
    const currentRepo = this.platformCurrentGitHubRepoGet(cwd);
    const owner = currentRepo?.owner ?? this.platformGithubLoginGet(cwd);
    if (!owner) {
      return undefined;
    }
    return { owner, repo: normalizedRepo };
  }

  private platformCurrentGitHubRepoGet(cwd: string): GitRemote | undefined {
    const remote = this.commandReadOptional("git config --get remote.origin.url", cwd);
    return remote ? this.gitRemoteParse(remote) : undefined;
  }

  private platformGithubLoginGet(cwd: string): string | undefined {
    if (this.platformGithubLoginCache) {
      return this.platformGithubLoginCache;
    }
    this.platformGithubLoginCache = this.commandReadOptional("gh api user --jq .login", cwd);
    return this.platformGithubLoginCache;
  }

  private platformGithubRepositoryNameGet(repoName: string): string {
    return repoName
      .replace(/^@/, "")
      .replace(/[\\/]+/g, "-")
      .replace(/[^a-zA-Z0-9._-]+/g, "-");
  }

  private releaseNamePart(name: string): string {
    return name.replace(/^@/, "").replace(/[\\/]+/g, "-").replace(/[^a-zA-Z0-9._-]+/g, "-");
  }

  private commandOk(command: string, cwd: string): boolean {
    try {
      execSync(command, { cwd, stdio: "ignore" });
      return true;
    } catch {
      return false;
    }
  }

  private commandRead(command: string, cwd: string): string {
    try {
      return execSync(command, { cwd, encoding: "utf-8", stdio: ["ignore", "pipe", "pipe"] }).trim();
    } catch {
      throw new Appexit(`命令执行失败: ${command}`);
    }
  }

  private commandReadOptional(command: string, cwd: string): string | undefined {
    try {
      const value = execSync(command, { cwd, encoding: "utf-8", stdio: ["ignore", "pipe", "ignore"] }).trim();
      return value || undefined;
    } catch {
      return undefined;
    }
  }

  private async platformCommandRunInherit(command: string, cwd: string, label: string): Promise<void> {
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

  private commandRun(command: string, cwd: string): void {
    try {
      execSync(command, { cwd, stdio: "inherit" });
    } catch {
      throw new Appexit(`命令执行失败: ${command}`);
    }
  }
}

export default GitPush;

