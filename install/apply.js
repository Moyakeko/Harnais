#!/usr/bin/env node
/**
 * apply.js — moteur d'installation/mise à jour du socle Harnais sur un projet.
 *
 * Usage : node apply.js --source <socle extrait> --target <projet> --commit <sha>
 *
 * Invoqué par install.ps1 / install.sh (bootstraps minces : ils téléchargent et
 * extraient, toute la logique vit ici — une seule implémentation de la fusion,
 * et Node écrit tout en UTF-8 sans BOM quel que soit le shell appelant).
 *
 * Principes (voir EVOLUTION.md, « couche distribution ») :
 * - Fusion ADDITIVE : l'existant d'un projet (autre méthode type BMAD/GSD,
 *   hooks ou permissions propres) n'est jamais supprimé ni réécrit — le socle
 *   s'ajoute à côté, entre marqueurs idempotents.
 * - L'état résultant n'est jamais plus faible que le socle : deny = union,
 *   disableBypassPermissionsMode forcé à "disable".
 * - Avant tout écrasement/fusion d'un fichier pré-existant : sauvegarde
 *   <fichier>.harnais-bak, créée une seule fois (l'état pré-socle d'origine
 *   est préservé même après N réinstallations).
 * - Relancer l'installation = mise à jour (remplacement entre marqueurs,
 *   comparaison de contenu avant toute écriture).
 *
 * Zéro dépendance npm — fs/path uniquement, comme les hooks du socle.
 */

"use strict";

const fs = require("fs");
const path = require("path");

const VERSION = "1.6";

// Marqueurs d'idempotence. Le start porte la version (informatif) mais la
// détection est tolérante à son changement — sinon une mise à jour ne
// retrouverait jamais le bloc posé par la version précédente.
const CLAUDE_START = `<!-- harnais:core v${VERSION} start -->`;
const CLAUDE_END = `<!-- harnais:core end -->`;
const CLAUDE_START_RE = /<!--\s*harnais:core\b[^>]*start\s*-->/;
const GITIGNORE_START = "# >>> harnais:guard start";
const GITIGNORE_END = "# <<< harnais:guard end";

// Ce que l'installeur pose dans le .gitignore du projet (section sécurité
// uniquement — le bruit par stack appartient au projet, voir plus bas).
const GITIGNORE_GUARD_BODY = `# Secrets — jamais versionnés (le socle les bloque aussi en lecture)
.env
.env.*
!.env.example
*.pem
*.key
*.pfx
*.p12
secrets/
credentials*.json
# Historique local Claude Code (extraits bruts de transcript, potentiellement sensibles)
.claude/session-log.md
# Config Claude Code propre à la machine
.claude/settings.local.json
# État local du hook de notification desktop (timestamps/compteurs par session)
.claude/notify-state.json`;

// Bruit par stack — ajouté hors marqueurs, uniquement à la création d'un
// .gitignore neuf (ensuite c'est au projet de le faire vivre).
const GITIGNORE_STACK_NOISE = `# Dépendances / bruit (à adapter à la stack)
node_modules/
__pycache__/
venv/
.venv/
target/
dist/
build/`;

// ---------------------------------------------------------------------------
// Aides
// ---------------------------------------------------------------------------

const summary = [];
function report(status, file) {
  summary.push(`  [${status}] ${file}`);
}

function fail(msg) {
  process.stderr.write(`apply.js ERREUR : ${msg}\n`);
  process.exit(1);
}

function readText(p) {
  return fs.readFileSync(p, "utf8");
}

// Comparaison tolérante aux fins de ligne : un même fichier extrait d'un
// tarball (LF) ou d'un checkout Windows (CRLF) doit compter comme identique.
function sameText(a, b) {
  return a.replace(/\r\n/g, "\n") === b.replace(/\r\n/g, "\n");
}

// EOL dominant d'un texte existant — les blocs insérés l'adoptent pour ne pas
// produire de fichiers mixtes.
function eolOf(text) {
  const crlf = (text.match(/\r\n/g) || []).length;
  const lf = (text.match(/(?<!\r)\n/g) || []).length;
  return crlf > lf ? "\r\n" : "\n";
}

function withEol(text, eol) {
  return text.replace(/\r\n/g, "\n").split("\n").join(eol);
}

function ensureDir(p) {
  fs.mkdirSync(p, { recursive: true });
}

// Sauvegarde unique : le .harnais-bak d'origine n'est jamais réécrasé.
function backupOnce(p) {
  const bak = `${p}.harnais-bak`;
  if (!fs.existsSync(bak)) fs.copyFileSync(p, bak);
}

