#!/usr/bin/env node
// Batterie de tests pour la chaîne watchdog V1.7 : statusline.js (capteur),
// context-watchdog.js (seuils contexte/crédits), credit-watchdog.js
// (StopFailure → checkpoint + planification) et resume-after-reset.js.
// WATCHDOG_DRY_RUN=1 court-circuite toast et Register-ScheduledTask — les
// hooks écrivent alors sur stdout ce qu'ils AURAIENT fait, ce que la
// batterie vérifie. La vérification réelle (tâche planifiée, toasts) se
// fait à la main, voir SESSION.md.
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
  for (const event of ["PostToolUse", "Stop", "PostCompact", "", "Inconnu"]) {
    const res = run("hard-stop-guard.js", [event], raw);
    check(`hard-stop-guard ${event || "(sans event)"} payload=${JSON.stringify(raw)} => exit 0`, res.status === 0);
  }
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
  snap(69);
  check("ctx 69% => silence (sous le seuil)", prompt("s-ctx").stdout === "");
  snap(72);
  const warned = prompt("s-ctx");
  check("ctx 72% => injection additionalContext", warned.stdout.includes("additionalContext"));
  check("ctx 72% => ordonne session-checkpoint", warned.stdout.includes("session-checkpoint"));
  check("ctx 72% => mentionne le pourcentage", warned.stdout.includes("72%"));
  check("ctx 72% une deuxième fois => silence (déjà signalé)", prompt("s-ctx").stdout === "");
  run("context-watchdog.js", ["PostCompact"], { session_id: "s-ctx", cwd: dir }, env);
  check("après PostCompact => le seuil est ré-armé", prompt("s-ctx").stdout.includes("additionalContext"));

  // Snapshot d'une autre session ou périmé : ne rien dire.
  writeSnapshot(dir, { session_id: "autre-session", ts: Date.now(), context_used_percentage: 95 });
  check("snapshot d'une autre session => silence", prompt("s-ctx2").stdout === "");
  writeSnapshot(dir, { session_id: "s-ctx3", ts: Date.now() - 10 * 60 * 1000, context_used_percentage: 95 });
  check("snapshot périmé (>5 min) => silence", prompt("s-ctx3").stdout === "");

  // Crédits ≥ 85% (V1.11) : avertissement, une seule fois, indépendant du contexte.
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
  check("planification : binaire claude résolu (dry-run => 'claude')", dry.wouldSchedule.claudeBin === "claude");

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

// --- resume-after-reset : reprise auto si le transcript existe, session neuve sinon ---
{
  const dir = mkProject();
  const fakeHome = fs.mkdtempSync(path.join(os.tmpdir(), "watchdog-home-"));
  const flat = dir.replace(/[^a-zA-Z0-9]/g, "-");
  const homeEnv = { USERPROFILE: fakeHome, HOME: fakeHome };
  const claudeBin = "C:\\fake\\claude.cmd";

  const resNoTranscript = run("resume-after-reset.js", ["sess-1234-abc", dir, claudeBin], "", homeEnv);
  const outNoTranscript = JSON.parse(resNoTranscript.stdout);
  check("transcript absent => pas de reprise (canResume=false)", outNoTranscript.canResume === false);
  check("transcript absent => pas d'arguments claude construits", (outNoTranscript.claudeArgs || []).length === 0);

  fs.mkdirSync(path.join(fakeHome, ".claude", "projects", flat), { recursive: true });
  fs.writeFileSync(path.join(fakeHome, ".claude", "projects", flat, "sess-1234-abc.jsonl"), "{}");

  // Sans section "En cours / bloqué" exploitable dans SESSION.md => repli générique.
  const resFallback = run("resume-after-reset.js", ["sess-1234-abc", dir, claudeBin], "", homeEnv);
  const outFallback = JSON.parse(resFallback.stdout);
  check("transcript présent => canResume=true", outFallback.canResume === true);
  check("transcript présent => binaire claude transmis", outFallback.claudeBinPath === claudeBin);
  check("pas de SESSION.md => instruction de repli générique", outFallback.instructionPreview.includes("SESSION.md"));
  check("la tâche à supprimer porte le nom dérivé", outFallback.wouldDeleteTask === "HarnaisResume_sess-123");

  // Avec une section "En cours / bloqué" précise => l'instruction la reprend.
  fs.writeFileSync(
    path.join(dir, "SESSION.md"),
    "# SESSION.md\n\n## Fait\n- Rien\n\n## En cours / bloqué\nÉditer hard-stop-guard.js, whitelist à finir.\n\n## Prochaines étapes\n- Tests\n"
  );
  const resTask = run("resume-after-reset.js", ["sess-1234-abc", dir, claudeBin], "", homeEnv);
  const outTask = JSON.parse(resTask.stdout);
  check(
    "section 'En cours / bloqué' présente => reprise dans l'instruction",
    outTask.instructionPreview.includes("hard-stop-guard.js")
  );

  fs.rmSync(dir, { recursive: true, force: true });
  fs.rmSync(fakeHome, { recursive: true, force: true });
}

