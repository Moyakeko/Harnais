#!/usr/bin/env node
/**
 * Statusline — à la fois affichage et CAPTEUR du socle.
 *
 * Claude Code invoque cette commande à chaque rafraîchissement de la barre de
 * statut en lui passant sur stdin un JSON riche qui contient deux données
 * qu'AUCUN hook ne reçoit (vérifié dans le binaire v2.1.204, pas seulement la
 * doc) : le pourcentage de contexte utilisé (`context_window.used_percentage`)
 * et l'état des fenêtres de crédits (`rate_limits.five_hour/seven_day` :
 * `used_percentage` + `resets_at` epoch). La statusline est donc le seul
 * canal local pour alimenter les watchdogs V1.7 :
 *
 *   - context-watchdog.js (UserPromptSubmit) lit le snapshot pour injecter
 *     l'ordre de checkpoint à ≥85% de contexte ;
 *   - credit-watchdog.js (StopFailure) y lit l'heure de réinitialisation des
 *     crédits pour planifier la reprise.
 *
 * D'où le snapshot .claude/statusline-snapshot.json (écriture atomique
 * tmp+rename, même motif que notify-state). Il est dans .gitignore : état
 * local de machine, pas du socle.
 *
 * L'affichage reste volontairement minimal : projet · modèle · ctx % · 5h %.
 * Jamais d'échec bloquant : en cas de payload illisible on affiche un
 * fallback et on sort en 0 — une statusline cassée ne doit rien casser.
 */

const fs = require("fs");
const path = require("path");

function readStdin() {
  return new Promise((resolve) => {
    let data = "";
    process.stdin.setEncoding("utf8");
    process.stdin.on("data", (chunk) => (data += chunk));
    process.stdin.on("end", () => resolve(data));
    process.stdin.on("error", () => resolve(""));
  });
}

// resets_at arrive en secondes epoch (en-tête anthropic-ratelimit-unified-reset).
// Tolérant aux millisecondes au cas où le format évoluerait.
function toEpochMs(resetsAt) {
  const n = Number(resetsAt);
  if (!n || !isFinite(n)) return null;
  return n < 1e12 ? n * 1000 : n;
}

function formatResetTime(resetsAt) {
  const ms = toEpochMs(resetsAt);
  if (!ms) return null;
  const d = new Date(ms);
  return `${String(d.getHours()).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")}`;
}

function limitPart(label, limit) {
  if (!limit || typeof limit.used_percentage !== "number") return null;
  const pct = Math.round(limit.used_percentage);
  const reset = formatResetTime(limit.resets_at);
  return `${label} ${pct}%${reset ? ` (reset ${reset})` : ""}`;
}

async function main() {
  let payload = {};
  try {
    payload = JSON.parse((await readStdin()) || "{}");
  } catch (e) {
    payload = {};
  }

  const projectDir =
    process.env.CLAUDE_PROJECT_DIR ||
    (payload.workspace && payload.workspace.project_dir) ||
    payload.cwd ||
    process.cwd();

  const contextPct =
    payload.context_window && typeof payload.context_window.used_percentage === "number"
      ? Math.round(payload.context_window.used_percentage)
      : null;
  const fiveHour = (payload.rate_limits && payload.rate_limits.five_hour) || null;
  const sevenDay = (payload.rate_limits && payload.rate_limits.seven_day) || null;

  // --- Capteur : snapshot pour les watchdogs ---
  try {
    const snapshot = {
      session_id: payload.session_id || null,
      ts: Date.now(),
      context_used_percentage: contextPct,
      five_hour: fiveHour,
      seven_day: sevenDay,
    };
    const snapshotFile = path.join(projectDir, ".claude", "statusline-snapshot.json");
    const tmp = `${snapshotFile}.tmp-${process.pid}`;
    fs.mkdirSync(path.dirname(snapshotFile), { recursive: true });
    fs.writeFileSync(tmp, JSON.stringify(snapshot));
    fs.renameSync(tmp, snapshotFile);
  } catch (e) {
    // Le capteur est best-effort : l'affichage doit sortir quand même.
  }

  // --- Affichage ---
  const parts = [path.basename(projectDir) || "Claude Code"];
  if (payload.model && payload.model.display_name) parts.push(payload.model.display_name);
  if (contextPct !== null) parts.push(`ctx ${contextPct}%`);
  const fh = limitPart("5h", fiveHour);
  if (fh) parts.push(fh);
  process.stdout.write(parts.join(" · "));
  process.exit(0);
}

main();
