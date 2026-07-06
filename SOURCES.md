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
