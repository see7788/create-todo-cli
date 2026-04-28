#!/usr/bin/env node
import prompts from 'prompts';
import ProjectTemplateCreator from './scripts/template.js';
import ReleaseManager from './scripts/release.js';
import DistPackageBuilder from './scripts/dist2.js';
import { Appexit } from './scripts/tool.js';
import pkg from '../package.json' with { type: 'json' };
/**命令行界面类 - 编排层，负责组织和协调各个工具类的使用*/
class CLI {
    /**命令行参数*/
    args;
    /**构造函数 - 初始化命令行参数*/
    constructor() {
        this.args = process.argv.slice(2);
        console.log("pkg.version:", pkg.version);
    }
    /**显示帮助信息*/
    showHelp() {
        console.log(`
            help             显示帮助
            h                显示帮助
            create <?name>   创建新项目
            init <?name>     创建新项目
            template <?name> 创建新项目
            release          发布新版本
            dist             抽取npm包
      `);
        process.exit(0);
    }
    /**处理命令行参数 - 编排工具类的使用方式*/
    async handleCommand(cmd, param) {
        switch (cmd) {
            case '--help':
            case '-h':
            case 'help':
                this.showHelp();
                break;
            case 'create':
            case 'template':
            case 'init':
                // 编排项目创建流程，使用工具类的create方法 - 延迟实例化
                await new ProjectTemplateCreator().task1(param);
                break;
            case 'release':
                // 编排版本发布流程，使用工具类的task1方法
                await new ReleaseManager().task1();
                break;
            case 'dist':
                // 编排分发包构建流程，使用工具类的build方法 - 延迟实例化
                await new DistPackageBuilder().task1();
                break;
            default:
                await this.showInteractiveMenu();
        }
    }
    /**显示交互式菜单 - 用户友好的操作选择界面*/
    async showInteractiveMenu() {
        const response = await prompts({
            type: 'select',
            name: 'action',
            message: '请选择操作',
            choices: [
                { title: '🆕 创建新项目', value: 'create' },
                { title: '🚀 发布新版本', value: 'release' },
                { title: '🎯 抽取 npm 包', value: 'dist' },
            ],
        });
        switch (response.action) {
            case 'create':
                await new ProjectTemplateCreator().task1();
                break;
            case 'release':
                await new ReleaseManager().task1();
                break;
            case 'dist':
                await new DistPackageBuilder().task1();
                break;
            default:
                console.log('取消');
                process.exit(0);
        }
    }
    /**执行主程序逻辑 - 入口编排的核心方法*/
    async run() {
        try {
            const [cmd, param] = this.args;
            await this.handleCommand(cmd, param);
        }
        catch (err) {
            // 统一错误处理
            if (err instanceof Appexit) {
                console.error(`❌ 程序错误: ${err.message}`);
            }
            else if (err.message === 'user-cancelled') {
                console.log('👋 操作已取消');
                return;
            }
            else {
                console.error('❌ 程序异常:', err.message || err);
            }
            process.exit(1);
        }
    }
}
/**创建CLI实例并运行 - 应用程序入口点*/
const cli = new CLI();
cli.run();
