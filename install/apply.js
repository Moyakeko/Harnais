#!/usr/bin/env node
/**
 * apply.js (v2) — installe ou met à jour le socle Harnais dans un projet, puis
 * applique le manifeste du projet (harnais.manifest.json).
 *
 * Usage :
 *   node apply.js --source <socle> --target <projet> [--commit <sha>] [--tag <vX.Y>]
 *                 [--manifest <fichier>] [--dry-run] [--install-plugins] [--keep-v1-skills]
 *
 * Principes :
 * - Fusion additive : ce que le projet a mis lui-même (hooks, permissions, skills,
 *   CLAUDE.md hors bloc) n'est jamais supprimé ni réécrit.
 * - Jamais touchés : SESSION.md et LESSONS.md existants, skills hors socle et hors
 *   manifeste (ex. skills locaux du projet).
 * - Sauvegarde avant toute écriture d'un fichier existant :
 *   .claude/harnais-backups/<horodatage>/<chemin>. Créée seulement si quelque chose change.
 * - Idempotent : relancer sans changement n'écrit rien.
 * - --dry-run : affiche ce qui serait fait, n'écrit rien.
 *
 * Zéro dépendance npm.
 */

"use strict";

const fs = require("fs");
const os = require("os");
const path = require("path");
const { spawnSync } = require("child_process");

// ---------------------------------------------------------------------------
// Arguments
// ---------------------------------------------------------------------------

function arg(name) {
  const i = process.argv.indexOf(`--${name}`);
  return i !== -1 ? process.argv[i + 1] : undefined;
}
function flag(name) {
  return process.argv.includes(`--${name}`);
}

const sourceDir = arg("source");
const targetDir = arg("target");
const commit = arg("commit") || "inconnu";
const tagArg = arg("tag");
const manifestArg = arg("manifest");
const DRY = flag("dry-run");
const INSTALL_PLUGINS = flag("install-plugins");
const KEEP_V1_SKILLS = flag("keep-v1-skills");

const DESCRIPTION_BUDGET = 6000; // marge sous le budget de la liste des skills (~1 % du contexte)
const DESCRIPTION_MAX = 1536; // limite par skill (doc skills.md)

function fail(msg) {
  process.stderr.write(`apply.js ERREUR : ${msg}\n`);
  process.exit(1);
}

function resolveVersion(tag, srcDir) {
  if (tag && /^v\d+\.\d+$/.test(tag)) return tag.slice(1);
  try {
    return fs.readFileSync(path.join(srcDir || ".", "VERSION"), "utf8").trim();
  } catch (e) {
    fail("version introuvable : ni --tag résolu ni fichier VERSION à la racine du socle.");
  }
}

if (!sourceDir || !targetDir)
  fail("usage : node apply.js --source <dir> --target <dir> [--commit <sha>] [--tag <vX.Y>] [--manifest <f>] [--dry-run]");
if (!fs.existsSync(path.join(sourceDir, ".claude", "settings.json")) || !fs.existsSync(path.join(sourceDir, "templates", "CLAUDE.core.md")))
  fail(`source invalide (${sourceDir}) : .claude/settings.json ou templates/CLAUDE.core.md introuvable.`);
if (!fs.existsSync(targetDir)) fail(`cible introuvable : ${targetDir}`);
if (path.resolve(sourceDir) === path.resolve(targetDir))
  fail("source et cible identiques — lance l'installation depuis le dossier du projet, pas depuis le socle.");

const VERSION = resolveVersion(tagArg, sourceDir);
const SRC = path.resolve(sourceDir);
const TGT = path.resolve(targetDir);
const STAMP = new Date().toISOString().replace(/[:.]/g, "-");
const BACKUP_REL = `.claude/harnais-backups/${STAMP}`;

