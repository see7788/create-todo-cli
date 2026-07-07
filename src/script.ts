import LibBase, { Appexit } from "./base";

export default abstract class ScriptBase extends LibBase {
  public abstract readonly scriptName: string;
  protected abstract readonly cmds: readonly string[];

  constructor() {
    super({ requirePackage: false });
  }

  public cmdsHelp(): string {
    return [
      this.scriptName + ":",
      ...this.cmds.map(commandName => "- " + this.commandDisplay(commandName)),
    ].join("\n");
  }

  public cmdsAsk() {
    return this.cmds.map(commandName => ({
      title: this.commandDisplay(commandName),
      value: () => this.cmdsRun([commandName]),
    }));
  }

  public async cmdsRun(commandArgs: string[]): Promise<void> {
    const [commandName, ...commandExtraArgs] = commandArgs;
    if (!commandName || commandName === "help") {
      console.log(this.cmdsHelp());
      return;
    }
    if (commandExtraArgs.length) {
      throw new Appexit(this.scriptName + "/" + commandName + " 不支持命令行参数");
    }
    if (!this.cmds.includes(commandName)) {
      throw new Appexit("未知 " + this.scriptName + " 命令: " + commandName);
    }

    const commandRun = (this as unknown as Record<string, unknown>)[commandName + "Run"];
    if (typeof commandRun !== "function") {
      if (this.commandIsRaw(commandName)) {
        await this.commandRawRun(commandName);
        return;
      }
      throw new Appexit(this.scriptName + "/" + commandName + " 未实现");
    }
    await commandRun.call(this);
  }

  private commandDisplay(commandName: string): string {
    return this.commandIsRaw(commandName) ? commandName : this.scriptName + "/" + commandName;
  }

  private commandIsRaw(commandName: string): boolean {
    return commandName.includes(" ");
  }

  private async commandRawRun(command: string): Promise<void> {
    const targetPath = await this.askLocalPath({
      initialPath: this.cwdProjectInfo.cwdPath,
      mode: "directory",
      shouldConfirm: true,
    });
    await this.commandRunInherit(command, targetPath, command);
  }
}
