export type ScriptCmds = readonly string[];

export default abstract class ScriptBase {
  public abstract readonly scriptName: string;
  protected abstract readonly cmds: ScriptCmds;

  public cmdsHelp(): string {
    return [
      this.scriptName + ":",
      ...this.cmds.map(commandName => "- " + this.scriptName + "/" + commandName),
    ].join("\n");
  }

  public cmdsAsk() {
    return this.cmds.map(commandName => ({
      title: this.scriptName + "/" + commandName,
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
      throw new Error(this.scriptName + "/" + commandName + " 不支持命令行参数");
    }
    if (!this.cmds.includes(commandName)) {
      throw new Error("未知 " + this.scriptName + " 命令: " + commandName);
    }

    const commandRun = (this as unknown as Record<string, unknown>)[commandName + "Run"];
    if (typeof commandRun !== "function") {
      throw new Error(this.scriptName + "/" + commandName + " 未实现");
    }
    await commandRun.call(this);
  }
}
