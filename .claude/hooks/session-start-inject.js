#!/usr/bin/env node
/**
 * SessionStart hook — injecte le contenu de SESSION.md comme contexte
 * additionnel au (re)démarrage d'une session, pour que Claude sache où on en
 * est sans dépendre du fait qu'il pense à aller lire le fichier lui-même.
 * Injecte aussi le session ID courant : les entrées de .claude/session-log.md
 * le reportent, pour pouvoir retrouver la conversation d'origine d'un
 * changement (claude --resume) même des semaines plus tard.
 * Ne modifie rien, ne bloque rien : si SESSION.md est absent ou illisible, on
 * injecte seulement le session ID et la session démarre normalement.
 */

const fs = require("fs");
const path = require("path");

function readStdin() {
  return new Promise((resolve) => {
    let data = "";
    process.stdin.setEncoding("utf8");
    process.stdin.on("data", (chunk) => (data += chunk));
    process.stdin.on("end", () => resolve(data));
    process.stdin.on("error", () => resolve(""));
  });
}

async function main() {
  let payload = {};
  try {
    const raw = await readStdin();
    payload = JSON.parse(raw || "{}");
  } catch (err) {
    payload = {};
  }

  const projectDir = process.env.CLAUDE_PROJECT_DIR || process.cwd();
  const sessionFile = path.join(projectDir, "SESSION.md");

  let content = "";
  try {
    content = fs.readFileSync(sessionFile, "utf8");
  } catch (err) {
    // Pas de SESSION.md : on injecte quand même le session ID ci-dessous.
  }

  const sessionId = payload.session_id || "inconnu";
  const header =
    `Session Claude Code courante : ${sessionId}\n` +
    `(à reporter dans toute entrée ajoutée à .claude/session-log.md pendant ` +
    `cette session — voir la skill session-checkpoint)\n\n`;

  process.stdout.write(
    JSON.stringify({
      continue: true,
      suppressOutput: true,
      hookSpecificOutput: {
        hookEventName: "SessionStart",
        additionalContext: header + content,
      },
    })
  );
  process.exit(0);
}

main();
