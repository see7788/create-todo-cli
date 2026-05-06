// scripts/createPkg.ts
import * as fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { execSync } from 'child_process';
import prompts from 'prompts';
import degit from 'degit';
import LibBase, { Appexit } from "./tool.js";

class CreatePkg extends LibBase {
  private readonly templates: [name: string, remark: string][] = [
    ["createFromLocalProject", "从本地项目抽取源码"],
    ['see7788/electron-template', '牛x的electron脚手架'],
    ['see7788/ts-template', 'typescript基本脚手架'],
  ];
  private validProjectName!: string;
  private templatesIndex!: number
  private localProjectPath = '';
  private targetCreated = false;

  private get targetPath(): string {
    return path.resolve(this.validProjectName);
  }

  async task1(initialProjectName?: string): Promise<void> {
    try {
      console.log('\n✅ 开始项目创建流程');
      this.validProjectName = await this.confirmOutputName({
        initialName: initialProjectName,
        defaultName: "my-app",
        message: "请输入项目名",
        targetLabel: "将创建项目到",
        existsError: true,
      });
      await this.templatesIndexSet();
      if (this.templatesIndex === 0) {
        await this.createFromLocalProject();
      } else {
        await this.createFromdegit();
      }
      this.targetCreated = true;
      await this.finalizeProjectOutput(this.targetPath, this.validProjectName)
      console.log('\n🎉 完成项目创建流程');

      console.log(`📁 项目路径: ${path.resolve(this.targetPath)}`);
      console.log('\n💡 下一步操作:');
      console.log(`   cd ${this.validProjectName}`);
      console.log('   pnpm install');
      console.log('   pnpm run dev');
    } catch (error: any) {
      await this.targetPathDEl();
      throw error;
    }
  }
  /**选择模板索引*/
  private async templatesIndexSet(): Promise<void> {
    const response = await prompts({
      type: 'select',
      name: 'templateIndex',
      message: '请选择项目来源',
      choices: this.templates.map(([value, remark], index) => ({
        title: `${index + 1}. ${remark}`,
        value: index
      }))
    });

    // 用户取消时不使用AppError，而是通过特殊消息标记正常退出流程
    if (response.templateIndex === undefined) {
      const error = new Error('user-cancelled');
      throw error;
    }

    this.templatesIndex = response.templateIndex;

    // 如果选择了本地项目模板，直接进入本地项目路径选择
    if (this.templatesIndex === 0) {
      await this.selectLocalProjectPath();
    }
  }

