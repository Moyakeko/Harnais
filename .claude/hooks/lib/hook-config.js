/**
 * lib/hook-config.js — état des hooks optionnels d'un projet.
 *
 * install/apply.js écrit .claude/harnais.hooks.json à partir du manifeste
 * (`optional_hooks`). Les hooks enregistrés dans settings.json sont activés ou
 * retirés directement par l'installeur ; ce fichier sert aux hooks qui ne sont
 * pas enregistrés eux-mêmes (resume-after-reset, planifié par credit-watchdog
 * et hard-stop-guard). Absent ou illisible : tout ce qui est actif par défaut
 * en v1 reste actif.
 */

const fs = require("fs");
const path = require("path");

function hookEnabled(name, projectDir) {
  try {
    const dir = projectDir || process.env.CLAUDE_PROJECT_DIR || process.cwd();
    const cfg = JSON.parse(fs.readFileSync(path.join(dir, ".claude", "harnais.hooks.json"), "utf8"));
    if (cfg && cfg.hooks && cfg.hooks[name] === false) return false;
    return true;
  } catch (e) {
    return true;
  }
}

module.exports = { hookEnabled };
