#!/usr/bin/env node
/**
 * Lancé par la tâche planifiée créée par credit-watchdog.js (réactif) ou
 * hard-stop-guard.js (proactif, seuil 95%), à l'heure de réinitialisation des
 * crédits + 1 min. Reprise AUTOMATIQUE supervisée (choix explicitement inversé
 * par l'utilisateur par rapport au comportement purement semi-automatique
 * retenu jusqu'ici — voir SOURCES.md) :
 *
 *   1. Si le transcript d'origine existe : extrait la section
 *      "## En cours / bloqué" de SESSION.md (écrite par le checkpoint forcé
 *      qui a précédé l'arrêt dur) pour construire une instruction de
 *      continuation, l'écrit dans un fichier temporaire (évite l'échappement
 *      à travers deux niveaux de shell), puis ouvre un terminal VISIBLE
 *      (Start-Process — jamais `cmd start`, piège déjà rencontré et corrigé
 *      par le passé) exécutant `claude --resume <session> <instruction>` :
 *      aucune action manuelle requise, l'utilisateur voit Claude reprendre le
 *      travail directement. L'instruction borne explicitement la reprise à la
 *      tâche en cours, rien d'autre.
 *   2. Toast récapitulatif.
 *   3. Supprime sa propre tâche planifiée (one-shot, pas de résidu).
 *
 * Le plafond anti-emballement (nombre d'actions, ou contexte remontant à 85%)
 * est appliqué par hard-stop-guard.js une fois la session reprise (champ
 * autoResumeActive/autoResumeActionCount de watchdog-state.json) — ce script
 * ne fait que lancer la reprise, pas la superviser après coup.
 *
 * Usage : node resume-after-reset.js <sessionId> <projectDir> <claudeBinPath>
 * Best-effort intégral : chaque étape est indépendante, exit 0 toujours.
 *
 * Point non vérifié empiriquement (à valider avant de considérer ce mécanisme
 * acquis, voir SESSION.md) : que `claude --resume <id> "texte"` accepte bien
 * un argument positionnel comme premier message en mode interactif après
 * reprise.
 */

const fs = require("fs");
const os = require("os");
const path = require("path");
const { spawnSync } = require("child_process");
const { showToast } = require("./lib/toast");

const LAUNCH_TIMEOUT_MS = 15000;

// Même dérivation que lib/resume-scheduler.js — les deux doivent produire le
// même nom pour que la tâche puisse se supprimer elle-même.
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

// Repli générique si SESSION.md est absent ou si sa section "En cours /
// bloqué" est vide (le checkpoint forcé n'a pas eu le temps d'être précis).
const FALLBACK_INSTRUCTION =
  "Lis SESSION.md et .claude/session-log.md pour retrouver le fil, identifie " +
  "la dernière tâche interrompue par l'arrêt dur, puis continue UNIQUEMENT " +
  "cette tâche jusqu'à sa fin. N'entreprends rien d'autre. Une fois terminée, " +
  "arrête-toi et attends l'utilisateur.";