  /**选择本地项目路径 - 优化的多级选择体验 */
  private async selectLocalProjectPath(): Promise<void> {
    console.log('📁 开始本地项目选择...');

    // 首先获取可用的磁盘驱动器
    let availableDrives: string[] = [];
    if (process.platform === 'win32') {
      // Windows平台获取所有可用磁盘
      const { execSync } = await import('child_process');
      try {
        const drivesOutput = execSync('wmic logicaldisk get caption', { encoding: 'utf8' });
        availableDrives = drivesOutput
          .split('\n')
          .map(line => line.trim())
          .filter(line => /^[A-Z]:$/.test(line));

        // 添加当前目录作为快速访问选项
        const currentDrive = process.cwd().split(':')[0] + ':';
        if (!availableDrives.includes(currentDrive)) {
          availableDrives.push(currentDrive);
        }
      } catch (error) {
        console.warn('⚠️ 无法获取磁盘列表，使用默认路径');
        availableDrives = ['C:', process.cwd().split(':')[0] + ':'];
      }
    } else {
      // 非Windows平台默认使用根目录和当前目录
      availableDrives = ['/', process.cwd()];
    }

    // 选择磁盘/根目录
    console.log('\n🔍 第1步：选择磁盘驱动器');
    const driveResponse = await prompts({
      type: 'select',
      name: 'drive',
      message: '请选择要查找项目的磁盘驱动器',
      choices: availableDrives.map(drive => ({
        title: drive === process.cwd().split(':')[0] + ':' ? `${drive} (当前磁盘)` : drive,
        value: drive
      }))
    });

    if (!driveResponse.drive) {
      const error = new Error('user-cancelled');
      throw error;
    }

    console.log(`✅ 已选择: ${driveResponse.drive}`);

    let currentPath = driveResponse.drive;
    let navigationLevel = 1; // 导航层级计数

    // 多级导航选择目录
    while (true) {
      navigationLevel++;
      console.log(`\n🔍 第${navigationLevel}步：浏览目录结构`);

      // 获取当前目录下的所有文件和文件夹
      let items: { name: string; path: string; isDirectory: boolean }[] = [];
      try {
        const files = fs.readdirSync(currentPath);
        items = files
          .map(name => {
            const itemPath = path.join(currentPath, name);
            try {
              const stats = fs.statSync(itemPath);
              return { name, path: itemPath, isDirectory: stats.isDirectory() };
            } catch (error) {
              // 跳过无法访问的文件/文件夹
              return null;
            }
          })
          .filter((item): item is { name: string; path: string; isDirectory: boolean } => item !== null) // 类型断言过滤null值
          .sort((a, b) => {
            // 文件夹排在前面，文件排在后面
            if (a.isDirectory && !b.isDirectory) return -1;
            if (!a.isDirectory && b.isDirectory) return 1;
            // 同类项按名称排序
            return a.name.localeCompare(b.name);
          });
      } catch (error) {
        console.error('❌ 无法读取目录内容:', error);
        // 让用户重试或取消
        const retryResponse = await prompts({
          type: 'confirm',
          name: 'retry',
          message: '是否重试访问该目录？',
          initial: true
        });

        if (!retryResponse.retry) {
          // 给用户返回上一级的选项
          const goBackResponse = await prompts({
            type: 'confirm',
            name: 'goBack',
            message: '是否返回上一级目录？',
            initial: true
          });

          if (goBackResponse.goBack) {
            const parentPath = path.dirname(currentPath);
            if (parentPath !== currentPath) {
              currentPath = parentPath;
              navigationLevel--;
              continue;
            }
          }

          const error = new Error('user-cancelled');
          throw error;
        }
        continue;
      }

      // 添加特殊选项
      const specialChoices = [
        { title: '.. (上一级目录)', value: '..' },
        { title: '🏠 当前工作目录', value: 'current' },
        { title: '❌ 取消选择', value: 'cancel' }
      ];

      // 构建文件/文件夹选项
      const itemChoices = items.map(item => ({
        title: item.isDirectory
          ? `📁 ${item.name}${this.isLocalProjectDirectory(item.path) ? ' (项目目录)' : ''}`
          : `📄 ${item.name}`,
        value: item.path
      }));

      // 组合所有选项
      const choices = [...specialChoices, ...itemChoices];

      // 询问用户选择
      const selectionResponse = await prompts({
        type: 'select',
        name: 'selection',
        message: `\n当前位置: ${currentPath}\n请选择一个目录进入，或选择一个JavaScript/TypeScript文件作为入口`,
        choices
      });

      // 处理特殊选择
      if (!selectionResponse.selection) {
        const error = new Error('user-cancelled');
        throw error;
      }

      // 处理特殊选项
      if (selectionResponse.selection === 'cancel') {
        const error = new Error('user-cancelled');
        throw error;
      } else if (selectionResponse.selection === 'current') {
        currentPath = process.cwd();
        console.log(`📂 已切换到当前工作目录: ${currentPath}`);
        continue;
      } else if (selectionResponse.selection === '..') {
        // 向上一级
        const parentPath = path.dirname(currentPath);
        if (parentPath !== currentPath) { // 防止到达根目录时无限循环
          console.log(`⬆️ 返回上一级目录`);
          currentPath = parentPath;
          navigationLevel--;
        } else {
          console.log('⚠️ 已经到达根目录，无法继续向上');
        }
        continue;
      }

      // 处理常规选择
      try {
        const selectedStats = fs.statSync(selectionResponse.selection);

        if (selectedStats.isFile()) {
          // 检查是否为JavaScript/TypeScript文件
          const ext = path.extname(selectionResponse.selection).toLowerCase();
          const isCodeFile = ['.js', '.jsx', '.ts', '.tsx', '.mjs', '.cjs'].includes(ext);

          if (!isCodeFile) {
            console.warn(`⚠️ 选择的文件不是有效的JavaScript/TypeScript文件（扩展名: ${ext}）`);
            const confirmResponse = await prompts({
              type: 'confirm',
              name: 'confirm',
              message: '是否继续使用此文件作为入口？',
              initial: false
            });

            if (!confirmResponse.confirm) {
              continue;
            }
          }

          // 选择了文件，将其作为入口文件
          this.localProjectPath = selectionResponse.selection;
          console.log(`\n✅ 已选择入口文件: ${this.localProjectPath}`);
          return;
        } else if (selectedStats.isDirectory()) {
          // 选择了目录，继续深入
          currentPath = selectionResponse.selection;
          console.log(`📂 已进入目录: ${currentPath}`);

          // 检查是否为有效的项目目录（包含package.json）
          if (this.isLocalProjectDirectory(currentPath)) {
            const confirmResponse = await prompts({
              type: 'confirm',
              name: 'confirm',
              message: `\n已找到有效的项目目录: ${currentPath}\n包含package.json文件\n是否使用此目录作为源码来源？`,
              initial: true
            });

            if (confirmResponse.confirm) {
              this.localProjectPath = currentPath;
              console.log(`\n✅ 已选择项目目录: ${this.localProjectPath}`);
              return;
            }
          }
        }
      } catch (error) {
        console.error('❌ 无法访问选定的项目:', error);
        continue;
      }
    }
  }

