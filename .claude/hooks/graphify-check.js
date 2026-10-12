#!/usr/bin/env node
/**
 * SessionStart hook — rappelle (au plus 1×/7j, jamais bloquant) que la skill
 * `graphify` existe quand ce repo semble volumineux ou de stack peu claire et que
 * graphify n'a jamais été utilisé ici. Ne lance ni n'installe jamais graphify
 * lui-même (invariant EVOLUTION.md : confirmation humaine explicite avant toute
 * installation à large blast radius — voir .claude/skills/graphify/SKILL.md pour
 * les vérifications security-audit/sandbox-pretest obligatoires).
 *
 * Contrairement à update-check.js, ce hook ne fait AUCUN appel réseau : il n'y a
 * pas de version distante à comparer, juste un état local du repo. L'heuristique
 * "volumineux/inconnu" (comptage de fichiers borné + absence de manifeste de stack
 * reconnu) est volontairement simple côté fs — elle ne vérifie PAS si l'outil
 * `graphify` est réellement installé sur la machine : ce serait un appel process
 * externe, hors de ce qu'un hook fs-only fait par conception. Le seul signal
 * "graphify déjà utilisé ici" vient de harnais-metrics.jsonl (télémétrie locale
 * déjà existante), lu de façon bornée (dernière tranche du fichier seulement).
 *
 * Fail-open systématique : absence de .claude/harnais.version (projet non
 * installé, ou dépôt source du socle lui-même), erreur fs, ou JSON invalide ->
 * silence complet, exit 0. Throttle dans .claude/harnais-graphify-check.json
 * (gitignored) : contrairement à update-check.js, l'horodatage n'est mis à jour
 * que lorsque le rappel est effectivement affiché (pas à chaque vérification) —
 * ici la vérification elle-même est gratuite (aucun réseau), seul le rappel répété
 * serait une nuisance.
 */

const fs = require("fs");
const path = require("path");
const { logMetric } = require("./lib/metrics");

const CHECK_INTERVAL_MS = 7 * 24 * 60 * 60 * 1000;
const FILE_COUNT_THRESHOLD = 200;
const EXCLUDE_DIRS = new Set(["node_modules", ".git", "venv", ".venv", "dist", "build", "target", "__pycache__"]);
const STACK_MANIFESTS = ["package.json", "requirements.txt", "pyproject.toml", "Cargo.toml", "go.mod", "pom.xml"];
const METRICS_TAIL_BYTES = 50 * 1024;

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

// Comptage borné : s'arrête dès que le seuil est dépassé plutôt que de compter
// exhaustivement un repo de dizaines de milliers de fichiers.
function countFilesBounded(rootDir, limit, excludeDirs) {
  let count = 0;
  const stack = [rootDir];
  while (stack.length) {
    const current = stack.pop();
    let entries;
    try {
      entries = fs.readdirSync(current, { withFileTypes: true });
    } catch (e) {
      continue;
    }
    for (const entry of entries) {
      if (entry.isDirectory()) {
        if (excludeDirs.has(entry.name)) continue;
        stack.push(path.join(current, entry.name));
      } else {
        count++;
        if (count > limit) return count;
      }
    }
  }
  return count;
}

function repoLooksUnknownOrLarge(projectDir) {
  const mockCount = process.env.HARNAIS_GRAPHIFY_CHECK_MOCK_FILECOUNT;
  let fileCount;
  if (mockCount !== undefined) {
    fileCount = parseInt(mockCount, 10);
    if (Number.isNaN(fileCount)) fileCount = 0;
  } else {
    fileCount = countFilesBounded(projectDir, FILE_COUNT_THRESHOLD, EXCLUDE_DIRS);
  }
  const large = fileCount > FILE_COUNT_THRESHOLD;
  const hasManifest = STACK_MANIFESTS.some((m) => fs.existsSync(path.join(projectDir, m)));
  return { trigger: large || !hasManifest, fileCount, hasManifest };
}

// Lecture bornée (dernière tranche seulement) : harnais-metrics.jsonl "grossit
// vite, voulu" (CLAUDE.md) — jamais un readFileSync complet depuis un hook.
function wasGraphifyUsed(projectDir) {
  const mock = process.env.HARNAIS_GRAPHIFY_CHECK_MOCK_USED;
  if (mock !== undefined) return mock === "1";
  const file = path.join(projectDir, ".claude", "harnais-metrics.jsonl");
  try {
    const stat = fs.statSync(file);
    const start = Math.max(0, stat.size - METRICS_TAIL_BYTES);
    const length = stat.size - start;
    const fd = fs.openSync(file, "r");
    const buffer = Buffer.alloc(length);
    fs.readSync(fd, buffer, 0, length, start);
    fs.closeSync(fd);
    return buffer.toString("utf8").includes('"source":"skill:graphify"');
  } catch (e) {
    return false;
  }
}

async function main() {
  try {
    await readStdin(); // payload non utilisé ici, mais on vide le pipe par convention.
  } catch (e) {
    // ignoré
  }

  try {
    const projectDir = process.env.CLAUDE_PROJECT_DIR || process.cwd();
    const versionInfo = loadJson(path.join(projectDir, ".claude", "harnais.version"));
    if (!versionInfo) {
      logMetric("hook:graphify-check", "skip", "pas de harnais.version (non installé ou dépôt source)");
      process.exit(0);
    }

    const stateFile = path.join(projectDir, ".claude", "harnais-graphify-check.json");
    const state = loadJson(stateFile) || {};
    const now = Date.now();
    const force = process.env.HARNAIS_GRAPHIFY_CHECK_FORCE === "1";
    const due = force || !state.lastShownAt || now - state.lastShownAt >= CHECK_INTERVAL_MS;

    if (!due) {
      logMetric("hook:graphify-check", "skip-throttled", "");
      process.exit(0);
    }

    if (wasGraphifyUsed(projectDir)) {
      logMetric("hook:graphify-check", "skip-already-used", "");
      process.exit(0);
    }

    const { trigger, fileCount, hasManifest } = repoLooksUnknownOrLarge(projectDir);
    if (!trigger) {
      logMetric("hook:graphify-check", "skip-small-known-repo", `fichiers=${fileCount} manifest=${hasManifest}`);
      process.exit(0);
    }

    state.lastShownAt = now;
    saveState(stateFile, state);

    const message =
      "Ce repo semble volumineux ou de stack peu claire, et la skill `graphify` n'a " +
      "jamais été utilisée ici — mentionne-la une fois à l'utilisateur comme option " +
      "de cartographie d'architecture si c'est pertinent pour la tâche en cours. Ne " +
      "l'installe ni ne la lance jamais toi-même : c'est une suggestion, pas une " +
      "action (voir .claude/skills/graphify/SKILL.md pour les vérifications " +
      "security-audit/sandbox-pretest obligatoires avant toute première installation).";

    process.stdout.write(
      JSON.stringify({
        continue: true,
        suppressOutput: true,
        hookSpecificOutput: {
          hookEventName: "SessionStart",
          additionalContext: message,
        },
      })
    );
    logMetric("hook:graphify-check", "reminder-shown", `fichiers=${fileCount} manifest=${hasManifest}`);
    process.exit(0);
  } catch (e) {
    logMetric("hook:graphify-check", "error", String(e).slice(0, 100));
    process.exit(0);
  }
}

main();