// Assaini pour la traversée fragile fichier -> PowerShell -> argv natif : un
// guillemet droit (") embarqué dans l'instruction a cassé le parsing des
// arguments côté claude.exe lors du premier test réel (2026-07-14) — le
// message s'est retrouvé tronqué en plein milieu. Remplacé par des guillemets
// français, sans signification spéciale pour CreateProcess.
function sanitizeForNativeArg(text) {
  return text.replace(/"/g, "«").replace(/`/g, "'");
}

function extractCurrentTask(projectDir) {
  try {
    const content = fs.readFileSync(path.join(projectDir, "SESSION.md"), "utf8");
    const m = /## En cours \/ bloqu[ée]\s*\n([\s\S]*?)(?=\n## |\s*$)/i.exec(content);
    const section = m && m[1] ? m[1].trim() : "";
    if (!section || /^rien de bloquant\.?$/i.test(section)) return null;
    return sanitizeForNativeArg(
      `Continue EXACTEMENT la tâche en cours documentée dans SESSION.md ` +
        `(section En cours / bloqué), rien d'autre :\n\n${section}\n\n` +
        `Une fois cette tâche précise terminée, arrête-toi et attends l'utilisateur.`
    );
  } catch (e) {
    return null;
  }
}

function writeInstructionFile(projectDir, sessionId, instruction) {
  const file = path.join(
    projectDir,
    ".claude",
    `.resume-instruction-${String(sessionId).replace(/[^a-zA-Z0-9-]/g, "").slice(0, 8) || "inconnu"}.txt`
  );
  fs.writeFileSync(file, instruction, "utf8");
  return file;
}

// Toutes les données variables (chemins, session id, binaire claude) passent
// par variables d'environnement, jamais concaténées dans le script — même
// motif anti-injection que lib/toast.js et lib/resume-scheduler.js. Le format
// -f évite l'échappement manuel de guillemets imbriqués.
//
// [System.IO.File]::ReadAllText(..., UTF8) plutôt que Get-Content -Raw : sans
// encodage explicite, Get-Content devine (souvent l'ANSI système sur Windows
// PowerShell 5.1 pour un fichier sans BOM) — confirmé par mojibake réel lors
// du premier test (2026-07-14, "tâche" devenu "tÃ¢che").
const RESUME_LAUNCH_PS = [
  "$ErrorActionPreference = 'Stop'",
  "$innerTemplate = '$instruction = [System.IO.File]::ReadAllText(''{0}'', [System.Text.Encoding]::UTF8); & ''{1}'' --resume {2} $instruction'",
  "$inner = $innerTemplate -f $env:HARNAIS_INSTRUCTION_FILE, $env:HARNAIS_CLAUDE_BIN, $env:HARNAIS_SESSION_ID",
  "Start-Process -FilePath 'powershell.exe' -ArgumentList @('-NoExit','-Command',$inner) -WorkingDirectory $env:HARNAIS_PROJECT_DIR",
  "Write-Output 'resume-terminal-opened-ok'",
].join("; ");

function launchResumeTerminal(projectDir, sessionId, claudeBinPath, instructionFile) {
  const env = {
    ...process.env,
    HARNAIS_INSTRUCTION_FILE: instructionFile,
    HARNAIS_CLAUDE_BIN: claudeBinPath,
    HARNAIS_SESSION_ID: String(sessionId),
    HARNAIS_PROJECT_DIR: projectDir,
  };
  try {
    const res = spawnSync("powershell.exe", ["-NoProfile", "-NonInteractive", "-Command", RESUME_LAUNCH_PS], {
      env,
      encoding: "utf8",
      windowsHide: true,
      timeout: LAUNCH_TIMEOUT_MS,
      stdio: ["ignore", "pipe", "ignore"],
    });
    return res.status === 0 && (res.stdout || "").includes("resume-terminal-opened-ok");
  } catch (e) {
    return false;
  }
}

function main() {
  // Assaini par précaution : le session id finit dans une commande PowerShell
  // — même s'il vient de notre propre tâche planifiée, on ne laisse passer
  // que l'alphabet d'un UUID.
  const sessionId = (process.argv[2] || "").replace(/[^0-9a-zA-Z-]/g, "");
  const projectDir = process.argv[3] || process.cwd();
  const claudeBinPath = process.argv[4] || "claude";
  const projectName = path.basename(projectDir) || "Claude Code";
  const canResume = sessionId && transcriptExists(sessionId, projectDir);

  let instructionFile = null;
  let instructionPreview = null;
  let launched = false;

  if (canResume) {
    const instruction = extractCurrentTask(projectDir) || sanitizeForNativeArg(FALLBACK_INSTRUCTION);
    instructionPreview = instruction.slice(0, 400);

    if (process.env.WATCHDOG_DRY_RUN === "1") {
      process.stdout.write(
        JSON.stringify({
          dryRun: true,
          canResume,
          claudeBinPath,
          sessionId,
          instructionPreview,
          wouldDeleteTask: taskNameFor(sessionId),
        })
      );
      process.exit(0);
    }

    instructionFile = writeInstructionFile(projectDir, sessionId, instruction);
    launched = launchResumeTerminal(projectDir, sessionId, claudeBinPath, instructionFile);
  } else if (process.env.WATCHDOG_DRY_RUN === "1") {
    process.stdout.write(
      JSON.stringify({ dryRun: true, canResume, claudeArgs: [], wouldDeleteTask: taskNameFor(sessionId) })
    );
    process.exit(0);
  }

  showToast(
    `${projectName} — crédits réinitialisés`,
    canResume
      ? launched
        ? `Reprise automatique lancée dans un nouveau terminal (claude --resume ${sessionId}).`
        : `Échec d'ouverture du terminal automatique — reprends toi-même : claude --resume ${sessionId}`
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