// --- hard-stop-guard : arrêt dur contexte/crédits, whitelist, plafond ---
{
  const dir = mkProject();
  const env = { CLAUDE_PROJECT_DIR: dir };
  const tool = (sid, toolName, toolInput) =>
    run("hard-stop-guard.js", ["PostToolUse"], { session_id: sid, cwd: dir, tool_name: toolName, tool_input: toolInput || {} }, env);
  const snap = (sid, ctx, extra) =>
    writeSnapshot(dir, { session_id: sid, ts: Date.now(), context_used_percentage: ctx, ...extra });

  // Sous le seuil : passthrough silencieux.
  snap("s-hs-ctx", 50);
  const passthrough = tool("s-hs-ctx", "Bash", { command: "ls" });
  check("contexte 50% => exit 0", passthrough.status === 0);
  check("contexte 50% => stdout silencieux", passthrough.stdout === "");

  // Franchissement du seuil dur (85%) : la commande qui vient de faire
  // franchir le seuil s'est déjà exécutée avant que le hook ne tourne (limite
  // assumée, PostToolUse) — mais l'appel suivant est bien bloqué.
  snap("s-hs-ctx", 86);
  tool("s-hs-ctx", "Bash", { command: "ls" }); // franchissement, pose le flag
  const blocked = tool("s-hs-ctx", "Bash", { command: "echo hi" });
  check("contexte ≥85% => exit 2 sur l'appel suivant", blocked.status === 2);
  check("contexte ≥85% => message d'ordre de checkpoint", blocked.stderr.includes("SESSION.md"));

  // Whitelist : Read toujours permis, Write/Edit uniquement sur les 2 fichiers.
  check("Read quelconque => toujours autorisé en hard-stop", tool("s-hs-ctx", "Read", { file_path: "n_importe_quoi.txt" }).status === 0);
  check(
    "Write sur SESSION.md => autorisé",
    tool("s-hs-ctx", "Write", { file_path: path.join(dir, "SESSION.md") }).status === 0
  );
  check(
    "Edit sur .claude/session-log.md (chemin relatif) => autorisé",
    tool("s-hs-ctx", "Edit", { file_path: ".claude/session-log.md" }).status === 0
  );
  check(
    "Write sur un autre fichier => bloqué",
    tool("s-hs-ctx", "Write", { file_path: path.join(dir, "autre.md") }).status === 2
  );
  check("PowerShell => bloqué quel que soit tool_input", tool("s-hs-ctx", "PowerShell", { command: "Get-Date" }).status === 2);

  // Persistance : même si le contexte redescend, le hard-stop reste actif
  // (pas de ré-armement automatique, seul PostCompact le fait).
  snap("s-hs-ctx", 10);
  check("contexte redescendu à 10% => hard-stop toujours actif", tool("s-hs-ctx", "Bash", { command: "ls" }).status === 2);

  // PostCompact manuel : réarme contextHardStop.
  run("hard-stop-guard.js", ["PostCompact"], { session_id: "s-hs-ctx", cwd: dir }, env);
  check("après PostCompact (contexte déjà bas) => hard-stop levé", tool("s-hs-ctx", "Bash", { command: "ls" }).status === 0);

  fs.rmSync(dir, { recursive: true, force: true });
}

