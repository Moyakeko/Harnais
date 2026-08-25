#!/usr/bin/env node
/**
 * SessionStart hook — vérifie (au plus 1×/24h, jamais bloquant) si une version plus
 * récente du socle Harnais est publiée sur GitHub, et si oui injecte un rappel pour
 * que Claude le signale à l'utilisateur et propose la skill update-harnais — ne met
 * jamais à jour lui-même (invariant EVOLUTION.md : confirmation humaine explicite
 * avant toute action à large impact).
 *
 * Fail-open systématique : absence de .claude/harnais.version (projet non installé,
 * ou dépôt source du socle lui-même — ce dépôt n'a pas ce fichier), erreur réseau,
 * timeout, ou JSON invalide -> silence complet, exit 0. Throttle dans
 * .claude/harnais-update-check.json (gitignored) : un échec réseau ne met PAS à jour
 * lastCheckedAt, pour retenter dès la prochaine session plutôt que d'attendre 24h de
 * plus après un simple accroc réseau.
 *
 * Pas d'état "déjà notifié, ne plus redemander" (choix assumé, voir SOURCES.md V1.12) :
 * le rappel revient au rythme du throttle tant que la version installée n'a pas
 * changé — se résout naturellement dès que l'utilisateur met à jour.
 */

const fs = require("fs");
const path = require("path");
const { logMetric } = require("./lib/metrics");
const { compareVersions, resolveLatestTag } = require("./lib/latest-version");

const REPO = "Moyakeko/Harnais";
const CHECK_INTERVAL_MS = 24 * 60 * 60 * 1000;
const TIMEOUT_MS = 3000;

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

// Mocks de test (patron *_DRY_RUN déjà en usage dans ce socle) : quand
// HARNAIS_UPDATE_CHECK_MOCK_TAGS/_MOCK_ERROR sont posées, court-circuite le vrai
// appel réseau pour des tests déterministes et hors-ligne.
function buildMockFetchTags() {
  if (process.env.HARNAIS_UPDATE_CHECK_MOCK_ERROR === "1") {
    return () => Promise.resolve(null);
  }
  const raw = process.env.HARNAIS_UPDATE_CHECK_MOCK_TAGS;
  if (raw === undefined) return undefined;
  const names = raw
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);
  return () => Promise.resolve(names.map((name) => ({ name })));
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
    const installedVersion =
      versionInfo && typeof versionInfo.version === "string" ? versionInfo.version : null;
    if (!installedVersion) {
      logMetric("hook:update-check", "skip", "pas de harnais.version (non installé ou dépôt source)");
      process.exit(0);
    }

    const stateFile = path.join(projectDir, ".claude", "harnais-update-check.json");
    const state = loadJson(stateFile) || {};
    const now = Date.now();
    const force = process.env.HARNAIS_UPDATE_CHECK_FORCE === "1";
    const due = force || !state.lastCheckedAt || now - state.lastCheckedAt >= CHECK_INTERVAL_MS;

    if (!due) {
      logMetric("hook:update-check", "skip-throttled", "");
      process.exit(0);
    }

    const fetchTags = buildMockFetchTags();
    const latestTag = await resolveLatestTag({ repo: REPO, timeoutMs: TIMEOUT_MS, fetchTags });

    if (!latestTag) {
      logMetric("hook:update-check", "skip-fetch-failed", "");
      process.exit(0);
    }

    state.lastCheckedAt = now;
    state.lastLatestTag = latestTag;
    saveState(stateFile, state);

    const latestVersion = latestTag.replace(/^v/, "");
    if (compareVersions(latestVersion, installedVersion) <= 0) {
      logMetric("hook:update-check", "up-to-date", `installé=${installedVersion} distant=${latestVersion}`);
      process.exit(0);
    }

    const message =
      `Le socle Harnais installé sur ce projet est en version v${installedVersion} ; ` +
      `la dernière version publiée est v${latestVersion}. Signale-le à l'utilisateur en ` +
      `début de conversation et propose de lancer la skill update-harnais — ne lance ` +
      `jamais la mise à jour toi-même sans confirmation explicite.`;

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
    logMetric("hook:update-check", "update-available", `installé=${installedVersion} distant=${latestVersion}`);
    process.exit(0);
  } catch (e) {
    logMetric("hook:update-check", "error", String(e).slice(0, 100));
    process.exit(0);
  }
}

main();
