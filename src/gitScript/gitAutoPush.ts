import prompts from "prompts";
import GitBase from "../public/git";
import GitPush from "./gitPush";

export default class GitAutoPush extends GitBase {
  private isRunning = false;

  public async task1(): Promise<void> {
    await new GitPush().task1();
    const minutes = await this.intervalMinutesAsk();
    console.log(`gitAutoPush started, interval: ${minutes} minutes`);
    console.log("Press Ctrl+C to stop");

    const intervalMs = minutes * 60_000;
    const timer = setInterval(() => {
      this.gitAutoPushRun().catch(error => {
        console.error("gitAutoPush failed:", error instanceof Error ? error.message : String(error));
      });
    }, intervalMs);
    this.exitSignalListen(timer);
  }

  private async intervalMinutesAsk(): Promise<number> {
    const response = await prompts({
      type: "number",
      name: "minutes",
      message: "gitAutoPush 自动提交间隔分钟",
      initial: 5,
      min: 1,
    });
    if (!response.minutes) {
      throw new Error("user-cancelled");
    }
    return Number(response.minutes);
  }

  private async gitAutoPushRun(): Promise<void> {
    if (this.isRunning) {
      console.log("gitAutoPush: previous run is still running");
      return;
    }
    this.isRunning = true;
    const targetPath = process.cwd();
    const message = `${this.timeText()} 自动提交`;
    const tagName = `auto-${this.timeTag()}`;
    try {
      console.log(`gitAutoPush: ${message}`);
      await this.commandRunInherit("git add -A", targetPath, "git add");
      const status = this.commandReadOptional("git status --porcelain", targetPath);
      if (!status) {
        console.log("gitAutoPush: no changes");
        return;
      }
      await this.commandRunInherit(`git commit -m ${this.shellArg(message)}`, targetPath, "git commit");
      await this.commandRunInherit(`git tag -a ${this.shellArg(tagName)} -m ${this.shellArg(message)}`, targetPath, "git tag");
      await this.commandRunInherit(
        `git -c credential.helper= -c credential.helper="!gh auth git-credential" push --follow-tags`,
        targetPath,
        "git push --follow-tags",
      );
    } finally {
      this.isRunning = false;
    }
  }

  private exitSignalListen(timer: ReturnType<typeof setInterval>): void {
    const exit = () => {
      clearInterval(timer);
      console.log("\ngitAutoPush stopped");
      process.exit(0);
    };
    process.once("SIGINT", exit);
    process.once("SIGTERM", exit);
  }

  private timeText(): string {
    const date = new Date();
    const pad = (value: number) => String(value).padStart(2, "0");
    return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())} ${pad(date.getHours())}:${pad(date.getMinutes())}:${pad(date.getSeconds())}`;
  }

  private timeTag(): string {
    const date = new Date();
    const pad = (value: number) => String(value).padStart(2, "0");
    return `${date.getFullYear()}${pad(date.getMonth() + 1)}${pad(date.getDate())}-${pad(date.getHours())}${pad(date.getMinutes())}${pad(date.getSeconds())}`;
  }
}