// --- hard-stop-guard : arrêt dur crédits (proactif 90%, V1.11), planification, fenêtre de reprise, plafond ---
{
  const dir = mkProject();
  const env = { CLAUDE_PROJECT_DIR: dir };
  const tool = (sid, toolName, toolInput) =>
    run("hard-stop-guard.js", ["PostToolUse"], { session_id: sid, cwd: dir, tool_name: toolName, tool_input: toolInput || {} }, env);

  const resetSec = Math.floor(Date.now() / 1000) + 3600;
  writeSnapshot(dir, {
    session_id: "s-hs-credit",
    ts: Date.now(),
    context_used_percentage: 10,
    five_hour: { used_percentage: 96, resets_at: resetSec },
  });

  const firstBlock = tool("s-hs-credit", "Bash", { command: "ls" });
  check("crédits ≥90% => exit 2", firstBlock.status === 2);
  check("crédits ≥90% => message d'ordre de checkpoint", firstBlock.stderr.includes("SESSION.md"));
  const dry = JSON.parse(firstBlock.stdout);
  check("crédits ≥90% => planifie la reprise (resumeAt = reset + 60s)", Date.parse(dry.wouldSchedule.resumeAt) === resetSec * 1000 + 60000);

  const secondBlock = tool("s-hs-credit", "Bash", { command: "ls" });
  check("crédits ≥90% une 2e fois => bloqué mais pas replanifié (idempotent)", secondBlock.status === 2 && secondBlock.stdout === "");

  // Read/Write SESSION.md restent autorisés pendant l'arrêt dur crédits.
  check("Read autorisé pendant hard-stop crédits", tool("s-hs-credit", "Read", { file_path: "x.txt" }).status === 0);
  check(
    "Write SESSION.md autorisé pendant hard-stop crédits",
    tool("s-hs-credit", "Write", { file_path: path.join(dir, "SESSION.md") }).status === 0
  );

  fs.rmSync(dir, { recursive: true, force: true });
}

// --- hard-stop-guard : régression du resserrement de seuil (95% -> 90%, V1.11) ---
{
  const dir = mkProject();
  const env = { CLAUDE_PROJECT_DIR: dir };
  const tool = (sid) =>
    run("hard-stop-guard.js", ["PostToolUse"], { session_id: sid, cwd: dir, tool_name: "Bash", tool_input: { command: "ls" } }, env);

  // 91% était SOUS l'ancien seuil (95%) donc serait passé avant V1.11 ; doit
  // désormais bloquer, preuve que le resserrement a un effet réel.
  writeSnapshot(dir, {
    session_id: "s-hs-credit91",
    ts: Date.now(),
    context_used_percentage: 10,
    five_hour: { used_percentage: 91 },
  });
  check("crédits 91% (entre l'ancien et le nouveau seuil) => bloque désormais", tool("s-hs-credit91").status === 2);

  fs.rmSync(dir, { recursive: true, force: true });
}

// --- hard-stop-guard : staleness du snapshot (V1.11) — fail-open corrigé ---
{
  const dir = mkProject();
  const env = { CLAUDE_PROJECT_DIR: dir };
  const tool = (sid) =>
    run("hard-stop-guard.js", ["PostToolUse"], { session_id: sid, cwd: dir, tool_name: "Bash", tool_input: { command: "ls" } }, env);
  const stateFile = path.join(dir, ".claude", "watchdog-state.json");
  const readState = (sid) => JSON.parse(fs.readFileSync(stateFile, "utf8"))[sid];

  // Snapshot frais sous les seuils d'escalade (75%/80%) : rien de spécial, valeurs mémorisées.
  writeSnapshot(dir, {
    session_id: "s-stale-low",
    ts: Date.now(),
    context_used_percentage: 60,
    five_hour: { used_percentage: 40 },
  });
  const freshLow = tool("s-stale-low");
  check("staleness : snapshot frais bas => exit 0", freshLow.status === 0);
  check("staleness : snapshot frais bas => stdout silencieux", freshLow.stdout === "");
  const stLow = readState("s-stale-low");
  check("staleness : dernière valeur contexte mémorisée", stLow.lastKnownCtx === 60);
  check("staleness : dernière valeur crédits mémorisée", stLow.lastKnownCredit === 40);
  check("staleness : streak à 0 après un snapshot frais", stLow.staleStreak === 0);
  fs.rmSync(dir, { recursive: true, force: true });
}