function listFiles(dir) {
  const out = [];
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) out.push(...listFiles(full));
    else out.push(full);
  }
  return out;
}

// ---------------------------------------------------------------------------
// Catégorie a — fichiers possédés par le socle (copie, écrasement contrôlé)
// ---------------------------------------------------------------------------

function installOwned(src, dst, rel) {
  if (!fs.existsSync(dst)) {
    ensureDir(path.dirname(dst));
    fs.copyFileSync(src, dst);
    report("créé", rel);
    return;
  }
  if (sameText(readText(src), readText(dst))) {
    report("identique", rel);
    return;
  }
  backupOnce(dst);
  fs.copyFileSync(src, dst);
  report("remplacé (+.harnais-bak)", rel);
}

// ---------------------------------------------------------------------------
// Catégorie c — fusion additive entre marqueurs (CLAUDE.md, .gitignore)
// ---------------------------------------------------------------------------

function mergeMarkedBlock(dst, rel, block, startRe, endMarker, freshExtra) {
  if (!fs.existsSync(dst)) {
    const body = freshExtra ? `${block}\n\n${freshExtra}\n` : `${block}\n`;
    fs.writeFileSync(dst, body);
    report("créé", rel);
    return;
  }
  const existing = readText(dst);
  const eol = eolOf(existing);
  const startMatch = existing.match(startRe);
  if (startMatch) {
    const startIdx = startMatch.index;
    const endIdx = existing.indexOf(endMarker, startIdx);
    if (endIdx === -1) fail(`${rel} : marqueur de début trouvé sans marqueur de fin — fichier à réparer à la main.`);
    const updated =
      existing.slice(0, startIdx) + withEol(block, eol) + existing.slice(endIdx + endMarker.length);
    if (sameText(updated, existing)) {
      report("identique", rel);
    } else {
      fs.writeFileSync(dst, updated);
      report("mis à jour (bloc harnais)", rel);
    }
    return;
  }
  // Fichier pré-existant sans bloc socle (autre méthode déjà en place) :
  // on ajoute à la fin, on ne touche à rien d'autre.
  backupOnce(dst);
  const sep = existing.endsWith("\n") || existing.endsWith("\r\n") ? eol : eol + eol;
  fs.writeFileSync(dst, existing + sep + withEol(block, eol) + eol);
  report("fusionné (bloc ajouté, +.harnais-bak)", rel);
}

// ---------------------------------------------------------------------------
// Catégorie c — fusion JSON de .claude/settings.json
// ---------------------------------------------------------------------------

function mergeSettings(srcPath, dstPath) {
  const rel = ".claude/settings.json";
  const socle = JSON.parse(readText(srcPath));
  if (!fs.existsSync(dstPath)) {
    ensureDir(path.dirname(dstPath));
    fs.copyFileSync(srcPath, dstPath);
    report("créé", rel);
    return;
  }
  let existing;
  try {
    existing = JSON.parse(readText(dstPath));
  } catch (e) {
    fail(`${rel} du projet n'est pas un JSON valide (${e.message}) — répare-le avant d'installer le socle.`);
  }
  const before = JSON.stringify(existing);

  // Hooks : append par événement, clé d'idempotence = chaîne `command`.
  existing.hooks = existing.hooks || {};
  for (const [event, socleEntries] of Object.entries(socle.hooks || {})) {
    existing.hooks[event] = existing.hooks[event] || [];
    const commands = new Set(
      existing.hooks[event].flatMap((e) => (e.hooks || []).map((h) => h.command))
    );
    for (const entry of socleEntries) {
      const cmds = (entry.hooks || []).map((h) => h.command);
      if (!cmds.every((c) => commands.has(c))) existing.hooks[event].push(entry);
    }
  }

  // Permissions : deny = union (jamais de retrait), anti-bypass forcé.
  existing.permissions = existing.permissions || {};
  const deny = new Set(existing.permissions.deny || []);
  for (const rule of (socle.permissions && socle.permissions.deny) || []) deny.add(rule);
  existing.permissions.deny = [...deny];
  if (existing.permissions.disableBypassPermissionsMode !== "disable") {
    if (existing.permissions.disableBypassPermissionsMode !== undefined) {
      report("ATTENTION : disableBypassPermissionsMode ramené à \"disable\" (garantie du socle)", rel);
    }
    existing.permissions.disableBypassPermissionsMode = "disable";
  }

  if (JSON.stringify(existing) === before) {
    report("identique", rel);
    return;
  }
  backupOnce(dstPath);
  fs.writeFileSync(dstPath, JSON.stringify(existing, null, 2) + "\n");
  report("fusionné (+.harnais-bak)", rel);
}

