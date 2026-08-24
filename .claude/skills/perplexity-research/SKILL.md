---
name: perplexity-research
description: Recherche web synthétique et sourcée via le MCP Perplexity (perplexity_ask/perplexity_research/perplexity_reason), en complément de WebSearch natif — pour une question de recherche complexe nécessitant une synthèse croisée de plusieurs sources ou une vérification approfondie (ex: sécurité d'une dépendance, actualité d'un outil de déploiement). Triggers on "recherche approfondie", "perplexity", "vérifie avec plusieurs sources", "sonar", "recherche poussée". Optionnelle : jamais un prérequis bloquant, bascule sur WebSearch natif si non configuré.
---

# perplexity-research

Complément optionnel à `WebSearch`/`WebFetch` (déjà disponibles nativement) : le MCP
Perplexity apporte une synthèse multi-source avec citations et des modes de recherche
plus poussés (raisonnement, "deep research"). Ce n'est jamais un prérequis — si le MCP
n'est pas configuré, continue avec `WebSearch` sans bloquer la tâche en cours.

## Quand se déclencher

- L'utilisateur mentionne explicitement Perplexity, "sonar", ou demande une recherche
  approfondie/sourcée.
- Une question de recherche nécessite de croiser plusieurs sources ou une vérification
  indépendante (ex: chantier sécurité de `security-audit`, recherche d'outils/MCP à jour
  dans `deploy-checklist`) — dans ces cas, propose Perplexity comme option, n'impose rien.

Ne te déclenche pas pour une question factuelle simple : `WebSearch` natif reste le
défaut, plus rapide et sans dépendance externe.

## 1. Vérifier si le MCP est déjà configuré

`claude mcp list` — cherche une entrée `perplexity`. Si présente, utilise directement les
tools `perplexity_search`/`perplexity_ask`/`perplexity_research`/`perplexity_reason`
(modèles Sonar/Sonar Pro/Sonar Reasoning Pro/Sonar Deep Research) selon le besoin :
- `perplexity_ask`/`perplexity_search` : question ponctuelle avec sources.
- `perplexity_research`/`perplexity_reason` : synthèse plus poussée, raisonnement
  multi-étapes — plus lent, à réserver aux questions qui le justifient.

## 2. Si le MCP n'est pas configuré

Explique comment l'ajouter, **sans jamais exécuter la commande sans confirmation
explicite de l'utilisateur** (règle CLAUDE.md n°1 — jamais de secret en clair) :

```
claude mcp add perplexity --env PERPLEXITY_API_KEY="${PERPLEXITY_API_KEY}" -- npx -y @perplexity-ai/mcp-server
```

La clé va dans `.env` (gitignoré) sous `PERPLEXITY_API_KEY=...`, jamais littérale dans la
commande ni dans un `.mcp.json` committé — voir `references/mcp-template.json` pour le
gabarit avec expansion `${PERPLEXITY_API_KEY}` (Claude Code substitue la valeur au
démarrage, la clé ne rentre jamais dans le fichier versionné).

## 3. Pas de clé disponible

Dis-le explicitement à l'utilisateur et continue avec `WebSearch`/`WebFetch` natifs sans
bloquer la tâche en cours — Perplexity est un raffinement, pas une dépendance du socle.

## Liens avec d'autres skills

- `security-audit` (vérification de version d'une dépendance) : si un doute persiste
  au-delà de la réponse d'OSV.dev (compromission très récente non encore répertoriée),
  `perplexity-research` peut compléter — jamais un remplacement du contrôle OSV.dev
  systématique.
- `deploy-checklist` (recherche d'outils/MCP de déploiement à jour) : complément possible
  à `find-skills`/`WebSearch` si configuré, pour une synthèse plus poussée sur un
  écosystème qui évolue vite.

## Ce que cette skill ne fait pas

- Ne configure jamais le MCP sans confirmation explicite de l'utilisateur.
- Ne stocke jamais de clé API en clair, nulle part (code, config committée, réponse
  affichée à l'écran).
- Ne remplace pas `WebSearch` par défaut — reste un complément pour les cas qui
  justifient une synthèse multi-source plus poussée.

## Télémétrie

En fin de skill, journalise une ligne (best-effort, n'affecte jamais le déroulé si la
commande échoue) :
`node .claude/hooks/lib/metrics.js "skill:perplexity-research" "research" "<résumé court>"`
