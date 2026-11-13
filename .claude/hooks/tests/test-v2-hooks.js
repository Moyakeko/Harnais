#!/usr/bin/env node
// Tests v2 des hooks : plafond d'injection de SESSION.md, checkpoint-nudge,
// HARNAIS_NO_METRICS respecté par tous les hooks, écriture atomique résistante
// à EPERM (simulé avec un fs factice) et désactivation de resume-after-reset.
const { spawnSync } = require("child_process");
const fs = require("fs");
const os = require("os");
const path = require("path");

const HOOKS = path.join(__dirname, "..");
process.env.HARNAIS_NO_METRICS = "1";

let pass = 0;
const fails = [];
function check(label, ok) {
  if (ok) pass++;
  else fails.push(`ÉCHEC: ${label}`);
}

function mkProject() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "harnais-v2-test-"));
  fs.mkdirSync(path.join(dir, ".claude"), { recursive: true });
  return dir;
}

function run(script, args, payload, env) {
  return spawnSync("node", [path.join(HOOKS, script), ...args], {
    input: payload === undefined ? "" : JSON.stringify(payload),
    encoding: "utf8",
    env: { ...process.env, HARNAIS_NO_METRICS: "1", WATCHDOG_DRY_RUN: "1", NOTIFY_DESKTOP_DRY_RUN: "1", ...env },
  });
}

// --- session-start-inject : plafond 4 Ko + avertissement > 80 lignes ---
{
  const dir = mkProject();
  const env = { CLAUDE_PROJECT_DIR: dir };
  const ctx = (res) => JSON.parse(res.stdout).hookSpecificOutput.additionalContext;

  fs.writeFileSync(path.join(dir, "SESSION.md"), "# Session\n\n- état court\n");
  let c = ctx(run("session-start-inject.js", [], { session_id: "a" }, env));
  check("SESSION.md court => injecté entier", c.includes("- état court"));
  check("SESSION.md court => aucun avertissement", !c.includes("[harnais]"));

  const long = Array.from({ length: 400 }, (_, i) => `ligne ${i} — état é`).join("\n") + "\nMARQUEUR-FIN\n";
  fs.writeFileSync(path.join(dir, "SESSION.md"), long);
  c = ctx(run("session-start-inject.js", [], { session_id: "a" }, env));
  const body = c.split("[harnais]")[0];
  check("SESSION.md long => fin non injectée", !c.includes("MARQUEUR-FIN"));
  check("SESSION.md long => début injecté", c.includes("ligne 0 —"));
  check("SESSION.md long => partie SESSION ≤ 4096 octets + en-tête", Buffer.byteLength(body, "utf8") <= 4096 + 400);
  check("SESSION.md long => coupe sur une fin de ligne", /ligne \d+ — état é\n\n*$/.test(body));
  check("SESSION.md long => avertissement troncature", c.includes("tronqué"));
  check("SESSION.md long => avertissement > 80 lignes", c.includes("401 lignes") || c.includes("lignes (> 80)"));

  const mid = Array.from({ length: 90 }, (_, i) => `l${i}`).join("\n") + "\n";
  fs.writeFileSync(path.join(dir, "SESSION.md"), mid);
  c = ctx(run("session-start-inject.js", [], { session_id: "a" }, env));
  check("90 lignes courtes => pas tronqué", !c.includes("tronqué") && c.includes("l89"));
  check("90 lignes courtes => avertissement lignes", c.includes("90 lignes"));

  const { capContent } = require(path.join(HOOKS, "session-start-inject.js"));
  const multi = "é".repeat(5000);
  const capped = capContent(multi);
  check("capContent : pas de caractère coupé (UTF-8)", !capped.body.includes("�") && Buffer.byteLength(capped.body) <= 4096);
  fs.rmSync(dir, { recursive: true, force: true });
}

