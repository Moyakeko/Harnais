# SESSION.md — état actuel (pointeur, pas journal)

> Injecté automatiquement au démarrage de chaque session (hook `SessionStart` —
> `.claude/hooks/session-start-inject.js`, qui injecte aussi le session ID courant).
> Mis à jour par Claude via la skill `session-checkpoint` après chaque étape
> significative. Reste court : c'est une table des matières de l'état actuel, pas un
> journal qui s'accumule. L'historique détaillé (daté + session ID) vit dans
> `.claude/session-log.md`, non chargé par défaut et hors git.

## Niveau / statut actuel

**V1.11 TERMINÉE — prête à commit/tag, en attente de confirmation utilisateur.** Cinq
chantiers demandés par l'utilisateur pour préparer le socle à un usage multi-personnes,
tous faits et vérifiés (détail dans "Fait" ci-dessous) : (A) découpage BMAD en Stories +
`find-skills` par Story (`onboard-project` + `dev-cycle`) ; (B) skill `perplexity-research`
optionnelle (MCP Perplexity, jamais de clé en clair) ; (C) `security-audit` étendue avec
vérification de version via OSV.dev + règle anti-swap-aveugle de dépendance ; (D)
`deploy-checklist` pilotée par une recherche `find-skills` ciblée sur la stack réelle
plutôt qu'une checklist figée ; (E) fix d'un vrai bug du watchdog crédits/contexte
(fail-open silencieux sur snapshot périmé) + seuils crédits resserrés (95→90% arrêt dur,
90→85% rappel doux).

Sous ce chantier V1.11 : V1.10 (télémétrie, versionnage par tag, `find-skills`, fix deny
`.env.example`) et V1.9 (arrêt dur contexte/crédits) restent stables et commités.

## Fait

