#!/usr/bin/env node
import prompts from 'prompts';
import CreatePkg from './scripts/createPkg.js';
import CreateNodeBin from './scripts/createNodeBin.js';
import DistPkg from './scripts/distPkg.js';
import GitWorkspacePrelease from './scripts/gitWorkspacePrelease.js';
import LibBase, { Appexit } from './scripts/tool.js';
import pkg from '../package.json' with { type: 'json' };

const commandChoices = [
  { title: '创建新项目', value: 'createPkg' },
  { title: '注册 TS/JS 入口 dev/start/stop/restart 命令', value: 'create-node-bin' },
  { title: '抽取 npm 包，并交互选择分支', value: 'distPkg' },
  { title: '抽取 npm 包：构建 ESM / CJS / d.ts', value: 'distPkgBundle' },
  { title: '抽取 npm 包：复制源码，不转 JS', value: 'distPkgSource' },
  { title: 'GitHub workspace prelease', value: 'gitWorkspacePrelease' },
];

const otherChoices = [
  { title: '初始化 pnpm workspace', value: 'setupPnpmWorkspace' },
  { title: '生成 publish.yml', value: 'createGithubPublish' },
  { title: '重写 package.json 身份信息', value: 'rewritePackageIdentity' },
];

class CLI {
  private readonly args: string[];

  constructor() {
    this.args = process.argv.slice(2);
    console.log('pkg.version:', pkg.version);
  }

  private showHelp(): void {
    console.log([
      'help - 显示帮助',
      ...commandChoices.map(choice => `${choice.value} - ${choice.title}`),
      '其他选项',
      ...otherChoices.map(choice => `${choice.value} - ${choice.title}`),
    ].join('\n'));
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
      case 'create-node-bin':
        await new CreateNodeBin().task1();
        break;
      case 'distPkg':
        await new DistPkg().task1(param);
        break;
      case 'distPkgBundle':
        await new DistPkg().taskBundle(param);
        break;
      case 'distPkgSource':
        await new DistPkg().taskSource(param);
        break;
      case 'setupPnpmWorkspace':
        await new LibBase().setupPnpmWorkspaceRoot();
        break;
      case 'createGithubPublish':
        await new LibBase().createCurrentGithubPublish();
        break;
      case 'rewritePackageIdentity':
        await new LibBase().rewriteCurrentPackageIdentity();
        break;
      case 'gitWorkspacePrelease':
        await new GitWorkspacePrelease().task1();
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
        ...commandChoices
          .filter(choice => choice.value !== 'distPkg')
          .map(choice => ({ ...choice, title: `${choice.value} - ${choice.title}` })),
        { title: '其他选项', value: '__other__', disabled: true },
        ...otherChoices.map(choice => ({ ...choice, title: `${choice.value} - ${choice.title}` })),
      ],
    });

    switch (response.action) {
      case 'createPkg':
        await new CreatePkg().task1();
        break;
      case 'create-node-bin':
        await new CreateNodeBin().task1();
        break;
      case 'distPkgBundle':
        await new DistPkg().taskBundle();
        break;
      case 'distPkgSource':
        await new DistPkg().taskSource();
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
      case 'gitWorkspacePrelease':
        await new GitWorkspacePrelease().task1();
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