// --- checkpoint-nudge ---
{
  const dir = mkProject();
  const env = { CLAUDE_PROJECT_DIR: dir, HARNAIS_CHECKPOINT_NUDGE_TURNS: "3" };
  const stop = (extra) => run("checkpoint-nudge.js", ["Stop"], { session_id: "s1", ...extra }, env);

  check("pas de SESSION.md => silence", stop().stdout === "");
  fs.writeFileSync(path.join(dir, "SESSION.md"), "x\n");
  const outs = [stop(), stop(), stop()];
  check("tours 1-2 => silence", outs[0].stdout === "" && outs[1].stdout === "");
  let parsed = null;
  try {
    parsed = JSON.parse(outs[2].stdout);
  } catch (e) {}
  check("tour 3 => rappel additionalContext Stop", parsed && parsed.hookSpecificOutput.hookEventName === "Stop" && /session-checkpoint/.test(parsed.hookSpecificOutput.additionalContext));
  check("rappel non bloquant (pas de decision:block)", parsed && parsed.decision === undefined);
  check("après rappel => compteur remis à zéro", stop().stdout === "");
  check("stop_hook_active => silence", stop({ stop_hook_active: true }).stdout === "" );

  // Modification de SESSION.md => compteur remis à zéro.
  stop();
  const t = Date.now() / 1000 + 5;
  fs.utimesSync(path.join(dir, "SESSION.md"), t, t);
  check("SESSION.md modifié => silence au tour suivant", stop().stdout === "");
  check("SESSION.md modifié => silence au 2e tour", stop().stdout === "");
  check("SESSION.md modifié => rappel au 3e tour", stop().stdout.includes("session-checkpoint"));

  // PreCompact : consigne au résumé seulement s'il y a du retard.
  const t2 = Date.now() / 1000 + 10;
  fs.utimesSync(path.join(dir, "SESSION.md"), t2, t2);
  check("PreCompact sans retard => silence", run("checkpoint-nudge.js", ["PreCompact"], { session_id: "s1" }, env).stdout === "");
  stop();
  const pc = run("checkpoint-nudge.js", ["PreCompact"], { session_id: "s1" }, env);
  check("PreCompact avec retard => consigne pour le résumé", pc.stdout.includes("session-checkpoint"));
  check("PreCompact => exit 0", pc.status === 0);
  check("payload invalide => exit 0", spawnSync("node", [path.join(HOOKS, "checkpoint-nudge.js"), "Stop"], { input: "pas du json", encoding: "utf8", env: { ...process.env, HARNAIS_NO_METRICS: "1", CLAUDE_PROJECT_DIR: dir } }).status === 0);
  fs.rmSync(dir, { recursive: true, force: true });
}

// --- HARNAIS_NO_METRICS=1 respecté par tous les hooks ---
{
  const dir = mkProject();
  fs.writeFileSync(path.join(dir, "SESSION.md"), "x\n");
  fs.writeFileSync(path.join(dir, ".claude", "harnais.version"), JSON.stringify({ version: "2.0" }));
  const env = {
    CLAUDE_PROJECT_DIR: dir,
    HARNAIS_UPDATE_CHECK_MOCK_TAGS: "v2.0",
    HARNAIS_UPDATE_CHECK_FORCE: "1",
    HARNAIS_GRAPHIFY_CHECK_MOCK_CLI: "1",
    HARNAIS_GRAPHIFY_CHECK_MOCK_FILECOUNT: "500",
  };
  const calls = [
    ["guard-dangerous-commands.js", [], { tool_name: "Bash", tool_input: { command: "git push --force" } }],
    ["guard-dangerous-commands.js", [], { tool_name: "Bash", tool_input: { command: "ls" } }],
    ["session-start-inject.js", [], { session_id: "m" }],
    ["update-check.js", [], {}],
    ["graphify-check.js", [], {}],
    ["checkpoint-nudge.js", ["Stop"], { session_id: "m" }],
    ["checkpoint-nudge.js", ["PreCompact"], { session_id: "m" }],
    ["statusline.js", [], { session_id: "m", context_window: { used_percentage: 10 } }],
    ["context-watchdog.js", ["UserPromptSubmit"], { session_id: "m" }],
    ["hard-stop-guard.js", ["PostToolUse"], { session_id: "m", tool_name: "Read" }],
    ["hard-stop-guard.js", ["Stop"], { session_id: "m" }],
    ["credit-watchdog.js", [], { session_id: "m", error: "billing_error" }],
    ["notify-desktop.js", ["Stop"], { session_id: "m" }],
    ["precompact-safety-net.js", [], { session_id: "m" }],
    ["resume-after-reset.js", [], {}],
  ];
  for (const [script, args, payload] of calls) run(script, args, payload, env);
  const metricsFile = path.join(dir, ".claude", "harnais-metrics.jsonl");
  check("NO_METRICS=1 => aucun harnais-metrics.jsonl après 15 appels de hooks", !fs.existsSync(metricsFile));

  // Contre-épreuve : sans la variable, le journal est bien écrit.
  run("session-start-inject.js", [], { session_id: "m" }, { ...env, HARNAIS_NO_METRICS: "" });
  check("sans NO_METRICS => journal écrit (contre-épreuve)", fs.existsSync(metricsFile));
  const { logMetric } = require(path.join(HOOKS, "lib", "metrics.js"));
  check("logMetric en process avec NO_METRICS=1 => false", process.env.HARNAIS_NO_METRICS === "1" && logMetric("t", "t", "") === false);
  fs.rmSync(dir, { recursive: true, force: true });
}

