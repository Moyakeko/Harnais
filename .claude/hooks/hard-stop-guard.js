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
 *
 * V1.11 — snapshot périmé (>SNAPSHOT_MAX_AGE_MS, ou d'une autre session) :
 * avant cette version, ce cas sautait SILENCIEUSEMENT toute détection —
 * indiscernable d'un cas réellement sain, y compris quand les crédits/le
 * contexte réels continuaient de grimper pendant une longue rafale d'outils
 * sans rafraîchissement de la statusline (hors contrôle du socle). Désormais :
 * la dernière valeur connue est mémorisée à chaque snapshot frais ; si le
 * snapshot devient périmé alors que cette dernière valeur était déjà en zone
 * de vigilance (≥75% contexte ou ≥80% crédits), un avertissement est émis
 * après STALE_STREAK_WARN appels consécutifs sans nouveau relevé, puis un
 * arrêt dur conservateur après STALE_STREAK_CAP (réutilise le mécanisme
 * forcedReason déjà existant pour le plafond anti-emballement). Sans base
 * "en zone de vigilance", aucune escalade sur la seule staleness — une
 * session simplement peu active ne doit pas être punie.
 *
 * V1.14 — agents en arrière-plan invisibles à ce hook : la détection de seuil
 * exige que le snapshot statusline corresponde au session_id courant
 * (sameSessionSnapshot) — un agent lancé en tâche de fond (Agent tool) n'a
 * pas de statusline propre, donc ses propres appels d'outils tombent
 * systématiquement dans la branche "périmé" sans jamais accumuler de valeur
 * connue : il ne peut PAS s'auto-arrêter via ce mécanisme, même si le seuil
 * réel est dépassé. Constaté en conditions réelles : la session principale
 * s'arrête proprement, mais des agents lancés plus tôt continuent jusqu'à
 * être coupés par le vrai épuisement de crédits, sans sauvegarde. Correctif
 * côté orchestration plutôt que télémétrie par agent (les crédits sont un
 * compteur de compte/fenêtre, pas par agent) : la whitelist inclut désormais
 * ListAgents/SendMessage/TaskStop, et blockMessage() donne à la session
 * principale la séquence à suivre — prévenir chaque agent encore actif
 * (SendMessage, lui demander de sauvegarder immédiatement), finir son propre
 * checkpoint (le temps pris sert de fenêtre de réaction), puis TaskStop
 * chacun en filet de sécurité. Reste du best-effort assumé : un agent en
 * plein milieu d'un unique appel d'outil au moment du TaskStop perd ce qui
 * n'est pas encore écrit — strictement mieux que la coupure actuelle par le
 * vrai quota (aucune chance de sauvegarde), pas une garantie à 100%. Seuil
 * crédits remonté de 90% à 95% en même temps, pour se garder une marge
 * dédiée à cette séquence plutôt que d'attendre le mur des 100%.
 */

const fs = require("fs");
const path = require("path");
const { scheduleResume, resolveClaudeBin, toEpochMs } = require("./lib/resume-scheduler");
const { logMetric } = require("./lib/metrics");

const CONTEXT_HARD_STOP_PCT = 85;
const CREDIT_HARD_STOP_PCT = 95;
const SNAPSHOT_MAX_AGE_MS = 5 * 60 * 1000;
const STATE_TTL_MS = 24 * 60 * 60 * 1000;
const RESUME_DELAY_MS = 60 * 1000;
const DEFAULT_MAX_ACTIONS = 30;

// V1.11 — fix du fail-open sur snapshot périmé (voir en-tête). Un snapshot
// périmé n'est dangereux que si la dernière valeur connue était déjà en zone
// de vigilance ; ces seuils sont volontairement SOUS les seuils durs
// ci-dessus, pour réagir avant que ce soit critique plutôt qu'après.
const STALE_ESCALATION_CONTEXT_PCT = 75;
const STALE_ESCALATION_CREDIT_PCT = 80;
const STALE_STREAK_WARN = 10; // appels consécutifs sans snapshot frais avant avertissement
const STALE_STREAK_CAP = 20; // puis arrêt dur conservateur

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

// Whitelist active pendant un arrêt dur : tout Read, Write/Edit spécifiquement
// sur SESSION.md ou .claude/session-log.md (comparaison de chemin résolue,
// insensible à la casse — Windows), plus ListAgents/SendMessage/TaskStop (V1.14)
// pour prévenir puis stopper proprement les agents en arrière-plan encore actifs
// — voir en-tête. Volontairement PAS TaskOutput : il peut rapatrier tout le
// transcript d'un agent dans le contexte, contre-productif pendant un arrêt
// d'urgence (ListAgents suffit pour savoir qui tourne encore).
const AGENT_WIND_DOWN_TOOLS = new Set(["ListAgents", "SendMessage", "TaskStop"]);

function isWhitelisted(toolName, toolInput, projectDir) {
  if (toolName === "Read") return true;
  if (AGENT_WIND_DOWN_TOOLS.has(toolName)) return true;
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
    `Outils encore autorisés : Read (n'importe quel fichier), Write/Edit sur ` +
    `SESSION.md ou .claude/session-log.md, ListAgents, SendMessage, TaskStop. ` +
    `Aucun autre outil, et ne relance aucun nouvel agent.\n` +
    `Si des agents en arrière-plan sont encore actifs (pas encore de notification ` +
    `de fin reçue — ListAgents en secours si besoin, ex: après une compaction) :\n` +
    `  1. Envoie IMMÉDIATEMENT un SendMessage à chacun, lui demandant de ` +
    `sauvegarder son avancement dans .claude/session-log.md puis de terminer au ` +
    `plus vite.\n` +
    `  2. Termine le checkpoint habituel (ce qui a été fait, où tu t'es arrêté ` +
    `précisément, ET la liste de ces agents avec ce qu'ils faisaient) dans ` +
    `SESSION.md/session-log.md — le temps pris ici sert de fenêtre de réaction ` +
    `à l'étape 1, pas besoin d'attendre artificiellement.\n` +
    `  3. Appelle ensuite TaskStop sur chacun d'eux, qu'ils aient eu ou non le ` +
    `temps de sauvegarder — c'est un filet de sécurité, pas une attente.\n` +
    `Puis dis à l'utilisateur de fermer cette session et d'en ouvrir une nouvelle ` +
    `(ou /clear).\n`
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
      const reset = !!entry.contextHardStop;
      if (entry.contextHardStop) {
        delete entry.contextHardStop;
        entry.ts = now;
        state[sessionId] = entry;
        saveState(stateFile, state);
      }
      logMetric("hook:hard-stop-guard", reset ? "postcompact-reset" : "postcompact-noop", `session=${sessionId}`);
      process.exit(0);
    }

    if (event === "Stop") {
      const reset = !!entry.autoResumeActive;
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
      logMetric("hook:hard-stop-guard", reset ? "stop-reset" : "stop-noop", `session=${sessionId}`);
      process.exit(0);
    }

    if (event !== "PostToolUse") {
      logMetric("hook:hard-stop-guard", "skip", `event=${event || "inconnu"}`);
      process.exit(0);
    }

    const snapshot = loadJson(path.join(projectDir, ".claude", "statusline-snapshot.json"));
    const sameSessionSnapshot = !!(snapshot && snapshot.session_id === payload.session_id && typeof snapshot.ts === "number");
    const snapshotFresh = sameSessionSnapshot && now - snapshot.ts < SNAPSHOT_MAX_AGE_MS;

    let changed = false;
    let forcedReason = null;

    if (snapshotFresh) {
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

      // Dernière valeur connue, pour rester prudent si le prochain snapshot
      // se fait attendre (voir bloc staleness ci-dessous).
      if (typeof ctx === "number") entry.lastKnownCtx = ctx;
      if (fiveHour && typeof fiveHour.used_percentage === "number") entry.lastKnownCredit = fiveHour.used_percentage;
      entry.staleStreak = 0;
      entry.staleWarned = false;
      changed = true;
    } else {
      // Snapshot absent, d'une autre session, ou périmé (>SNAPSHOT_MAX_AGE_MS)
      // : avant V1.11 ce cas sautait silencieusement toute détection
      // (fail-open indiscernable d'un cas sain). On compte désormais les
      // appels consécutifs dans cet état pour pouvoir escalader si la
      // dernière valeur connue était déjà préoccupante (voir plus bas).
      entry.staleStreak = (entry.staleStreak || 0) + 1;
      changed = true;
    }

    const lastKnownHigh =
      (typeof entry.lastKnownCtx === "number" && entry.lastKnownCtx >= STALE_ESCALATION_CONTEXT_PCT) ||
      (typeof entry.lastKnownCredit === "number" && entry.lastKnownCredit >= STALE_ESCALATION_CREDIT_PCT);

    if (!snapshotFresh && lastKnownHigh && entry.staleStreak >= STALE_STREAK_CAP && !entry.contextHardStop) {
      entry.contextHardStop = true;
      forcedReason =
        `snapshot périmé depuis ${entry.staleStreak} appels alors que la dernière valeur connue était déjà ` +
        `élevée (contexte ${entry.lastKnownCtx ?? "?"}%, crédits ${entry.lastKnownCredit ?? "?"}%) — arrêt conservateur`;
      changed = true;
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
    if (!hardStopActive) {
      if (!snapshotFresh && lastKnownHigh && entry.staleStreak >= STALE_STREAK_WARN && !entry.staleWarned) {
        entry.staleWarned = true;
        entry.ts = now;
        state[sessionId] = entry;
        saveState(stateFile, state);
        const warnMsg =
          `⚠️ ORDRE DU HARNAIS (hard-stop-guard) : le snapshot statusline n'a pas été rafraîchi depuis ` +
          `${entry.staleStreak} outils, alors que la dernière valeur connue était déjà élevée ` +
          `(contexte ${entry.lastKnownCtx ?? "?"}%, crédits ${entry.lastKnownCredit ?? "?"}%). La détection réelle ` +
          `est en pause tant qu'un nouveau relevé ne revient pas — fais un point session-checkpoint par précaution.`;
        // Support de hookSpecificOutput.additionalContext sur PostToolUse non
        // confirmé (seul UserPromptSubmit l'utilise ailleurs dans ce socle) :
        // si Claude Code l'ignore, l'écriture stdout est simplement sans effet
        // (fail-open préservé) et la télémétrie warn-stale reste le filet réel.
        process.stdout.write(
          JSON.stringify({
            continue: true,
            suppressOutput: true,
            hookSpecificOutput: {
              hookEventName: "PostToolUse",
              additionalContext: warnMsg,
            },
          })
        );
        logMetric(
          "hook:hard-stop-guard",
          "warn-stale",
          `streak=${entry.staleStreak} ctx=${entry.lastKnownCtx ?? "?"} credit=${entry.lastKnownCredit ?? "?"}`
        );
        process.exit(0);
      }

      const passCategory = snapshotFresh ? "pass-fresh" : "pass-stale";
      const detail = snapshotFresh
        ? "aucun seuil atteint"
        : `snapshot périmé/absent (streak=${entry.staleStreak || 0}), dernière valeur connue ctx=${entry.lastKnownCtx ?? "?"}% 5h=${entry.lastKnownCredit ?? "?"}%`;
      logMetric("hook:hard-stop-guard", passCategory, detail);
      process.exit(0);
    }

    const toolName = payload.tool_name || "";
    const toolInput = payload.tool_input || {};
    if (isWhitelisted(toolName, toolInput, projectDir)) {
      logMetric("hook:hard-stop-guard", "pass-whitelisted", `tool=${toolName}`);
      process.exit(0);
    }

    const reason =
      forcedReason ||
      (entry.contextHardStop && creditBlocking
        ? `contexte ≥${CONTEXT_HARD_STOP_PCT}% et crédits 5h ≥${CREDIT_HARD_STOP_PCT}%`
        : entry.contextHardStop
        ? `contexte ≥${CONTEXT_HARD_STOP_PCT}%`
        : `crédits 5h ≥${CREDIT_HARD_STOP_PCT}%`);

    process.stderr.write(blockMessage(reason));
    const category = forcedReason ? "block-forced" : entry.contextHardStop && creditBlocking ? "block-both" : entry.contextHardStop ? "block-context" : "block-credits";
    logMetric("hook:hard-stop-guard", category, reason);
    process.exit(2);
  } catch (e) {
    logMetric("hook:hard-stop-guard", "error", String(e).slice(0, 100));
    process.exit(0); // Jamais bloquant sur erreur interne : fail-open comme les autres watchdogs.
  }
}

main();