{
  const dir = mkProject();
  const env = { CLAUDE_PROJECT_DIR: dir };
  const tool = (sid) =>
    run("hard-stop-guard.js", ["PostToolUse"], { session_id: sid, cwd: dir, tool_name: "Bash", tool_input: { command: "ls" } }, env);
  const stateFile = path.join(dir, ".claude", "watchdog-state.json");
  const readState = (sid) => JSON.parse(fs.readFileSync(stateFile, "utf8"))[sid];
  const snapshotFile = path.join(dir, ".claude", "statusline-snapshot.json");
  const sid = "s-stale-high";

  // Snapshot frais avec valeur déjà en zone de vigilance (≥75% contexte).
  writeSnapshot(dir, { session_id: sid, ts: Date.now(), context_used_percentage: 80 });
  check("staleness haute : premier appel frais => exit 0", tool(sid).status === 0);

  // Le snapshot ne se rafraîchit plus (simule une rafale d'outils sans refresh statusline).
  fs.rmSync(snapshotFile, { force: true });

  let lastRes;
  for (let i = 0; i < 9; i++) lastRes = tool(sid); // streak 1..9, sous STALE_STREAK_WARN (10)
  check("staleness haute : sous le seuil d'avertissement => exit 0 silencieux", lastRes.status === 0 && lastRes.stdout === "");
  check("staleness haute : streak correctement compté", readState(sid).staleStreak === 9);

  const warnRes = tool(sid); // streak=10 => STALE_STREAK_WARN atteint
  check("staleness haute : avertissement au 10e appel périmé => exit 0", warnRes.status === 0);
  check("staleness haute : avertissement mentionne le snapshot non rafraîchi", warnRes.stdout.includes("rafraîchi"));
  check("staleness haute : avertissement mentionne la dernière valeur (80%)", warnRes.stdout.includes("80"));

  const noReWarn = tool(sid); // streak=11 : déjà averti, pas de re-déclenchement
  check("staleness haute : avertissement une seule fois (pas de re-déclenchement)", noReWarn.stdout === "");

  for (let i = 0; i < 8; i++) lastRes = tool(sid); // streak 12..19, toujours sous STALE_STREAK_CAP (20)
  check("staleness haute : toujours sous le plafond => exit 0", lastRes.status === 0);

  const capRes = tool(sid); // streak=20 => STALE_STREAK_CAP atteint
  check("staleness haute : plafond atteint => exit 2 (arrêt conservateur)", capRes.status === 2);
  check("staleness haute : message mentionne 'périmé'", capRes.stderr.includes("périmé"));
  check("staleness haute : message mentionne 'arrêt conservateur'", capRes.stderr.includes("arrêt conservateur"));

  fs.rmSync(dir, { recursive: true, force: true });
}

{
  const dir = mkProject();
  const env = { CLAUDE_PROJECT_DIR: dir };
  const tool = (sid) =>
    run("hard-stop-guard.js", ["PostToolUse"], { session_id: sid, cwd: dir, tool_name: "Bash", tool_input: { command: "ls" } }, env);
  const snapshotFile = path.join(dir, ".claude", "statusline-snapshot.json");
  const sid = "s-stale-lowvalue";

  // Dernière valeur connue BASSE : même après beaucoup d'appels périmés, pas
  // d'escalade — une session simplement peu active ne doit pas être punie.
  writeSnapshot(dir, { session_id: sid, ts: Date.now(), context_used_percentage: 20, five_hour: { used_percentage: 10 } });
  tool(sid);
  fs.rmSync(snapshotFile, { force: true });

  let lastRes;
  for (let i = 0; i < 25; i++) lastRes = tool(sid); // bien au-delà de STALE_STREAK_CAP (20)
  check("staleness sans base élevée : aucune escalade même au-delà du plafond", lastRes.status === 0);

  fs.rmSync(dir, { recursive: true, force: true });
}