  /**检查目录是否为有效的项目目录 */
  private isLocalProjectDirectory(dirPath: string): boolean {
    try {
      return fs.existsSync(path.join(dirPath, 'package.json'));
    } catch (error) {
      return false;
    }
  }

  /**从本地项目抽取源码，不执行打包转换 */
  private async createFromLocalProject(): Promise<void> {
    const stats = fs.statSync(this.localProjectPath);
    const sourcePath = stats.isDirectory()
      ? this.localProjectPath
      : this.findPackageRoot(this.localProjectPath);

    if (!fs.existsSync(path.join(sourcePath, 'package.json'))) {
      throw new Appexit(`本地项目缺少 package.json: ${sourcePath}`);
    }

    console.log(`\n从本地项目抽取源码: ${sourcePath}`);
    fs.mkdirSync(this.targetPath, { recursive: true });
    this.targetCreated = true;
    this.copyDirectory(sourcePath, this.targetPath);
    console.log('\n本地项目源码抽取完成');
  }

  /**复制目录函数 - 递归复制目录内容 */
  private copyDirectory(source: string, target: string): void {
    // 确保目标目录存在
    if (!fs.existsSync(target)) {
      fs.mkdirSync(target, { recursive: true });
    }

    // 读取源目录内容
    const files = fs.readdirSync(source);

    // 复制每个文件/目录
    for (const file of files) {
      if (this.shouldSkipCopy(file)) {
        continue;
      }

      const sourcePath = path.join(source, file);
      const targetPath = path.join(target, file);

      const stats = fs.statSync(sourcePath);

      if (stats.isDirectory()) {
        // 递归复制子目录
        this.copyDirectory(sourcePath, targetPath);
      } else {
        // 复制文件
        fs.copyFileSync(sourcePath, targetPath);
      }
    }
  }

  private shouldSkipCopy(name: string): boolean {
    return ['.git', 'node_modules', 'dist', '.pnpm-store'].includes(name);
  }

  /**用degit创建项目*/
  private async createFromdegit(): Promise<void> {
    const repoUrl = this.templates[this.templatesIndex][0];

    console.log(`\n🚀 创建项目: ${this.validProjectName}`);
    console.log(`📦 使用 degit 从 ${repoUrl} 获取模板...\n`);

    // 创建degit实例并监听事件
    const emitter = degit(repoUrl, {
      cache: false,
      force: true,
      verbose: true
    });

    emitter.on('info', (info) => console.log(`📝 ${info.message}`));
    emitter.on('warn', (warn) => console.warn(`⚠️ ${warn.message}`));

    // 执行克隆
    await emitter.clone(this.targetPath);
    console.log('🧹 已自动移除 .git 目录（degit 特性）');

    // 完成创建后的提示信息
    console.log('\n✅ 项目创建成功！');
  }

  /**清理失败的项目目录 - 仅在有目标目录时执行*/
  private async targetPathDEl() {
    try {
      if (!this.targetCreated || !this.validProjectName) {
        return;
      }

      const targetPath = this.targetPath;
      if (targetPath === process.cwd() || targetPath === path.parse(targetPath).root) {
        return;
      }

      if (fs.existsSync(targetPath)) {
        console.log(`🧹 清理失败的项目目录: ${targetPath}`);
        fs.rmSync(targetPath, { recursive: true, force: true });
        console.log(`✅ 目录已清理`);
      }
    } catch (error: any) {
      // 文件系统操作错误不是致命错误，仅输出警告
      throw new Appexit(`⚠️  清理目录时出现警告: ${error.message}`);
    }
  }
}

/**直接运行脚本时执行 - 添加Promise处理*/
if (path.resolve(fileURLToPath(import.meta.url)) === path.resolve(process.argv[1])) {
  new CreatePkg().task1();
}

export default CreatePkg
