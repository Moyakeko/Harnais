#!/usr/bin/env node
// Batterie de tests pour graphify-check.js (SessionStart, V1.16) : vérifie le
// fail-open (pas de harnais.version, payloads malformés), l'heuristique
// volumineux/inconnu (via HARNAIS_GRAPHIFY_CHECK_MOCK_FILECOUNT), le signal
// "déjà utilisé" (via HARNAIS_GRAPHIFY_CHECK_MOCK_USED), et le throttle 7 jours.
// Aucun vrai appel réseau ni comptage fs réel dans cette batterie (mocks).
const { spawnSync } = require("child_process");
const fs = require("fs");
const os = require("os");
const path = require("path");

const HOOKS = path.join(__dirname, "..");

function run(payload, extraEnv) {
  const input = payload === undefined ? "" : typeof payload === "string" ? payload : JSON.stringify(payload);
  return spawnSync("node", [path.join(HOOKS, "graphify-check.js")], {
    input,
    encoding: "utf8",
    env: { ...process.env, ...extraEnv },
  });
}

function mkProject() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "graphify-check-test-"));
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
    return JSON.parse(fs.readFileSync(path.join(dir, ".claude", "harnais-graphify-check.json"), "utf8"));
  } catch (e) {
    return null;
  }
}

// Repo petit + manifeste connu + pas de mock filecount : condition de
// déclenchement toujours fausse par défaut dans ces tests, sauf mock explicite.
function baseEnv(dir, extra) {
  return { CLAUDE_PROJECT_DIR: dir, HARNAIS_GRAPHIFY_CHECK_MOCK_USED: "0", ...extra };
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
  const res = run(raw, baseEnv(dir, { HARNAIS_GRAPHIFY_CHECK_MOCK_FILECOUNT: "1000" }));
  check(`payload=${JSON.stringify(raw)} => exit 0`, res.status === 0);
  fs.rmSync(dir, { recursive: true, force: true });
}

// --- Pas de harnais.version (projet non installé, ou dépôt source du socle) : silence ---
{
  const dir = mkProject();
  const res = run({ session_id: "s1" }, baseEnv(dir, { HARNAIS_GRAPHIFY_CHECK_MOCK_FILECOUNT: "1000" }));
  check("sans harnais.version => exit 0", res.status === 0);
  check("sans harnais.version => pas d'additionalContext", !res.stdout.includes("additionalContext"));
  fs.rmSync(dir, { recursive: true, force: true });
}

// --- Repo petit (filecount sous le seuil) + manifeste présent => silence ---
{
  const dir = mkProject();
  writeHarnaisVersion(dir, "1.0");
  fs.writeFileSync(path.join(dir, "package.json"), "{}");
  const res = run({ session_id: "s2" }, baseEnv(dir, { HARNAIS_GRAPHIFY_CHECK_MOCK_FILECOUNT: "10" }));
  check("repo petit+connu => exit 0", res.status === 0);
  check("repo petit+connu => pas d'additionalContext", !res.stdout.includes("additionalContext"));
  fs.rmSync(dir, { recursive: true, force: true });
}

// --- Repo volumineux, jamais utilisé => rappel émis, throttle écrit ---
{
  const dir = mkProject();
  writeHarnaisVersion(dir, "1.0");
  const res = run({ session_id: "s3" }, baseEnv(dir, { HARNAIS_GRAPHIFY_CHECK_MOCK_FILECOUNT: "500" }));
  check("repo volumineux+jamais utilisé => exit 0", res.status === 0);
  check("repo volumineux+jamais utilisé => additionalContext présent", res.stdout.includes("additionalContext"));
  check("rappel => mentionne graphify", res.stdout.includes("graphify"));
  check("rappel => ne dit jamais de l'installer soi-même", res.stdout.includes("Ne l'installe ni ne la lance jamais"));
  const state = readState(dir);
  check("rappel émis => throttle state écrit", !!(state && state.lastShownAt));
  fs.rmSync(dir, { recursive: true, force: true });
}

// --- Repo volumineux mais déjà utilisé => silence ---
{
  const dir = mkProject();
  writeHarnaisVersion(dir, "1.0");
  const res = run(
    { session_id: "s4" },
    { CLAUDE_PROJECT_DIR: dir, HARNAIS_GRAPHIFY_CHECK_MOCK_FILECOUNT: "500", HARNAIS_GRAPHIFY_CHECK_MOCK_USED: "1" }
  );
  check("déjà utilisé => exit 0", res.status === 0);
  check("déjà utilisé => pas d'additionalContext", !res.stdout.includes("additionalContext"));
  fs.rmSync(dir, { recursive: true, force: true });
}

// --- Throttle 7 jours : un rappel déjà montré récemment reste silencieux ---
{
  const dir = mkProject();
  writeHarnaisVersion(dir, "1.0");
  fs.writeFileSync(
    path.join(dir, ".claude", "harnais-graphify-check.json"),
    JSON.stringify({ lastShownAt: Date.now() - 60 * 1000 })
  );
  const res = run({ session_id: "s5" }, baseEnv(dir, { HARNAIS_GRAPHIFY_CHECK_MOCK_FILECOUNT: "500" }));
  check("montré récemment (<7j) => silence", !res.stdout.includes("additionalContext"));

  const forced = run(
    { session_id: "s5b" },
    baseEnv(dir, { HARNAIS_GRAPHIFY_CHECK_MOCK_FILECOUNT: "500", HARNAIS_GRAPHIFY_CHECK_FORCE: "1" })
  );
  check("FORCE=1 => bypass le throttle", forced.stdout.includes("additionalContext"));
  fs.rmSync(dir, { recursive: true, force: true });
}

// --- Throttle corrompu => fail-open, traité comme jamais montré ---
{
  const dir = mkProject();
  writeHarnaisVersion(dir, "1.0");
  fs.writeFileSync(path.join(dir, ".claude", "harnais-graphify-check.json"), "pas du json");
  const res = run({ session_id: "s6" }, baseEnv(dir, { HARNAIS_GRAPHIFY_CHECK_MOCK_FILECOUNT: "500" }));
  check("throttle corrompu => exit 0", res.status === 0);
  check("throttle corrompu => traité comme jamais montré (rappel émis)", res.stdout.includes("additionalContext"));
  fs.rmSync(dir, { recursive: true, force: true });
}

console.log(`${pass}/${pass + fails.length} tests OK`);
if (fails.length) {
  console.log(fails.join("\n"));
  process.exit(1);
}