// --- Écriture atomique : EPERM simulé ---
{
  const { writeJsonAtomic } = require(path.join(HOOKS, "lib", "atomic-write.js"));
  const dir = mkProject();
  const target = path.join(dir, ".claude", "state.json");

  function fakeFs(failures, code) {
    let n = 0;
    return Object.assign(Object.create(fs), {
      calls: () => n,
      renameSync(a, b) {
        n++;
        if (n <= failures) {
          const e = new Error(`${code}: operation not permitted, rename`);
          e.code = code;
          throw e;
        }
        return fs.renameSync(a, b);
      },
    });
  }

  let f = fakeFs(2, "EPERM");
  check("EPERM ×2 puis succès => renamed", writeJsonAtomic(target, { a: 1 }, f) === "renamed" && f.calls() === 3);
  check("EPERM ×2 => contenu écrit", JSON.parse(fs.readFileSync(target, "utf8")).a === 1);

  f = fakeFs(99, "EPERM");
  check("EPERM permanent => repli écriture directe", writeJsonAtomic(target, { a: 2 }, f) === "direct");
  check("EPERM permanent => contenu écrit", JSON.parse(fs.readFileSync(target, "utf8")).a === 2);
  check("EPERM permanent => tmp nettoyé", fs.readdirSync(path.dirname(target)).every((n) => !n.includes(".tmp-")));

  f = fakeFs(99, "EBUSY");
  check("EBUSY permanent => repli écriture directe", writeJsonAtomic(target, { a: 3 }, f) === "direct");

  f = fakeFs(1, "ENOSPC");
  let threw = false;
  try {
    writeJsonAtomic(target, { a: 4 }, f);
  } catch (e) {
    threw = e.code === "ENOSPC";
  }
  check("erreur non transitoire => propagée (pas masquée)", threw);
  check("erreur non transitoire => tmp nettoyé", fs.readdirSync(path.dirname(target)).every((n) => !n.includes(".tmp-")));

  for (const h of ["hard-stop-guard.js", "context-watchdog.js", "statusline.js", "notify-desktop.js", "update-check.js", "graphify-check.js", "checkpoint-nudge.js"]) {
    const src = fs.readFileSync(path.join(HOOKS, h), "utf8");
    check(`${h} utilise writeJsonAtomic (plus de renameSync direct)`, src.includes("writeJsonAtomic") && !src.includes("renameSync"));
  }
  fs.rmSync(dir, { recursive: true, force: true });
}

// --- resume-after-reset désactivé par harnais.hooks.json ---
{
  const dir = mkProject();
  const { scheduleResume } = require(path.join(HOOKS, "lib", "resume-scheduler.js"));
  const prev = process.env.WATCHDOG_DRY_RUN;
  process.env.WATCHDOG_DRY_RUN = "1";
  const origWrite = process.stdout.write.bind(process.stdout);
  let out = "";
  process.stdout.write = (s) => ((out += s), true);
  const on = scheduleResume(dir, "sid", Date.now() + 1000, "claude");
  fs.writeFileSync(path.join(dir, ".claude", "harnais.hooks.json"), JSON.stringify({ hooks: { "resume-after-reset": false } }));
  out = "";
  const off = scheduleResume(dir, "sid", Date.now() + 1000, "claude");
  process.stdout.write = origWrite;
  if (prev === undefined) delete process.env.WATCHDOG_DRY_RUN;
  else process.env.WATCHDOG_DRY_RUN = prev;
  check("resume-after-reset actif par défaut => planifié (dry-run)", on === true);
  check("resume-after-reset désactivé => rien planifié", off === false && out === "");
  fs.rmSync(dir, { recursive: true, force: true });
}

console.log(`${pass}/${pass + fails.length} tests OK`);
if (fails.length) {
  console.log(fails.join("\n"));
  process.exit(1);
}
