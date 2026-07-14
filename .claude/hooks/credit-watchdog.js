#!/usr/bin/env node
/**
 * Hook StopFailure (matcher: billing_error|rate_limit) — le tour vient d'être
 * interrompu par l'épuisement des crédits (chemin RÉACTIF : la coupure est
 * survenue sans avoir été anticipée). Trois actions, toutes best-effort :
 *
 *   1. Checkpoint brut horodaté dans .claude/session-log.md (même motif que
 *      precompact-safety-net.js) : erreur, dernier message assistant, queue du
 *      transcript. Un hook ne raisonne pas — le checkpoint riche reste le rôle
 *      de la skill session-checkpoint (poussée par context-watchdog quand les
 *      crédits passent 90%, ou forcée par hard-stop-guard.js à 95%) ; ici on
 *      garantit juste qu'aucune trace ne se perd.
 *   2. Planifie la reprise via lib/resume-scheduler.js (Register-ScheduledTask
 *      à l'heure de réinitialisation + 1 min) — MÊME mécanisme que le chemin
 *      PROACTIF de hard-stop-guard.js (seuil 95%, avant qu'une vraie coupure
 *      ne survienne) : les deux chemins doivent aboutir à la même reprise
 *      automatique supervisée (terminal visible + instruction injectée, voir
 *      resume-after-reset.js), pas de logique dupliquée ni divergente.
 *   3. Toast immédiat récapitulant ce qui a été fait.
 *
 * L'heure de réinitialisation vient du snapshot statusline
 * (rate_limits.five_hour.resets_at — accepté même d'une autre session : la
 * fenêtre 5h est liée au compte, pas à la session, tant que l'heure est dans
 * le futur), sinon d'un timestamp epoch dans error_details (format historique
 * « …|1751986800 » des messages de limite). Sans heure fiable : toast seul,
 * pas de planification à l'aveugle.
 *
 * Le matcher settings.json limite déjà aux erreurs de crédits ; le code
 * re-vérifie car les tests pipent des payloads sans passer par le matcher.
 * Windows uniquement (no-op ailleurs), exit 0 dans tous les cas.
 */

const fs = require("fs");
const path = require("path");
const { showToast } = require("./lib/toast");
const { findResetMs, formatTime, scheduleResume, resolveClaudeBin } = require("./lib/resume-scheduler");

const CREDIT_ERRORS = new Set(["billing_error", "rate_limit"]);
const TAIL_LINES = 40;
const RESUME_DELAY_MS = 60 * 1000;

function readStdin() {
  return new Promise((resolve) => {
    let data = "";
    process.stdin.setEncoding("utf8");
    process.stdin.on("data", (chunk) => (data += chunk));
    process.stdin.on("end", () => resolve(data));
    process.stdin.on("error", () => resolve(""));
  });
}

function appendRawCheckpoint(projectDir, payload) {
  let tail = "(transcript introuvable ou illisible)";
  if (payload.transcript_path) {
    try {
      const lines = fs.readFileSync(payload.transcript_path, "utf8").split("\n").filter(Boolean);
      tail = lines.slice(-TAIL_LINES).join("\n");
    } catch (e) {
      // Un transcript illisible ne doit pas empêcher le reste du sauvetage.
    }
  }
  const entry =
    `\n## Coupure crédits — ${new Date().toISOString()} (erreur: ${payload.error || "inconnue"})\n` +
    `- Session : ${payload.session_id || "inconnue"}\n` +
    (payload.error_details ? `- Détail : ${payload.error_details}\n` : "") +
    (payload.last_assistant_message
      ? `- Dernier message assistant :\n\n> ${String(payload.last_assistant_message).split("\n").join("\n> ")}\n`
      : "") +
    "\n```\n" +
    tail +
    "\n```\n";
  try {
    fs.appendFileSync(path.join(projectDir, ".claude", "session-log.md"), entry, "utf8");
    return true;
  } catch (e) {
    return false;
  }
}

async function main() {
  const raw = await readStdin();
  if (process.platform !== "win32") process.exit(0);

  try {
    let payload = {};
    try {
      payload = JSON.parse(raw || "{}");
    } catch (e) {
      payload = {};
    }

    if (!CREDIT_ERRORS.has(payload.error)) process.exit(0);

    const projectDir = process.env.CLAUDE_PROJECT_DIR || process.cwd();
    const projectName = path.basename(payload.cwd || projectDir) || "Claude Code";
    const sessionId = payload.session_id || "";
    const now = Date.now();

    appendRawCheckpoint(projectDir, payload);

    const resetMs = sessionId ? findResetMs(projectDir, payload.error_details, now) : null;
    let scheduled = false;
    let resumeAtMs = null;
    if (resetMs) {
      resumeAtMs = resetMs + RESUME_DELAY_MS;
      scheduled = scheduleResume(projectDir, sessionId, resumeAtMs, resolveClaudeBin());
    }

    showToast(
      `${projectName} — crédits épuisés`,
      scheduled
        ? `État sauvegardé. Reprise proposée à ${formatTime(resumeAtMs)} (terminal ouvert automatiquement).`
        : `État sauvegardé dans session-log.md. Heure de réinitialisation inconnue — reprise manuelle : claude --resume`
    );
    process.exit(0);
  } catch (e) {
    process.exit(0); // Le sauvetage est best-effort : jamais d'échec bloquant.
  }
}

main();
