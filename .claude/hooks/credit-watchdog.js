#!/usr/bin/env node
/**
 * Hook StopFailure (matcher: billing_error|rate_limit) — le tour vient d'être
 * interrompu par l'épuisement des crédits. Trois actions, toutes best-effort :
 *
 *   1. Checkpoint brut horodaté dans .claude/session-log.md (même motif que
 *      precompact-safety-net.js) : erreur, dernier message assistant, queue du
 *      transcript. Un hook ne raisonne pas — le checkpoint riche reste le rôle
 *      de la skill session-checkpoint (poussée par context-watchdog quand les
 *      crédits passent 90%) ; ici on garantit juste qu'aucune trace ne se perd.
 *   2. Planifie une tâche Windows (Register-ScheduledTask, pas schtasks : seul
 *      le cmdlet expose -StartWhenAvailable, qui rattrape un PC en veille à
 *      l'heure dite) à l'heure de réinitialisation + 1 min, qui lancera
 *      resume-after-reset.js : toast + terminal prêt sur `claude --resume` —
 *      la reprise reste validée par l'humain (choix utilisateur : pas de
 *      relance headless qui consommerait des crédits sans supervision).
 *   3. Toast immédiat récapitulant ce qui a été fait.
 *
 * L'heure de réinitialisation vient du snapshot statusline
 * (rate_limits.five_hour.resets_at — accepté même d'une autre session : la
 * fenêtre 5h est liée au compte, pas à la session, tant que l'heure est dans
 * le futur), sinon d'un timestamp epoch dans error_details (format historique
 * « …|1751986800 » des messages de limite). Sans heure fiable : toast seul,
 * pas de planification à l'aveugle.
 *
 * Le matcher settings.json limite déjà aux erreurs de crédits ; le code
 * re-vérifie car les tests pipent des payloads sans passer par le matcher.
 * Windows uniquement (no-op ailleurs), exit 0 dans tous les cas.
 */

const fs = require("fs");
const path = require("path");
const { spawnSync } = require("child_process");
const { showToast } = require("./lib/toast");

const CREDIT_ERRORS = new Set(["billing_error", "rate_limit"]);
const TAIL_LINES = 40;
const RESUME_DELAY_MS = 60 * 1000;
const SCHEDULE_TIMEOUT_MS = 30000;

// Script PowerShell constant — toutes les données variables (nom de tâche,
// heure, chemins, session id) passent par variables d'environnement, jamais
// concaténées dans le code : même motif anti-injection que lib/toast.js.
const SCHEDULE_PS = [
  "$ErrorActionPreference = 'Stop'",
  "$action = New-ScheduledTaskAction -Execute $env:HARNAIS_NODE -Argument ('\"{0}\" \"{1}\" \"{2}\"' -f $env:HARNAIS_SCRIPT, $env:HARNAIS_SESSION_ID, $env:HARNAIS_PROJECT_DIR) -WorkingDirectory $env:HARNAIS_PROJECT_DIR",
  "$trigger = New-ScheduledTaskTrigger -Once -At ([datetime]::Parse($env:HARNAIS_RESUME_AT))",
  "$settings = New-ScheduledTaskSettingsSet -StartWhenAvailable",
  "Register-ScheduledTask -TaskName $env:HARNAIS_TASK_NAME -Action $action -Trigger $trigger -Settings $settings -Force | Out-Null",
  "Write-Output 'task-registered-ok'",
].join("; ");

function readStdin() {
  return new Promise((resolve) => {
    let data = "";
    process.stdin.setEncoding("utf8");
    process.stdin.on("data", (chunk) => (data += chunk));
    process.stdin.on("end", () => resolve(data));
    process.stdin.on("error", () => resolve(""));
  });
}

function loadJson(file) {
  try {
    return JSON.parse(fs.readFileSync(file, "utf8"));
  } catch (e) {
    return null;
  }
}

function toEpochMs(value) {
  const n = Number(value);
  if (!n || !isFinite(n)) return null;
  return n < 1e12 ? n * 1000 : n;
}

// Nom de tâche stable par session : re-déclencher le hook (retry de prompt
// après coupure) remplace la tâche (-Force) au lieu d'en empiler.
function taskNameFor(sessionId) {
  return `HarnaisResume_${String(sessionId).replace(/[^a-zA-Z0-9-]/g, "").slice(0, 8) || "inconnu"}`;
}

