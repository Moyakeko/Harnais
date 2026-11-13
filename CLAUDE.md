# Harnais — dépôt du socle

Ce dépôt contient le socle Claude Code que `install/apply.js` installe dans les projets.
Les règles de travail sont les mêmes que dans un projet :

@templates/CLAUDE.core.md

## Spécifique à ce dépôt
- Bloc injecté dans les projets : `templates/CLAUDE.core.md` (≤ 60 lignes avec marqueurs,
  comportement et ton uniquement). Rien d'autre ne part dans le CLAUDE.md d'un projet.
- Historique : `CHANGELOG.md`. Pourquoi des choix : `SOURCES.md`, `EVOLUTION.md`.
- Dépôt public : aucun secret, aucun détail de serveur, aucun nom de projet privé.
- Tests : `node .claude/hooks/tests/run-all.js` (pose `HARNAIS_NO_METRICS=1`).
