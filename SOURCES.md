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
