// scripts/createPkg.ts
import * as fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import prompts from 'prompts';
import degit from 'degit';
import LibBase, { Appexit } from "./tool.js";

type CreateTarget = {
  name: string;
  path: string;
};

class CreatePkg extends LibBase {
  private readonly templates: [name: string, remark: string][] = [
    ['see7788/electron-template', '牛x的electron脚手架'],
    ['see7788/ts-template', 'typescript基本脚手架'],
  ];
  private target!: CreateTarget;
  private templatesIndex!: number;
  private targetCreated = false;

  async task1(initialProjectName?: string): Promise<void> {
    try {
      console.log('\n✅ 开始项目创建流程');
      this.target = await this.confirmOutputTarget({
        initialName: initialProjectName,
        defaultName: "my-app",
        message: "请输入项目名",
        targetLabel: "将创建项目到",
        existsError: true,
      });
      await this.templatesIndexSet();
      await this.createFromdegit();
      this.targetCreated = true;
      await this.finalizeProjectOutput(this.target.path, this.target.name);
      console.log('\n🎉 完成项目创建流程');
      console.log(`📁 项目路径: ${path.resolve(this.target.path)}`);
      console.log('\n💡 下一步操作:');
      console.log(`   cd ${this.target.name}`);
      console.log('   pnpm install');
      console.log('   pnpm run dev');
    } catch (error: unknown) {
      await this.targetPathDEl();
      throw error;
    }
  }

  private async templatesIndexSet(): Promise<void> {
    const response = await prompts({
      type: 'select',
      name: 'templateIndex',
      message: '请选择项目来源',
      choices: this.templates.map(([, remark], index) => ({
        title: `${index + 1}. ${remark}`,
        value: index,
      })),
    });

    if (response.templateIndex === undefined) {
      throw new Error('user-cancelled');
    }
    this.templatesIndex = response.templateIndex;
  }

  private async createFromdegit(): Promise<void> {
    const repoUrl = this.templates[this.templatesIndex][0];
    console.log(`\n🚀 创建项目: ${this.target.name}`);
    console.log(`📦 使用 degit 从 ${repoUrl} 获取模板...\n`);

    const emitter = degit(repoUrl, {
      cache: false,
      force: true,
      verbose: true,
    });

    emitter.on('info', info => console.log(`📝 ${info.message}`));
    emitter.on('warn', warn => console.warn(`⚠️ ${warn.message}`));
    await emitter.clone(this.target.path);
    console.log('🧹 已自动移除 .git 目录（degit 特性）');
    console.log('\n✅ 项目创建成功！');
  }

  private async targetPathDEl(): Promise<void> {
    try {
      if (!this.targetCreated || !this.target) {
        return;
      }

      const targetPath = this.target.path;
      if (targetPath === process.cwd() || targetPath === path.parse(targetPath).root) {
        return;
      }

      if (fs.existsSync(targetPath)) {
        console.log(`🧹 清理失败的项目目录: ${targetPath}`);
        fs.rmSync(targetPath, { recursive: true, force: true });
        console.log('✅ 目录已清理');
      }
    } catch (error: unknown) {
      throw new Appexit(`⚠️ 清理目录时出现警告: ${error instanceof Error ? error.message : String(error)}`);
    }
  }
}

if (path.resolve(fileURLToPath(import.meta.url)) === path.resolve(process.argv[1])) {
  new CreatePkg().task1();
}

export default CreatePkg;