const CLAUDE_START = `<!-- harnais:core v${VERSION} start -->`;
const CLAUDE_END = `<!-- harnais:core end -->`;
const CLAUDE_START_RE = /<!--\s*harnais:core\b[^>]*start\s*-->/;
const GITIGNORE_START = "# >>> harnais:guard start";
const GITIGNORE_END = "# <<< harnais:guard end";

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
# États locaux des hooks du socle
.claude/notify-state.json
.claude/statusline-snapshot.json
.claude/watchdog-state.json
.claude/harnais-update-check.json
.claude/harnais-graphify-check.json
.claude/checkpoint-nudge.json
# Télémétrie locale du socle (grossit vite, voulu)
.claude/harnais-metrics.jsonl
# Sauvegardes de l'installeur (copies d'avant mise à jour)
.claude/harnais-backups/`;

const GITIGNORE_STACK_NOISE = `# Dépendances / bruit (à adapter à la stack)
node_modules/
__pycache__/
venv/
.venv/
target/
dist/
build/`;

// Hooks optionnels : nom -> entrées settings.json. resume-after-reset n'a pas
// d'entrée propre (planifié par credit-watchdog / hard-stop-guard) : son état
// passe par .claude/harnais.hooks.json.
const hookCmd = (file, argv) => `node "$CLAUDE_PROJECT_DIR/.claude/hooks/${file}"${argv ? ` ${argv}` : ""}`;
const OPTIONAL_HOOKS = {
  "hard-stop-guard": {
    default: true,
    entries: [
      { event: "PostToolUse", command: hookCmd("hard-stop-guard.js", "PostToolUse") },
      { event: "PostCompact", command: hookCmd("hard-stop-guard.js", "PostCompact") },
      { event: "Stop", command: hookCmd("hard-stop-guard.js", "Stop") },
    ],
  },
  "context-watchdog": {
    default: true,
    entries: [
      { event: "UserPromptSubmit", command: hookCmd("context-watchdog.js", "UserPromptSubmit") },
      { event: "PostCompact", command: hookCmd("context-watchdog.js", "PostCompact") },
    ],
  },
  "credit-watchdog": {
    default: true,
    entries: [{ event: "StopFailure", matcher: "billing_error|rate_limit", command: hookCmd("credit-watchdog.js") }],
  },
  "resume-after-reset": { default: true, entries: [] },
  "graphify-check": {
    default: false,
    entries: [{ event: "SessionStart", command: hookCmd("graphify-check.js") }],
  },
};

// Skills et agents du socle v1 qui passent en optionnel en v2.
const OPTIONAL_SKILLS_DIR = path.join(SRC, "optionnel", "skills");
const OPTIONAL_AGENTS_DIR = path.join(SRC, "optionnel", "agents");
const listNames = (dir, strip) =>
  fs.existsSync(dir) ? fs.readdirSync(dir).map((n) => (strip ? n.replace(/\.md$/, "") : n)).sort() : [];
const OPTIONAL_SKILL_NAMES = listNames(OPTIONAL_SKILLS_DIR, false);
const OPTIONAL_AGENT_NAMES = listNames(OPTIONAL_AGENTS_DIR, true);

// ---------------------------------------------------------------------------
// Système de fichiers : écritures réelles ou simulées (--dry-run)
// ---------------------------------------------------------------------------

const overlay = new Map(); // dry-run : chemin absolu -> Buffer | null (supprimé)
let backupUsed = false;
const summary = [];
const warnings = [];
const notes = [];

function report(status, rel) {
  summary.push(`  [${status}] ${rel}`);
}
function rel(abs) {
  return path.relative(TGT, abs).split(path.sep).join("/");
}

function vExists(abs) {
  if (overlay.has(abs)) return overlay.get(abs) !== null;
  return fs.existsSync(abs);
}
function vRead(abs) {
  if (overlay.has(abs)) {
    const v = overlay.get(abs);
    if (v === null) throw new Error(`ENOENT (simulé) ${abs}`);
    return v;
  }
  return fs.readFileSync(abs);
}
function vReadText(abs) {
  return vRead(abs).toString("utf8");
}
function vListFiles(dir) {
  const out = new Set();
  const walk = (d) => {
    if (!fs.existsSync(d)) return;
    for (const e of fs.readdirSync(d, { withFileTypes: true })) {
      const full = path.join(d, e.name);
      if (e.isDirectory()) walk(full);
      else out.add(full);
    }
  };
  walk(dir);
  for (const [p, v] of overlay) {
    if (p.startsWith(dir + path.sep)) {
      if (v === null) out.delete(p);
      else out.add(p);
    }
  }
  return [...out].sort();
}
function vListDirs(dir) {
  const out = new Set();
  if (fs.existsSync(dir)) for (const e of fs.readdirSync(dir, { withFileTypes: true })) if (e.isDirectory()) out.add(e.name);
  for (const [p, v] of overlay) {
    if (v !== null && p.startsWith(dir + path.sep)) out.add(path.relative(dir, p).split(path.sep)[0]);
  }
  return [...out].filter((n) => vListFiles(path.join(dir, n)).length > 0).sort();
}

function backup(abs) {
  if (!fs.existsSync(abs)) return;
  backupUsed = true;
  if (DRY) return;
  const dst = path.join(TGT, BACKUP_REL, rel(abs));
  fs.mkdirSync(path.dirname(dst), { recursive: true });
  fs.copyFileSync(abs, dst);
}

function sameBytes(a, b) {
  const norm = (x) => x.toString("utf8").replace(/\r\n/g, "\n");
  return norm(a) === norm(b);
}

// Écrit si le contenu change ; sauvegarde l'ancien. Renvoie "créé" | "remplacé" | "identique".
function vWrite(abs, data) {
  const buf = Buffer.isBuffer(data) ? data : Buffer.from(data, "utf8");
  if (vExists(abs)) {
    if (sameBytes(vRead(abs), buf)) return "identique";
    backup(abs);
    if (DRY) overlay.set(abs, buf);
    else fs.writeFileSync(abs, buf);
    return "remplacé";
  }
  if (DRY) overlay.set(abs, buf);
  else {
    fs.mkdirSync(path.dirname(abs), { recursive: true });
    fs.writeFileSync(abs, buf);
  }
  return "créé";
}

function vRemove(abs) {
  if (!vExists(abs)) return false;
  backup(abs);
  if (DRY) overlay.set(abs, null);
  else fs.rmSync(abs, { force: true });
  return true;
}

function removeEmptyDirs(dir) {
  if (DRY || !fs.existsSync(dir)) return;
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) if (e.isDirectory()) removeEmptyDirs(path.join(dir, e.name));
  if (fs.readdirSync(dir).length === 0) fs.rmdirSync(dir);
}

function eolOf(text) {
  const crlf = (text.match(/\r\n/g) || []).length;
  const lf = (text.match(/(?<!\r)\n/g) || []).length;
  return crlf > lf ? "\r\n" : "\n";
}
function withEol(text, eol) {
  return text.replace(/\r\n/g, "\n").split("\n").join(eol);
}

function writeReport(abs, data, label) {
  const st = vWrite(abs, data);
  report(st === "remplacé" ? "remplacé (sauvegardé)" : st, label || rel(abs));
  return st;
}

// Synchronise un dossier possédé (skill) : copie les fichiers, retire ceux en trop.
function syncDir(files, dstDir, label) {
  const isNew = vListFiles(dstDir).length === 0;
  let changed = false;
  const wanted = new Set();
  for (const [relPath, buf] of files) {
    const abs = path.join(dstDir, relPath);
    wanted.add(abs);
    if (vWrite(abs, buf) !== "identique") changed = true;
  }
  for (const abs of vListFiles(dstDir)) {
    if (!wanted.has(abs)) {
      vRemove(abs);
      changed = true;
    }
  }
  report(isNew ? "créé" : changed ? "mis à jour (sauvegardé)" : "identique", label);
  return changed;
}

function readDirFiles(dir) {
  const out = [];
  const walk = (d) => {
    for (const e of fs.readdirSync(d, { withFileTypes: true })) {
      const full = path.join(d, e.name);
      if (e.isDirectory()) {
        if (e.name === ".git") continue;
        walk(full);
      } else out.push([path.relative(dir, full), fs.readFileSync(full)]);
    }
  };
  walk(dir);
  return out.sort((a, b) => (a[0] < b[0] ? -1 : 1));
}

// ---------------------------------------------------------------------------
// Frontmatter des skills
// ---------------------------------------------------------------------------

function splitFrontmatter(text) {
  const t = text.replace(/^﻿/, "");
  const m = t.match(/^---\r?\n([\s\S]*?)\r?\n---(\r?\n|$)/);
  if (!m) return null;
  return { fm: m[1], body: t.slice(m[0].length) };
}

// Lecture minimale d'une clé YAML scalaire (simple, guillemets, bloc > ou | , suite indentée).
function fmGet(fm, key) {
  const lines = fm.split(/\r?\n/);
  for (let i = 0; i < lines.length; i++) {
    const m = lines[i].match(new RegExp(`^${key}:\\s?(.*)$`));
    if (!m) continue;
    let v = m[1].trim();
    const cont = [];
    for (let j = i + 1; j < lines.length && /^\s+\S/.test(lines[j]); j++) cont.push(lines[j].trim());
    if (/^[>|][-+]?$/.test(v)) v = cont.join(" ");
    else if (cont.length) v = [v, ...cont].join(" ");
    if (/^".*"$/.test(v)) {
      try {
        v = JSON.parse(v);
      } catch (e) {
        v = v.slice(1, -1);
      }
    } else if (/^'.*'$/.test(v)) v = v.slice(1, -1).replace(/''/g, "'");
    return v;
  }
  return undefined;
}

// Remplace (ou ajoute) une clé scalaire, en retirant ses lignes de suite.
function fmSet(fm, key, value) {
  const lines = fm.split(/\r?\n/);
  const out = [];
  let done = false;
  for (let i = 0; i < lines.length; i++) {
    if (new RegExp(`^${key}:`).test(lines[i])) {
      while (i + 1 < lines.length && /^\s+\S/.test(lines[i + 1])) i++;
      if (value !== undefined) out.push(`${key}: ${value}`);
      done = true;
    } else out.push(lines[i]);
  }
  if (!done && value !== undefined) out.push(`${key}: ${value}`);
  return out.join("\n");
}

function skillDescriptionCost(skillMdText) {
  const parts = splitFrontmatter(skillMdText);
  if (!parts) return { cost: 0, manual: false };
  const manual = String(fmGet(parts.fm, "disable-model-invocation")).trim() === "true";
  if (manual) return { cost: 0, manual: true };
  const d = fmGet(parts.fm, "description") || "";
  const w = fmGet(parts.fm, "when_to_use") || "";
  return { cost: Math.min(DESCRIPTION_MAX, d.length + w.length), manual: false };
}

// ---------------------------------------------------------------------------
// Manifeste
// ---------------------------------------------------------------------------

function loadManifest() {
  const p = manifestArg ? path.resolve(manifestArg) : path.join(TGT, "harnais.manifest.json");
  if (!fs.existsSync(p)) {
    if (manifestArg) fail(`manifeste introuvable : ${p}`);
    notes.push("Pas de harnais.manifest.json : socle seul, hooks optionnels à leur valeur par défaut.");
    return { path: null, dir: TGT, data: {} };
  }
  let data;
  try {
    data = JSON.parse(fs.readFileSync(p, "utf8"));
  } catch (e) {
    fail(`manifeste illisible (${p}) : ${e.message}`);
  }
  const errs = validateManifest(data);
  if (errs.length) fail(`manifeste invalide (${p}) :\n  - ${errs.join("\n  - ")}`);
  return { path: p, dir: path.dirname(p), data };
}

const NAME_RE = /^[a-z0-9][a-z0-9._-]*$/;

function validateManifest(m) {
  const errs = [];
  if (typeof m !== "object" || m === null || Array.isArray(m)) return ["la racine doit être un objet"];
  const known = new Set(["$schema", "harnais", "plugins", "skills", "optional_hooks", "optional_skills", "optional_agents"]);
  for (const k of Object.keys(m)) if (!known.has(k)) errs.push(`clé inconnue : ${k}`);
  if (m.harnais !== undefined && typeof m.harnais !== "string") errs.push("harnais doit être une chaîne (ex. \"2.0\")");
  if (m.plugins !== undefined) {
    if (!Array.isArray(m.plugins)) errs.push("plugins doit être un tableau");
    else
      m.plugins.forEach((p, i) => {
        if (!p || typeof p !== "object") return errs.push(`plugins[${i}] doit être un objet`);
        for (const k of ["name", "marketplace", "source"]) if (typeof p[k] !== "string" || !p[k]) errs.push(`plugins[${i}].${k} manquant`);
        if (p.name && !NAME_RE.test(p.name)) errs.push(`plugins[${i}].name invalide : ${p.name}`);
        if (p.marketplace && !NAME_RE.test(p.marketplace)) errs.push(`plugins[${i}].marketplace invalide : ${p.marketplace}`);
        if (p.ref !== undefined && typeof p.ref !== "string") errs.push(`plugins[${i}].ref doit être une chaîne`);
      });
  }
  if (m.skills !== undefined) {
    if (!Array.isArray(m.skills)) errs.push("skills doit être un tableau");
    else
      m.skills.forEach((s, i) => {
        if (!s || typeof s !== "object") return errs.push(`skills[${i}] doit être un objet`);
        for (const k of ["name", "from", "description"]) if (typeof s[k] !== "string" || !s[k]) errs.push(`skills[${i}].${k} manquant`);
        if (s.name && !NAME_RE.test(s.name)) errs.push(`skills[${i}].name invalide : ${s.name}`);
        if (s.description && s.description.length > DESCRIPTION_MAX) errs.push(`skills[${i}].description dépasse ${DESCRIPTION_MAX} caractères`);
        if (s.path !== undefined && (typeof s.path !== "string" || s.path.split(/[\\/]/).includes(".."))) errs.push(`skills[${i}].path invalide`);
        if (s.paths !== undefined && !(typeof s.paths === "string" || (Array.isArray(s.paths) && s.paths.every((x) => typeof x === "string"))))
          errs.push(`skills[${i}].paths doit être une chaîne ou un tableau de chaînes`);
      });
  }
  const oh = m.optional_hooks;
  if (oh !== undefined) {
    const names = Array.isArray(oh) ? oh : typeof oh === "object" && oh ? Object.keys(oh) : null;
    if (!names) errs.push("optional_hooks doit être un tableau de noms ou un objet {nom: booléen}");
    else {
      for (const n of names) if (!OPTIONAL_HOOKS[n]) errs.push(`optional_hooks : hook inconnu ${n} (connus : ${Object.keys(OPTIONAL_HOOKS).join(", ")})`);
      if (!Array.isArray(oh)) for (const [n, v] of Object.entries(oh)) if (typeof v !== "boolean") errs.push(`optional_hooks.${n} doit être true ou false`);
    }
  }
  for (const [key, known2] of [["optional_skills", OPTIONAL_SKILL_NAMES], ["optional_agents", OPTIONAL_AGENT_NAMES]]) {
    if (m[key] === undefined) continue;
    if (!Array.isArray(m[key])) errs.push(`${key} doit être un tableau`);
    else for (const n of m[key]) if (!known2.includes(n)) errs.push(`${key} : inconnu ${n} (disponibles : ${known2.join(", ")})`);
  }
  return errs;
}

function hookStates(m) {
  const st = {};
  for (const [n, h] of Object.entries(OPTIONAL_HOOKS)) st[n] = h.default;
  const oh = m.optional_hooks;
  if (Array.isArray(oh)) for (const n of oh) st[n] = true;
  else if (oh && typeof oh === "object") for (const [n, v] of Object.entries(oh)) st[n] = v;
  return st;
}

// "github:owner/repo" | URL git | chemin local (relatif au manifeste)
function parseSource(src, baseDir) {
  const gh = src.match(/^github:([\w.-]+\/[\w.-]+)$/);
  if (gh) return { kind: "github", repo: gh[1] };
  if (/^(https?:\/\/|git@|ssh:\/\/)/.test(src)) return { kind: "git", url: src };
  return { kind: "local", path: path.resolve(baseDir, src) };
}

function marketplaceEntry(p, baseDir) {
  const s = parseSource(p.source, baseDir);
  if (s.kind === "github") return { source: { source: "github", repo: s.repo, ...(p.ref ? { ref: p.ref } : {}) } };
  if (s.kind === "git") return { source: { source: "git", url: s.url, ...(p.ref ? { ref: p.ref } : {}) } };
  return { source: { source: "directory", path: s.path } };
}

// ---------------------------------------------------------------------------
// Étapes
// ---------------------------------------------------------------------------

const manifest = loadManifest();
const M = manifest.data;
const HOOK_STATE = hookStates(M);
const versionPath = path.join(TGT, ".claude", "harnais.version");
let prev = null;
try {
  prev = JSON.parse(fs.readFileSync(versionPath, "utf8"));
} catch (e) {
  prev = null;
}
const prevApplied = (prev && prev.applied) || { plugins: [], marketplaces: [], skills: [] };
const previousVersion = prev && prev.version ? String(prev.version) : null;
const preexistingProject = fs.readdirSync(TGT).some((n) => n !== ".git");

// 1) Fichiers possédés par le socle : hooks (+tests), skills du socle, règle de maintenance.
function installOwnedTree(relDir) {
  const abs = path.join(SRC, relDir);
  if (!fs.existsSync(abs)) return;
  for (const [r, buf] of readDirFiles(abs)) {
    const relPath = `${relDir}/${r.split(path.sep).join("/")}`;
    writeReport(path.join(TGT, relPath), buf, relPath);
  }
}
installOwnedTree(".claude/hooks");
installOwnedTree(".claude/rules");
const CORE_SKILLS = listNames(path.join(SRC, ".claude", "skills"), false);
for (const s of CORE_SKILLS) syncDir(readDirFiles(path.join(SRC, ".claude", "skills", s)), path.join(TGT, ".claude", "skills", s), `.claude/skills/${s}/`);
writeReport(path.join(TGT, ".claude", "harnais.manifest.schema.json"), fs.readFileSync(path.join(SRC, "harnais.manifest.schema.json")), ".claude/harnais.manifest.schema.json");

// 2) Skills et agents optionnels du socle.
const wantedOptSkills = new Set(M.optional_skills || []);
const wantedOptAgents = new Set(M.optional_agents || []);
const retired = [];
for (const s of OPTIONAL_SKILL_NAMES) {
  const dst = path.join(TGT, ".claude", "skills", s);
  if (wantedOptSkills.has(s)) {
    syncDir(readDirFiles(path.join(OPTIONAL_SKILLS_DIR, s)), dst, `.claude/skills/${s}/ (optionnel)`);
  } else if (vListFiles(dst).length && !KEEP_V1_SKILLS) {
    // Skill du socle v1 non retenu : mis de côté dans la sauvegarde (récupérable), pas supprimé.
    for (const f of vListFiles(dst)) vRemove(f);
    removeEmptyDirs(dst);
    retired.push(`.claude/skills/${s}/`);
  }
}
for (const a of OPTIONAL_AGENT_NAMES) {
  const dst = path.join(TGT, ".claude", "agents", `${a}.md`);
  if (wantedOptAgents.has(a)) writeReport(dst, fs.readFileSync(path.join(OPTIONAL_AGENTS_DIR, `${a}.md`)), `.claude/agents/${a}.md (optionnel)`);
  else if (vExists(dst) && !KEEP_V1_SKILLS) {
    vRemove(dst);
    retired.push(`.claude/agents/${a}.md`);
  }
}
for (const r of retired) report(`retiré du socle (copie dans ${BACKUP_REL}/)`, r);

// 3) Skills isolés du manifeste.
const appliedSkills = [];
const tmpRoots = [];
function fetchSkillSource(s) {
  const src = parseSource(s.from, manifest.dir);
  if (src.kind === "local") {
    const dir = path.join(src.path, s.path || "");
    if (!fs.existsSync(path.join(dir, "SKILL.md"))) throw new Error(`SKILL.md introuvable dans ${dir}`);
    return dir;
  }
  if (!s.ref) warnings.push(`skill ${s.name} : pas de ref épinglée, branche par défaut utilisée`);
  const url = src.kind === "github" ? `https://github.com/${src.repo}.git` : src.url;
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "harnais-skill-"));
  tmpRoots.push(tmp);
  const args = ["clone", "--quiet", "--depth", "1", ...(s.ref ? ["--branch", s.ref] : []), url, tmp];
  const res = spawnSync("git", args, { encoding: "utf8", timeout: 120000 });
  if (res.status !== 0) throw new Error(`git clone ${url}${s.ref ? `@${s.ref}` : ""} a échoué : ${(res.stderr || "").trim().slice(0, 200)}`);
  const dir = path.join(tmp, s.path || "");
  if (!fs.existsSync(path.join(dir, "SKILL.md"))) throw new Error(`SKILL.md introuvable dans ${s.path || "(racine)"}`);
  return dir;
}

