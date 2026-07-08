#!/usr/bin/env node
// Batterie de tests pour la chaîne watchdog V1.7 : statusline.js (capteur),
// context-watchdog.js (seuils contexte/crédits), credit-watchdog.js
// (StopFailure → checkpoint + planification) et resume-after-reset.js.
// WATCHDOG_DRY_RUN=1 court-circuite toast, Register-ScheduledTask et
// ouverture de terminal — les hooks écrivent alors sur stdout ce qu'ils
// AURAIENT fait, ce que la batterie vérifie. La vérification réelle
// (tâche planifiée, terminal, toasts) se fait à la main, voir SESSION.md.
const { spawnSync } = require("child_process");
const fs = require("fs");
const os = require("os");
const path = require("path");

const HOOKS = path.join(__dirname, "..");

function run(script, args, payload, extraEnv) {
  const input = payload === undefined ? "" : typeof payload === "string" ? payload : JSON.stringify(payload);
  return spawnSync("node", [path.join(HOOKS, script), ...args], {
    input,
    encoding: "utf8",
    env: { ...process.env, WATCHDOG_DRY_RUN: "1", ...extraEnv },
  });
}

function mkProject() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "watchdog-test-"));
  fs.mkdirSync(path.join(dir, ".claude"), { recursive: true });
  return dir;
}

function writeSnapshot(projectDir, snapshot) {
  fs.writeFileSync(path.join(projectDir, ".claude", "statusline-snapshot.json"), JSON.stringify(snapshot));
}

let pass = 0;
const fails = [];
function check(label, ok) {
  if (ok) pass++;
  else fails.push(`ÉCHEC: ${label}`);
}

// --- Robustesse : payloads vides/invalides => exit 0, pour tous les scripts ---
for (const raw of [undefined, "", "{}", "pas du json"]) {
  check(`statusline payload=${JSON.stringify(raw)} => exit 0`, run("statusline.js", [], raw).status === 0);
  for (const event of ["UserPromptSubmit", "PostCompact", "", "Inconnu"]) {
    const res = run("context-watchdog.js", [event], raw);
    check(`context-watchdog ${event || "(sans event)"} payload=${JSON.stringify(raw)} => exit 0`, res.status === 0);
  }
  check(`credit-watchdog payload=${JSON.stringify(raw)} => exit 0`, run("credit-watchdog.js", [], raw).status === 0);
}
check("resume-after-reset sans args => exit 0", run("resume-after-reset.js", [], "").status === 0);

// --- statusline : snapshot écrit + ligne affichée ---
{
  const dir = mkProject();
  const res = run("statusline.js", [], {
    session_id: "s-statusline",
    cwd: dir,
    model: { id: "claude-fable-5", display_name: "Fable 5" },
    context_window: { used_percentage: 42.4 },
    rate_limits: { five_hour: { used_percentage: 63.2, resets_at: Math.floor(Date.now() / 1000) + 3600 } },
  }, { CLAUDE_PROJECT_DIR: dir });
  const snap = JSON.parse(fs.readFileSync(path.join(dir, ".claude", "statusline-snapshot.json"), "utf8"));
  check("statusline écrit le snapshot (session_id)", snap.session_id === "s-statusline");
  check("statusline écrit le snapshot (ctx arrondi)", snap.context_used_percentage === 42);
  check("statusline écrit le snapshot (five_hour)", snap.five_hour && snap.five_hour.used_percentage === 63.2);
  check("statusline affiche le modèle", res.stdout.includes("Fable 5"));
  check("statusline affiche le contexte", res.stdout.includes("ctx 42%"));
  check("statusline affiche la fenêtre 5h", res.stdout.includes("5h 63%"));
  fs.rmSync(dir, { recursive: true, force: true });
}

// --- context-watchdog : seuils, une-seule-fois, ré-armement PostCompact ---
{
  const dir = mkProject();
  const env = { CLAUDE_PROJECT_DIR: dir };
  const prompt = (sid) => run("context-watchdog.js", ["UserPromptSubmit"], { session_id: sid, cwd: dir }, env);
  const snap = (ctx, extra) => writeSnapshot(dir, { session_id: "s-ctx", ts: Date.now(), context_used_percentage: ctx, ...extra });

  check("sans snapshot => silence", prompt("s-ctx").stdout === "");
  snap(84);
  check("ctx 84% => silence (sous le seuil)", prompt("s-ctx").stdout === "");
  snap(87);
  const warned = prompt("s-ctx");
  check("ctx 87% => injection additionalContext", warned.stdout.includes("additionalContext"));
  check("ctx 87% => ordonne session-checkpoint", warned.stdout.includes("session-checkpoint"));
  check("ctx 87% => mentionne le pourcentage", warned.stdout.includes("87%"));
  check("ctx 87% une deuxième fois => silence (déjà signalé)", prompt("s-ctx").stdout === "");
  run("context-watchdog.js", ["PostCompact"], { session_id: "s-ctx", cwd: dir }, env);
  check("après PostCompact => le seuil est ré-armé", prompt("s-ctx").stdout.includes("additionalContext"));

  // Snapshot d'une autre session ou périmé : ne rien dire.
  writeSnapshot(dir, { session_id: "autre-session", ts: Date.now(), context_used_percentage: 95 });
  check("snapshot d'une autre session => silence", prompt("s-ctx2").stdout === "");
  writeSnapshot(dir, { session_id: "s-ctx3", ts: Date.now() - 10 * 60 * 1000, context_used_percentage: 95 });
  check("snapshot périmé (>5 min) => silence", prompt("s-ctx3").stdout === "");

  // Crédits ≥ 90% : avertissement, une seule fois, indépendant du contexte.
  writeSnapshot(dir, {
    session_id: "s-credit", ts: Date.now(), context_used_percentage: 10,
    five_hour: { used_percentage: 92, resets_at: Math.floor(Date.now() / 1000) + 1800 },
  });
  const creditWarn = prompt("s-credit");
  check("crédits 92% => avertissement", creditWarn.stdout.includes("92%"));
  check("crédits 92% => une deuxième fois silence", prompt("s-credit").stdout === "");
  fs.rmSync(dir, { recursive: true, force: true });
}

