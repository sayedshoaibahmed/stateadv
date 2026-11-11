import { createInterface } from "node:readline/promises";
import { stdin, stdout } from "node:process";

/** Ask a normal question (answer is visible while typing). */
export async function ask(question: string): Promise<string> {
  const rl = createInterface({ input: stdin, output: stdout });
  try {
    return (await rl.question(question)).trim();
  } finally {
    rl.close();
  }
}

/**
 * Ask for a secret: the typed characters are NOT shown, not echoed and not kept in history.
 * Works in a real terminal (raw mode). Refuses to run when input is piped, so a password is never
 * read from a file, a pipe or a command line.
 */
export function askHidden(question: string): Promise<string> {
  if (!stdin.isTTY) {
    return Promise.reject(
      new Error(
        "A hidden prompt needs a real terminal. Run this command in your own terminal window.",
      ),
    );
  }
  return new Promise((resolve, reject) => {
    stdout.write(question);
    let value = "";
    stdin.setRawMode(true);
    stdin.resume();
    stdin.setEncoding("utf8");
    const done = (fn: () => void) => {
      stdin.setRawMode(false);
      stdin.pause();
      stdin.removeListener("data", onData);
      stdout.write("\n");
      fn();
    };
    const onData = (chunk: string) => {
      for (const ch of chunk) {
        if (ch === "\r" || ch === "\n") return done(() => resolve(value));
        if (ch === "\u0003") return done(() => reject(new Error("Cancelled.")));
        if (ch === "\u007f" || ch === "\b") value = value.slice(0, -1);
        else if (ch >= " ") value += ch;
      }
    };
    stdin.on("data", onData);
  });
}
