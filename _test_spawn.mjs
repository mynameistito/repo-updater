import { spawn } from "node:child_process";
const p = "C:\\Program Files\\BraveSoftware\\Brave-Browser\\Application\\brave.exe";
const c = spawn(p, ["--new-window", "https://example.com"], { stdio: "ignore", windowsHide: true });
c.on("error", (e) => console.error("ERR", e.message));
c.on("spawn", () => console.log("spawned pid", c.pid));
c.unref();
