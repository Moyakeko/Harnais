# Sources de ce socle — ce qui a été pris, ce qui a été écarté, et pourquoi

Ce fichier existe parce que ce dépôt est un **socle destiné à être réutilisé et dérivé**,
pas un projet applicatif ordinaire. Sans ça, la raison d'être de chaque pièce s'oublie
avec le temps — y compris pour la personne qui l'a construit. À mettre à jour à chaque
fois qu'une nouvelle source inspire un changement du socle.

## ECC (github.com/affaan-m/ecc)

**Retenu** : la séparation stricte en couches — `rules/` (contraintes toujours actives),
`skills/` (workflows à la demande), `hooks/` (blocage déterministe par exit code),
`agents/` (sous-agents scopés). C'est l'architecture derrière ce socle, en miniature.

**Écarté** : les 277+ skills, 67 agents, le système de mémoire/apprentissage continu
("instincts" avec score de confiance), et la couche sécurité multi-agents (AgentShield).
Pourquoi : conçus pour un usage professionnel à grande échelle ; pour un usage solo
étudiant, ce niveau d'appareillage coûterait plus en maintenance qu'il n'apporterait de
valeur. Un système de mémoire à moitié construit donne une fausse confiance — pire que
ne pas en avoir.

## AIS-OS (github.com/nateherkai/AIS-OS)

**Retenu** : interviewer l'utilisateur *avant* de générer quoi que ce soit et dériver le
contenu du CLAUDE.md de ses réponses plutôt que d'un template générique — c'est comme ça
que ce socle a été construit. Le principe du cycle "diagnostic → une amélioration
livrée" a inspiré la logique de `skill-builder` comme levier d'évolution du socle dans
le temps.

