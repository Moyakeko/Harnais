#!/usr/bin/env node
/**
 * Lancé par la tâche planifiée créée par credit-watchdog.js, à l'heure de
 * réinitialisation des crédits + 1 min. Deux actions :
 *
 *   1. Toast « crédits réinitialisés — reprends avec claude --resume <session> ».
 *      Ouvrir automatiquement un terminal a été essayé puis désactivé sur
 *      demande explicite de l'utilisateur (2026-07-09) : il préfère lancer la
 *      reprise lui-même plutôt que de voir une fenêtre s'ouvrir toute seule.
 *      Le choix de rester semi-automatique (pas de reprise headless
 *      `claude -p`) tient toujours : c'est l'humain qui relance, à sa main,
 *      dans son propre terminal — voir SOURCES.md V1.7.
 *   2. Supprime sa propre tâche planifiée (one-shot, pas de résidu).
 *
 * Usage : node resume-after-reset.js <sessionId> <projectDir>
 * Best-effort intégral : chaque étape est indépendante, exit 0 toujours.
 */

const fs = require("fs");
const os = require("os");
const path = require("path");
const { spawnSync } = require("child_process");
const { showToast } = require("./lib/toast");

// Même dérivation que credit-watchdog.js — les deux doivent produire le même
// nom pour que la tâche puisse se supprimer elle-même.
function taskNameFor(sessionId) {
  return `HarnaisResume_${String(sessionId).replace(/[^a-zA-Z0-9-]/g, "").slice(0, 8) || "inconnu"}`;
}

// Les transcripts vivent dans ~/.claude/projects/<chemin-projet-aplati>/<session>.jsonl,
// où le chemin est aplati en remplaçant tout caractère non alphanumérique par
// un tiret (constaté sur cette machine, ex: C--Users-hp-Desktop-...).
function transcriptExists(sessionId, projectDir) {
  try {
    const flat = projectDir.replace(/[^a-zA-Z0-9]/g, "-");
    return fs.existsSync(path.join(os.homedir(), ".claude", "projects", flat, `${sessionId}.jsonl`));
  } catch (e) {
    return false;
  }
}

function main() {
  // Assaini par précaution : le session id finit dans une ligne de commande
  // cmd /k — même s'il vient de notre propre tâche planifiée, on ne laisse
  // passer que l'alphabet d'un UUID.
  const sessionId = (process.argv[2] || "").replace(/[^0-9a-zA-Z-]/g, "");
  const projectDir = process.argv[3] || process.cwd();
  const projectName = path.basename(projectDir) || "Claude Code";
  const canResume = sessionId && transcriptExists(sessionId, projectDir);
  const claudeArgs = canResume ? ["--resume", sessionId] : [];

  if (process.env.WATCHDOG_DRY_RUN === "1") {
    process.stdout.write(
      JSON.stringify({ dryRun: true, claudeArgs, projectDir, wouldDeleteTask: taskNameFor(sessionId) })
    );
    process.exit(0);
  }

  showToast(
    `${projectName} — crédits réinitialisés`,
    canResume
      ? `Reprends avec : claude --resume ${sessionId}`
      : "Session d'origine introuvable — SESSION.md fait la continuité au prochain démarrage."
  );

  try {
    spawnSync("schtasks.exe", ["/delete", "/tn", taskNameFor(sessionId), "/f"], {
      windowsHide: true,
      timeout: 15000,
      stdio: "ignore",
    });
  } catch (e) {
    // Une tâche résiduelle est sans effet (déclencheur one-shot passé).
  }
  process.exit(0);
}

main();