// Heure de réinitialisation : snapshot d'abord, sinon epoch dans error_details.
function findResetMs(projectDir, errorDetails, now) {
  const snapshot = loadJson(path.join(projectDir, ".claude", "statusline-snapshot.json"));
  const fromSnapshot = snapshot && snapshot.five_hour ? toEpochMs(snapshot.five_hour.resets_at) : null;
  if (fromSnapshot && fromSnapshot > now) return fromSnapshot;
  const m = /\b(\d{10})\b/.exec(errorDetails || "");
  if (m) {
    const fromDetails = toEpochMs(m[1]);
    if (fromDetails && fromDetails > now) return fromDetails;
  }
  return null;
}

function formatTime(ms) {
  const d = new Date(ms);
  return `${String(d.getHours()).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")}`;
}

function appendRawCheckpoint(projectDir, payload) {
  let tail = "(transcript introuvable ou illisible)";
  if (payload.transcript_path) {
    try {
      const lines = fs.readFileSync(payload.transcript_path, "utf8").split("\n").filter(Boolean);
      tail = lines.slice(-TAIL_LINES).join("\n");
    } catch (e) {
      // Un transcript illisible ne doit pas empêcher le reste du sauvetage.
    }
  }
  const entry =
    `\n## Coupure crédits — ${new Date().toISOString()} (erreur: ${payload.error || "inconnue"})\n` +
    `- Session : ${payload.session_id || "inconnue"}\n` +
    (payload.error_details ? `- Détail : ${payload.error_details}\n` : "") +
    (payload.last_assistant_message
      ? `- Dernier message assistant :\n\n> ${String(payload.last_assistant_message).split("\n").join("\n> ")}\n`
      : "") +
    "\n```\n" +
    tail +
    "\n```\n";
  try {
    fs.appendFileSync(path.join(projectDir, ".claude", "session-log.md"), entry, "utf8");
    return true;
  } catch (e) {
    return false;
  }
}

function scheduleResume(projectDir, sessionId, resumeAtMs) {
  const env = {
    ...process.env,
    HARNAIS_TASK_NAME: taskNameFor(sessionId),
    HARNAIS_RESUME_AT: new Date(resumeAtMs).toISOString(),
    HARNAIS_NODE: process.execPath,
    HARNAIS_SCRIPT: path.join(__dirname, "resume-after-reset.js"),
    HARNAIS_SESSION_ID: String(sessionId),
    HARNAIS_PROJECT_DIR: projectDir,
  };
  if (process.env.WATCHDOG_DRY_RUN === "1") {
    // Sortie pour les assertions de test — le stdout d'un hook StopFailure
    // est ignoré par Claude Code, on ne pollue rien en réel.
    process.stdout.write(
      JSON.stringify({
        dryRun: true,
        wouldSchedule: {
          taskName: env.HARNAIS_TASK_NAME,
          resumeAt: env.HARNAIS_RESUME_AT,
          script: env.HARNAIS_SCRIPT,
          sessionId: env.HARNAIS_SESSION_ID,
          projectDir: env.HARNAIS_PROJECT_DIR,
        },
      })
    );
    return true;
  }
  try {
    const res = spawnSync("powershell.exe", ["-NoProfile", "-NonInteractive", "-Command", SCHEDULE_PS], {
      env,
      encoding: "utf8",
      windowsHide: true,
      timeout: SCHEDULE_TIMEOUT_MS,
      stdio: ["ignore", "pipe", "ignore"],
    });
    return res.status === 0 && (res.stdout || "").includes("task-registered-ok");
  } catch (e) {
    return false;
  }
}

async function main() {
  const raw = await readStdin();
  if (process.platform !== "win32") process.exit(0);

  try {
    let payload = {};
    try {
      payload = JSON.parse(raw || "{}");
    } catch (e) {
      payload = {};
    }

    if (!CREDIT_ERRORS.has(payload.error)) process.exit(0);

    const projectDir = process.env.CLAUDE_PROJECT_DIR || process.cwd();
    const projectName = path.basename(payload.cwd || projectDir) || "Claude Code";
    const sessionId = payload.session_id || "";
    const now = Date.now();

    appendRawCheckpoint(projectDir, payload);

    const resetMs = sessionId ? findResetMs(projectDir, payload.error_details, now) : null;
    let scheduled = false;
    let resumeAtMs = null;
    if (resetMs) {
      resumeAtMs = resetMs + RESUME_DELAY_MS;
      scheduled = scheduleResume(projectDir, sessionId, resumeAtMs);
    }

    showToast(
      `${projectName} — crédits épuisés`,
      scheduled
        ? `État sauvegardé. Reprise proposée à ${formatTime(resumeAtMs)} (terminal ouvert automatiquement).`
        : `État sauvegardé dans session-log.md. Heure de réinitialisation inconnue — reprise manuelle : claude --resume`
    );
    process.exit(0);
  } catch (e) {
    process.exit(0); // Le sauvetage est best-effort : jamais d'échec bloquant.
  }
}

main();
