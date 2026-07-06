# SESSION.md — état actuel (pointeur, pas journal)

> Injecté automatiquement au démarrage de chaque session (hook `SessionStart` —
> `.claude/hooks/session-start-inject.js`, qui injecte aussi le session ID courant).
> Mis à jour par Claude via la skill `session-checkpoint` après chaque étape
> significative. Reste court : c'est une table des matières de l'état actuel, pas un
> journal qui s'accumule. L'historique détaillé (daté + session ID) vit dans
> `.claude/session-log.md`, non chargé par défaut et hors git.

## Niveau / statut actuel

Projet non encore onboardé — lancer la skill `onboard-project` (elle crée `PROJECT.md`
à partir de quelques questions : nature du projet, contraintes, cible de déploiement).

## Fait

- Socle Harnais installé (voir `.claude/harnais.version` pour la version exacte).

## En cours / bloqué

Rien.

## Prochaines étapes

- Onboarder le projet (`onboard-project` → `PROJECT.md`).
- Smoke test du socle : `node .claude/hooks/tests/test-guard.js` (doit afficher N/N OK).

## Problèmes rencontrés / limites connues

Rien encore.

## Dernier checkpoint

Aucun — la date d'installation du socle est dans `.claude/harnais.version`.
