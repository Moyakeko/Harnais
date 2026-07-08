/**
 * lib/toast.js — notification desktop Windows partagée par les hooks du socle
 * (notify-desktop, credit-watchdog, resume-after-reset). Extraite de
 * notify-desktop.js quand un deuxième consommateur est apparu (V1.7) — la
 * logique et ses raisons sont inchangées :
 *
 *   - Vrai toast WinRT (ToastNotificationManager) sous une identité
 *     "Claude Code" dédiée : AUMID `ClaudeCode.Harnais` enregistré
 *     paresseusement dans HKCU\Software\Classes\AppUserModelId au premier
 *     toast (clé utilisateur, sans admin, réversible — méthode documentée
 *     pour les apps de bureau non packagées).
 *   - PowerShell en enfant SYNCHRONE (spawnSync, pas détaché, pas de
 *     -WindowStyle Hidden — la console est supprimée côté Node par
 *     windowsHide/CREATE_NO_WINDOW), maintenu vivant 1,5s après Show().
 *     La vraie cause des échecs historiques, isolée par tests croisés le
 *     2026-07-08 : (1) un toast émis par un process qui meurt aussitôt après
 *     Show() peut être perdu avant livraison ; (2) un powershell.exe détaché
 *     ET caché est tué en ~1s sur la machine cible (vraisemblablement
 *     Kaspersky, heuristique classique anti-malware).
 *   - `msg.exe` (fenêtre modale Terminal Services, moche mais fiable) en
 *     filet de secours si le toast échoue.
 *   - Titre/corps passés par variables d'environnement, jamais interpolés
 *     dans le code PowerShell : aucune injection possible.
 *
 * Best-effort intégral : aucune erreur ne remonte à l'appelant, un toast
 * raté ne doit jamais faire échouer un hook.
 */

const { spawn, spawnSync } = require("child_process");

const TOAST_AUMID = "ClaudeCode.Harnais";

const MSG_TIMEOUT_SECONDS = 10;

// Marge large : chargement WinRT (~0,5s) + Start-Sleep 1,5s. Au-delà, on
// considère le toast perdu et on bascule sur le fallback msg.exe.
const TOAST_TIMEOUT_MS = 8000;

// Le Start-Sleep final n'est pas décoratif : sans lui, le toast peut mourir
// avec le process avant d'être livré (voir l'en-tête).
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

// Échappatoire de test : chaque batterie a sa variable (NOTIFY_DESKTOP_DRY_RUN
// pour test-notify.js, WATCHDOG_DRY_RUN pour test-watchdogs.js) — l'une ou
// l'autre suffit à empêcher tout affichage réel.
function isDryRun() {
  return process.env.NOTIFY_DESKTOP_DRY_RUN === "1" || process.env.WATCHDOG_DRY_RUN === "1";
}

function showToast(title, subtitle) {
  if (isDryRun()) return;
  try {
    const res = spawnSync("powershell.exe", ["-NoProfile", "-NonInteractive", "-Command", TOAST_PS], {
      env: { ...process.env, NOTIFY_TITLE: title, NOTIFY_BODY: subtitle || "" },
      encoding: "utf8",
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

module.exports = { showToast };
