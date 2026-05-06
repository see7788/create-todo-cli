#!/usr/bin/env node
import prompts from 'prompts';
import CreatePkg from './scripts/createPkg.js';
import DistPkg from './scripts/distPkg.js';
import LibBase, { Appexit } from './scripts/tool.js';
import pkg from '../package.json' with { type: 'json' };

class CLI {
  private readonly args: string[];

  constructor() {
    this.args = process.argv.slice(2);
    console.log('pkg.version:', pkg.version);
  }

  private showHelp(): void {
    console.log(`
help                 显示帮助
createPkg <?name>    创建新项目
distPkg <?name>      抽取 npm 包
`);
    process.exit(0);
  }

  private async handleCommand(cmd?: string, param?: string): Promise<void> {
    switch (cmd) {
      case '--help':
      case '-h':
      case 'help':
        this.showHelp();
        break;
      case 'createPkg':
        await new CreatePkg().task1(param);
        break;
      case 'distPkg':
        await new DistPkg().task1(param);
        break;
      default:
        await this.showInteractiveMenu();
    }
  }

  private async showInteractiveMenu(): Promise<void> {
    const response = await prompts({
      type: 'select',
      name: 'action',
      message: '请选择操作',
      choices: [
        { title: '创建新项目', value: 'createPkg' },
        { title: '抽取 npm 包', value: 'distPkg' },
        { title: '重写 package.json 身份信息', value: 'rewritePackageIdentity' },
        { title: '初始化 pnpm workspace', value: 'setupPnpmWorkspace' },
        { title: '生成 publish.yml', value: 'createGithubPublish' },
      ],
    });

    switch (response.action) {
      case 'createPkg':
        await new CreatePkg().task1();
        break;
      case 'distPkg':
        await new DistPkg().task1();
        break;
      case 'rewritePackageIdentity':
        await new LibBase().rewriteCurrentPackageIdentity();
        break;
      case 'setupPnpmWorkspace':
        await new LibBase().setupPnpmWorkspaceRoot();
        break;
      case 'createGithubPublish':
        await new LibBase().createCurrentGithubPublish();
        break;
      default:
        console.log('取消');
        process.exit(0);
    }
  }

  public async run(): Promise<void> {
    try {
      const [cmd, param] = this.args;
      await this.handleCommand(cmd, param);
    } catch (err: unknown) {
      if (err instanceof Appexit) {
        console.error(`程序错误: ${err.message}`);
      } else if (err instanceof Error && err.message === 'user-cancelled') {
        console.log('操作已取消');
        return;
      } else {
        console.error('程序异常:', err instanceof Error ? err.message : err);
      }
      process.exit(1);
    }
  }
}

const cli = new CLI();
cli.run();
