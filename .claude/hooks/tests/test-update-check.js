#!/usr/bin/env node
// Batterie de tests pour update-check.js (SessionStart, V1.12) : vérifie le
// fail-open (pas de harnais.version, erreur réseau simulée), la comparaison de
// version, le throttle 24h, et la robustesse aux payloads malformés. Utilise
// HARNAIS_UPDATE_CHECK_MOCK_TAGS/_MOCK_ERROR/_FORCE pour rester déterministe et
// hors-ligne (aucun vrai appel réseau dans cette batterie).
const { spawnSync } = require("child_process");
const fs = require("fs");
const os = require("os");
const path = require("path");

const HOOKS = path.join(__dirname, "..");

function run(payload, extraEnv) {
  const input = payload === undefined ? "" : typeof payload === "string" ? payload : JSON.stringify(payload);
  return spawnSync("node", [path.join(HOOKS, "update-check.js")], {
    input,
    encoding: "utf8",
    env: { ...process.env, ...extraEnv },
  });
}

function mkProject() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "update-check-test-"));
  fs.mkdirSync(path.join(dir, ".claude"), { recursive: true });
  return dir;
}

function writeHarnaisVersion(dir, version) {
  fs.writeFileSync(
    path.join(dir, ".claude", "harnais.version"),
    JSON.stringify({ version, installedAt: new Date().toISOString(), commit: "test" })
  );
}

function readState(dir) {
  try {
    return JSON.parse(fs.readFileSync(path.join(dir, ".claude", "harnais-update-check.json"), "utf8"));
  } catch (e) {
    return null;
  }
}

let pass = 0;
const fails = [];
function check(label, ok) {
  if (ok) pass++;
  else fails.push(`ÉCHEC: ${label}`);
}

// --- Robustesse : payloads vides/invalides => toujours exit 0 ---
for (const raw of [undefined, "", "{}", "pas du json"]) {
  const dir = mkProject();
  writeHarnaisVersion(dir, "1.0");
  const res = run(raw, { CLAUDE_PROJECT_DIR: dir, HARNAIS_UPDATE_CHECK_MOCK_TAGS: "v1.0" });
  check(`payload=${JSON.stringify(raw)} => exit 0`, res.status === 0);
  fs.rmSync(dir, { recursive: true, force: true });
}

// --- Pas de harnais.version (projet non installé, ou dépôt source du socle) : silence ---
{
  const dir = mkProject();
  const res = run({ session_id: "s1" }, { CLAUDE_PROJECT_DIR: dir, HARNAIS_UPDATE_CHECK_MOCK_TAGS: "v9.9" });
  check("sans harnais.version => exit 0", res.status === 0);
  check("sans harnais.version => pas d'additionalContext", !res.stdout.includes("additionalContext"));
  fs.rmSync(dir, { recursive: true, force: true });
}

// --- Version distante plus récente => additionalContext avec les deux numéros ---
{
  const dir = mkProject();
  writeHarnaisVersion(dir, "1.10");
  const res = run(
    { session_id: "s2" },
    { CLAUDE_PROJECT_DIR: dir, HARNAIS_UPDATE_CHECK_MOCK_TAGS: "v1.2,v1.10,v1.12,v1.9" }
  );
  check("update dispo => exit 0", res.status === 0);
  check("update dispo => additionalContext présent", res.stdout.includes("additionalContext"));
  check("update dispo => mentionne la version installée", res.stdout.includes("v1.10"));
  check("update dispo => mentionne la dernière version (tri numérique, pas lexical)", res.stdout.includes("v1.12"));
  check("update dispo => mentionne update-harnais", res.stdout.includes("update-harnais"));
  const state = readState(dir);
  check("update dispo => throttle state écrit", !!(state && state.lastCheckedAt));
  fs.rmSync(dir, { recursive: true, force: true });
}

// --- Version installée déjà la plus récente/en avance => rien ---
{
  const dir = mkProject();
  writeHarnaisVersion(dir, "1.12");
  const res = run({ session_id: "s3" }, { CLAUDE_PROJECT_DIR: dir, HARNAIS_UPDATE_CHECK_MOCK_TAGS: "v1.10,v1.12" });
  check("déjà à jour => exit 0", res.status === 0);
  check("déjà à jour => pas d'additionalContext", !res.stdout.includes("additionalContext"));

  const dir2 = mkProject();
  writeHarnaisVersion(dir2, "1.99");
  const res2 = run({ session_id: "s3b" }, { CLAUDE_PROJECT_DIR: dir2, HARNAIS_UPDATE_CHECK_MOCK_TAGS: "v1.12" });
  check("version installée en avance => pas d'additionalContext", !res2.stdout.includes("additionalContext"));
  fs.rmSync(dir, { recursive: true, force: true });
  fs.rmSync(dir2, { recursive: true, force: true });
}

// --- Erreur réseau simulée => fail-open, pas de crash, throttle non mis à jour ---
{
  const dir = mkProject();
  writeHarnaisVersion(dir, "1.0");
  const res = run({ session_id: "s4" }, { CLAUDE_PROJECT_DIR: dir, HARNAIS_UPDATE_CHECK_MOCK_ERROR: "1" });
  check("erreur réseau => exit 0", res.status === 0);
  check("erreur réseau => pas d'additionalContext", !res.stdout.includes("additionalContext"));
  check("erreur réseau => throttle NON écrit (retente à la prochaine session)", readState(dir) === null);
  fs.rmSync(dir, { recursive: true, force: true });
}

// --- Throttle 24h : un check déjà récent ignore un nouveau tag disponible ---
{
  const dir = mkProject();
  writeHarnaisVersion(dir, "1.0");
  fs.writeFileSync(
    path.join(dir, ".claude", "harnais-update-check.json"),
    JSON.stringify({ lastCheckedAt: Date.now() - 60 * 1000, lastLatestTag: "v1.0" })
  );
  const res = run({ session_id: "s5" }, { CLAUDE_PROJECT_DIR: dir, HARNAIS_UPDATE_CHECK_MOCK_TAGS: "v9.9" });
  check("check récent (<24h) => pas de nouvel appel, silence", !res.stdout.includes("additionalContext"));

  const forced = run(
    { session_id: "s5b" },
    { CLAUDE_PROJECT_DIR: dir, HARNAIS_UPDATE_CHECK_MOCK_TAGS: "v9.9", HARNAIS_UPDATE_CHECK_FORCE: "1" }
  );
  check("FORCE=1 => bypass le throttle", forced.stdout.includes("additionalContext"));
  check("FORCE=1 => mentionne la version forcée", forced.stdout.includes("v9.9"));
  fs.rmSync(dir, { recursive: true, force: true });
}

console.log(`${pass}/${pass + fails.length} tests OK`);
if (fails.length) {
  console.log(fails.join("\n"));
  process.exit(1);
}
