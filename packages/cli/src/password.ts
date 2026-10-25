/** Asks for a password on the terminal without echoing it. */
export function promptHidden(question: string): Promise<string> {
  const stdin = process.stdin;
  process.stderr.write(question);
  stdin.setRawMode?.(true);
  stdin.resume();
  return new Promise((resolve, reject) => {
    let value = "";
    const finish = (error?: Error) => {
      stdin.off("data", onData);
      stdin.setRawMode?.(false);
      stdin.pause();
      process.stderr.write("\n");
      if (error) reject(error);
      else resolve(value);
    };
    const onData = (chunk: Buffer | string) => {
      for (const char of chunk.toString()) {
        if (char === "\r" || char === "\n") return finish();
        if (char === "\u0003") return finish(new Error("přerušeno")); // Ctrl+C
        if (char === "\u007f" || char === "\b") value = value.slice(0, -1);
        else value += char;
      }
    };
    stdin.on("data", onData);
  });
}