function prepareSkillFiles(s, dir) {
  const files = readDirFiles(dir);
  const idx = files.findIndex(([r]) => r === "SKILL.md");
  const parts = splitFrontmatter(files[idx][1].toString("utf8"));
  if (!parts) throw new Error("SKILL.md sans frontmatter YAML");
  let fm = fmSet(parts.fm, "name", s.name);
  fm = fmSet(fm, "description", JSON.stringify(s.description));
  if (s.paths !== undefined) fm = fmSet(fm, "paths", JSON.stringify(Array.isArray(s.paths) ? s.paths.join(", ") : s.paths));
  files[idx] = ["SKILL.md", Buffer.from(`---\n${fm}\n---\n${parts.body}`, "utf8")];
  return files;
}

const coreAndOptional = new Set([...CORE_SKILLS, ...OPTIONAL_SKILL_NAMES]);
for (const s of M.skills || []) {
  const dst = path.join(TGT, ".claude", "skills", s.name);
  const label = `.claude/skills/${s.name}/ (manifeste)`;
  if (coreAndOptional.has(s.name)) {
    warnings.push(`skill ${s.name} : nom réservé au socle, ignoré`);
    continue;
  }
  const exists = vListFiles(dst).length > 0;
  if (exists && !prevApplied.skills.includes(s.name)) {
    warnings.push(`skill ${s.name} : .claude/skills/${s.name}/ existe déjà et n'a pas été posé par le manifeste — laissé intact (renomme l'entrée du manifeste)`);
    continue;
  }
  try {
    if (DRY && parseSource(s.from, manifest.dir).kind !== "local") {
      report(exists ? "serait revérifié (non téléchargé en --dry-run)" : "serait copié (non téléchargé en --dry-run)", label);
      overlay.set(path.join(dst, "SKILL.md"), Buffer.from(`---\nname: ${s.name}\ndescription: ${JSON.stringify(s.description)}\n---\n`));
    } else {
      syncDir(prepareSkillFiles(s, fetchSkillSource(s)), dst, label);
    }
    appliedSkills.push(s.name);
  } catch (e) {
    warnings.push(`skill ${s.name} : ${e.message}`);
    if (prevApplied.skills.includes(s.name)) appliedSkills.push(s.name); // reste suivi
  }
}
for (const t of tmpRoots) fs.rmSync(t, { recursive: true, force: true });
for (const old of prevApplied.skills) {
  if (!appliedSkills.includes(old) && !(M.skills || []).some((s) => s.name === old))
    notes.push(`skill ${old} : retiré du manifeste, dossier .claude/skills/${old}/ laissé en place (supprime-le à la main si inutile)`);
}

