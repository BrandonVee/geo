import { spawn } from "node:child_process";

// Keep one root-level environment file for every workspace command. Existing
// shell/CI variables keep precedence over values from .env.
try {
  process.loadEnvFile(new URL("../.env", import.meta.url));
} catch (error) {
  if (error?.code !== "ENOENT") throw error;
}

const [command, ...args] = process.argv.slice(2);
if (!command) throw new Error("A command is required");

const child = spawn(command, args, {
  env: process.env,
  stdio: "inherit",
  shell: process.platform === "win32",
});

child.on("error", (error) => {
  console.error(error);
  process.exitCode = 1;
});

child.on("exit", (code, signal) => {
  if (signal) process.kill(process.pid, signal);
  else process.exitCode = code ?? 1;
});
