/**
 * lib/metrics.js — journal d'usage local du socle (.claude/harnais-metrics.jsonl,
 * gitignored, jamais versionné). Une ligne JSON par invocation d'un hook ou d'une
 * skill. Best-effort intégral : une erreur d'écriture ne doit jamais remonter à
 * l'appelant ni changer son comportement ou son code de sortie — c'est de la
 * télémétrie, pas un mécanisme dont dépend le socle.
 *
 * Double usage : require()-able en-process par les hooks (rapide, pas de
 * sous-process), et exécutable en CLI pour que les skills journalisent via une
 * seule commande Bash sans avoir à construire du JSON à la main.
 */

const fs = require("fs");
const path = require("path");

const MAX_DETAIL_LEN = 200;

function logMetric(source, category, detail) {
  try {
    const projectDir = process.env.CLAUDE_PROJECT_DIR || process.cwd();
    const file = path.join(projectDir, ".claude", "harnais-metrics.jsonl");
    const line = JSON.stringify({
      timestamp: new Date().toISOString(),
      source: String(source || "inconnu"),
      category: String(category || "inconnu"),
      detail: String(detail == null ? "" : detail).slice(0, MAX_DETAIL_LEN),
    });
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.appendFileSync(file, line + "\n", "utf8");
    return true;
  } catch (e) {
    return false;
  }
}

if (require.main === module) {
  const [source, category, detail] = process.argv.slice(2);
  if (!source || !category) {
    process.stderr.write('usage: node metrics.js "<source>" "<category>" ["<detail>"]\n');
    process.exit(1);
  }
  logMetric(source, category, detail);
  process.exit(0);
}

module.exports = { logMetric };