// 4) SESSION.md / LESSONS.md : créés seulement s'ils manquent.
for (const f of ["SESSION.md", "LESSONS.md"]) {
  const dst = path.join(TGT, f);
  if (vExists(dst)) report("conservé (existe déjà)", f);
  else writeReport(dst, fs.readFileSync(path.join(SRC, "templates", f)), f);
}

// 5) Blocs entre marqueurs : CLAUDE.md, .gitignore.
function mergeMarkedBlock(abs, label, block, startRe, endMarker, freshExtra) {
  if (!vExists(abs)) {
    writeReport(abs, freshExtra ? `${block}\n\n${freshExtra}\n` : `${block}\n`, label);
    return;
  }
  const existing = vReadText(abs);
  const eol = eolOf(existing);
  const m = existing.match(startRe);
  let updated;
  if (m) {
    const endIdx = existing.indexOf(endMarker, m.index);
    if (endIdx === -1) fail(`${label} : marqueur de début trouvé sans marqueur de fin — fichier à réparer à la main.`);
    updated = existing.slice(0, m.index) + withEol(block, eol) + existing.slice(endIdx + endMarker.length);
  } else {
    const sep = existing.endsWith("\n") ? eol : eol + eol;
    updated = existing + sep + withEol(block, eol) + eol;
  }
  const st = vWrite(abs, updated);
  report(st === "identique" ? "identique" : m ? "bloc harnais mis à jour (sauvegardé)" : "bloc harnais ajouté (sauvegardé)", label);
}