// ---------------------------------------------------------------------------
// Programme principal
// ---------------------------------------------------------------------------

function arg(name) {
  const i = process.argv.indexOf(`--${name}`);
  return i !== -1 ? process.argv[i + 1] : undefined;
}

const sourceDir = arg("source");
const targetDir = arg("target");
const commit = arg("commit") || "inconnu";

if (!sourceDir || !targetDir) fail("usage : node apply.js --source <dir> --target <dir> [--commit <sha>]");
if (!fs.existsSync(path.join(sourceDir, ".claude", "settings.json")) || !fs.existsSync(path.join(sourceDir, "CLAUDE.md")))
  fail(`source invalide (${sourceDir}) : .claude/settings.json ou CLAUDE.md introuvable.`);
if (!fs.existsSync(targetDir)) fail(`cible introuvable : ${targetDir}`);
if (path.resolve(sourceDir) === path.resolve(targetDir))
  fail("source et cible identiques — lance l'installation depuis le dossier du projet, pas depuis le socle.");

// Mesuré AVANT toute écriture : un projet non vide a pu commiter des secrets
// avant que le socle (et son .gitignore) n'existe — l'installeur ne peut pas
// auditer ça lui-même, mais il doit le dire.
const preexistingProject = fs.readdirSync(targetDir).some((n) => n !== ".git");

// a) Socle-owned : hooks (tests inclus), skills, agents, EVOLUTION.md.
for (const dir of [".claude/hooks", ".claude/skills", ".claude/agents"]) {
  const abs = path.join(sourceDir, dir);
  if (!fs.existsSync(abs)) continue;
  for (const file of listFiles(abs)) {
    const rel = path.relative(sourceDir, file).split(path.sep).join("/");
    installOwned(file, path.join(targetDir, rel), rel);
  }
}
installOwned(path.join(sourceDir, "EVOLUTION.md"), path.join(targetDir, "EVOLUTION.md"), "EVOLUTION.md");

// b) Create-only : SESSION.md depuis le template (jamais écrasé — c'est l'état
// réel d'un projet en cours).
const sessionDst = path.join(targetDir, "SESSION.md");
if (fs.existsSync(sessionDst)) {
  report("conservé (existe déjà)", "SESSION.md");
} else {
  fs.copyFileSync(path.join(sourceDir, "templates", "SESSION.md"), sessionDst);
  report("créé", "SESSION.md");
}

// c) Fusions additives.
const claudeBlock = `${CLAUDE_START}\n${readText(path.join(sourceDir, "CLAUDE.md")).replace(/\r\n/g, "\n").trimEnd()}\n${CLAUDE_END}`;
mergeMarkedBlock(path.join(targetDir, "CLAUDE.md"), "CLAUDE.md", claudeBlock, CLAUDE_START_RE, CLAUDE_END, null);

const gitignoreBlock = `${GITIGNORE_START}\n${GITIGNORE_GUARD_BODY}\n${GITIGNORE_END}`;
mergeMarkedBlock(
  path.join(targetDir, ".gitignore"),
  ".gitignore",
  gitignoreBlock,
  new RegExp(GITIGNORE_START.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")),
  GITIGNORE_END,
  GITIGNORE_STACK_NOISE
);

mergeSettings(path.join(sourceDir, ".claude", "settings.json"), path.join(targetDir, ".claude", "settings.json"));

// Version installée — base des futures mises à jour.
const versionPath = path.join(targetDir, ".claude", "harnais.version");
const hadVersion = fs.existsSync(versionPath);
const versionInfo = { version: VERSION, installedAt: new Date().toISOString(), commit };
fs.writeFileSync(versionPath, JSON.stringify(versionInfo) + "\n");
report(hadVersion ? "mis à jour" : "écrit", ".claude/harnais.version");

process.stdout.write(`Socle Harnais v${VERSION} (${commit}) — installation dans ${targetDir}\n`);
process.stdout.write(summary.join("\n") + "\n\n");
process.stdout.write(
  "Prochaines étapes :\n" +
    '  1. Ouvre Claude Code dans ce dossier et dis "onboard ce projet".\n' +
    "  2. Smoke test du socle : node .claude/hooks/tests/test-guard.js\n" +
    (preexistingProject
      ? '  3. Projet existant détecté : lance "security-audit" dans Claude Code —\n' +
        "     le .gitignore posé par le socle n'agit que pour l'avenir. Si des secrets\n" +
        "     ont pu être commités avant l'installation, vérifie aussi l'historique git.\n"
      : "")
);
