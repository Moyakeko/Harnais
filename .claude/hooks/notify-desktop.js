#!/usr/bin/env node
/**
 * Hooks UserPromptSubmit / Stop / Notification — notifie sur le bureau Windows
 * quand Claude termine une tâche ou attend une action, quel que soit l'IDE/
 * terminal utilisé (VS Code, Cursor, autre) : c'est un toast OS, pas une
 * fonctionnalité d'éditeur.
 *
 * Inspiré de CCNotify (github.com/dazuiba/CCNotify, macOS-only, Python +
 * terminal-notifier + SQLite) recréé en Node pur pour Windows :
 *   - Notification via un vrai toast WinRT (ToastNotificationManager) sous
 *     une identité "Claude Code" dédiée : AUMID `ClaudeCode.Harnais`
 *     enregistré paresseusement dans HKCU\Software\Classes\AppUserModelId au
 *     premier toast (clé utilisateur, sans admin, réversible — méthode
 *     documentée pour les apps de bureau non packagées). Deux premières
 *     tentatives avaient échoué et le diagnostic initial (parenté de process)
 *     était faux ; la vraie cause, isolée par tests croisés sur la machine
 *     cible (2026-07-08) :
 *       1. Un toast émis par un process qui meurt aussitôt après Show() peut
 *          être perdu avant livraison — il faut que le process survive ~1s.
 *       2. Un powershell.exe détaché ET caché (-WindowStyle Hidden, orphelin)
 *          est tué au bout d'~1s sur la machine cible (vraisemblablement
 *          Kaspersky, heuristique classique anti-malware).
 *     La formule qui marche : PowerShell en enfant SYNCHRONE (spawnSync, pas
 *     détaché, pas de -WindowStyle Hidden — la console est supprimée côté
 *     Node par windowsHide/CREATE_NO_WINDOW), maintenu vivant 1,5s après
 *     Show(). Coût : le hook bloque ~2s sur Stop/Notification — invisible en
 *     pratique (le tour est déjà terminé quand Stop se déclenche).
 *   - `msg.exe` (fenêtre modale Terminal Services, moche mais fiable en
 *     toutes circonstances sur la machine testée) reste en filet de secours
 *     si le toast échoue (WinRT indisponible, PowerShell absent, timeout).
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
const { spawn, spawnSync } = require("child_process");

const MSG_TIMEOUT_SECONDS = 10;

const TOAST_AUMID = "ClaudeCode.Harnais";

// Marge large : chargement WinRT (~0,5s) + Start-Sleep 1,5s. Au-delà, on
// considère le toast perdu et on bascule sur le fallback msg.exe.
const TOAST_TIMEOUT_MS = 8000;

// Script PowerShell constant — titre et corps arrivent par variables
// d'environnement ($env:NOTIFY_TITLE / $env:NOTIFY_BODY), jamais interpolés
// dans le code : aucune injection possible, même logique que le tableau
// d'arguments de msg.exe. L'échappement XML (SecurityElement::Escape) protège
// le LoadXml. Le Start-Sleep final n'est pas décoratif : sans lui, le toast
// peut mourir avec le process avant d'être livré (cause racine des échecs
// initiaux, voir l'en-tête).
const TOAST_PS = [
  "$ErrorActionPreference = 'Stop'",
  `$key = 'HKCU:\\Software\\Classes\\AppUserModelId\\${TOAST_AUMID}'`,
  "if (-not (Test-Path $key)) { New-Item -Path $key -Force | Out-Null; Set-ItemProperty -Path $key -Name DisplayName -Value 'Claude Code'; Set-ItemProperty -Path $key -Name ShowInSettings -Value 1 -Type DWord }",
  "$null = [Windows.UI.Notifications.ToastNotificationManager, Windows.UI.Notifications, ContentType = WindowsRuntime]",
  "$null = [Windows.Data.Xml.Dom.XmlDocument, Windows.Data.Xml.Dom, ContentType = WindowsRuntime]",
  "$title = [System.Security.SecurityElement]::Escape($env:NOTIFY_TITLE)",
  "$body = [System.Security.SecurityElement]::Escape($env:NOTIFY_BODY)",
  "$doc = New-Object Windows.Data.Xml.Dom.XmlDocument",
  '$doc.LoadXml("<toast><visual><binding template=""ToastGeneric""><text>$title</text><text>$body</text></binding></visual></toast>")',
  `[Windows.UI.Notifications.ToastNotificationManager]::CreateToastNotifier('${TOAST_AUMID}').Show((New-Object Windows.UI.Notifications.ToastNotification($doc)))`,
  "Start-Sleep -Milliseconds 1500",
  "Write-Output 'toast-shown-ok'",
].join("; ");

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

// Toast WinRT sous identité "Claude Code" (voir TOAST_PS et l'en-tête pour
// le pourquoi de chaque précaution). Synchrone à dessein : le process
// PowerShell doit rester un enfant vivant jusqu'à la livraison du toast —
// détaché il se fait tuer, mort trop tôt le toast est perdu.
function showToast(title, subtitle) {
  // Échappatoire de test : évite qu'une suite automatisée fasse apparaître un
  // vrai message à chaque exécution (voir tests/test-notify.js).
  if (process.env.NOTIFY_DESKTOP_DRY_RUN === "1") return;
  try {
    const res = spawnSync("powershell.exe", ["-NoProfile", "-NonInteractive", "-Command", TOAST_PS], {
      env: { ...process.env, NOTIFY_TITLE: title, NOTIFY_BODY: subtitle || "" },
      encoding: "utf8",
      // Pas de fenêtre console côté Node (CREATE_NO_WINDOW) : n'utilise PAS
      // -WindowStyle Hidden, marqueur qui déclenche la terminaison par l'AV.
      windowsHide: true,
      timeout: TOAST_TIMEOUT_MS,
      stdio: ["ignore", "pipe", "ignore"],
    });
    // Le marqueur prouve que Show() a été atteint ET que le sleep de
    // livraison s'est écoulé — un simple exit 0 ne suffirait pas.
    if (res.status === 0 && (res.stdout || "").includes("toast-shown-ok")) return;
  } catch (e) {
    // PowerShell introuvable ou spawn impossible : on tente le fallback.
  }
  showModalFallback(title, subtitle);
}

// Filet de secours si le toast échoue : msg.exe (utilitaire Windows natif de
// Terminal Services), fenêtre modale avec bouton OK — moche mais fiable.
// Le message arrive comme argument séparé (tableau passé à spawn, pas une
// chaîne shell) : aucune interpolation, donc aucun risque d'injection.
// S'auto-ferme après MSG_TIMEOUT_SECONDS si ignoré.
function showModalFallback(title, subtitle) {
  try {
    const message = subtitle ? `${title} — ${subtitle}` : title;
    // "*" (toutes les sessions), pas le nom d'utilisateur ciblé : testé en
    // conditions réelles, cibler le username échoue silencieusement en mode
    // détaché sur la machine de référence (résolution de session
    // incohérente une fois le process orphelin) — "*" fonctionne de façon
    // fiable. Sans risque pratique sur une machine perso mono-utilisateur.
    const child = spawn("msg.exe", ["*", `/TIME:${MSG_TIMEOUT_SECONDS}`, message], {
      detached: true,
      stdio: "ignore",
    });
    child.on("error", () => {}); // msg.exe absent/désactivé : best-effort, on ne bloque rien.
    child.unref();
  } catch (e) {
    // Best-effort : tant pis, on ne bloque rien.
  }
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
