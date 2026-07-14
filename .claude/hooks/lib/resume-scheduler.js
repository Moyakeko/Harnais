/**
 * lib/resume-scheduler.js — planification de la reprise après réinitialisation
 * des crédits, extrait de credit-watchdog.js (V1.7) quand un deuxième
 * consommateur est apparu (hard-stop-guard.js, arrêt dur proactif à 95%,
 * V1.9) : les deux déclencheurs (réactif StopFailure, proactif seuil 95%)
 * doivent produire exactement le même comportement de planification — un seul
 * endroit à tester/maintenir plutôt qu'un copier-coller.
 *
 * Register-ScheduledTask (pas schtasks.exe) : seul le cmdlet expose
 * -StartWhenAvailable, qui rattrape un PC en veille à l'heure dite. Toutes
 * les données variables (nom de tâche, heure, chemins, session id, binaire
 * claude) passent par variables d'environnement, jamais concaténées dans le
 * script PowerShell : même motif anti-injection que lib/toast.js.
 */

const fs = require("fs");
const path = require("path");
const { spawnSync } = require("child_process");

const SCHEDULE_TIMEOUT_MS = 30000;

const SCHEDULE_PS = [
  "$ErrorActionPreference = 'Stop'",
  "$action = New-ScheduledTaskAction -Execute $env:HARNAIS_NODE -Argument ('\"{0}\" \"{1}\" \"{2}\" \"{3}\"' -f $env:HARNAIS_SCRIPT, $env:HARNAIS_SESSION_ID, $env:HARNAIS_PROJECT_DIR, $env:HARNAIS_CLAUDE_BIN) -WorkingDirectory $env:HARNAIS_PROJECT_DIR",
  "$trigger = New-ScheduledTaskTrigger -Once -At ([datetime]::Parse($env:HARNAIS_RESUME_AT))",
  "$settings = New-ScheduledTaskSettingsSet -StartWhenAvailable",
  "Register-ScheduledTask -TaskName $env:HARNAIS_TASK_NAME -Action $action -Trigger $trigger -Settings $settings -Force | Out-Null",
  "Write-Output 'task-registered-ok'",
].join("; ");

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

// Nom de tâche stable par session : un re-déclenchement (retry après coupure,
// ou proactif suivi d'un réactif) remplace la tâche (-Force) au lieu d'en
// empiler.
function taskNameFor(sessionId) {
  return `HarnaisResume_${String(sessionId).replace(/[^a-zA-Z0-9-]/g, "").slice(0, 8) || "inconnu"}`;
}

// Heure de réinitialisation : snapshot d'abord, sinon epoch dans error_details
// (format historique des messages de limite « …|1751986800 »).
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

// claudeBinPath : résolu une fois par l'appelant (une tâche planifiée ne porte
// pas l'environnement de la session courante, seul un argument figé traverse
// jusqu'à l'exécution différée).
function scheduleResume(projectDir, sessionId, resumeAtMs, claudeBinPath) {
  const env = {
    ...process.env,
    HARNAIS_TASK_NAME: taskNameFor(sessionId),
    HARNAIS_RESUME_AT: new Date(resumeAtMs).toISOString(),
    HARNAIS_NODE: process.execPath,
    HARNAIS_SCRIPT: path.join(__dirname, "..", "resume-after-reset.js"),
    HARNAIS_SESSION_ID: String(sessionId),
    HARNAIS_PROJECT_DIR: projectDir,
    HARNAIS_CLAUDE_BIN: claudeBinPath || "claude",
  };
  if (process.env.WATCHDOG_DRY_RUN === "1") {
    // Sortie pour les assertions de test — le stdout d'un hook StopFailure ou
    // PostToolUse est ignoré par Claude Code, on ne pollue rien en réel.
    process.stdout.write(
      JSON.stringify({
        dryRun: true,
        wouldSchedule: {
          taskName: env.HARNAIS_TASK_NAME,
          resumeAt: env.HARNAIS_RESUME_AT,
          script: env.HARNAIS_SCRIPT,
          sessionId: env.HARNAIS_SESSION_ID,
          projectDir: env.HARNAIS_PROJECT_DIR,
          claudeBin: env.HARNAIS_CLAUDE_BIN,
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

// Résout le chemin du binaire claude une seule fois, au moment de planifier
// (une tâche planifiée ne porte pas le PATH de la session courante). Best
// effort : à défaut, on transmet le nom nu "claude" et on compte sur le PATH
// système au moment de l'exécution différée.
function resolveClaudeBin() {
  if (process.env.WATCHDOG_DRY_RUN === "1") return "claude";
  try {
    const res = spawnSync("where", ["claude"], { encoding: "utf8", windowsHide: true, timeout: 5000 });
    if (res.status === 0 && res.stdout) {
      const first = res.stdout.split(/\r?\n/).map((s) => s.trim()).filter(Boolean)[0];
      if (first) return first;
    }
  } catch (e) {
    // ignore, repli ci-dessous
  }
  return "claude";
}

module.exports = { taskNameFor, findResetMs, formatTime, scheduleResume, resolveClaudeBin, toEpochMs };