{
  const dir = mkProject();
  const env = { CLAUDE_PROJECT_DIR: dir };
  const tool = (sid) =>
    run("hard-stop-guard.js", ["PostToolUse"], { session_id: sid, cwd: dir, tool_name: "Bash", tool_input: { command: "ls" } }, env);
  const stateFile = path.join(dir, ".claude", "watchdog-state.json");
  const readState = (sid) => JSON.parse(fs.readFileSync(stateFile, "utf8"))[sid];
  const snapshotFile = path.join(dir, ".claude", "statusline-snapshot.json");
  const sid = "s-stale-reset";

  // Une série de staleness, puis un retour de snapshot frais => le compteur retombe à 0.
  writeSnapshot(dir, { session_id: sid, ts: Date.now(), context_used_percentage: 80 });
  tool(sid);
  fs.rmSync(snapshotFile, { force: true });
  for (let i = 0; i < 5; i++) tool(sid);
  check("staleness : streak accumulé avant retour du snapshot", readState(sid).staleStreak === 5);

  writeSnapshot(dir, { session_id: sid, ts: Date.now(), context_used_percentage: 55 });
  tool(sid);
  const afterFresh = readState(sid);
  check("staleness : retour d'un snapshot frais => streak réinitialisé", afterFresh.staleStreak === 0);
  check("staleness : retour d'un snapshot frais => staleWarned réinitialisé", afterFresh.staleWarned === false);

  fs.rmSync(dir, { recursive: true, force: true });
}

// --- hard-stop-guard : fenêtre de reprise franchie => déblocage + plafond anti-emballement ---
{
  const dir = mkProject();
  const env = { CLAUDE_PROJECT_DIR: dir };
  const tool = (sid) =>
    run("hard-stop-guard.js", ["PostToolUse"], { session_id: sid, cwd: dir, tool_name: "Bash", tool_input: { command: "ls" } }, env);
  const stateFile = path.join(dir, ".claude", "watchdog-state.json");

  // État pré-existant : arrêt dur crédits déjà posé, heure de reprise déjà
  // passée (simule l'instant où la tâche planifiée vient de relancer la
  // session) — sans dépendre d'un vrai sommeil de plusieurs heures en test.
  fs.writeFileSync(
    stateFile,
    JSON.stringify({
      "s-hs-resume": {
        ts: Date.now(),
        creditHardStop: true,
        creditResumeScheduled: true,
        autoResumeUnblockAt: Date.now() - 1000,
      },
    })
  );

  const first = tool("s-hs-resume");
  check("fenêtre de reprise déjà ouverte => pas bloqué (crédits levés)", first.status === 0);

  fs.writeFileSync(path.join(dir, ".claude", "watchdog-config.json"), JSON.stringify({ autoResumeMaxActions: 3 }));
  tool("s-hs-resume"); // action 2
  tool("s-hs-resume"); // action 3
  const overCap = tool("s-hs-resume"); // action 4 : dépasse le plafond de 3
  check("plafond de reprise dépassé => hard-stop forcé (exit 2)", overCap.status === 2);
  check("plafond de reprise dépassé => message mentionne le plafond", overCap.stderr.includes("plafond"));

  fs.rmSync(dir, { recursive: true, force: true });
}

// --- hard-stop-guard : Stop nettoie l'état de reprise auto, sans y toucher si absent ---
{
  const dir = mkProject();
  const env = { CLAUDE_PROJECT_DIR: dir };
  const stateFile = path.join(dir, ".claude", "watchdog-state.json");

  fs.writeFileSync(
    stateFile,
    JSON.stringify({
      "s-hs-stop": {
        ts: Date.now(),
        creditHardStop: true,
        creditResumeScheduled: true,
        autoResumeUnblockAt: Date.now() - 1000,
        autoResumeActive: true,
        autoResumeActionCount: 5,
      },
      "s-hs-other": { ts: Date.now(), contextWarned: true },
    })
  );

  run("hard-stop-guard.js", ["Stop"], { session_id: "s-hs-stop", cwd: dir }, env);
  const stateAfter = JSON.parse(fs.readFileSync(stateFile, "utf8"));
  check("Stop avec autoResumeActive => nettoie l'épisode de reprise", !stateAfter["s-hs-stop"].autoResumeActive);
  check("Stop avec autoResumeActive => nettoie creditHardStop", !stateAfter["s-hs-stop"].creditHardStop);
  check("Stop => ne touche pas l'entrée d'une autre session", stateAfter["s-hs-other"].contextWarned === true);

  fs.rmSync(dir, { recursive: true, force: true });
}

console.log(`${pass}/${pass + fails.length} tests OK`);
if (fails.length) {
  console.log(fails.join("\n"));
  process.exit(1);
}
