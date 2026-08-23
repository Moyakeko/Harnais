#!/usr/bin/env node
// Batterie de tests pour lib/metrics.js (V1.10) et son instrumentation dans les
// 9 hooks : le CLI et l'usage require() écrivent une ligne JSONL bien formée,
// un échec d'écriture est absorbé sans jamais changer le comportement/code de
// sortie de l'appelant, et chacun des 9 hooks produit exactement une ligne par
// invocation représentative. Pattern run()/check() façon test-notify.js : ça
// couvre plusieurs hooks + le module lib lui-même, pas un simple binaire
// bloqué/autorisé comme test-guard.js.
const { spawnSync } = require("child_process");
const fs = require("fs");
const os = require("os");
const path = require("path");

const HOOKS = path.join(__dirname, "..");
const METRICS = path.join(HOOKS, "lib", "metrics.js");
const METRICS_FILE_REL = path.join(".claude", "harnais-metrics.jsonl");

function run(script, args, payload, extraEnv) {
  const input = payload === undefined ? "" : typeof payload === "string" ? payload : JSON.stringify(payload);
  return spawnSync("node", [path.join(HOOKS, script), ...args], {
    input,
    encoding: "utf8",
    env: { ...process.env, WATCHDOG_DRY_RUN: "1", NOTIFY_DESKTOP_DRY_RUN: "1", ...extraEnv },
  });
}

function mkProject() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "metrics-test-"));
  fs.mkdirSync(path.join(dir, ".claude"), { recursive: true });
  return dir;
}

function readMetricsLines(projectDir) {
  const file = path.join(projectDir, METRICS_FILE_REL);
  if (!fs.existsSync(file)) return [];
  return fs.readFileSync(file, "utf8").split("\n").filter(Boolean);
}

let pass = 0;
const fails = [];
function check(label, ok) {
  if (ok) pass++;
  else fails.push(`ÉCHEC: ${label}`);
}

// --- CLI standalone : accents/espaces préservés, une ligne JSON bien formée ---
{
  const dir = mkProject();
  const res = spawnSync("node", [METRICS, "hook:test", "cat", "détail avec accents éàü et espaces"], {
    encoding: "utf8",
    env: { ...process.env, CLAUDE_PROJECT_DIR: dir },
  });
  check("CLI metrics.js => exit 0", res.status === 0);
  const lines = readMetricsLines(dir);
  check("CLI metrics.js => exactement une ligne", lines.length === 1);
  const entry = lines[0] && JSON.parse(lines[0]);
  check("CLI metrics.js => source correcte", entry && entry.source === "hook:test");
  check("CLI metrics.js => category correcte", entry && entry.category === "cat");
  check("CLI metrics.js => détail avec accents préservé", entry && entry.detail === "détail avec accents éàü et espaces");
  check("CLI metrics.js => timestamp ISO8601", entry && !isNaN(Date.parse(entry.timestamp)));
  fs.rmSync(dir, { recursive: true, force: true });
}

// --- CLI sans source/category => usage + exit 1, pas de fichier créé ---
{
  const dir = mkProject();
  const res = spawnSync("node", [METRICS], { encoding: "utf8", env: { ...process.env, CLAUDE_PROJECT_DIR: dir } });
  check("CLI metrics.js sans arguments => exit 1", res.status === 1);
  check("CLI metrics.js sans arguments => aucun fichier créé", readMetricsLines(dir).length === 0);
  fs.rmSync(dir, { recursive: true, force: true });
}

// --- require() en-process ---
{
  const dir = mkProject();
  const prevDir = process.env.CLAUDE_PROJECT_DIR;
  process.env.CLAUDE_PROJECT_DIR = dir;
  delete require.cache[require.resolve("../lib/metrics.js")];
  const { logMetric } = require("../lib/metrics.js");
  const ok = logMetric("skill:test", "cycle", "résumé");
  process.env.CLAUDE_PROJECT_DIR = prevDir;
  check("require() logMetric() => retourne true", ok === true);
  const lines = readMetricsLines(dir);
  check("require() logMetric() => une ligne écrite", lines.length === 1);
  fs.rmSync(dir, { recursive: true, force: true });
}

