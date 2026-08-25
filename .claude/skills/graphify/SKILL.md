---
name: graphify
description: Construit un graphe de connaissances interrogable d'un codebase (code,
  docs, schémas SQL, PDFs) via l'outil tiers Graphify (Graphify-Labs/graphify, CLI
  `graphify` / paquet PyPI `graphifyy`) — pour explorer l'architecture d'un projet
  inconnu ou volumineux, tracer des chemins d'appel/dépendances, ou comprendre le
  "pourquoi" d'une conception. Triggers on "graphify", "cartographie ce code", "graphe
  de connaissances", "comprendre l'architecture de ce projet".
---

# graphify

Wrapper de l'outil tiers **Graphify** (Graphify-Labs/graphify) : construit un graphe de
connaissances (code, docs, schémas SQL, PDFs, images) à partir d'un repo, interrogeable
ensuite pour explorer une architecture inconnue ou volumineuse. Optionnelle — jamais un
prérequis bloquant, même patron que `perplexity-research`.

## Quand se déclencher / ne pas se déclencher

- Se déclenche : onboarding sur un gros repo inconnu, besoin de tracer des chemins
  d'appel/dépendances à travers de nombreux fichiers, ou de comprendre le "pourquoi"
  d'une conception documentée dans des sources hétérogènes (code + docs + schémas).
- Ne se déclenche pas pour un besoin simple d'exploration : `Grep`/`Glob` ou l'agent
  `Explore` suffisent alors, ne sur-outille pas. Ne remplace pas `onboard-project`
  (cadrage initial d'un projet) ni `dev-cycle` (étape "explore" d'une tâche ciblée).

## Vigilance source — plusieurs dépôts portent ce même nom

"graphify" est un nom très cloné : en plus du dépôt officiel, on trouve des forks/clones
quasi identiques sous des noms proches (`collabsoft/ai_graphify`, `sharkkyyy10/graphify-`,
`wfsh2026/Skill-graphify`, `rhanka/graphify`, `safishamsi/graphify`, des listings sur des
marketplaces tierces), un second domaine concurrent (`graphify.net`), et un paquet PyPI
voisin (`lifeisforu-graphify`). Avant toute installation, vérifie que la source est bien :

- Dépôt : `github.com/Graphify-Labs/graphify`
- Package PyPI : `graphifyy` (double y — la commande installée s'appelle `graphify`)

Ne jamais installer depuis un nom approchant sans le signaler explicitement à
l'utilisateur — c'est le réflexe anti-typosquatting déjà documenté dans `security-audit`.

## Avant toute première installation sur une machine/projet (obligatoire)

Graphify lit l'intégralité d'un repo et fait tourner des sous-agents Claude en réseau —
blast radius large, donc pas d'installation à la légère :

1. **`security-audit`** : requête OSV.dev sur `graphifyy` pour la version exacte visée
   avant `uv tool install` (voir sa section "Vérification de version avant ajout de
   dépendance"). Aucune CVE connue au moment de la rédaction de cette skill, mais
   revérifie à chaque installation — un package neuf peut être compromis après coup.
2. **`sandbox-pretest`** : première exécution en isolation avant de lancer l'outil sur un
   projet contenant des données sensibles, précisément parce qu'il lit largement le repo
   et appelle le réseau.

## Installation (une fois les deux vérifications faites)

```
uv tool install graphifyy
```
(ou `pipx install graphifyy`). Puis, dans le projet cible :
```
/graphify --project
```
génère le `SKILL.md` scoped au projet cible (sous `.claude/skills/graphify/SKILL.md` de
**ce** projet — distinct de la présente skill du socle, qui ne fait que documenter
comment y arriver en sécurité).

## Usage

- `/graphify query` — interroger le graphe généré.
- `/graphify path` — tracer un chemin entre deux éléments (ex: dépendances, appels).
- `/graphify explain` — obtenir l'explication du "pourquoi" d'un nœud du graphe.

## Optionnalité

Si l'outil n'est pas installé ou indisponible, retombe sur l'exploration native
(`Grep`/`Glob`/agent `Explore`) sans bloquer la tâche en cours.

## Ce que cette skill ne fait pas

Ne réinvente pas la vérification de dépendance (`security-audit`) ni l'isolation
(`sandbox-pretest`) — elle route dessus. Ne remplace pas `onboard-project`/`dev-cycle`.

## Télémétrie

En fin de skill, journalise une ligne (best-effort, n'affecte jamais le déroulé si la
commande échoue) :
`node .claude/hooks/lib/metrics.js "skill:graphify" "graphify" "<résumé court>"`