**Écarté** : l'arborescence complète `context/`/`connections/` et les skills `/audit`/
`/level-up` telles quelles — pensées pour un contexte business (contenu, CRM, cadence
d'automatisation) qui ne correspond pas à un usage de développement logiciel école/
perso/prod.

## Karpathy skills (github.com/multica-ai/andrej-karpathy-skills)

**Retenu** : les 4 principes intégrés tels quels dans la règle non négociable n°5 du
CLAUDE.md — ne jamais deviner silencieusement une hypothèse ambiguë, ne rien ajouter
au-delà de la demande, changer chirurgicalement, transformer toute tâche vague en
critères de succès vérifiables. Directement applicable, aucune adaptation nécessaire.

## Tutoriel Notion "The Only Claude Code Tutorial You'll Ever Need"

**Retenu** :
- La structure CLAUDE.md en "5 questions" (quoi / comment on fait tourner les choses /
  quels patterns / qu'est-ce qui est contre-intuitif / comment on travaille) et le
  principe "point, don't dump" (table des matières, pas encyclopédie, <200 lignes).
- L'héritage de `CLAUDE.md` le long de l'arborescence de dossiers — voir la section
  "Où placer ce socle" dans `skill-builder`.
- Le triptyque skills/hooks/commands ("skills = comment Claude pense, hooks = garanties
  automatiques, commands = déclenché par toi").
- Le framework en 6 étapes pour construire une skill (Name it / Trigger / Outcome /
  Dependencies / Flow / Edge cases) et le principe de progressive disclosure
  (description → corps du SKILL.md → fichiers de référence) — intégrés dans
  `skill-builder`.
- La protection déterministe des fichiers secrets via `permissions.deny` dans
  `.claude/settings.json` — mécanisme natif Claude Code, complémentaire au hook déjà
  écrit pour les commandes destructrices.

**Écarté** :
- Le deny-list large du tutoriel qui bloque `npm install`/`pip install`/`curl`/`wget`/
  `ssh`/`scp`. Pensé pour un usage "business content" où le réseau et l'installation de
  paquets sont rares ; pour un usage école/perso/déploiement réel, ça casserait des
  usages légitimes au quotidien (installer une dépendance de cours, appeler une API,
  déployer par SSH/SCP sur un VPS).
- MCP, plugins, agent teams, `/loop`, git worktrees, remote control : utiles mais hors
  scope pour un socle V1 volontairement à 5 skills — à envisager plus tard via
  `skill-builder` si un besoin concret apparaît, pas par anticipation.

## skills.sh (www.skills.sh)

**Retenu** : référencé dans `skill-builder` comme étape de recherche préalable — avant
de construire une skill from scratch, vérifier si l'annuaire communautaire (en
particulier la skill `find-skills` de vercel-labs) couvre déjà le besoin.

**Écarté** : aucune skill de cet annuaire n'est installée par défaut dans ce socle V1 —
seulement référencé comme point de départ pour une recherche future.

## Décisions propres (hors sources étudiées)

### Continuité de session (`SESSION.md`, `session-checkpoint`, hooks `SessionStart`/`PreCompact`)

**Origine** : demande directe de l'utilisateur, pas une des 4 sources analysées. Besoin :
qu'une nouvelle session sache où en est le socle (niveau, fait, en cours, bloqué,
prochaines étapes) sans tout réexpliquer, y compris si une session précédente a été
coupée par une limite de contexte ou de crédit en plein milieu d'un traitement.

**Retenu** : `SESSION.md` comme pointeur court (jamais un journal qui grossit), injecté
automatiquement au démarrage par un hook `SessionStart` ; un hook `PreCompact` comme
filet de sécurité brut qui copie la fin du transcript dans `.claude/session-log.md`
avant qu'une compaction ne résume/perde le détail ; une skill `session-checkpoint` qui
documente comment et quand Claude doit mettre à jour `SESSION.md` lui-même — la
rédaction du résumé reste le travail de Claude, pas d'un hook (un hook ne raisonne pas).

**Écarté / limite assumée** : aucun hook ne peut intercepter une coupure brutale de
crédit en plein milieu d'une commande (rien ne tourne après un arrêt net du processus),
ni déclencher `/clear`/`/compact` à la place de l'utilisateur — seule la discipline de
checkpoints fréquents réduit ce risque. Une synchronisation Obsidian a été évoquée pour
plus tard : `SESSION.md` reste un markdown plat exprès pour rester compatible avec un tel
outil externe le jour venu, mais rien n'est construit pour ça dans cette passe.

### V1.4 — sandbox de pré-test, guide d'évolution, traçabilité git (2026-07-06)

**Origine** : demande directe de l'utilisateur — usage entreprise à venir, scripts
d'auto-amélioration du socle prévus, futur skill "checkpoint" de retour arrière
inter-sessions, et volonté que le socle reste solide quel que soit le modèle utilisé.

**Retenu** : skill `sandbox-pretest` (Docker d'abord — `--network none`, `--read-only`,
placeholders à la place des vrais secrets —, fallback dégradé annoncé comme tel) ;
`EVOLUTION.md` comme guide non chargé par défaut (invariants de la couche de garde,
cadre des scripts d'auto-amélioration, adaptation aux modèles, durcissement entreprise) ;
**git comme mécanisme de checkpoint/rollback** (un commit par évolution) avec
`session-log.md` horodaté + session ID (injecté par `session-start-inject.js`) pour
retrouver la conversation d'origine d'un changement ; batterie de tests du hook
versionnée dans `.claude/hooks/tests/`.

**Écarté** : un système de rollback maison sans git (fragile, réinvente moins bien) ;
l'auto-application par un script de changements sur les hooks/`settings.json`/règles
CLAUDE.md (interdit par invariant — un script propose, l'humain applique) ;
`session-log.md` versionné dans git (le filet PreCompact y copie des extraits bruts de
transcript, potentiellement sensibles — il reste local, dans `.gitignore`).

### V1.5 — socle installable en une ligne, fix du hook git add (2026-07-06)

**Origine** : demande directe de l'utilisateur — réutiliser le socle sur chaque nouveau
projet sans cloner le repo (le projet cible a son propre remote git), avec coexistence
possible avec d'autres méthodes (BMAD, GSD…) : le socle est la couche
architecture/cybersécurité de base, les méthodes de construction viennent par-dessus.

**Retenu** :
- **Dépôt public** + one-liners sans authentification (`curl … | sh`,
  `iwr … | iex`) — le socle ne contient aucun secret (audité), seul son design est
  exposé, et ça le rend partageable.
- **Bootstraps minces + moteur Node unique** (`install/apply.js`) : la fusion JSON est
  triviale en Node et quasi impossible en sh pur ; Node est déjà le prérequis des
  hooks ; une seule implémentation à maintenir ; zéro écriture de fichier côté
  PowerShell donc zéro problème de BOM/UTF-16.
- **Fusion additive à marqueurs** (`harnais:core` dans CLAUDE.md, `harnais:guard` dans
  .gitignore, clé `command` pour les hooks JSON, union pour deny) : jamais de
  remplacement de l'existant, backup `.harnais-bak` unique, idempotence par
  construction — relancer le one-liner = mise à jour.
- **Fix du faux positif `git add`** : la règle teste désormais les arguments du
  `git add` segment par segment (comme les prédicats rm), plus la commande entière —
  un nom de secret dans un message de commit voisin ne bloque plus. 11 cas de test
  ajoutés (138/138).
- `git add .`/`-A` **reste permissif** : le .gitignore posé par le socle,
  `permissions.deny` et `security-audit` couvrent déjà le staging global, et le hook
  ne peut pas inspecter l'arbre de travail.

**Écarté** : un dépôt template GitHub ("Use this template" — crée un repo entier au
lieu de s'ajouter à un projet existant) ; git submodule/subtree (couple le projet au
repo du socle, exactement ce que l'utilisateur voulait éviter) ; un installeur tout
PowerShell ou tout bash (double implémentation de la fusion, divergence garantie).

### V1.6/V1.7 — notifications toast, watchdogs crédits & contexte (2026-07-08)

**Origine** : demande directe de l'utilisateur — être prévenu par une vraie
notification Windows (pas une modale) des fins de tâche et attentes d'action (V1.6),
puis : sauvegarde automatique de l'état quand les crédits s'épuisent en pleine tâche +
reprise proposée à l'heure de réinitialisation, et checkpoint forcé à ~85 % de
contexte avant que l'auto-compact ne perde le détail (V1.7).

**Retenu** :
- **Toast WinRT sous AUMID dédié `ClaudeCode.Harnais`** (enregistré paresseusement en
  HKCU, sans admin), PowerShell en **enfant synchrone maintenu vivant 1,5 s** — les
  échecs historiques venaient de là : un toast émis par un process mort aussitôt après
  `Show()` est perdu, et un powershell détaché+caché est tué en ~1 s sur la machine
  cible (vraisemblablement Kaspersky). `msg.exe` rétrogradé en filet de secours.
  Logique partagée dans `lib/toast.js`.
- **La statusline comme capteur** (`statusline.js` → `statusline-snapshot.json`) :
  vérifié dans le binaire v2.1.204, c'est le SEUL canal local qui expose
  `context_window.used_percentage` et `rate_limits.five_hour.{used_percentage,
  resets_at}` — aucun hook ne reçoit ces données.
- **`StopFailure` (matcher `billing_error|rate_limit`)** comme déclencheur de la
  coupure crédits — événement vérifié dans le binaire (« fires instead of Stop when an
  API error ended the turn »). `credit-watchdog.js` : checkpoint brut dans
  session-log.md + tâche planifiée (`Register-ScheduledTask -StartWhenAvailable`,
  seul moyen de rattraper un PC en veille) à reset+1 min → `resume-after-reset.js` :
  toast, auto-suppression.
- **Reprise semi-automatique, pas headless** (choix utilisateur explicite) : un
  `claude -p --resume` autonome consommerait des crédits sans supervision et peut
  bloquer sur une permission ; le toast donne la commande `claude --resume <session>`,
  c'est l'humain qui la lance. **Ouverture automatique d'un terminal testée puis
  retirée** (2026-07-09, demande explicite) : l'utilisateur préfère lancer la reprise
  lui-même plutôt qu'une fenêtre qui s'ouvre seule — le toast suffit à l'informer.
- **Checkpoint forcé à 85 % au lieu d'un `/clear` auto** : `/clear`/`/compact` ne sont
  déclenchables par aucun hook ni SDK (vérifié) ; `context-watchdog.js` injecte une
  fois par session (ré-armé par PostCompact) l'ordre d'exécuter `session-checkpoint`,
  puis l'auto-compact intégré assure la continuité, avec `precompact-safety-net.js`
  en filet brut inchangé.

**Écarté** : SnoreToast/node-notifier (binaire tiers ou dépendance npm — le socle
reste zéro dépendance) ; le hook `Notification` pour détecter la limite de crédits
(il ne reçoit pas ce type de message) ; `schtasks.exe` pour planifier (n'expose pas
StartWhenAvailable) ; un seuil d'auto-compact configurable (n'existe pas dans Claude
Code) ; la relance automatique headless (risque crédits/permissions, voir ci-dessus).

### V1.8 — skill update-harnais (2026-07-09)

**Origine** : demande directe de l'utilisateur — il oublie de relancer le one-liner
d'installation sur ses autres projets quand une nouvelle version du socle sort (ex :
les watchdogs V1.6/V1.7), et voudrait une commande de mise à jour plus accessible.

**Retenu** :
- **Une skill invocable depuis le chat** (« mets à jour le harnais »), choix explicite
  de l'utilisateur face à l'alternative d'un simple alias de terminal — plus pratique
  quand on est déjà dans une session Claude Code sur le projet à mettre à jour.
- **Zéro nouvelle logique d'installation** : la skill télécharge `install.ps1`/
  `install.sh` dans un fichier (`-OutFile`/`-o`, jamais pipé) puis l'exécute
  directement (jamais pipé non plus) — exactement le mécanisme que CLAUDE.md prévoit
  déjà comme exception légitime au blocage `curl|sh` (règle n°2, section
  « contre-intuitif ») : télécharger puis exécuter en deux étapes séparées. Le script
  fait ensuite le travail habituel via `apply.js`, inchangé.
- **`apply.js` enrichi, pas dupliqué** : lecture de la version précédente avant
  écrasement de `.claude/harnais.version`, bannière consciente de la transition
  (« mise à jour vX → vY » / « déjà à jour »), et rappel de redémarrage de session
  uniquement affiché quand c'est pertinent (mise à jour, pas première installation).
- **Redémarrage de session laissé manuel** : aucun mécanisme ne permet à une skill de
  recharger les hooks/`settings.json` d'une session déjà démarrée — la skill le dit
  explicitement à chaque fois plutôt que de laisser croire à une mise à jour à chaud.

**Écarté** : un `update.ps1`/`update.sh` séparé au niveau du dépôt (duplication de
logique avec `install.ps1`/`install.sh` pour un gain purement cosmétique de nommage) ;
une confirmation bloquante supplémentaire avant le téléchargement (invoquer la skill
explicitement est déjà la confirmation) ; toute tentative de recharger les hooks à
chaud (n'existe pas côté Claude Code).

### V1.9 — arrêt dur contexte/crédits, inversion de deux choix V1.7 (2026-07-12)

**Origine** : demande directe de l'utilisateur (idée née d'un post Instagram) — l'IA
hallucine et dégrade dans le dernier quart avant l'auto-compact natif (~100 %) ; il
préfère un arrêt net et contrôlé (checkpoint + fermeture/nouvelle session) plutôt que
subir une compression automatique du contexte. Étendu ensuite, sur sa demande
explicite, aux crédits de la fenêtre 5h avec une reprise automatique bornée.

**Retenu** :
- **Auto-compact natif désactivé** (`autoCompactEnabled: false`) : le socle prend
  intégralement le relais du contrôle de contexte plutôt que de composer avec lui.
- **Deux niveaux au lieu d'un** : `context-watchdog.js` reste un rappel doux, non
  bloquant, mais son seuil descend de 85 % à 70 % (`UserPromptSubmit` uniquement) ;
  un nouveau hook `hard-stop-guard.js` (`PostToolUse`, sans matcher — vérifié après
  CHAQUE outil, pas seulement à l'envoi d'un message) impose un arrêt DUR à 85 % :
  blocage (`exit 2`, même mécanisme que `guard-dangerous-commands.js`) de tout outil
  sauf `Read` (n'importe quel fichier) et `Write`/`Edit` sur `SESSION.md` /
  `.claude/session-log.md`, pour forcer le checkpoint puis l'arrêt de la session par
  l'utilisateur. Jamais réarmé seul : seul un `/compact` manuel (event `PostCompact`)
  ou une nouvelle session repart propre.
- **Limite assumée et documentée** : `PostToolUse` s'exécute après l'outil — il ne
  peut pas empêcher celui qui vient de faire franchir le seuil, seulement contraindre
  le suivant. Accepté en connaissance de cause : c'est le seul event qui se déclenche
  après chaque outil plutôt qu'à l'envoi d'un message, condition explicitement
  demandée par l'utilisateur.
- **Inversion n°1 — seuil auto-compact configurable** : jugé absent de Claude Code en
  V1.7 (`autoCompactEnabled` existe bel et bien, vérifié via la doc officielle en
  V1.9) ET le socle ne cherche plus à composer avec l'auto-compact natif : il le
  désactive et le remplace entièrement.
- **Inversion n°2 — reprise crédits "jamais headless"** : le choix explicite de V1.7
  ("l'humain relance à sa main, pas de fenêtre qui s'ouvre seule") est renversé sur
  demande explicite de l'utilisateur. Arrêt dur proactif à 95 % des crédits 5h
  (mêmes règles de blocage que le contexte) : planifie la reprise (logique
  factorisée dans `lib/resume-scheduler.js`, partagée avec `credit-watchdog.js` —
  chemin réactif `StopFailure` inchangé par ailleurs) puis, à la réinitialisation,
  `resume-after-reset.js` ouvre un terminal VISIBLE (`Start-Process`, jamais
  `cmd start`) avec `claude --resume <session>` et une instruction de continuation
  injectée automatiquement (extraite de la section "En cours / bloqué" de
  `SESSION.md`) — bornée à la tâche en cours, rien d'autre.
- **Le blocage crédits est borné dans le temps, pas permanent** : `--resume` continue
  le MÊME `session_id`, donc la même entrée d'état (`watchdog-state.json`) est
  partagée entre la session bloquée et sa reprise. Le blocage reste actif tant que
  l'heure planifiée (`autoResumeUnblockAt`) n'est pas atteinte ; une fois franchie, il
  se lève de lui-même et seul le plafond anti-emballement prend le relais.
- **Plafond de sécurité anti-emballement** (demande explicite de l'utilisateur) :
  nombre d'actions d'outil pendant la reprise automatique (`.claude/watchdog-
  config.json`, `autoResumeMaxActions`, défaut 30, optionnel) OU contexte remontant
  à ≥85% pendant la reprise → force le même arrêt dur. L'event `Stop` avec
  `autoResumeActive` posé nettoie tout l'état crédits de l'épisode (jamais ambigu
  avec une session interactive classique, ce flag n'étant posé qu'au moment de
  planifier une reprise).

**Non vérifié empiriquement au moment de l'implémentation, à valider avant de
considérer acquis** (voir SESSION.md) : que `claude --resume <id> "texte"` accepte
bien un argument positionnel comme premier message en mode interactif après reprise ;
que le hook `hard-stop-guard.js` bloque réellement en conditions réelles (nécessite
une session fraîche, les hooks ne se rechargent pas à chaud — seule la batterie
dry-run de `.claude/hooks/tests/test-watchdogs.js` a été vérifiée à ce stade).

**Écarté** : un plafond basé sur une durée plutôt qu'un nombre d'actions (moins
prévisible d'un modèle/tâche à l'autre) ; une reprise headless silencieuse
(`claude -p`, envisagée puis explicitement écartée par l'utilisateur au profit d'un
terminal visible) ; un second fichier de hook séparé pour les crédits (dupliquerait
la logique de blocage/whitelist, déjà identique à celle du contexte).

## Décisions propres — V1.11 (collaboration multi-personnes, recherche, watchdog fiable)

**Contexte** : le socle commence à être utilisé sur des projets avec d'autres personnes.
L'utilisateur a remonté cinq manques constatés à l'usage (pas depuis une source externe
étudiée cette fois — décisions propres à ce socle) : pas de découpage en Stories avant de
coder, pas de réflexe Perplexity natif, aucune vérification de faille de sécurité connue
avant d'adopter une version de dépendance (ni de garde-fou contre le réflexe "erreur de
build → je change de paquet" sans vérifier), `deploy-checklist` figée sans recherche
active d'outils à jour, et surtout un **bug réel découvert à l'usage** dans le watchdog
crédits/contexte de V1.9.

**Le bug** : `hard-stop-guard.js` (`PostToolUse`) exige un snapshot `statusline.js` de
moins de 5 minutes pour détecter un franchissement de seuil. Si ce snapshot ne se
rafraîchit pas (rafale d'outils/sous-agents sans rafraîchissement de l'UI, hors contrôle
du socle), le hook sautait **silencieusement** toute détection — indiscernable d'un cas
réellement sain, alors même que les crédits réels continuaient de grimper. C'est
vraisemblablement la cause de l'impression utilisateur que "ça ne vérifie pas à chaque
étape", alors que la fréquence de check elle-même (après CHAQUE outil, sans matcher)
était déjà correcte depuis V1.9.

**Retenu — fix du fail-open** : mémoriser la dernière valeur connue de contexte/crédits
à chaque snapshot frais, avec un compteur d'appels consécutifs sans rafraîchissement. Si
le snapshot devient périmé alors que la dernière valeur connue était déjà en zone de
vigilance (≥75 % contexte ou ≥80 % crédits — volontairement sous les seuils durs, pour
réagir avant que ce soit critique), un avertissement est émis après 10 appels sans
nouveau relevé, puis un arrêt dur conservateur après 20 (réutilise le mécanisme
`forcedReason` déjà existant du plafond anti-emballement, plutôt qu'un nouveau chemin de
blocage). Sans base "en zone de vigilance", aucune escalade sur la seule staleness — une
session simplement peu active ne doit pas être punie.

**Retenu — seuils resserrés modérément** : `CREDIT_HARD_STOP_PCT` 95 → 90,
`CREDIT_THRESHOLD_PCT` (rappel doux) 90 → 85, pour garder un vrai buffer entre rappel et
arrêt dur (identique à l'écart contexte 70/85, inchangé). Choix délibéré entre les deux
options extrêmes présentées à l'utilisateur : ni la "sécurité maximale" (seuils ~80/85 %,
fenêtre de fraîcheur 60-90s) ni le statu quo (85/95 % inchangés) — un compromis qui
corrige le vrai bug sans sacrifier une part significative de la fenêtre 5h utilisable.

**Retenu — recherche renforcée** : `find-skills` (déjà présente) devient le mécanisme
d'identification de skills pertinentes par Story (BMAD, `onboard-project`/`dev-cycle`) et
par stack de déploiement (`deploy-checklist`), plutôt que de figer du contenu qui
deviendrait vite obsolète. Nouvelle skill `perplexity-research` : documentée comme
**optionnelle** (l'utilisateur n'a pas de clé API Perplexity au moment de cette décision)
— jamais un prérequis, jamais de clé en clair (`.mcp.json` avec expansion
`${PERPLEXITY_API_KEY}`, jamais littérale). Vérification de version de dépendance :
extension de `security-audit` (pas une nouvelle skill — le domaine y était déjà déclaré)
via l'API gratuite et sans clé d'OSV.dev, avec une règle explicite anti-swap-aveugle
(vérifier des versions antérieures du même paquet avant d'envisager un remplacement,
jamais de substitution silencieuse).

**Écarté** : une 7e règle non négociable dans `CLAUDE.md` pour la vérification de
dépendances — les 6 règles actuelles sont des invariants universels souvent adossés à un
hook déterministe, celle-ci est domaine-spécifique (renforcement de la règle 5 existante
+ renvoi croisé depuis `dev-cycle`/`security-audit` à la place). Une skill de déploiement
générique figée par techno — choix délibéré de recherche dynamique via `find-skills` à
chaque projet plutôt qu'un contenu qui se périmerait.

## Décisions propres — V1.12 (graphify)

**Contexte** : l'utilisateur a demandé d'installer "graphify" comme skill officielle du
socle (pas juste un usage personnel ponctuel dans ce dépôt) — un outil tiers qui
construit un graphe de connaissances interrogable d'un codebase (code, docs, schémas
SQL, PDFs) pour en explorer l'architecture.

**Recherche préalable (WebSearch/WebFetch/OSV.dev)** : "graphify" recouvre plusieurs
dépôts GitHub distincts sous des noms quasi identiques — signal classique de
prolifération de clones. Retenu comme source officielle : `Graphify-Labs/graphify`
(110k★/10.7k forks, société YC S26, site `graphify.com`, package PyPI `graphifyy`).
Écartés (mêmes noms/variantes proches, sans garantie sur leur contenu réel) :
`collabsoft/ai_graphify`, `sharkkyyy10/graphify-`, `wfsh2026/Skill-graphify`,
`rhanka/graphify`, `safishamsi/graphify`, deux listings sur des marketplaces tierces, un
domaine concurrent `graphify.net`, et un paquet PyPI voisin `lifeisforu-graphify`. OSV.dev
interrogé sur `graphifyy` : aucune CVE connue au moment de la rédaction — rassurant mais
non suffisant à lui seul (outil neuf, lecture large du repo, appels réseau).

**Retenu — conception en routage plutôt qu'en réinvention** : la nouvelle skill
`graphify` ne réimplémente ni la vérification de version de dépendance ni l'isolation
d'exécution — elle route explicitement vers `security-audit` (check OSV.dev + anti-swap-
aveugle, avec le rappel exprès des clones trouvés) et `sandbox-pretest` (première
exécution isolée), obligatoires avant toute installation réelle du CLI (`uv tool install
graphifyy`). Même patron que `perplexity-research` : optionnelle, jamais un prérequis
bloquant — retombe sur l'exploration native (`Grep`/`Glob`/agent `Explore`) si l'outil
n'est pas installé.

**Retenu — rupture assumée du compte "11 skills"** : la section "Ce qui est
volontairement absent" de `CLAUDE.md` fixait delibérément ce compte comme un choix de
sobriété, à faire évoluer "si le besoin s'en fait sentir, pas par défaut" — c'est
exactement ce cas : demande explicite de l'utilisateur, passée par `skill-builder`, pas
une dérive automatique. Le compte passe à 12 skills, documenté comme tel plutôt que
silencieusement laissé obsolète dans `CLAUDE.md`.

**Écarté** : exécuter réellement `uv tool install graphifyy`/`/graphify` sur la machine de
l'utilisateur au moment de cette décision — l'ajout au socle est une définition de skill
(documentation + garde-fous de routage), pas une installation du CLI tiers ; c'est à la
skill elle-même d'imposer les vérifications avant toute installation future sur un vrai
besoin.

**Suite V1.12 — trois chantiers demandés avant le commit/push** : l'utilisateur a validé
le commit de `graphify` mais a demandé d'y intégrer trois ajouts avant de pousser (donc
toujours V1.12, rien n'ayant encore été tagué/publié) : vérification automatique de
mise à jour au démarrage de session, un fichier `STATS.md` par projet pour comparer
l'usage du socle entre projets, et une habitude de tenir la documentation utilisateur à
jour au fil des évolutions.

**Retenu — vérification automatique (hook `update-check.js`)** : nouveau hook
`SessionStart` (entrée supplémentaire, à côté de `session-start-inject.js` — patron déjà
en usage pour plusieurs hooks sur un même événement) qui compare la version installée
(`.claude/harnais.version`) au dernier tag `vX.Y` publié sur GitHub, au plus 1×/24h par
projet (état dans `.claude/harnais-update-check.json`, gitignored). Ne fait
**qu'informer** (message dans le contexte, jamais d'application automatique) — cohérent
avec l'invariant `EVOLUTION.md` de confirmation humaine explicite avant toute action à
impact. Fail-open systématique : absence de `.claude/harnais.version` (dépôt source du
socle lui-même, ou projet non installé), timeout, erreur réseau → silence complet ; un
échec réseau ne met pas à jour le throttle, pour retenter à la session suivante plutôt
que d'attendre 24h de plus. Nouvelle lib `lib/latest-version.js` (comparaison de version
en tuples `[major, minor]`, jamais une comparaison de chaîne — même piège que documenté
dans `install.ps1`/`install.sh` pour `v1.10` vs `v1.9`) ; header `User-Agent` explicite
requis pour l'API GitHub via le module `https` natif de Node (contrairement à
`curl`/`Invoke-RestMethod`, qui le posent par défaut — sans lui l'API répond 403).
**Écarté** : un état "déjà notifié, ne plus redemander" — le rappel revient au rythme du
throttle tant que la version installée n'a pas changé, ce qui se résout naturellement
après une mise à jour, sans état de suppression supplémentaire à maintenir. **Écarté**
aussi : refactoriser la résolution de tag dupliquée dans `install.ps1`/`install.sh`/
`update-harnais` — hors périmètre de cette demande.

