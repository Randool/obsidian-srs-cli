/**
 * 整屏界面基建：备择屏进出、整帧重画、单键读取。
 * 只做「渲染 + 读键」，不含任何业务逻辑。
 */
import readline from "node:readline";

export class Screen {
  constructor(stdout = process.stdout, stdin = process.stdin) {
    this.out = stdout;
    this.in = stdin;
    this._pending = [];
    this._listener = null;
    this.closed = false;
    this.active = false;
  }

  get columns() {
    return Math.max(24, this.out.columns || 80);
  }

  get rows() {
    return Math.max(8, this.out.rows || 24);
  }

  enter() {
    if (this.active) return;
    this.out.write("\x1b[?1049h\x1b[?25l\x1b[2J");
    this.in.setRawMode?.(true);
    this.in.resume();
    readline.emitKeypressEvents(this.in);
    this._listener = (str, key) => {
      const name = normalizeKey(str, key);
      const next = this._pending.shift();
      if (next) next(name);
    };
    // 输入侧被关掉（管道跑完、终端断开）时不能干等一个永远不来的键
    this._onClose = () => {
      this.closed = true;
      while (this._pending.length) this._pending.shift()("eof");
    };
    this.in.on("keypress", this._listener);
    this.in.on("end", this._onClose);
    this.in.on("close", this._onClose);
    this.active = true;
  }

  leave() {
    if (!this.active) return;
    this.in.removeListener("keypress", this._listener);
    if (this._onClose) {
      this.in.removeListener("end", this._onClose);
      this.in.removeListener("close", this._onClose);
    }
    try {
      this.in.setRawMode?.(false);
    } catch {
      /* 非 TTY 时会抛，忽略 */
    }
    this.out.write("\x1b[?25h\x1b[?1049l");
    this.active = false;
    this._pending = [];
  }

  /** 用换行分帧：先回家，逐行清尾，最后清屏下缘。 */
  draw(lines) {
    const body = lines.map((l) => `${l}\x1b[K`).join("\n");
    this.out.write(`\x1b[H${body}\x1b[J`);
  }

  /** 等一个按键。 */
  key() {
    if (this.closed) return Promise.resolve("eof");
    return new Promise((resolve) => this._pending.push(resolve));
  }

  /** 读键但允许被外部打断（用于退出信号的统一处理）。 */
  async keyOr(interrupt) {
    return Promise.race([this.key(), interrupt]);
  }
}

/** readline 的 key 对象 → 我们自己的键名。 */
export function normalizeKey(str, key) {
  if (key) {
    if (key.ctrl && key.name === "c") return "ctrl-c";
    if (key.name === "return" || key.name === "enter") return "enter";
    if (key.name) return key.name.toLowerCase();
  }
  const s = String(str || "");
  if (s === " ") return "space";
  return s.toLowerCase();
}

/** 备用：把 process.stdin 的一次 SIGINT 变成可等待的 Promise。 */
export function interruptPromise(proc = process) {
  return new Promise((resolve) => {
    const fire = () => resolve("ctrl-c");
    proc.once("SIGINT", fire);
    proc.once("SIGTERM", fire);
  });
}