- **Chantier E (watchdog)** : `hard-stop-guard.js` — le bug réel (snapshot périmé >5min
  → détection sautée silencieusement, indiscernable d'un cas sain) est corrigé : mémorise
  la dernière valeur connue + un compteur `staleStreak`, avertit après 10 appels sans
  rafraîchissement si la dernière valeur était déjà en zone de vigilance (≥75%
  contexte/≥80% crédits), arrête par précaution après 20 (réutilise `forcedReason`
  existant). Seuils resserrés : `CREDIT_HARD_STOP_PCT` 95→90, `CREDIT_THRESHOLD_PCT`
  (`context-watchdog.js`) 90→85. Commentaires à jour dans `credit-watchdog.js`,
  `resume-after-reset.js`, `lib/resume-scheduler.js`. **Vérifié** : `test-watchdogs.js`
  102→123/123 (21 nouveaux tests : régression du resserrement + 5 scénarios de
  staleness), `test-guard.js`/`test-notify.js`/`test-metrics.js`/`test-settings-deny.js`
  inchangés (138/32/61/30), syntaxe des 5 hooks touchés vérifiée (`node -c`).
- **Chantier B (perplexity-research)** : nouvelle skill (11e), MCP officiel documenté
  (`claude mcp add perplexity --env PERPLEXITY_API_KEY="${PERPLEXITY_API_KEY}" -- npx -y
  @perplexity-ai/mcp-server`), gabarit `references/mcp-template.json` avec expansion
  `${VAR}` (jamais de clé en dur), toujours optionnelle (bascule `WebSearch` natif si non
  configuré, cas réel actuel de l'utilisateur qui n'a pas encore de clé).
- **Chantier C (security-audit)** : section "Vérification de version avant ajout/
  changement de dépendance" — appel systématique à l'API OSV.dev (gratuite, sans clé)
  avant tout ajout/montée/remplacement de dépendance, règle anti-swap-aveugle en 4 points
  (versions antérieures du même paquet d'abord, remplacement toujours signalé, repasse
  par OSV.dev + contrôle typosquatting existant, `perplexity-research` en complément si
  doute persistant). **Vérifié en conditions réelles** : requête OSV.dev testée contre
  `lodash@4.17.15` → 6 CVE réelles retournées (dont CVE-2020-8203 prototype pollution).
- **Chantier D (deploy-checklist)** : nouvelle section 2 "Recherche ciblée avant la
  checklist" — identification de la stack réelle, appel `find-skills` ciblé, recherche
  web si besoin (`WebSearch`/`perplexity-research`), jamais de skill de déploiement
  figée par techno. Sections renumérotées (2→3, 3→4).
- **Chantier A (BMAD Stories)** : nouvelle référence canonique unique
  `.claude/skills/onboard-project/references/bmad-story.md` (critère de déclenchement
  ≥2 fonctionnalités, template court format IHM, règle `find-skills` par Story) ;
  `onboard-project` (nouvelle étape 5, backlog dans `PROJECT.md`) et `dev-cycle` (sous-
  étape en tête de "2. Plan") y renvoient sans dupliquer le format. `dev-cycle` "3. Code"
  renvoie aussi vers la règle anti-swap-aveugle de `security-audit` (chantier C).
- **CLAUDE.md/SOURCES.md (passe finale groupée)** : table de routage à jour (11 skills,
  lignes `perplexity-research` + mentions BMAD/OSV.dev/find-skills sur les skills
  existantes touchées), compte "10→11 skills" ; règle 5 (Karpathy) enrichie de la clause
  anti-swap-aveugle ; section "contre-intuitif" à jour sur les nouveaux seuils crédits et
  le fix de staleness ; nouvelle entrée `SOURCES.md` "Décisions propres — V1.11"
  documentant le bug découvert, le choix de seuils, et les chantiers B/C/D. Entrée V1.9
  de `SOURCES.md` non touchée (historique figé). `grep -rn "9[05] ?%"` passé sur tout le
  repo pour ne rien oublier — seules les mentions historiques (`SOURCES.md` V1.9,
  `SESSION.md` V1.10) restent à "95%", correctement, car elles décrivent un état passé.
- `install/apply.js` : `VERSION` 1.10 → 1.11.

## En cours / bloqué

Rien de bloqué. Reste l'action de clôture ci-dessous (commit + tag + push), qui demande
une confirmation explicite avant de s'exécuter — action visible/partagée.

## Prochaines étapes

1. Demander confirmation à l'utilisateur, puis : commit V1.11, tag `v1.11`, push (commit
   + tag) — même déroulé que V1.10 (attention au faux positif du hook de garde sur un
   message de commit heredoc contenant `.env`/`cat` : utiliser `git commit -F <fichier>`
   si le message mentionne des noms de fichiers `.env*` ou "OSV"/"npm audit" à proximité
   d'un mot déclencheur).
2. Une fois poussé : test manuel du fix de staleness en conditions quasi réelles (éditer
   à la main le `ts` d'un `statusline-snapshot.json` pour le rendre périmé avec une valeur
   déjà élevée enregistrée, exécuter quelques outils, confirmer via `harnais-report`
   l'apparition de `warn-stale` puis potentiellement `block-forced`) — pas encore fait,
   seule la batterie automatisée l'a été.
3. Scénarios de test manuel des chantiers A/B/C/D dans une vraie session (checklist dans
   le plan `sharded-booping-toast.md`) — pas encore faits, seule la vérification de forme/
   cohérence croisée (fichiers référencés existants, frontmatter, télémétrie) l'a été.
4. Futur skill "checkpoint" (retour arrière inter-sessions) : cadrage déjà écrit dans
   `EVOLUTION.md`, à construire via `skill-builder` quand le besoin se présente.
5. Optimisation des tokens : chantier volontairement reporté par l'utilisateur.

## Problèmes rencontrés / limites connues

- Le hook de garde est un anti-accident, pas un anti-adversaire — la règle n°1 de
  CLAUDE.md reste la défense d'intention ; pour du code réellement suspect,
  `sandbox-pretest` est la réponse, pas le hook.
- La skill `find-skills` peut faire exécuter `npx skills add ...` sans être interceptée
  par le hook de garde (aucune des 5 catégories bloquées ne couvre ça) — vigilance
  normale requise (réputation de la source), documenté dans CLAUDE.md.
- Support de `hookSpecificOutput.additionalContext` sur l'event `PostToolUse` (utilisé par
  le nouvel avertissement de staleness dans `hard-stop-guard.js`) **non confirmé** — seul
  `UserPromptSubmit` l'utilise ailleurs dans ce socle. Si Claude Code l'ignore sur
  `PostToolUse`, l'écriture stdout est simplement sans effet (fail-open préservé) et la
  télémétrie `warn-stale` reste le seul filet réel pour ce palier intermédiaire — le
  blocage dur (`STALE_STREAK_CAP`, `stderr`+`exit 2`) ne dépend lui d'aucun support
  particulier. À vérifier en conditions réelles (voir "Prochaines étapes" point 2).
- `.env.example` non lisible par l'outil Read si son nom matche un pattern deny listé —
  liste énumérée depuis V1.10, `.env.example` explicitement hors de cette liste.
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

## Dernier checkpoint

2026-08-24 — **V1.11 terminée** : les 5 chantiers (BMAD Stories, Perplexity optionnelle,
vérification CVE de dépendance + anti-swap-aveugle, déploiement piloté par find-skills,
fix du watchdog crédits/contexte) faits et vérifiés dans la même session que la reprise
V1.10. Plan détaillé dans `C:\Users\hp\.claude\plans\sharded-booping-toast.md` (contexte
complet, décisions validées par l'utilisateur, détail fichier par fichier — 3 questions
posées via AskUserQuestion avant le plan : placement du découpage Stories, absence de clé
Perplexity, arbitrage seuils watchdog). Tests : 5 suites, 384/384 au total. API OSV.dev
vérifiée en conditions réelles (requête contre lodash@4.17.15, 6 CVE retournées). Rien
commité pour l'instant — en attente de confirmation utilisateur pour commit + tag `v1.11`
+ push. Session : 58e33e41-469f-4f91-bc2e-4319038c86ec. Détail dans
`.claude/session-log.md`.

2026-08-24 — V1.10 terminée, commitée (`438ad57`), taguée (`v1.10`) et poussée sur
`main`. Détail dans `.claude/session-log.md`.
