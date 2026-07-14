#!/usr/bin/env node
/**
 * Hooks PostToolUse / Stop / PostCompact — arrêt DUR (bloquant), remplace la
 * fonction d'auto-compact native désormais désactivée (autoCompactEnabled:
 * false, voir settings.json). Vérifie le snapshot statusline après CHAQUE
 * outil (pas seulement à l'envoi d'un message — contrairement à
 * context-watchdog.js, qui reste un simple rappel doux à 70%, jamais
 * bloquant) :
 *
 *   - Contexte ≥ 85% : bloque tout nouvel outil sauf Read (n'importe quel
 *     fichier) et Write/Edit sur SESSION.md / .claude/session-log.md, pour
 *     forcer le checkpoint puis l'arrêt de la session par l'utilisateur.
 *     Jamais réarmé seul : seul un /compact manuel (event PostCompact,
 *     encore possible même auto-compact désactivé) ou une nouvelle session
 *     repart propre.
 *   - Crédits 5h ≥ 95% : même blocage, MAIS borné dans le temps plutôt que
 *     permanent — puisque `claude --resume` continue le MÊME session_id,
 *     l'entrée d'état est partagée entre la session bloquée et sa reprise
 *     automatique. Le blocage crédits reste actif tant que l'heure de
 *     réinitialisation planifiée (autoResumeUnblockAt) n'est pas atteinte ;
 *     une fois franchie (la reprise programmée par
 *     lib/resume-scheduler.js/resume-after-reset.js a démarré, ou l'utilisateur
 *     a continué la même session après l'heure), le blocage crédits se lève
 *     de lui-même et la session peut travailler — mais seulement jusqu'au
 *     plafond anti-emballement (autoResumeActionCount vs
 *     .claude/watchdog-config.json, défaut 30) ou jusqu'à ce que le contexte
 *     remonte lui-même à ≥85%, qui forcent alors le blocage permanent
 *     (contextHardStop) comme n'importe quel arrêt dur contexte.
 *
 * Blocage : process.exit(2) + stderr, même mécanisme que
 * guard-dangerous-commands.js. Limite assumée : PostToolUse s'exécute APRÈS
 * l'outil — il ne peut pas empêcher celui qui vient de déclencher le
 * franchissement du seuil, seulement contraindre le suivant. C'est le
 * compromis du choix PostToolUse (seul event qui se déclenche après chaque
 * outil, pas seulement à l'envoi d'un message) plutôt que PreToolUse.
 *
 * Event Stop : si un épisode de reprise automatique était en cours
 * (autoResumeActive), le considère terminé (fin normale ou arrêt forcé) et
 * remet à zéro TOUT l'état crédits (creditHardStop, creditResumeScheduled,
 * autoResumeUnblockAt, autoResumeActive, autoResumeActionCount) — un nouveau
 * franchissement à 95% (prochaine fenêtre 5h) repartira propre. Ce flag n'est
 * JAMAIS posé en usage interactif classique : aucune ambiguïté possible avec
 * une session normale qui termine simplement son tour.
 *
 * Event PostCompact : un /compact manuel fait baisser le contexte -> réarme
 * contextHardStop uniquement (pas les flags crédits, sans rapport).
 *
 * Jamais bloquant sur erreur interne (payload illisible, snapshot absent,
 * état corrompu) : fail-open, comme tous les autres watchdogs de ce socle.
 */

const fs = require("fs");
const path = require("path");
const { scheduleResume, resolveClaudeBin, toEpochMs } = require("./lib/resume-scheduler");

const CONTEXT_HARD_STOP_PCT = 85;
const CREDIT_HARD_STOP_PCT = 95;
const SNAPSHOT_MAX_AGE_MS = 5 * 60 * 1000;
const STATE_TTL_MS = 24 * 60 * 60 * 1000;
const RESUME_DELAY_MS = 60 * 1000;
const DEFAULT_MAX_ACTIONS = 30;

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

function saveState(stateFile, state) {
  const tmp = `${stateFile}.tmp-${process.pid}`;
  fs.mkdirSync(path.dirname(stateFile), { recursive: true });
  fs.writeFileSync(tmp, JSON.stringify(state));
  fs.renameSync(tmp, stateFile);
}

function pruneStale(state, now) {
  for (const [id, entry] of Object.entries(state)) {
    if (!entry || !entry.ts || now - entry.ts > STATE_TTL_MS) delete state[id];
  }
  return state;
}

function loadMaxActions(projectDir) {
  const cfg = loadJson(path.join(projectDir, ".claude", "watchdog-config.json"));
  return cfg && typeof cfg.autoResumeMaxActions === "number" ? cfg.autoResumeMaxActions : DEFAULT_MAX_ACTIONS;
}

// Whitelist active pendant un arrêt dur : tout Read, plus Write/Edit
// spécifiquement sur SESSION.md ou .claude/session-log.md (comparaison de
// chemin résolue, insensible à la casse — Windows).
function isWhitelisted(toolName, toolInput, projectDir) {
  if (toolName === "Read") return true;
  if (toolName === "Write" || toolName === "Edit") {
    const raw = (toolInput && toolInput.file_path) || "";
    if (!raw) return false;
    const abs = path.resolve(projectDir, raw).toLowerCase();
    const checkpointFiles = ["SESSION.md", path.join(".claude", "session-log.md")];
    return checkpointFiles.some((f) => abs === path.resolve(projectDir, f).toLowerCase());
  }
  return false;
}

