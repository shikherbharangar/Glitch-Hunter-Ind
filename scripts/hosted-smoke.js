import { execFileSync } from "node:child_process";
import { randomBytes } from "node:crypto";
import assert from "node:assert/strict";
import { manualInput } from "../tests/fixtures.js";
const suffix = randomBytes(5).toString("hex");
const container = `ghi-hosted-smoke-${suffix}`,
  volume = `ghi-hosted-smoke-data-${suffix}`;
const token = randomBytes(32).toString("hex");
const env = {
  ...process.env,
  APP_AUTH_TOKEN: token,
  PUBLIC_ORIGIN: "https://hosted.example.com",
};
const docker = (args) =>
  execFileSync("docker", args, {
    env,
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
  }).trim();
let created = false;
try {
  docker(["volume", "create", volume]);
  created = true;
  docker([
    "run",
    "--rm",
    "-v",
    `${volume}:/volume`,
    "node:24-bookworm-slim",
    "sh",
    "-c",
    "chown 0:0 /volume && chmod 755 /volume",
  ]);
  docker([
    "run",
    "-d",
    "--name",
    container,
    "-p",
    "127.0.0.1::3000",
    "-e",
    "APP_AUTH_TOKEN",
    "-e",
    "PUBLIC_ORIGIN",
    "-v",
    `${volume}:/app/data`,
    process.env.GHI_IMAGE || "glitch-hunter-india:local",
  ]);
  let port = docker(["port", container, "3000/tcp"]).split(":").at(-1);
  let base = `http://127.0.0.1:${port}`;
  let cookie = "";
  async function request(path, method = "GET", body) {
    return fetch(base + path, {
      method,
      headers: {
        Host: "hosted.example.com",
        Origin: "https://hosted.example.com",
        "Content-Type": "application/json",
        ...(cookie ? { Cookie: cookie } : {}),
      },
      ...(body ? { body: JSON.stringify(body) } : {}),
    });
  }
  async function ready() {
    for (let n = 0; n < 50; n++) {
      try {
        if ((await request("/")).ok) return;
      } catch {}
      await new Promise((r) => setTimeout(r, 100));
    }
    throw new Error("Container did not become ready");
  }
  async function login() {
    const r = await request("/api/login", "POST", { token });
    assert.equal(r.status, 200);
    const header = r.headers.get("set-cookie");
    assert.match(header, /HttpOnly/);
    assert.match(header, /Secure/);
    cookie = header.split(";")[0];
  }
  await ready();
  assert.equal((await request("/api/state")).status, 401);
  await login();
  let state = await (await request("/api/state")).json();
  assert.equal(state.providers[0].status, "credentials_missing");
  assert.equal(state.settings.scanEnabled, false);
  const saved = await request("/api/observations", "POST", manualInput());
  assert.equal(saved.status, 201);
  const record = await saved.json();
  assert.ok(record.id);
  const font = await request("/fonts/PaperMono.woff2");
  assert.equal(font.status, 200);
  assert.ok((await font.arrayBuffer()).byteLength > 10000);
  assert.equal(
    docker([
      "exec",
      container,
      "node",
      "-e",
      "const s=require('node:fs').readFileSync('/proc/1/status','utf8');console.log(s.split(String.fromCharCode(10)).find(x=>x.startsWith('Uid:')).slice(4).trim().split(String.fromCharCode(9))[0])",
    ]),
    "1000",
  );
  docker(["restart", container]);
  port = docker(["port", container, "3000/tcp"]).split(":").at(-1);
  base = `http://127.0.0.1:${port}`;
  cookie = "";
  await ready();
  assert.equal((await request("/api/state")).status, 401);
  await login();
  state = await (await request("/api/state")).json();
  assert.equal(state.coverage.observations, 1);
  assert.equal(state.candidates[0].id, record.id);
  console.log(
    JSON.stringify({
      containerStartup: "passed",
      authentication: "passed",
      secureCookie: "passed",
      font: "passed",
      nonRoot: "passed",
      restartPersistence: "passed",
      fixture: "SYNTHETIC temporary volume",
      liveProviderCalls: 0,
    }),
  );
} finally {
  if (created) {
    try {
      docker(["rm", "-f", container]);
    } catch {}
    docker(["volume", "rm", volume]);
  }
}
