#!/usr/bin/env node
/**
 * Hooks UserPromptSubmit / Stop / Notification — notifie sur le bureau Windows
 * quand Claude termine une tâche ou attend une action, quel que soit l'IDE/
 * terminal utilisé (VS Code, Cursor, autre) : c'est un toast OS, pas une
 * fonctionnalité d'éditeur.
 *
 * Inspiré de CCNotify (github.com/dazuiba/CCNotify, macOS-only, Python +
 * terminal-notifier + SQLite) recréé en Node pur pour Windows :
 *   - L'affichage lui-même (toast WinRT "Claude Code", fallback msg.exe, et
 *     le pourquoi de chaque précaution durement acquise) vit dans
 *     lib/toast.js, partagé avec les watchdogs V1.7. Coût : le hook bloque
 *     ~2s sur Stop/Notification — invisible en pratique (le tour est déjà
 *     terminé quand Stop se déclenche).
 *   - État minimal en JSON (.claude/notify-state.json) au lieu d'une base
 *     SQLite : chaque invocation de hook est un nouveau process qui ne
 *     partage rien avec le précédent, il faut bien persister {startedAt, seq}
 *     par session entre l'UserPromptSubmit et le Stop qui y répond.
 *   - Pas de "clic sur la notification → focus IDE" (v1 volontairement sans
 *     ce comportement, trop fragile sous Windows — voir SOURCES.md).
 *   - Contrairement à CCNotify, "waiting for input" NOTIFIE (pas de silence
 *     au prétexte que le Stop suivant le ferait déjà) — choix explicite de
 *     l'utilisateur de ce socle.
 *   - Chaque type de notification peut être désactivé via un fichier optionnel
 *     .claude/notify-config.json (voir loadConfig ci-dessous) — absent par
 *     défaut, tout est activé tant qu'il n'existe pas.
 *
 * Ce hook ne bloque jamais une session Claude Code : toute erreur (payload
 * invalide, PowerShell absent, pas de bureau) est avalée, exit(0) dans tous
 * les cas. Contrairement à guard-dangerous-commands.js qui bloque
 * intentionnellement, celui-ci est un pur confort, jamais un garde-fou.
 *
 * Limite assumée : Windows uniquement pour l'instant (no-op silencieux sur
 * macOS/Linux).
 */

const fs = require("fs");
const path = require("path");
const { showToast } = require("./lib/toast");

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

function loadState(stateFile) {
  try {
    return JSON.parse(fs.readFileSync(stateFile, "utf8"));
  } catch (e) {
    return {};
  }
}

// Fichier optionnel .claude/notify-config.json — { "stop": bool,
// "waitingForInput": bool, "permission": bool, "approval": bool,
// "generic": bool }. Absent/corrompu => tout activé (comportement par défaut
// sans configuration, cohérent avec le reste du socle : zéro setup requis).
const CONFIG_DEFAULTS = {
  stop: true,
  waitingForInput: true,
  permission: true,
  approval: true,
  generic: true,
};

function loadConfig(projectDir) {
  try {
    const raw = fs.readFileSync(path.join(projectDir, ".claude", "notify-config.json"), "utf8");
    return { ...CONFIG_DEFAULTS, ...JSON.parse(raw) };
  } catch (e) {
    return CONFIG_DEFAULTS;
  }
}

function pruneStale(state, now) {
  for (const [id, entry] of Object.entries(state)) {
    const startedAt = Date.parse(entry && entry.startedAt);
    if (!startedAt || now - startedAt > STATE_TTL_MS) delete state[id];
  }
  return state;
}

// Écriture atomique (fichier temporaire + rename) : réduit le risque de
// corruption si deux hooks s'exécutent quasi simultanément. La lecture reste
// tolérante (loadState) en filet de sécurité complémentaire.
function saveState(stateFile, state) {
  const tmp = `${stateFile}.tmp-${process.pid}`;
  fs.mkdirSync(path.dirname(stateFile), { recursive: true });
  fs.writeFileSync(tmp, JSON.stringify(state));
  fs.renameSync(tmp, stateFile);
}

function formatDuration(ms) {
  const totalSeconds = Math.max(0, Math.round(ms / 1000));
  if (totalSeconds < 60) return `${totalSeconds}s`;
  const totalMinutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  if (totalMinutes < 60) return seconds ? `${totalMinutes}m${seconds}s` : `${totalMinutes}m`;
  const hours = Math.floor(totalMinutes / 60);
  const minutes = totalMinutes % 60;
  return minutes ? `${hours}h${minutes}m` : `${hours}h`;
}

// Classification du message d'un événement Notification — premier match
// gagne, même idiome que RULES dans guard-dangerous-commands.js. `key`
// correspond à une entrée de notify-config.json pour l'activer/désactiver.
const NOTIFICATION_RULES = [
  { key: "waitingForInput", test: (m) => /waiting for (your )?input/.test(m), subtitle: "En attente de ta réponse" },
  { key: "permission", test: (m) => /permission/.test(m), subtitle: "Autorisation requise" },
  { key: "approval", test: (m) => /(approval|choose an option)/.test(m), subtitle: "Action requise" },
];

async function main() {
  const raw = await readStdin();

  // No-op silencieux hors Windows : après avoir vidé stdin pour ne jamais
  // laisser le process appelant bloqué sur un pipe plein.
  if (process.platform !== "win32") process.exit(0);

  try {
    let payload = {};
    try {
      payload = JSON.parse(raw || "{}");
    } catch (e) {
      payload = {};
    }

    const event = process.argv[2] || payload.hook_event_name || "";
    const projectDir = process.env.CLAUDE_PROJECT_DIR || process.cwd();
    const stateFile = path.join(projectDir, ".claude", "notify-state.json");
    const cwd = payload.cwd || projectDir;
    const projectName = path.basename(cwd) || "Claude Code";
    const sessionId = payload.session_id || "sans-session";

    const state = pruneStale(loadState(stateFile), Date.now());
    const config = loadConfig(projectDir);

    if (event === "UserPromptSubmit") {
      const entry = state[sessionId] || { startedAt: new Date().toISOString(), seq: 0 };
      entry.seq += 1;
      state[sessionId] = entry;
      saveState(stateFile, state);
      process.exit(0);
    }

    if (event === "Stop") {
      const entry = state[sessionId];
      const subtitle = entry
        ? `Tâche #${entry.seq} terminée — durée : ${formatDuration(Date.now() - Date.parse(entry.startedAt))}`
        : "Tâche terminée (durée inconnue)";
      if (config.stop) showToast(projectName, subtitle);
      delete state[sessionId];
      saveState(stateFile, state);
      process.exit(0);
    }

    if (event === "Notification") {
      const message = (payload.message || "").toLowerCase();
      const rule = NOTIFICATION_RULES.find((r) => r.test(message));
      const key = rule ? rule.key : "generic";
      if (config[key]) showToast(projectName, rule ? rule.subtitle : "Notification");
      process.exit(0);
    }

    process.exit(0); // événement inconnu : no-op
  } catch (e) {
    process.exit(0); // filet de sécurité absolu : ce hook ne fait jamais échouer la session
  }
}

main();