function blockMessage(reason) {
  return (
    `[hard-stop-guard] ARRÊT DUR ACTIF (${reason}).\n` +
    `Seuls Read (n'importe quel fichier) et Write/Edit sur SESSION.md ou ` +
    `.claude/session-log.md restent autorisés. Termine IMMÉDIATEMENT le ` +
    `checkpoint (ce qui a été fait, où tu t'es arrêté précisément) dans ces ` +
    `deux fichiers, puis dis à l'utilisateur de fermer cette session et d'en ` +
    `ouvrir une nouvelle (ou /clear). N'utilise plus aucun autre outil.\n`
  );
}

async function main() {
  let payload = {};
  try {
    payload = JSON.parse((await readStdin()) || "{}");
  } catch (e) {
    payload = {};
  }

  try {
    const event = process.argv[2] || payload.hook_event_name || "";
    const projectDir = process.env.CLAUDE_PROJECT_DIR || process.cwd();
    const sessionId = payload.session_id || "sans-session";
    const stateFile = path.join(projectDir, ".claude", "watchdog-state.json");
    const now = Date.now();
    const state = pruneStale(loadJson(stateFile) || {}, now);
    const entry = state[sessionId] || {};

    if (event === "PostCompact") {
      if (entry.contextHardStop) {
        delete entry.contextHardStop;
        entry.ts = now;
        state[sessionId] = entry;
        saveState(stateFile, state);
      }
      process.exit(0);
    }

    if (event === "Stop") {
      if (entry.autoResumeActive) {
        delete entry.autoResumeActive;
        delete entry.autoResumeActionCount;
        delete entry.creditHardStop;
        delete entry.creditResumeScheduled;
        delete entry.autoResumeUnblockAt;
        entry.ts = now;
        state[sessionId] = entry;
        saveState(stateFile, state);
      }
      process.exit(0);
    }

    if (event !== "PostToolUse") process.exit(0);

    const snapshot = loadJson(path.join(projectDir, ".claude", "statusline-snapshot.json"));
    const snapshotValid =
      snapshot &&
      snapshot.session_id === payload.session_id &&
      typeof snapshot.ts === "number" &&
      now - snapshot.ts < SNAPSHOT_MAX_AGE_MS;

    let changed = false;
    let forcedReason = null;

    if (snapshotValid) {
      const ctx = snapshot.context_used_percentage;
      if (typeof ctx === "number" && ctx >= CONTEXT_HARD_STOP_PCT && !entry.contextHardStop) {
        entry.contextHardStop = true;
        changed = true;
      }

      const fiveHour = snapshot.five_hour;
      if (
        fiveHour &&
        typeof fiveHour.used_percentage === "number" &&
        fiveHour.used_percentage >= CREDIT_HARD_STOP_PCT &&
        !entry.creditHardStop
      ) {
        entry.creditHardStop = true;
        changed = true;

        if (!entry.creditResumeScheduled && sessionId !== "sans-session") {
          const resetMs = toEpochMs(fiveHour.resets_at);
          if (resetMs && resetMs > now) {
            const resumeAtMs = resetMs + RESUME_DELAY_MS;
            const scheduled = scheduleResume(projectDir, sessionId, resumeAtMs, resolveClaudeBin());
            if (scheduled) {
              entry.creditResumeScheduled = true;
              entry.autoResumeUnblockAt = resumeAtMs;
            }
          }
        }
      }
    }

    // Phase "reprise" : l'heure planifiée est franchie -> le blocage crédits
    // se lève de lui-même (voir en-tête) et le plafond anti-emballement prend
    // le relais comme unique garde-fou.
    const inResumeWindow =
      entry.creditHardStop && typeof entry.autoResumeUnblockAt === "number" && now >= entry.autoResumeUnblockAt;

    if (inResumeWindow) {
      if (!entry.autoResumeActive) {
        entry.autoResumeActive = true;
        entry.autoResumeActionCount = 0;
      }
      entry.autoResumeActionCount += 1;
      changed = true;
      const cap = loadMaxActions(projectDir);
      if (entry.autoResumeActionCount > cap && !entry.contextHardStop) {
        entry.contextHardStop = true;
        forcedReason = `plafond de reprise automatique atteint (${cap} actions)`;
      }
    }

    if (changed) {
      entry.ts = now;
      state[sessionId] = entry;
      saveState(stateFile, state);
    }

    // Le blocage crédits ne s'applique que hors fenêtre de reprise : posé
    // mais pas encore l'heure (attente du reset), ou posé sans heure fiable
    // (pas de creditResumeScheduled) -> reste bloquant indéfiniment, comme le
    // repli existant de credit-watchdog.js (pas de planification à l'aveugle).
    const creditBlocking = entry.creditHardStop && !inResumeWindow;
    const hardStopActive = entry.contextHardStop || creditBlocking;
    if (!hardStopActive) process.exit(0);

    const toolName = payload.tool_name || "";
    const toolInput = payload.tool_input || {};
    if (isWhitelisted(toolName, toolInput, projectDir)) process.exit(0);

    const reason =
      forcedReason ||
      (entry.contextHardStop && creditBlocking
        ? "contexte ≥85% et crédits 5h ≥95%"
        : entry.contextHardStop
        ? "contexte ≥85%"
        : "crédits 5h ≥95%");

    process.stderr.write(blockMessage(reason));
    process.exit(2);
  } catch (e) {
    process.exit(0); // Jamais bloquant sur erreur interne : fail-open comme les autres watchdogs.
  }
}

main();
