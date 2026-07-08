#!/usr/bin/env node
/**
 * Lancé par la tâche planifiée créée par credit-watchdog.js, à l'heure de
 * réinitialisation des crédits + 1 min. Trois actions :
 *
 *   1. Toast « crédits réinitialisés ».
 *   2. Ouvre un terminal dans le projet avec `claude --resume <session>` déjà
 *      lancé — si le transcript de la session n'existe plus (purgé), ouvre
 *      `claude` simple : SESSION.md injecté au démarrage assure la continuité.
 *      C'est volontairement une fenêtre INTERACTIVE, pas un `claude -p`
 *      headless : l'utilisateur valide la poursuite du travail, aucun crédit
 *      n'est consommé sans lui (choix explicite, voir SOURCES.md V1.7).
 *   3. Supprime sa propre tâche planifiée (one-shot, pas de résidu).
 *
 * Usage : node resume-after-reset.js <sessionId> <projectDir>
 * Best-effort intégral : chaque étape est indépendante, exit 0 toujours.
 */

const fs = require("fs");
const os = require("os");
const path = require("path");
const { spawnSync } = require("child_process");
const { showToast } = require("./lib/toast");

// Ouverture du terminal via Start-Process (données variables en variables
// d'environnement, motif anti-injection du socle) plutôt que `cmd /c start` :
// `start` traite son premier argument comme un TITRE seulement s'il est entre
// guillemets — Node ne quote que les arguments contenant des espaces, donc un
// titre simple passait pour le programme à lancer et rien ne s'ouvrait
// (constaté au test live du 2026-07-08). cmd /k garde la fenêtre ouverte
// après la fin de claude : l'utilisateur voit une éventuelle erreur au lieu
// d'un flash.
const OPEN_TERMINAL_PS = [
  "$ErrorActionPreference = 'Stop'",
  "Start-Process -FilePath 'cmd.exe' -ArgumentList '/k', $env:HARNAIS_CLAUDE_CMD -WorkingDirectory $env:HARNAIS_PROJECT_DIR",
  "Write-Output 'terminal-opened-ok'",
].join("; ");

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
      JSON.stringify({ dryRun: true, wouldOpen: { claudeArgs, projectDir }, wouldDeleteTask: taskNameFor(sessionId) })
    );
    process.exit(0);
  }

  showToast(
    `${projectName} — crédits réinitialisés`,
    canResume
      ? "Un terminal s'ouvre avec la session reprise — à toi de valider la poursuite."
      : "Session d'origine introuvable — un terminal s'ouvre sur une session neuve (SESSION.md fait la continuité)."
  );

  try {
    spawnSync("powershell.exe", ["-NoProfile", "-NonInteractive", "-Command", OPEN_TERMINAL_PS], {
      env: {
        ...process.env,
        HARNAIS_CLAUDE_CMD: ["claude", ...claudeArgs].join(" "),
        HARNAIS_PROJECT_DIR: projectDir,
      },
      encoding: "utf8",
      windowsHide: true,
      timeout: 30000,
      stdio: ["ignore", "pipe", "ignore"],
    });
  } catch (e) {
    // Sans terminal, le toast a déjà donné l'information essentielle.
  }

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
