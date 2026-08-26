# SESSION.md — état actuel (pointeur, pas journal)

> Injecté automatiquement au démarrage de chaque session (hook `SessionStart` —
> `.claude/hooks/session-start-inject.js`, qui injecte aussi le session ID courant).
> Mis à jour par Claude via la skill `session-checkpoint` après chaque étape
> significative. Reste court : c'est une table des matières de l'état actuel, pas un
> journal qui s'accumule. L'historique détaillé (daté + session ID) vit dans
> `.claude/session-log.md`, non chargé par défaut et hors git.

## Niveau / statut actuel

**V1.12 commitée (`c5608bc`), taguée (`v1.12`) et poussée** (les cinq chantiers de la
session précédente : `graphify`, `update-check.js`, `STATS.md`/`harnais-stats`,
rattrapage README, `checkpoint-pause`/`checkpoint-resume`).

**V1.13 commitée (`70a0681`, `9d82e3b`), taguée (`v1.13`) et poussée** — deux chantiers
cette session, partis d'un rapport d'incident utilisateur réel :
1. **Fix du hang `install.ps1`** (`70a0681`).
2. **Refonte `STATS.md` → `MONITORING.csv`** (`9d82e3b`).

**Post-V1.13 ("V1.14" en cours, pas encore commité/tagué)** — un chantier, encore parti
d'un rapport d'incident utilisateur réel (agents en arrière-plan coupés par la vraie
limite de crédits plutôt que par notre watchdog) : arrêt dur crédits remonté à 95% +
arrêt propre des agents en arrière-plan (`ListAgents`/`SendMessage`/`TaskStop`
whitelistés pendant l'arrêt dur). Fait et vérifié, **pas encore commité**.

## Fait

- **Fix hang `install.ps1`** : un rapport d'incident décrivait `install.ps1` bloqué
  indéfiniment (`node.exe` à 0% CPU, aucune sortie) lors d'un `update-harnais` réel.
  L'investigation a écarté les deux hypothèses du rapport (pas d'auto-suppression du
  script, pas de capture de sortie interne — `install.ps1` héritait déjà la console) ;
  cause probable non confirmable à distance (antivirus/EDR local). L'invocation node
  passe de l'opérateur `&` à `System.Diagnostics.Process` direct (après avoir écarté
  `Start-Process -PassThru`, dont l'`.ExitCode` s'est révélé peu fiable une fois le
  process terminé), qui sonde la progression et affiche après 60s un avertissement avec
  la commande de contournement exacte. `update-harnais/SKILL.md` documente ce problème
  connu. **Vérifié** bout-en-bout (chemin heureux + chemin d'erreur) sur un dossier de
  test. Détail complet dans `SOURCES.md` § "V1.13".
- **`STATS.md` → `MONITORING.csv`** : deux défauts remontés par l'utilisateur à l'usage —
  format markdown à table réécrite peu adapté à un journal d'événements, et
  déclenchement de `harnais-stats` sans règle claire pour le cas où Claude remarque un
  problème de lui-même. Nouveau fichier CSV **append-only** (une ligne = un événement
  daté, jamais réécrite — même idiome que `.claude/harnais-metrics.jsonl`), même statut
  create-only que l'ancien `STATS.md` dans `apply.js`. `harnais-stats` gagne deux modes :
  **automatique** (Claude remarque un incident/succès notable en cours de travail —
  annonce en une phrase puis écrit directement, sans confirmation bloquante) et
  **interactif** (demande ouverte explicite — déroulé inchangé : proposer, agréger,
  noter la pertinence, confirmer avant d'écrire). Colonne `projet` dérivée
  automatiquement du nom de dossier, jamais demandée. Anciens `STATS.md`/
  `templates/STATS.md` supprimés (squelettes vides, aucune perte). `CLAUDE.md`,
  `README.md` (3 endroits), `SOURCES.md` (nouvelle entrée "V1.13") mis à jour. **Vérifié**
  via `apply.js` sur un dossier de test (création + idempotence) et
  `test-guard.js` (138/138, non affecté).
- **Arrêt dur crédits : agents en arrière-plan** : diagnostic confirmé par lecture du
  code (`sameSessionSnapshot` dans `hard-stop-guard.js` exige que le `session_id` de
  l'outil corresponde au snapshot statusline — un agent en tâche de fond n'en a pas,
  donc structurellement invisible au watchdog, ne peut jamais s'auto-arrêter). Plutôt
  que de la télémétrie par agent (n'aurait pas de sens, les crédits sont un compteur de
  compte), le correctif est côté orchestration : whitelist étendue à
  `ListAgents`/`SendMessage`/`TaskStop` pendant l'arrêt dur, `blockMessage()` donne la
  séquence (prévenir chaque agent actif → finir le checkpoint → `TaskStop` en filet de
  sécurité). Seuil crédits `CREDIT_HARD_STOP_PCT` remonté 90%→95% (décision utilisateur,
  marge dédiée à cette séquence). Limite assumée avec l'utilisateur (question posée) :
  best-effort, pas garanti à 100% — convention complémentaire documentée dans
  `CLAUDE.md` (tâche multi-parties confiée à un sous-agent → lui demander de
  checkpointer au fil de l'eau dans `session-log.md`, pas seulement en fin de tâche).
  Toutes les mentions "90%" mises à jour en cohérence (6 fichiers hooks + README +
  CLAUDE.md). **Vérifié** : `test-watchdogs.js` mis à jour (nouvelle frontière 94/95%,
  nouveau test whitelist ListAgents/SendMessage/TaskStop vs Bash toujours bloqué,
  129/129) + `test-guard.js` (138/138) + inspection manuelle du message généré. Détail
  complet dans `SOURCES.md` § "V1.14".

## En cours / bloqué

`hard-stop-guard.js`/agents en arrière-plan pas encore commité/poussé — en attente de
confirmation utilisateur.

## Prochaines étapes

1. Commit + push du chantier "arrêt dur crédits/agents" (V1.14), si l'utilisateur le
   confirme, puis tag quand il le décide (même logique que V1.13 : rester non tagué
   tant que d'autres chantiers post-V1.13 sont possibles).
2. Sur un projet déjà installé (ex: `Nope`, en v1.12) : lancer `update-harnais` pour
   récupérer les dernières versions taguées — `update-check.js` le signalera de
   lui-même à la prochaine session (confirmé en conditions réelles sur `Nope`).
3. Test manuel réel de bout en bout du nouveau mécanisme agents/arrêt dur (nécessite un
   vrai franchissement de seuil crédits avec des agents en vol) — non réalisable en
   session normale, seule la batterie automatisée (129/129) l'a vérifié jusqu'ici.
4. Une fois `MONITORING.csv` en place sur un projet, la skill `harnais-stats` peut être
   utilisée en mode automatique dès qu'un incident se présente — pas d'action à
   planifier, ça se déclenche seul en contexte.
5. Test manuel réel de la skill `graphify` le jour où le besoin se présente.
6. Test manuel du fix de staleness du watchdog (V1.11) en conditions quasi réelles —
   toujours pas fait.
7. Futur skill "checkpoint" (retour arrière inter-sessions) : cadrage dans
   `EVOLUTION.md`, à construire via `skill-builder` quand le besoin se présente.
8. Optimisation des tokens : chantier volontairement reporté par l'utilisateur.

## Problèmes rencontrés / limites connues

- Le hook de garde est un anti-accident, pas un anti-adversaire — la règle n°1 de
  CLAUDE.md reste la défense d'intention ; pour du code réellement suspect,
  `sandbox-pretest` est la réponse, pas le hook.
- La skill `find-skills` peut faire exécuter `npx skills add ...` sans être interceptée
  par le hook de garde — vigilance normale requise, documenté dans CLAUDE.md (le cas
  `graphify` en est un exemple concret).
- `update-check.js` est le seul hook du socle qui fait un appel réseau — throttlé,
  fail-open, jamais bloquant, mais c'est un changement de nature (aucun hook existant
  n'en faisait avant V1.12) à garder en tête si un futur hook réseau est envisagé.
- Support de `hookSpecificOutput.additionalContext` sur `PostToolUse` (utilisé par
  `hard-stop-guard.js`) toujours non confirmé en conditions réelles — voir "Prochaines
  étapes" du chantier V1.11 précédent, non repris ici pour rester court.
- Les patterns `**/` de `permissions.deny` sont relatifs au projet : un fichier secret
  hors projet reste lisible, sauf les chemins home couverts par des règles `~/` explicites.
- `disableBypassPermissionsMode` neutralise silencieusement `--dangerously-skip-permissions`
  sans message d'erreur explicite.
- `PostToolUse` s'exécute après l'outil : celui qui fait franchir un seuil s'est déjà
  exécuté, impossible à annuler.
- Whitelist du hard-stop : seuls les appels d'outil `Write`/`Edit` sur SESSION.md/
  session-log.md passent — un `Bash` qui redirige vers ces mêmes fichiers reste bloqué.
- Éditer `.claude/settings.json`/des messages de commit heredoc contenant `.env`+`cat`
  peut être bloqué par le classificateur de sécurité d'Anthropic (faux positif observé en
  V1.10) — contournement : `Write` du fichier complet, ou `git commit -F <fichier>`.
- `Start-Process -PassThru` en PowerShell : `.ExitCode` s'est révélé peu fiable une fois
  le process terminé (vide au lieu du vrai code) — préférer
  `[Diagnostics.Process]::Start(...)` direct (`New-Object`/`::new` sur `ProcessStartInfo`)
  dès qu'un script PowerShell doit lire un code de sortie fiable après une attente
  (découvert en corrigeant le hang `install.ps1`).

## Dernier checkpoint

2026-08-26 — **Post-V1.13 ("V1.14")** : arrêt dur crédits remonté à 95% + arrêt propre
des agents en arrière-plan (`ListAgents`/`SendMessage`/`TaskStop` whitelistés pendant
l'arrêt dur crédits/contexte) — fait, vérifié (129/129 + 138/138 + inspection manuelle
du message), pas commité. Parti d'un rapport d'incident réel de l'utilisateur (agents
coupés par la vraie limite de crédits plutôt que par notre watchdog). Détail complet
dans `SOURCES.md` § "Décisions propres — V1.14". Session :
84685b68-10db-43f1-8dbf-65e2346d91a6.

2026-08-26 — **Post-V1.12 ("V1.13")** : fix hang `install.ps1` (commité/poussé,
`70a0681`) + refonte `STATS.md` → `MONITORING.csv`/`harnais-stats` (commité/poussé,
`9d82e3b`, tagué `v1.13`). Partis tous les deux d'un rapport d'incident réel de
l'utilisateur (bug `update-harnais` + retour d'usage sur `STATS.md`). Détail complet
dans `SOURCES.md` § "Décisions propres — V1.13". Session :
84685b68-10db-43f1-8dbf-65e2346d91a6.

2026-08-25 — **V1.12 complète, commitée/taguée/poussée depuis** : graphify + update-check.js +
STATS.md/harnais-stats + rattrapage doc + checkpoint-pause/checkpoint-resume, dans la
même session (recherche via 3 agents Explore pour les chantiers F/G/H, un plan par
chantier écrit et approuvé en mode plan). 15 skills, 9 hooks au total désormais. Tests :
6 suites, 405/405 au total (nouveau test-update-check.js 21/21). Plan détaillé dans
`C:\Users\hp\.claude\plans\je-souhaiterais-installer-graphify-ancient-wolf.md`. Session :
9d4a541f-3d3f-43e0-8258-336003ac8184.

2026-08-24 — **V1.11 terminée** : les 5 chantiers (BMAD Stories, Perplexity optionnelle,
vérification CVE de dépendance + anti-swap-aveugle, déploiement piloté par find-skills,
fix du watchdog crédits/contexte) faits et vérifiés. Plan détaillé dans
`C:\Users\hp\.claude\plans\sharded-booping-toast.md`. Tests : 5 suites, 384/384 au
total. Commit (`6ba4bd7`), tag (`v1.11`) et push confirmés par l'utilisateur et
exécutés. Session : 58e33e41-469f-4f91-bc2e-4319038c86ec. Détail dans
`.claude/session-log.md`.
