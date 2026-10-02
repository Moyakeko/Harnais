# SESSION.md — état actuel (pointeur, pas journal)

> Injecté automatiquement au démarrage de chaque session (hook `SessionStart` —
> `.claude/hooks/session-start-inject.js`, qui injecte aussi le session ID courant).
> Mis à jour par Claude via la skill `session-checkpoint` après chaque étape
> significative. Reste court : c'est une table des matières de l'état actuel, pas un
> journal qui s'accumule. L'historique détaillé (daté + session ID) vit dans
> `.claude/session-log.md`, non chargé par défaut et hors git.

## Niveau / statut actuel

**V1.15 implémentée, pas encore commitée/taguée/poussée** — trois chantiers inspirés
d'ECC (github.com/affaan-m/ecc), périmètre scopé explicitement avec l'utilisateur :
1. **`LESSONS.md`** : mémoire persistante project-local versionnée avec git.
2. **`config-audit`** : nouvelle skill, version réduite d'AgentShield (audit de
   `.claude/` lui-même, jamais bloquant).
3. **Détection du gestionnaire de paquets** (dont `uv`) dans `onboard-project`.

(Historique V1.12→V1.14 : voir `.claude/session-log.md` et `SOURCES.md`.)

## Fait

- **`LESSONS.md`** : nouveau fichier (racine + `templates/`) — mémoire persistante
  project-local versionnée avec git, inspirée du Memory Vault d'ECC mais sans score de
  confiance ni auto-génération de skill. `session-checkpoint` la maintient,
  systématiquement en fin de session, uniquement si une leçon non-évidente a émergé.
  Choix explicite de ne pas ajouter de hook `Stop` dédié (jugement sémantique, pas
  déterministe) — automatisation côté skill/règle CLAUDE.md. Détail complet dans
  `SOURCES.md` § "V1.15".
- **`config-audit`** (nouvelle skill) : version réduite d'AgentShield (ECC) — audite
  `.claude/` lui-même (settings.json, hooks, MCP, surface d'injection de prompt), jamais
  bloquant, complémentaire à `security-audit` (code/dépendances) sans le dupliquer.
  Dry-run sur ce repo lui-même : a révélé puis corrigé un faux positif potentiel (hooks
  invoqués indirectement comme `resume-after-reset.js`, et `.claude/hooks/lib/*.js`
  signalés à tort comme orphelins par un check naïf).
- **Détection du gestionnaire de paquets** dans `onboard-project` (dont `uv` pour
  Python) : petit ajout à l'étape de détection de stack existante.
- Compte skills : 15 → 16 (`config-audit`). `CLAUDE.md`, `README.md`, `SOURCES.md`,
  `VERSION` mis à jour en cohérence.
- **Vérifié** : les 6 suites de tests hooks existantes inchangées (138/61/32/30/21/129
  OK — aucun hook touché) ; `install/apply.js` testé sur dossier scratch vierge
  (`LESSONS.md` créé) + double exécution (idempotent) + dossier avec `LESSONS.md`
  préexistant (jamais écrasé).

## En cours / bloqué

Rien de bloquant.

## Prochaines étapes

1. Sur les projets réellement bloqués dans la boucle `update-harnais` (dont celui à
   l'origine du rapport) : relancer `update-harnais` maintenant que `v1.14` est publiée
   avec le fix — devrait enfin faire progresser `.claude/harnais.version` au-delà de
   v1.12. Pas encore vérifié sur un vrai projet utilisateur (seulement en bac à sable +
   `install.sh` réel contre GitHub).
2. Test manuel réel de bout en bout du mécanisme agents/arrêt dur crédits (nécessite un
   vrai franchissement de seuil crédits avec des agents en vol) — non réalisable en
   session normale, seule la batterie automatisée (129/129) l'a vérifié jusqu'ici.
3. Une fois `MONITORING.csv` en place sur un projet, la skill `harnais-stats` peut être
   utilisée en mode automatique dès qu'un incident se présente — pas d'action à
   planifier, ça se déclenche seul en contexte.
4. Test manuel réel de la skill `graphify` le jour où le besoin se présente.
5. Test manuel du fix de staleness du watchdog (V1.11) en conditions quasi réelles —
   toujours pas fait.
6. Futur skill "checkpoint" (retour arrière inter-sessions) : cadrage dans
   `EVOLUTION.md`, à construire via `skill-builder` quand le besoin se présente.
7. Optimisation des tokens : chantier volontairement reporté par l'utilisateur.
8. **V1.15 à commiter/pousser, et taguer `v1.15` après confirmation de l'utilisateur**
   (mémoire opérée uniquement par le jugement de Claude dans `session-checkpoint` — pas
   encore observée en usage réel sur une session de longueur normale).
9. Repo tiers d'économie de tokens évoqué par l'utilisateur pendant la discussion V1.15 :
   nom non retrouvé sur le moment, à reprendre si l'utilisateur s'en souvient.

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

2026-10-02 — **V1.15 implémentée, pas encore commitée** : trois chantiers inspirés d'ECC
scopés explicitement avec l'utilisateur (après recherche `WebFetch` sur le repo source) —
`LESSONS.md` (mémoire project-local versionnée avec git, maintenue par
`session-checkpoint` en fin de session), `config-audit` (AgentShield réduit, jamais
bloquant), détection du gestionnaire de paquets dans `onboard-project`. 6 suites de
tests hooks inchangées (138/61/32/30/21/129 OK), `apply.js` testé sur dossier scratch
(création + idempotence + non-écrasement d'un `LESSONS.md` existant). Détail complet
dans `SOURCES.md` § "Décisions propres — V1.15". Session :
7e5cd61c-df2f-41b5-a493-222f6973007a.

2026-09-17 — **V1.14 taguée/poussée** : fix de la boucle infinie `update-harnais`
(`VERSION` dérivée du tag `--tag` réellement résolu par `install.ps1`/`install.sh` au
lieu d'une constante hardcodée dans `apply.js` — cause racine du rapport utilisateur,
confirmée par lecture directe du code et de l'historique git) + le chantier
"arrêt dur crédits/agents" déjà commité (`74bd2c2`). Tag `v1.14` créé et poussé
(confirmé par l'utilisateur), vérifié en rejouant `install.sh` réel contre GitHub
depuis un dossier séparé. `README.md` (bandeau de version), `EVOLUTION.md` (invariant
4) et `update-harnais/SKILL.md` mis à jour en cohérence. Session :
686f571e-a62e-4144-896b-9a664571e1b8.

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