**Retenu — `STATS.md` + skill `harnais-stats`** : nouveau fichier par projet (template
`templates/STATS.md`, copié une fois comme `SESSION.md`, jamais écrasé), pensé pour être
collecté et comparé entre plusieurs projets — d'où une structure fixe (tableau "Usage
par skill" avec colonnes Utilisée/Pertinence/Problèmes) à ne pas faire dériver d'un
projet à l'autre. Contrairement à `session-checkpoint`/`onboard-project` (aucune n'a
d'étape de confirmation explicite avant écriture), `harnais-stats` **n'écrit jamais de
contenu sans accord explicite préalable** — nouvelle convention dans ce socle, dictée
par la nature du contenu (un jugement sur la pertinence d'un outil, pas un simple état
de travail). Réutilise l'agrégation déjà écrite dans `harnais-report`
(`.claude/harnais-metrics.jsonl` par `source`) pour la partie quantitative plutôt que de
la dupliquer. Skill nommée en écho à `harnais-report` (les deux tournent autour de
l'usage du socle) mais rôles distincts : `harnais-report` = quantitatif pur, à la
demande, jamais persisté ; `harnais-stats` = qualitatif + quantitatif, persisté,
toujours avec accord. Compte skills : 12 → 13 (avec `graphify`, ajouté dans la même
version : 11 → 13 au total). **Écarté** : un outil d'agrégation multi-projets des
`STATS.md` collectés — l'utilisateur a dit vouloir faire cette comparaison lui-même, pas
demandé un outil pour ça.

**Retenu — habitude de documentation à jour + rattrapage immédiat** : `EVOLUTION.md`
étape 4 ("Documenter") étendue pour inclure explicitement `README.md` quand un
changement touche à l'usage visible du socle. Rattrapage réel effectué dans la foulée
(pas seulement la règle pour l'avenir) : `README.md` était resté à **V1.8** pendant que
le socle était passé à V1.12 — bandeau de version, liste des skills (8 listées sur 13
réelles), nombre de hooks ("6" sur 9 réels, avec description des 3 manquants :
`hard-stop-guard.js`, `resume-after-reset.js`, `update-check.js`), règles
`permissions.deny` ("29" sur 39 réelles, recomptées depuis `.claude/settings.json`), et
une affirmation devenue fausse depuis V1.10 (`.env.example` prétendu illisible, alors
que la liste énumérée depuis V1.10 le rend lisible) — corrigée au passage. Constat que
cette dérive documentaire est exactement ce que l'utilisateur signalait : la preuve que
la règle seule (sans rattrapage) n'aurait pas suffi.

**Retenu — `checkpoint-pause`/`checkpoint-resume`** : dernier ajout demandé avant le
commit — une commande manuelle pour arrêter proprement une session (l'utilisateur doit
partir, la tâche prend plus de temps que prévu) sans perdre l'avancement, et sa
contrepartie pour reprendre, y compris dans une autre session. Deux skills distinctes
plutôt qu'une extension de `session-checkpoint` : celle-ci est un checkpoint réfléchi de
fin d'étape (réécrit toutes les sections), alors que `checkpoint-pause` doit être rapide
et mécanique (urgence par hypothèse — ne touche que "En cours / bloqué" + la ligne
"Dernier checkpoint"), et sa contrepartie `checkpoint-resume` n'a pas d'équivalent
existant (aucune skill ne "reprenait" explicitement sur commande avant celle-ci).
Noms préfixés `checkpoint-` (plutôt que les mots seuls `pause`/`resume`) pour éviter tout
recoupement avec une éventuelle commande native de Claude Code, et pour se regrouper
visuellement avec `session-checkpoint` dans la table de routage. Clarification
documentée explicitement dans les deux skills et le README : une skill ne peut pas
s'auto-interrompre — Échap/Ctrl+C (natif à Claude Code) reste le geste qui arrête une
action en cours, `checkpoint-pause` ne fait que capturer l'état et s'arrêter ensuite,
volontairement, sans continuer la tâche. Compte skills : 13 → 15 (11 → 15 au total sur
cette même version V1.12).

## Décisions propres — V1.13 (fix install.ps1, refonte MONITORING.csv)

**Contexte** : rapport d'incident utilisateur — `install.ps1` s'est bloqué
indéfiniment (deux fois) lors d'un `update-harnais` réel, `node.exe` figé à 0% CPU sans
sortie ni erreur, alors qu'invoquer `apply.js` directement fonctionne normalement.

**Retenu — sondage de progression dans `install.ps1`** : l'investigation (lecture
directe du code) a écarté les deux hypothèses du rapport — `install.ps1` ne s'autodétruit
jamais lui-même (seul le dossier temporaire d'extraction est nettoyé, en `finally`,
après la fin de `apply.js`), et il n'a jamais capturé sa propre sortie (`& node ...`
héritait déjà directement la console) ; la tentative de contournement du rapport
utilisant `-RedirectStandardOutput` vers un vrai fichier a d'ailleurs reproduit le même
blocage, ce qui écarte aussi tout deadlock de pipe. Cause probable non confirmable à
distance : un antivirus/EDR local retenant `node.exe` le temps d'une vérification de
réputation sur un script fraîchement téléchargé. Plutôt que de deviner un correctif
pour une cause invérifiable, l'invocation passe de l'opérateur `&`
(`Start-Process -PassThru` testé en premier, écarté : son `.ExitCode` s'est révélé
peu fiable une fois le process terminé) à `System.Diagnostics.Process` direct, qui
sonde la progression et affiche après 60s un avertissement one-shot avec la commande de
contournement exacte à copier-coller — jamais de kill automatique. `update-harnais/
SKILL.md` documente ce problème connu. Vérifié bout-en-bout (chemin heureux et chemin
d'erreur) sur un dossier de projet de test. **Écarté** : modifier `install.sh`
(aucune preuve du même symptôme sur Unix) ou ajouter un `Unblock-File` (efficacité
incertaine sur la cause réelle, `Expand-Archive` ne propage pas nécessairement le
Mark-of-the-Web aux fichiers extraits).

**Retenu — `STATS.md` → `MONITORING.csv`** : deux défauts remontés par l'utilisateur à
l'usage du `STATS.md` introduit en V1.12 — un format markdown à table réécrite en place
ne se prêtait pas à un usage de journal d'événements (l'exemple déclencheur étant
justement l'incident `install.ps1` ci-dessus, que l'utilisateur veut voir consigné comme
un fait daté), et le déclenchement de la skill `harnais-stats` ("jamais sans accord
explicite") n'avait pas de règle claire pour le cas où Claude remarque un problème de
lui-même. `MONITORING.csv` reprend le même statut create-only que l'ancien `STATS.md`
(template copié une fois, jamais réécrasé) mais en format CSV **append-only** (une
ligne = un événement daté, jamais réécrite) — même idiome que
`.claude/harnais-metrics.jsonl`, choisi plutôt qu'une table à réécrire pour conserver
l'historique complet au lieu de l'écraser à chaque relevé. `harnais-stats` gagne deux
modes clairement distincts : **automatique** (Claude remarque un fait concret en cours
de travail — incident, faux positif, ou succès notable — annonce en une phrase puis
écrit directement, sans confirmation bloquante) et **interactif** (demande ouverte
explicite — déroulé inchangé : proposer, agréger via `harnais-report`, noter la
pertinence, confirmer avant d'écrire). Colonne `projet` dérivée automatiquement du nom
de dossier (jamais demandée) plutôt que d'ajouter une étape de question à la création du
fichier — cohérent avec la demande explicite de réduire les questions bloquantes non
nécessaires. **Écarté** : un fichier séparé en plus de `STATS.md` (l'utilisateur a
choisi le remplacement complet, un seul mécanisme) ; un nouveau hook de rappel
périodique façon `update-check.js`/`context-watchdog.js` pour le mode automatique — la
détection reste un jugement de Claude en contexte, pas un mécanisme à seuil/throttle,
conformément à ce que l'utilisateur a demandé.
