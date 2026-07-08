#!/usr/bin/env node
// Batterie de tests pour notify-desktop.js — robustesse (jamais de crash,
// toujours exit 0) et comportement de l'état JSON. NOTIFY_DESKTOP_DRY_RUN=1
// empêche tout vrai toast de s'afficher pendant les tests (voir showToast
// dans le hook) : la vérification visuelle réelle se fait à la main, sans
// cette variable, voir README/SOURCES.md.
const { spawnSync } = require("child_process");
const fs = require("fs");
const os = require("os");
const path = require("path");

const HOOK = path.join(__dirname, "..", "notify-desktop.js");

function run(event, payload, projectDir) {
  const input = payload === undefined ? "" : typeof payload === "string" ? payload : JSON.stringify(payload);
  return spawnSync("node", [HOOK, event].filter(Boolean), {
    input,
    encoding: "utf8",
    env: {
      ...process.env,
      NOTIFY_DESKTOP_DRY_RUN: "1",
      CLAUDE_PROJECT_DIR: projectDir || os.tmpdir(),
    },
  });
}

let pass = 0;
const fails = [];
function check(label, ok) {
  if (ok) pass++;
  else fails.push(`ÉCHEC: ${label}`);
}

// --- Robustesse : payloads vides/invalides, tout événement => exit 0 ---
for (const event of ["UserPromptSubmit", "Stop", "Notification", "", "EvenementInconnu"]) {
  for (const raw of [undefined, "", "{}", "pas du json", '{"session_id":"x"}']) {
    const res = run(event, raw);
    check(`event=${JSON.stringify(event)} payload=${JSON.stringify(raw)} => exit 0`, res.status === 0);
  }
}

// --- Comportement de l'état : UserPromptSubmit incrémente seq, Stop nettoie ---
const tmpProject = fs.mkdtempSync(path.join(os.tmpdir(), "notify-test-"));
const stateFile = path.join(tmpProject, ".claude", "notify-state.json");
const sessionId = "session-test-1";

run("UserPromptSubmit", { session_id: sessionId, cwd: tmpProject, prompt: "x" }, tmpProject);
let state = JSON.parse(fs.readFileSync(stateFile, "utf8"));
check("seq=1 après le premier UserPromptSubmit", state[sessionId] && state[sessionId].seq === 1);

run("UserPromptSubmit", { session_id: sessionId, cwd: tmpProject, prompt: "y" }, tmpProject);
state = JSON.parse(fs.readFileSync(stateFile, "utf8"));
check("seq=2 après le second UserPromptSubmit (même session)", state[sessionId] && state[sessionId].seq === 2);

run("Stop", { session_id: sessionId, cwd: tmpProject }, tmpProject);
state = JSON.parse(fs.readFileSync(stateFile, "utf8"));
check("entrée supprimée après Stop", state[sessionId] === undefined);

// Stop sans UserPromptSubmit préalable : ne doit pas planter (pas de vérif de contenu ici, juste l'exit).
const res = run("Stop", { session_id: "session-orpheline", cwd: tmpProject }, tmpProject);
check("Stop sans état préalable => exit 0", res.status === 0);

fs.rmSync(tmpProject, { recursive: true, force: true });

// --- notify-config.json : un type désactivé ne doit pas empêcher le reste de fonctionner ---
const tmpConfig = fs.mkdtempSync(path.join(os.tmpdir(), "notify-test-config-"));
fs.mkdirSync(path.join(tmpConfig, ".claude"), { recursive: true });
fs.writeFileSync(path.join(tmpConfig, ".claude", "notify-config.json"), JSON.stringify({ stop: false }));
const configSessionId = "session-config-test";

run("UserPromptSubmit", { session_id: configSessionId, cwd: tmpConfig, prompt: "x" }, tmpConfig);
const resStopDisabled = run("Stop", { session_id: configSessionId, cwd: tmpConfig }, tmpConfig);
check("Stop avec stop:false dans la config => exit 0 quand même", resStopDisabled.status === 0);
const stateAfterDisabledStop = JSON.parse(fs.readFileSync(path.join(tmpConfig, ".claude", "notify-state.json"), "utf8"));
check("l'état est quand même nettoyé même si le toast est désactivé", stateAfterDisabledStop[configSessionId] === undefined);

// Config corrompue => comportement par défaut (tout activé), jamais de crash.
fs.writeFileSync(path.join(tmpConfig, ".claude", "notify-config.json"), "pas du json");
const resBadConfig = run("Stop", { session_id: "autre-session", cwd: tmpConfig }, tmpConfig);
check("notify-config.json corrompu => exit 0 quand même", resBadConfig.status === 0);

fs.rmSync(tmpConfig, { recursive: true, force: true });

console.log(`${pass}/${pass + fails.length} tests OK`);
if (fails.length) {
  console.log(fails.join("\n"));
  process.exit(1);
}
