#!/usr/bin/env node
/**
 * Hooks UserPromptSubmit / PostCompact — surveille le remplissage du contexte
 * et l'usage des crédits via le snapshot écrit par statusline.js (seul canal
 * qui expose ces données — aucun hook ne les reçoit directement, vérifié dans
 * le binaire v2.1.204).
 *
 *   - Contexte ≥ 85% : injecte comme contexte additionnel l'ordre d'exécuter
 *     la skill session-checkpoint AVANT de traiter le message courant. C'est
 *     le substitut assumé au « /clear automatique » demandé initialement :
 *     /clear et /compact ne sont déclenchables par aucun hook ni SDK
 *     (vérifié) — le harnais force donc un checkpoint riche pendant qu'il
 *     reste du contexte pour le rédiger, puis laisse l'auto-compact intégré
 *     faire la continuité (avec precompact-safety-net.js en filet brut).
 *   - Crédits 5h ≥ 90% : même mécanisme, simple avertissement pour
 *     checkpointer avant la coupure (credit-watchdog.js prend le relais si
 *     elle survient quand même).
 *
 * Chaque seuil n'est signalé qu'UNE fois par session (flags dans
 * .claude/watchdog-state.json) pour ne pas polluer chaque prompt ; le flag
 * contexte est ré-armé par l'événement PostCompact (le contexte est alors
 * redescendu, un futur 85% redevient signifiant).
 *
 * Garde-fous de validité du snapshot : même session ET moins de 5 min d'âge,
 * sinon on ne dit rien (un snapshot d'une autre session ou d'hier ferait
 * checkpointer pour rien). Jamais bloquant : exit 0 dans tous les cas.
 */

const fs = require("fs");
const path = require("path");

const CONTEXT_THRESHOLD_PCT = 85;
const CREDIT_THRESHOLD_PCT = 90;
const SNAPSHOT_MAX_AGE_MS = 5 * 60 * 1000;
const STATE_TTL_MS = 24 * 60 * 60 * 1000;

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

function formatResetTime(resetsAt) {
  const n = Number(resetsAt);
  if (!n || !isFinite(n)) return null;
  const d = new Date(n < 1e12 ? n * 1000 : n);
  return `${String(d.getHours()).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")}`;
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
      // Le contexte vient d'être compacté : un futur passage au-dessus du
      // seuil redevient une information neuve.
      if (entry.contextWarned) {
        delete entry.contextWarned;
        entry.ts = now;
        state[sessionId] = entry;
        saveState(stateFile, state);
      }
      process.exit(0);
    }

    if (event !== "UserPromptSubmit") process.exit(0);

    const snapshot = loadJson(path.join(projectDir, ".claude", "statusline-snapshot.json"));
    const snapshotValid =
      snapshot &&
      snapshot.session_id === payload.session_id &&
      typeof snapshot.ts === "number" &&
      now - snapshot.ts < SNAPSHOT_MAX_AGE_MS;
    if (!snapshotValid) process.exit(0);

    const warnings = [];

    const ctx = snapshot.context_used_percentage;
    if (typeof ctx === "number" && ctx >= CONTEXT_THRESHOLD_PCT && !entry.contextWarned) {
      entry.contextWarned = true;
      warnings.push(
        `⚠️ ORDRE DU HARNAIS (hook context-watchdog) : le contexte est à ${Math.round(ctx)}% — ` +
          `exécute la skill session-checkpoint MAINTENANT, avant de traiter le message ci-dessus. ` +
          `L'auto-compact approche : SESSION.md et .claude/session-log.md doivent capturer l'état ` +
          `pendant qu'il reste du contexte pour le rédiger. Une fois le checkpoint fait, reprends ` +
          `le message de l'utilisateur normalement.`
      );
    }

    const fiveHour = snapshot.five_hour;
    if (
      fiveHour &&
      typeof fiveHour.used_percentage === "number" &&
      fiveHour.used_percentage >= CREDIT_THRESHOLD_PCT &&
      !entry.creditWarned
    ) {
      entry.creditWarned = true;
      const reset = formatResetTime(fiveHour.resets_at);
      warnings.push(
        `⚠️ Avertissement du harnais : ${Math.round(fiveHour.used_percentage)}% des crédits 5h sont ` +
          `consommés${reset ? ` (réinitialisation à ${reset})` : ""}. Fais un point session-checkpoint ` +
          `dès la prochaine étape franchie ; si la coupure survient, le hook credit-watchdog ` +
          `sauvegardera l'état brut et planifiera la reprise.`
      );
    }

    if (warnings.length === 0) process.exit(0);

    entry.ts = now;
    state[sessionId] = entry;
    saveState(stateFile, state);

    process.stdout.write(
      JSON.stringify({
        continue: true,
        suppressOutput: true,
        hookSpecificOutput: {
          hookEventName: "UserPromptSubmit",
          additionalContext: warnings.join("\n\n"),
        },
      })
    );
    process.exit(0);
  } catch (e) {
    process.exit(0); // Jamais bloquant : la surveillance est un confort, pas un garde-fou.
  }
}

main();
