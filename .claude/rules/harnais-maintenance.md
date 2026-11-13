---
paths:
  - ".claude/**"
---
# Maintenance du harnais (chargé seulement quand on touche `.claude/`)

Le détail et l'historique sont dans `CHANGELOG.md` (dépôt Harnais) ; le pourquoi des
choix dans `SOURCES.md` et `EVOLUTION.md`. Ici, seulement ce qu'il faut savoir avant de
modifier un hook ou un réglage.

## Hooks du socle (`.claude/hooks/`, Node sans dépendance, toujours exit 0 sauf blocage voulu)
- `guard-dangerous-commands.js` (PreToolUse Bash/PowerShell) : bloque suppression large,
  destruction de disque, git destructif, code téléchargé pipé dans un shell, secrets via
  le shell. Pas de contournement côté Claude ; la raison part sur stderr.
- `session-start-inject.js` (SessionStart) : injecte SESSION.md, plafonné à 4 Ko,
  avertit au-delà de 80 lignes. Ne modifie jamais le fichier.
- `update-check.js` (SessionStart) : seul appel réseau (API GitHub, 1 fois par 24 h),
  signale un harnais en retard ; n'applique jamais de mise à jour.
- `checkpoint-nudge.js` (Stop, PreCompact) : rappelle session-checkpoint si SESSION.md
  n'a pas bougé depuis N tours (`HARNAIS_CHECKPOINT_NUDGE_TURNS`, défaut 15).
- `statusline.js` : affichage et capteur (snapshot contexte/crédits pour les watchdogs).
- `notify-desktop.js`, `precompact-safety-net.js` : toast Windows ; copie brute du
  transcript dans `.claude/session-log.md` avant compaction.

## Hooks optionnels (manifeste `optional_hooks`, actifs par défaut sauf graphify-check)
- `hard-stop-guard.js` : arrêt dur à 85 % de contexte et 95 % de crédits 5 h, vérifié
  après chaque outil. Lié à `autoCompactEnabled: false`.
- `context-watchdog.js` : rappels doux (70 % contexte, 85 % crédits).
- `credit-watchdog.js` (StopFailure) et `resume-after-reset.js` : checkpoint brut puis
  reprise planifiée (Windows, tâche `HarnaisResume_*`).
- `graphify-check.js` : rappel graphify, seulement si le CLI est installé.
- L'installeur retire ou ajoute leurs entrées dans `settings.json` ;
  `.claude/harnais.hooks.json` porte l'état (lu par le planificateur de reprise).

## Invariants
- Tout état local passe par `lib/atomic-write.js` (retry EPERM puis écriture directe).
- Toute télémétrie passe par `lib/metrics.js` ; `HARNAIS_NO_METRICS=1` coupe tout.
  Les tests la posent et travaillent dans des dossiers temporaires.
- `permissions.deny` : liste énumérée des variantes `.env` (pas de wildcard : le deny ne
  gère pas la négation et masquerait `.env.example`).
- Tests : `node .claude/hooks/tests/run-all.js` avant tout commit qui touche un hook.
