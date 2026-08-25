---
name: checkpoint-resume
description: Reprend immédiatement la tâche notée dans SESSION.md ("En cours /
  bloqué") sans redemander où on en était — contrepartie de checkpoint-pause,
  utilisable dans la même session ou une nouvelle. Triggers on "/checkpoint-resume",
  "reprends", "continue où on en était", "on reprend".
---

# checkpoint-resume

Reprise explicite et immédiate d'une tâche laissée en suspens (typiquement via
`checkpoint-pause`, mais fonctionne pour tout § "En cours / bloqué" non vide de
`SESSION.md`) — pour ne pas avoir à réexpliquer où on en était.

## Déroulé

1. Lit `SESSION.md` § "En cours / bloqué" — déjà injecté automatiquement en début de
   session par `session-start-inject.js`, mais cette commande le rend explicite et
   immédiat, utile aussi en cours de session (pas seulement au démarrage), par exemple
   juste après un `checkpoint-pause` dans la même conversation.
2. Si la section est vide/« Rien de bloqué » : le dire simplement, proposer de regarder
   "Prochaines étapes" à la place plutôt que de ne rien faire.
3. Si un état est présent : le reformuler en une ou deux phrases (pour que l'utilisateur
   puisse corriger si Claude l'a mal compris), puis reprendre l'exécution directement —
   pas de boucle de confirmation supplémentaire, l'utilisateur a déjà signalé son intent
   en tapant la commande.

## Ce que cette skill ne fait pas

- Ne vide ni ne réécrit "En cours / bloqué" elle-même — c'est un futur
  `session-checkpoint`/`checkpoint-pause` qui le fera, une fois la tâche reprise
  effectivement terminée ou de nouveau interrompue.
- Ne remplace pas l'injection automatique de `SESSION.md` au démarrage (qui reste
  automatique, sans confirmation) — c'est un déclenchement explicite et immédiat, utile
  en particulier en cours de session.

## Télémétrie

En fin de skill, journalise une ligne (best-effort, n'affecte jamais le déroulé si la
commande échoue) :
`node .claude/hooks/lib/metrics.js "skill:checkpoint-resume" "resume" "<résumé court>"`