// --- credit-watchdog : filtre d'erreur, checkpoint brut, planification ---
{
  const dir = mkProject();
  const env = { CLAUDE_PROJECT_DIR: dir };
  const logFile = path.join(dir, ".claude", "session-log.md");
  const resetSec = Math.floor(Date.now() / 1000) + 3600;

  run("credit-watchdog.js", [], { session_id: "abcd1234-xyz", error: "server_error", cwd: dir }, env);
  check("server_error => aucun checkpoint (pas une coupure crédits)", !fs.existsSync(logFile));

  // Transcript factice pour vérifier la queue copiée.
  const transcript = path.join(dir, "transcript.jsonl");
  fs.writeFileSync(transcript, ["ligne-1", "ligne-2", "ligne-marqueur-fin"].join("\n"));
  writeSnapshot(dir, { session_id: "abcd1234-xyz", ts: Date.now(), five_hour: { used_percentage: 100, resets_at: resetSec } });
  const res = run("credit-watchdog.js", [], {
    session_id: "abcd1234-xyz", error: "billing_error", cwd: dir,
    transcript_path: transcript, error_details: "usage limit reached",
    last_assistant_message: "Je m'apprêtais à lancer les tests.",
  }, env);
  const log = fs.readFileSync(logFile, "utf8");
  check("billing_error => entrée session-log", log.includes("Coupure crédits"));
  check("l'entrée contient la queue du transcript", log.includes("ligne-marqueur-fin"));
  check("l'entrée contient le dernier message assistant", log.includes("Je m'apprêtais"));
  const dry = JSON.parse(res.stdout);
  check("planification : nom de tâche dérivé de la session", dry.wouldSchedule.taskName === "HarnaisResume_abcd1234");
  check("planification : reprise = reset + 60s", Date.parse(dry.wouldSchedule.resumeAt) === resetSec * 1000 + 60000);

  // Snapshot inutilisable (reset passé) mais epoch dans error_details.
  writeSnapshot(dir, { session_id: "abcd1234-xyz", ts: Date.now(), five_hour: { used_percentage: 100, resets_at: resetSec - 7200 } });
  const res2 = run("credit-watchdog.js", [], {
    session_id: "abcd1234-xyz", error: "rate_limit", cwd: dir,
    error_details: `Claude AI usage limit reached|${resetSec}`,
  }, env);
  const dry2 = JSON.parse(res2.stdout);
  check("fallback error_details : reprise = epoch du message + 60s", Date.parse(dry2.wouldSchedule.resumeAt) === resetSec * 1000 + 60000);

  // Aucune heure fiable : checkpoint quand même, pas de planification.
  fs.rmSync(path.join(dir, ".claude", "statusline-snapshot.json"));
  const res3 = run("credit-watchdog.js", [], { session_id: "abcd1234-xyz", error: "billing_error", cwd: dir }, env);
  check("sans heure de reset => pas de planification", !res3.stdout.includes("wouldSchedule"));
  check("sans heure de reset => checkpoint quand même", (fs.readFileSync(logFile, "utf8").match(/Coupure crédits/g) || []).length === 3);
  fs.rmSync(dir, { recursive: true, force: true });
}

// --- resume-after-reset : --resume si le transcript existe, session neuve sinon ---
{
  const dir = mkProject();
  const fakeHome = fs.mkdtempSync(path.join(os.tmpdir(), "watchdog-home-"));
  const flat = dir.replace(/[^a-zA-Z0-9]/g, "-");
  const homeEnv = { USERPROFILE: fakeHome, HOME: fakeHome };

  const resNoTranscript = run("resume-after-reset.js", ["sess-1234-abc", dir], "", homeEnv);
  check("transcript absent => session neuve (pas de --resume)", JSON.parse(resNoTranscript.stdout).wouldOpen.claudeArgs.length === 0);

  fs.mkdirSync(path.join(fakeHome, ".claude", "projects", flat), { recursive: true });
  fs.writeFileSync(path.join(fakeHome, ".claude", "projects", flat, "sess-1234-abc.jsonl"), "{}");
  const resTranscript = run("resume-after-reset.js", ["sess-1234-abc", dir], "", homeEnv);
  const out = JSON.parse(resTranscript.stdout);
  check("transcript présent => claude --resume <session>", out.wouldOpen.claudeArgs.join(" ") === "--resume sess-1234-abc");
  check("la tâche à supprimer porte le nom dérivé", out.wouldDeleteTask === "HarnaisResume_sess-123");
  fs.rmSync(dir, { recursive: true, force: true });
  fs.rmSync(fakeHome, { recursive: true, force: true });
}

console.log(`${pass}/${pass + fails.length} tests OK`);
if (fails.length) {
  console.log(fails.join("\n"));
  process.exit(1);
}
