#!/usr/bin/env node
/**
 * checkpoint-nudge.js (v2) — rappelle la skill session-checkpoint quand
 * SESSION.md n'a pas été modifié depuis N tours.
 *
 * Usage : node checkpoint-nudge.js Stop | PreCompact
 *
 * - Stop : compte les tours (un Stop = une réponse terminée) depuis la dernière
 *   modification observée de SESSION.md. Au N-ième tour sans modification, renvoie
 *   un `additionalContext` (non bloquant) puis remet le compteur à zéro : un rappel
 *   au plus tous les N tours. Ne fait rien si `stop_hook_active` est vrai (évite les
 *   boucles).
 * - PreCompact : la doc indique que le stdout d'un PreCompact sert de consigne au
 *   résumé de compaction (il ne peut pas injecter de contexte). Si SESSION.md a pris
 *   du retard (au moins un tour sans modification), on demande au résumé de le noter.
 *
 * N = HARNAIS_CHECKPOINT_NUDGE_TURNS (défaut 15). État local :
 * .claude/checkpoint-nudge.json (gitignored). Toujours exit 0, jamais bloquant.
 */

const fs = require("fs");
const path = require("path");
const { logMetric } = require("./lib/metrics");
const { writeJsonAtomic } = require("./lib/atomic-write");

const DEFAULT_TURNS = 15;

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

function threshold() {
  const n = parseInt(process.env.HARNAIS_CHECKPOINT_NUDGE_TURNS || "", 10);
  return Number.isFinite(n) && n > 0 ? n : DEFAULT_TURNS;
}

async function main() {
  const event = process.argv[2] || "";
  let payload = {};
  try {
    payload = JSON.parse((await readStdin()) || "{}");
  } catch (e) {
    payload = {};
  }

  try {
    const projectDir = process.env.CLAUDE_PROJECT_DIR || process.cwd();
    const sessionFile = path.join(projectDir, "SESSION.md");
    if (!fs.existsSync(sessionFile)) {
      logMetric("hook:checkpoint-nudge", "skip", "SESSION.md absent");
      return;
    }
    const mtime = fs.statSync(sessionFile).mtimeMs;
    const stateFile = path.join(projectDir, ".claude", "checkpoint-nudge.json");
    const sessionId = payload.session_id || "inconnu";
    const all = loadJson(stateFile) || {};
    // Une entrée par session ; les autres sessions sont élaguées (fichier minuscule).
    const st = all.session_id === sessionId ? all : { session_id: sessionId, mtime, turns: 0 };
    if (st.mtime !== mtime) {
      st.mtime = mtime;
      st.turns = 0;
    }

    if (event === "Stop") {
      if (payload.stop_hook_active) {
        logMetric("hook:checkpoint-nudge", "skip", "stop_hook_active");
        return;
      }
      st.turns += 1;
      const n = threshold();
      if (st.turns >= n) {
        st.turns = 0;
        writeJsonAtomic(stateFile, st);
        process.stdout.write(
          JSON.stringify({
            hookSpecificOutput: {
              hookEventName: "Stop",
              additionalContext:
                `SESSION.md n'a pas été mis à jour depuis ${n} tours. Si une étape notable ` +
                `est terminée, lance la skill session-checkpoint (état courant court, leçons ` +
                `non évidentes dans LESSONS.md). Sinon, ignore ce rappel.`,
            },
          })
        );
        logMetric("hook:checkpoint-nudge", "nudge", `tours=${n}`);
        return;
      }
      writeJsonAtomic(stateFile, st);
      logMetric("hook:checkpoint-nudge", "count", `tours=${st.turns}`);
      return;
    }

    if (event === "PreCompact") {
      writeJsonAtomic(stateFile, st);
      if (st.turns >= 1) {
        process.stdout.write(
          `SESSION.md n'a pas été mis à jour depuis ${st.turns} tour(s) avant cette compaction. ` +
            `Indique dans le résumé qu'il faut lancer la skill session-checkpoint juste après.\n`
        );
        logMetric("hook:checkpoint-nudge", "precompact-note", `tours=${st.turns}`);
      } else {
        logMetric("hook:checkpoint-nudge", "precompact-ok", "");
      }
      return;
    }

    logMetric("hook:checkpoint-nudge", "skip", `event=${event || "inconnu"}`);
  } catch (e) {
    logMetric("hook:checkpoint-nudge", "error", String(e).slice(0, 100));
  }
}

main().then(() => process.exit(0), () => process.exit(0));