// --- Échec d'écriture : jamais de throw, jamais de changement de code de sortie ---
{
  const dir = mkProject();
  // .claude existe déjà comme FICHIER (pas dossier) => mkdirSync récursif échoue.
  fs.rmSync(path.join(dir, ".claude"), { recursive: true, force: true });
  fs.writeFileSync(path.join(dir, ".claude"), "pas un dossier");
  const prevDir = process.env.CLAUDE_PROJECT_DIR;
  process.env.CLAUDE_PROJECT_DIR = dir;
  delete require.cache[require.resolve("../lib/metrics.js")];
  const { logMetric } = require("../lib/metrics.js");
  let threw = false;
  let ok;
  try {
    ok = logMetric("hook:test", "cat", "détail");
  } catch (e) {
    threw = true;
  }
  process.env.CLAUDE_PROJECT_DIR = prevDir;
  check("logMetric() sur chemin invalide => ne throw jamais", !threw);
  check("logMetric() sur chemin invalide => retourne false", ok === false);

  // Un vrai hook avec ce même CLAUDE_PROJECT_DIR cassé doit continuer à faire
  // son travail principal (ici : precompact-safety-net.js écrit quand même
  // dans session-log.md, qui vit à côté de .claude/ pas dedans) et sortir 0.
  const res = run("precompact-safety-net.js", [], { trigger: "auto" }, { CLAUDE_PROJECT_DIR: dir });
  check("hook réel avec CLAUDE_PROJECT_DIR cassé => exit 0 quand même", res.status === 0);
  const logFile = path.join(dir, ".claude", "session-log.md");
  // .claude est un fichier ici, pas un dossier : l'écriture du log échoue
  // aussi (best-effort), mais ce qui compte est l'exit 0 ci-dessus.
  check("hook réel avec CLAUDE_PROJECT_DIR cassé => pas de crash", res.error === undefined);
  fs.rmSync(dir, { recursive: true, force: true });
}

// --- Chacun des 9 hooks : une invocation représentative => exactement une ligne JSON valide ---
function checkOneLine(dir, label, sourceExpected) {
  const lines = readMetricsLines(dir);
  check(`${label} => exactement une ligne de métriques`, lines.length === 1);
  const entry = lines[0] && JSON.parse(lines[0]);
  check(`${label} => JSON valide`, !!entry);
  check(`${label} => source=${sourceExpected}`, entry && entry.source === sourceExpected);
  check(`${label} => category non vide`, entry && !!entry.category);
}

