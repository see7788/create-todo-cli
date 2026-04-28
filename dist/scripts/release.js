#!/usr/bin/env node
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import LibBase, { Appexit } from "./tool.js";
/**发布管理器类 - 采用流畅异步模式的发布流程管理*/
class ReleaseManager extends LibBase {
    nextVersion;
    constructor() {
        super();
    }
    /**执行版本发布工作流 - 编排各个业务步骤的具体执行*/
    async task1() {
        // 编排业务流程的执行顺序
        console.log('\n🚀 开始版本发布流程');
        console.log('📦 1. 更新版本号并创建Git标签');
        await this.nextVersionSet(); // 内部已包含版本号更新、提交和标签创建
        // 自动处理Git状态检查和推送
        console.log('📤 2. 推送代码和标签到远程仓库');
        await this.checkAndPushGitChanges();
        console.log(`\n🚀 完成版本发布流程 - 版本: ${this.nextVersion}`);
        // 打印发布链接 - 从版本号中移除时间戳部分用于GitHub标签
        const gitTagVersion = this.nextVersion.split('+')[0];
        console.log(`🔗 GitHub Release: https://github.com/see7788/create-todo-cli/releases/tag/v${gitTagVersion}`);
        console.log(`🔗 NPM 包地址: https://www.npmjs.com/package/create-todo-cli`);
        console.log(`📦 当前发布版本: ${this.nextVersion}`);
        // GitHub Release将由GitHub Actions自动创建（见.github/workflows/publish.yml）
    }
    /**检查Git状态并推送到远程仓库 - 合并原checkGitStatus和pushChangesToRemote方法的功能*/
    async checkAndPushGitChanges() {
        // Git状态检查逻辑
        // 检查并初始化Git仓库
        if (!(this.runGitCommand('rev-parse --is-inside-work-tree', { encoding: 'utf8' }, false) === 'true')) {
            this.runCommand('git init', undefined, false);
        }
        // 检查是否有未暂存的变更
        const statusResult = this.runGitCommand('status --porcelain', { encoding: 'utf8' }, false);
        if (statusResult?.trim()) {
            try {
                // 自动暂存所有更改
                this.runGitCommand('add .');
                // 自动提交更改
                this.runGitCommand('commit -m "Update files before release"');
                console.log('✅ 已成功暂存并提交所有更改');
            }
            catch (error) {
                // 处理未提交更改失败是致命错误
                throw new Appexit('处理未提交更改失败');
            }
        }
        // 检查远程仓库
        const remotes = this.runGitCommand('remote', { encoding: 'utf8' }, false);
        if (!remotes || remotes.trim().length === 0) {
            // 静默处理无远程仓库情况
            return;
        }
        // 推送代码和标签到远程仓库（简化分支逻辑，直接推送当前HEAD和标签）
        try {
            // 直接推送当前HEAD到远程仓库的默认分支
            this.runInteractiveCommand('git push origin HEAD');
            // 推送标签到远程仓库
            this.runInteractiveCommand(`git push origin v${this.nextVersion}`);
        }
        catch (error) {
            // 推送代码到远程仓库失败是致命错误
            throw new Appexit('推送代码到远程仓库失败');
        }
    }
    /**设置下一个版本号*/
    async nextVersionSet() {
        // 1. 获取当前版本，如果不存在或不规范则使用默认版本0.0.1
        const currentVersion = this.cwdProjectInfo.jsonInfo.version || "0.0.1";
        // 2. 版本号递增 - 语义化版本规则递增
        const baseVersion = currentVersion.split(/[-+]/)[0];
        const [major, minor, patch] = baseVersion.split('.').map(Number);
        // 3. 生成带时间戳的唯一版本号（符合语义化版本规范，时间戳放在构建元数据部分）
        const timestamp = Date.now();
        this.nextVersion = `${major}.${minor}.${patch + 1}`;
        // 4. 直接更新package.json
        fs.writeFileSync(this.cwdProjectInfo.jsonPath, JSON.stringify({ ...this.cwdProjectInfo.jsonInfo, version: this.nextVersion }, null, 2));
        // 5. 提交版本更新
        try {
            this.runInteractiveCommand(`git add ${this.cwdProjectInfo.pkgPath}`);
            this.runInteractiveCommand(`git commit -m "chore: release ${this.nextVersion}"`);
        }
        catch (error) {
            // 静默失败，继续执行
        }
        // 6. 创建Git标签
        try {
            this.runInteractiveCommand(`git tag -a v${this.nextVersion} -m "Release ${this.nextVersion}"`);
        }
        catch (error) {
            // 静默失败，继续执行
        }
    }
}
/**直接运行脚本时执行 - 简化的错误处理*/
if (path.resolve(fileURLToPath(import.meta.url)) === path.resolve(process.argv[1])) {
    new ReleaseManager().task1();
}
export default ReleaseManager;
