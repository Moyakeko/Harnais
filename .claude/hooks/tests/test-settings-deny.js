#!/usr/bin/env node
// Batterie pour la règle deny des fichiers .env dans settings.json (V1.10).
// Contexte : la règle large `Read(.env.*)`/`Read(**/.env.*)` bloquait aussi
// `.env.example`, un template qu'on veut souvent pouvoir laisser lire par Claude.
// `permissions.deny` ne supporte pas la négation (`!pattern`) — confirmé via la
// doc officielle — donc le seul fix possible est une liste énumérée des vraies
// variantes sensibles (`.env.local`, `.env.*.local`, `.env.development`,
// `.env.production`, `.env.test`, `.env.staging`), bare + `**/`, à la place du
// wildcard. Ce test vérifie le contenu de la liste ET le comportement de
// matching réel (un `.env.example` ne doit correspondre à AUCUNE règle deny).
const fs = require("fs");
const path = require("path");

const SETTINGS = path.join(__dirname, "..", "..", "settings.json");

let pass = 0;
const fails = [];
function check(label, ok) {
  if (ok) pass++;
  else fails.push(`ÉCHEC: ${label}`);
}

const settings = JSON.parse(fs.readFileSync(SETTINGS, "utf8"));
const deny = settings.permissions && settings.permissions.deny;
check("permissions.deny existe et est un tableau", Array.isArray(deny));

// --- La liste énumérée attendue est bien présente, bare + **/ ---
const expectedEnumerated = [
  ".env.local",
  ".env.*.local",
  ".env.development",
  ".env.production",
  ".env.test",
  ".env.staging",
];
for (const suffix of expectedEnumerated) {
  check(`deny contient Read(${suffix})`, deny.includes(`Read(${suffix})`));
  check(`deny contient Read(**/${suffix})`, deny.includes(`Read(**/${suffix})`));
}

// --- Le wildcard large qui bloquait .env.example a bien disparu ---
check("deny NE contient PLUS Read(.env.*)", !deny.includes("Read(.env.*)"));
check("deny NE contient PLUS Read(**/.env.*)", !deny.includes("Read(**/.env.*)"));

// --- .env nu reste bloqué (bare + **/) ---
check("deny contient Read(.env)", deny.includes("Read(.env)"));
check("deny contient Read(**/.env)", deny.includes("Read(**/.env)"));

// --- Comportement de matching réel : traduit chaque pattern deny en regex
// (mêmes règles que le glob de permissions.deny : ** = tout chemin, * = un
// segment) et vérifie qu'aucun ne capture .env.example, alors que les vraies
// variantes sensibles restent capturées. ---
function globToRegExp(glob) {
  let re = "";
  for (let i = 0; i < glob.length; i++) {
    if (glob.startsWith("**/", i)) {
      re += "(?:.*/)?";
      i += 2;
    } else if (glob[i] === "*") {
      re += "[^/]*";
    } else {
      re += glob[i].replace(/[.+^${}()|[\]\\]/g, "\\$&");
    }
  }
  return new RegExp(`^${re}$`);
}

function isDenied(patterns, filePath) {
  return patterns.some((p) => {
    const m = /^Read\((.*)\)$/.exec(p);
    return m && globToRegExp(m[1]).test(filePath);
  });
}

const envPatterns = deny.filter((p) => /^Read\(\*?\*?\/?\.env/.test(p));

for (const target of [".env", "sub/.env", ".env.local", "sub/dir/.env.local", ".env.development", "nested/.env.production", ".env.test", ".env.staging", ".env.ci.local"]) {
  check(`.env sensible bloqué : ${target}`, isDenied(envPatterns, target));
}

for (const target of [".env.example", "sub/.env.example", "env.example", "sub/env.example"]) {
  check(`template lisible, PAS bloqué : ${target}`, !isDenied(envPatterns, target));
}

console.log(`${pass}/${pass + fails.length} tests OK`);
if (fails.length) {
  console.log(fails.join("\n"));
  process.exit(1);
}