{
  // session-start-inject.js
  const dir = mkProject();
  run("session-start-inject.js", [], { session_id: "s-metrics" }, { CLAUDE_PROJECT_DIR: dir });
  checkOneLine(dir, "session-start-inject", "hook:session-start-inject");
  fs.rmSync(dir, { recursive: true, force: true });
}
{
  // precompact-safety-net.js
  const dir = mkProject();
  run("precompact-safety-net.js", [], { trigger: "auto" }, { CLAUDE_PROJECT_DIR: dir });
  checkOneLine(dir, "precompact-safety-net", "hook:precompact-safety-net");
  fs.rmSync(dir, { recursive: true, force: true });
}
{
  // statusline.js
  const dir = mkProject();
  run("statusline.js", [], { session_id: "s-metrics", cwd: dir, context_window: { used_percentage: 10 } }, { CLAUDE_PROJECT_DIR: dir });
  checkOneLine(dir, "statusline", "hook:statusline");
  fs.rmSync(dir, { recursive: true, force: true });
}
{
  // context-watchdog.js
  const dir = mkProject();
  run("context-watchdog.js", ["UserPromptSubmit"], { session_id: "s-metrics", cwd: dir }, { CLAUDE_PROJECT_DIR: dir });
  checkOneLine(dir, "context-watchdog", "hook:context-watchdog");
  fs.rmSync(dir, { recursive: true, force: true });
}
{
  // credit-watchdog.js — StopFailure hors erreur crédits => branche "skip", toujours une ligne.
  const dir = mkProject();
  run("credit-watchdog.js", [], { error: "autre_chose" }, { CLAUDE_PROJECT_DIR: dir });
  checkOneLine(dir, "credit-watchdog", "hook:credit-watchdog");
  fs.rmSync(dir, { recursive: true, force: true });
}
{
  // notify-desktop.js
  const dir = mkProject();
  run("notify-desktop.js", ["UserPromptSubmit"], { session_id: "s-metrics", cwd: dir }, { CLAUDE_PROJECT_DIR: dir });
  checkOneLine(dir, "notify-desktop", "hook:notify-desktop");
  fs.rmSync(dir, { recursive: true, force: true });
}
{
  // resume-after-reset.js — script CLI (argv), pas de stdin JSON ; pas de transcript => branche dry-run.
  const dir = mkProject();
  spawnSync("node", [path.join(HOOKS, "resume-after-reset.js"), "session-inconnue", dir, "claude"], {
    encoding: "utf8",
    env: { ...process.env, WATCHDOG_DRY_RUN: "1" },
  });
  checkOneLine(dir, "resume-after-reset", "hook:resume-after-reset");
  fs.rmSync(dir, { recursive: true, force: true });
}
{
  // guard-dangerous-commands.js — deux branches distinctes, pas de double-log.
  const dirBlock = mkProject();
  run("guard-dangerous-commands.js", [], { tool_name: "Bash", tool_input: { command: "rm -rf /" } }, { CLAUDE_PROJECT_DIR: dirBlock });
  checkOneLine(dirBlock, "guard-dangerous-commands (block)", "hook:guard-dangerous-commands");
  const blockEntry = JSON.parse(readMetricsLines(dirBlock)[0]);
  check("guard-dangerous-commands (block) => category=block", blockEntry.category === "block");
  fs.rmSync(dirBlock, { recursive: true, force: true });

  const dirAllow = mkProject();
  run("guard-dangerous-commands.js", [], { tool_name: "Bash", tool_input: { command: "echo bonjour" } }, { CLAUDE_PROJECT_DIR: dirAllow });
  checkOneLine(dirAllow, "guard-dangerous-commands (allow)", "hook:guard-dangerous-commands");
  const allowEntry = JSON.parse(readMetricsLines(dirAllow)[0]);
  check("guard-dangerous-commands (allow) => category=allow", allowEntry.category === "allow");
  fs.rmSync(dirAllow, { recursive: true, force: true });
}
{
  // hard-stop-guard.js — deux branches distinctes (pass / block-context), pas de double-log.
  const dirPass = mkProject();
  run("hard-stop-guard.js", ["PostToolUse"], { session_id: "s-metrics", cwd: dirPass, tool_name: "Bash" }, { CLAUDE_PROJECT_DIR: dirPass });
  checkOneLine(dirPass, "hard-stop-guard (pass, pas de snapshot)", "hook:hard-stop-guard");
  fs.rmSync(dirPass, { recursive: true, force: true });

  const dirBlock = mkProject();
  fs.writeFileSync(
    path.join(dirBlock, ".claude", "statusline-snapshot.json"),
    JSON.stringify({ session_id: "s-metrics", ts: Date.now(), context_used_percentage: 90 })
  );
  run("hard-stop-guard.js", ["PostToolUse"], { session_id: "s-metrics", cwd: dirBlock, tool_name: "Bash" }, { CLAUDE_PROJECT_DIR: dirBlock });
  checkOneLine(dirBlock, "hard-stop-guard (block-context)", "hook:hard-stop-guard");
  const hsEntry = JSON.parse(readMetricsLines(dirBlock)[0]);
  check("hard-stop-guard (block-context) => category=block-context", hsEntry.category === "block-context");
  fs.rmSync(dirBlock, { recursive: true, force: true });
}

console.log(`${pass}/${pass + fails.length} tests OK`);
if (fails.length) {
  console.log(fails.join("\n"));
  process.exit(1);
}