const coreText = fs.readFileSync(path.join(SRC, "templates", "CLAUDE.core.md"), "utf8").replace(/\r\n/g, "\n").trimEnd();
const claudeBlock = `${CLAUDE_START}\n${coreText}\n${CLAUDE_END}`;
mergeMarkedBlock(path.join(TGT, "CLAUDE.md"), "CLAUDE.md", claudeBlock, CLAUDE_START_RE, CLAUDE_END, null);
mergeMarkedBlock(
  path.join(TGT, ".gitignore"),
  ".gitignore",
  `${GITIGNORE_START}\n${GITIGNORE_GUARD_BODY}\n${GITIGNORE_END}`,
  new RegExp(GITIGNORE_START.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")),
  GITIGNORE_END,
  GITIGNORE_STACK_NOISE
);

// 6) settings.json : hooks (socle + optionnels), deny, anti-bypass, statusline, plugins.
function mergeSettings() {
  const label = ".claude/settings.json";
  const abs = path.join(TGT, ".claude", "settings.json");
  const socle = JSON.parse(fs.readFileSync(path.join(SRC, ".claude", "settings.json"), "utf8"));
  let s;
  if (vExists(abs)) {
    try {
      s = JSON.parse(vReadText(abs));
    } catch (e) {
      fail(`${label} du projet n'est pas un JSON valide (${e.message}) — répare-le avant d'installer le socle.`);
    }
  } else {
    // autoCompactEnabled:false n'a de sens qu'avec le filet hard-stop-guard.
    s = HOOK_STATE["hard-stop-guard"] ? { autoCompactEnabled: socle.autoCompactEnabled } : {};
  }
  if (!HOOK_STATE["hard-stop-guard"] && s.autoCompactEnabled === false)
    warnings.push("autoCompactEnabled vaut false alors que hard-stop-guard est désactivé : plus de filet de contexte. Mets-le à true dans .claude/settings.json si c'est voulu.");
  const before = JSON.stringify(s, null, 2);

  // Commandes des hooks optionnels désactivés : retirées du socle et du projet.
  const disabledCmds = new Set();
  for (const [n, h] of Object.entries(OPTIONAL_HOOKS)) if (!HOOK_STATE[n]) for (const e of h.entries) disabledCmds.add(e.command);
  const socleHooks = JSON.parse(JSON.stringify(socle.hooks || {}));
  for (const [n, h] of Object.entries(OPTIONAL_HOOKS)) {
    if (!HOOK_STATE[n]) continue;
    for (const e of h.entries) {
      socleHooks[e.event] = socleHooks[e.event] || [];
      const has = socleHooks[e.event].some((x) => (x.hooks || []).some((y) => y.command === e.command));
      if (!has) socleHooks[e.event].push({ ...(e.matcher ? { matcher: e.matcher } : {}), hooks: [{ type: "command", command: e.command }] });
    }
  }
  s.hooks = s.hooks || {};
  for (const ev of Object.keys(s.hooks)) {
    s.hooks[ev] = s.hooks[ev]
      .map((x) => ({ ...x, hooks: (x.hooks || []).filter((y) => !disabledCmds.has(y.command)) }))
      .filter((x) => x.hooks.length > 0);
    if (s.hooks[ev].length === 0) delete s.hooks[ev];
  }
  for (const [ev, entries] of Object.entries(socleHooks)) {
    for (const entry of entries) {
      const cmds = (entry.hooks || []).map((h) => h.command);
      if (cmds.some((c) => disabledCmds.has(c))) continue;
      s.hooks[ev] = s.hooks[ev] || [];
      const present = new Set(s.hooks[ev].flatMap((x) => (x.hooks || []).map((y) => y.command)));
      if (!cmds.every((c) => present.has(c))) s.hooks[ev].push(entry);
    }
  }

  if (socle.statusLine && !s.statusLine) s.statusLine = socle.statusLine;
  else if (socle.statusLine && JSON.stringify(s.statusLine) !== JSON.stringify(socle.statusLine))
    notes.push("statusLine existante conservée — les watchdogs contexte/crédits restent inactifs sans le capteur du socle");

  s.permissions = s.permissions || {};
  const deny = new Set(s.permissions.deny || []);
  for (const r of (socle.permissions && socle.permissions.deny) || []) deny.add(r);
  s.permissions.deny = [...deny];
  if (s.permissions.disableBypassPermissionsMode !== "disable") {
    if (s.permissions.disableBypassPermissionsMode !== undefined) warnings.push('disableBypassPermissionsMode ramené à "disable" (garantie du socle)');
    s.permissions.disableBypassPermissionsMode = "disable";
  }

  // Plugins : marketplaces + activation par projet. Retrait seulement de ce que le
  // manifeste avait ajouté lui-même.
  const plugins = M.plugins || [];
  const wantedMk = {};
  const wantedPl = [];
  for (const p of plugins) {
    if (!p.ref && parseSource(p.source, manifest.dir).kind !== "local") warnings.push(`plugin ${p.name} : pas de ref épinglée`);
    wantedMk[p.marketplace] = marketplaceEntry(p, manifest.dir);
    wantedPl.push(`${p.name}@${p.marketplace}`);
  }
  if (plugins.length || prevApplied.plugins.length || prevApplied.marketplaces.length) {
    s.extraKnownMarketplaces = s.extraKnownMarketplaces || {};
    s.enabledPlugins = s.enabledPlugins || {};
    for (const mk of prevApplied.marketplaces) if (!(mk in wantedMk)) delete s.extraKnownMarketplaces[mk];
    for (const pl of prevApplied.plugins) if (!wantedPl.includes(pl)) delete s.enabledPlugins[pl];
    for (const [mk, entry] of Object.entries(wantedMk)) s.extraKnownMarketplaces[mk] = entry;
    for (const pl of wantedPl) s.enabledPlugins[pl] = true;
    if (!Object.keys(s.extraKnownMarketplaces).length) delete s.extraKnownMarketplaces;
    if (!Object.keys(s.enabledPlugins).length) delete s.enabledPlugins;
  }

  const after = JSON.stringify(s, null, 2);
  if (after === before && vExists(abs)) return report("identique", label);
  writeReport(abs, after + "\n", label);
}
mergeSettings();
const appliedPlugins = (M.plugins || []).map((p) => `${p.name}@${p.marketplace}`);
const appliedMarketplaces = [...new Set((M.plugins || []).map((p) => p.marketplace))];

// 7) État des hooks optionnels (lu par le planificateur de reprise).
writeReport(path.join(TGT, ".claude", "harnais.hooks.json"), JSON.stringify({ hooks: HOOK_STATE }, null, 2) + "\n", ".claude/harnais.hooks.json");

// 8) Version installée et ce que le manifeste a posé (pour les retraits futurs).
const applied = { plugins: appliedPlugins, marketplaces: appliedMarketplaces, skills: appliedSkills };
const sameApplied = prev && JSON.stringify(prev.applied || null) === JSON.stringify(applied);
if (prev && prev.version === VERSION && prev.commit === commit && sameApplied) {
  report("identique", ".claude/harnais.version");
} else {
  const info = { version: VERSION, installedAt: new Date().toISOString(), commit, applied };
  writeReport(versionPath, JSON.stringify(info) + "\n", ".claude/harnais.version");
}

// 9) Budget de descriptions (skills appelables par le modèle + agents).
let budget = 0;
const budgetLines = [];
const skillsRoot = path.join(TGT, ".claude", "skills");
for (const name of vListDirs(skillsRoot)) {
  const md = path.join(skillsRoot, name, "SKILL.md");
  if (!vExists(md)) continue;
  const { cost, manual } = skillDescriptionCost(vReadText(md));
  budget += cost;
  budgetLines.push(`${name}=${manual ? "manuel" : cost}`);
}
const agentsRoot = path.join(TGT, ".claude", "agents");
for (const f of vListFiles(agentsRoot).filter((x) => x.endsWith(".md"))) {
  const { cost } = skillDescriptionCost(vReadText(f));
  budget += cost;
  budgetLines.push(`agent:${path.basename(f, ".md")}=${cost}`);
}

// 10) Restes de la v1 à regarder (jamais supprimés automatiquement).
function findBak(dir, depth, out) {
  if (depth > 6) return out;
  let entries = [];
  try {
    entries = fs.readdirSync(dir, { withFileTypes: true });
  } catch (e) {
    return out;
  }
  for (const e of entries) {
    if (["node_modules", ".git", "harnais-backups"].includes(e.name)) continue;
    const full = path.join(dir, e.name);
    if (e.isDirectory()) findBak(full, depth + 1, out);
    else if (e.name.endsWith(".harnais-bak")) out.push(rel(full));
  }
  return out;
}
const baks = findBak(TGT, 0, []);

// ---------------------------------------------------------------------------
// Plugins : installation optionnelle via le CLI claude
// ---------------------------------------------------------------------------

const pluginCmds = [];
for (const p of M.plugins || []) {
  const s = parseSource(p.source, manifest.dir);
  const mkArg = s.kind === "github" ? `${s.repo}${p.ref ? `#${p.ref}` : ""}` : s.kind === "git" ? `${s.url}${p.ref ? `#${p.ref}` : ""}` : s.path;
  pluginCmds.push(["plugin", "marketplace", "add", mkArg]);
  pluginCmds.push(["plugin", "install", `${p.name}@${p.marketplace}`, "--scope", "project"]);
}
const pluginResults = [];
if (INSTALL_PLUGINS && !DRY && pluginCmds.length) {
  for (const c of pluginCmds) {
    const res = spawnSync("claude", c, { cwd: TGT, encoding: "utf8", timeout: 300000 });
    const out = `${res.stdout || ""}${res.stderr || ""}`.trim().split("\n").slice(-2).join(" | ");
    pluginResults.push(`  claude ${c.join(" ")} -> ${res.status === 0 ? "OK" : `KO (${res.error ? res.error.code : res.status})`} ${out.slice(0, 200)}`);
  }
}

// ---------------------------------------------------------------------------
// Rapport
// ---------------------------------------------------------------------------

let banner;
if (!previousVersion) banner = `Socle Harnais v${VERSION} (${commit}) — installation dans ${TGT}`;
else if (previousVersion === VERSION) banner = `Socle Harnais v${VERSION} (${commit}) — déjà à jour dans ${TGT} (fichiers revérifiés)`;
else banner = `Socle Harnais : mise à jour v${previousVersion} → v${VERSION} (${commit}) dans ${TGT}`;
const out = [];
if (DRY) out.push("MODE --dry-run : aucune écriture.");
out.push(banner);
if (manifest.path) out.push(`Manifeste : ${rel(manifest.path) || manifest.path}`);
const changed = summary.filter((l) => !/\[identique\]|\[conservé/.test(l));
out.push(...changed);
out.push(`  (${summary.length - changed.length} fichier(s) identique(s) ou conservé(s))`);
if (backupUsed) out.push(`Sauvegarde ${DRY ? "prévue" : "faite"} : ${BACKUP_REL}/`);
out.push(
  `Hooks optionnels : ${Object.entries(HOOK_STATE)
    .map(([n, v]) => `${n}=${v ? "on" : "off"}`)
    .join(", ")}`
);
out.push(`Budget descriptions : ${budget} / ${DESCRIPTION_BUDGET} car. (${budgetLines.join(", ") || "aucune"}) ; descriptions des plugins non comptées.`);
if (budget > DESCRIPTION_BUDGET)
  warnings.push(`budget de descriptions dépassé (${budget} > ${DESCRIPTION_BUDGET}) : retire des skills du manifeste ou marque les skills manuels disable-model-invocation: true`);
if (pluginCmds.length) {
  if (pluginResults.length) out.push("Plugins (claude CLI) :", ...pluginResults);
  else
    out.push(
      "Plugins déclarés dans settings.json. Claude Code ne les installe pas seul : une fois par machine, depuis ce dossier :",
      ...pluginCmds.map((c) => `  claude ${c.join(" ")}`),
      "  (ou relance l'installeur avec --install-plugins)"
    );
}
if (baks.length) out.push(`Fichiers *.harnais-bak de la v1 (non supprimés, à effacer à la main s'ils ne servent plus) :`, ...baks.map((b) => `  ${b}`));
if (fs.existsSync(path.join(TGT, "MONITORING.csv"))) notes.push("MONITORING.csv (v1) n'est plus utilisé par le socle v2 ; laissé en place.");
for (const n of notes) out.push(`Note : ${n}`);
for (const w of warnings) out.push(`ATTENTION : ${w}`);
if (!DRY) {
  out.push("Ensuite :");
  out.push("  - Si une session Claude Code tourne sur ce projet, redémarre-la (hooks et settings se chargent au démarrage).");
  out.push("  - Tests du socle : node .claude/hooks/tests/run-all.js");
  if (preexistingProject && !previousVersion)
    out.push("  - Projet existant : le .gitignore n'agit que pour l'avenir ; vérifie que l'historique git ne contient pas de secret.");
}
process.stdout.write(out.join("\n") + "\n");
