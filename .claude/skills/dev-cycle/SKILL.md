---
name: dev-cycle
description: Use for any non-trivial feature or bug fix — structures the work as explore → plan → code → test → review instead of jumping straight to code. Triggers on "implémente", "ajoute la fonctionnalité", "corrige le bug", "développe", or any multi-step coding request that isn't a one-line fix.
---

# dev-cycle

Le rituel de développement par défaut de ce socle. Ne remplace pas `/verify` ou
`/code-review` — les orchestre. But : éviter de coder sur une hypothèse fausse, et éviter
de déclarer une tâche terminée sans l'avoir vérifiée.

## Ne te déclenche pas pour

Un changement d'une ligne, une correction de typo, un renommage trivial — le cycle
complet est un coût, pas un rituel à appliquer partout. Utilise le jugement : si le
changement est chirurgical et sans ambiguïté, code-le directement.

## 1. Explore

Avant d'écrire quoi que ce soit : cherche si une implémentation similaire, un utilitaire
réutilisable, ou un pattern existant couvre déjà une partie du besoin. Ne propose pas de
code nouveau là où du code réutilisable existe déjà.

## 2. Plan

Formule explicitement (à voix haute pour l'utilisateur, pas juste en interne) :
- L'approche retenue et pourquoi (pas juste "je vais faire X", mais "je fais X plutôt que
  Y parce que Z").
- Les hypothèses ambiguës que tu as dû trancher — pose la question si trancher seul
  change significativement le résultat.
- Les critères de succès vérifiables : qu'est-ce qui prouvera que c'est fait ? ("le test
  X passe", "l'endpoint Y renvoie Z", "l'app se lance sans erreur") — pas un critère vague
  comme "ça devrait marcher".

## 3. Code

Changement chirurgical : ne touche que le code directement lié à la tâche. Respecte le
style existant du fichier plutôt que d'imposer tes conventions. N'ajoute pas de gestion
d'erreur, d'abstraction ou de feature non demandée — même si "ce serait plus propre".

## 4. Test

Ne délègue pas cette étape à une simple relecture visuelle du code. Utilise `/verify`
pour exercer le changement de bout en bout et observer le comportement réel (exécuter,
pas juste typechecker/linter). Si `/verify` ne s'applique pas (diff qui ne touche que des
docs/tests), dis-le explicitement plutôt que de sauter l'étape silencieusement.

## 5. Review

Pour un diff de taille raisonnable, utilise directement `/code-review`. Pour une revue
plus large (plusieurs fichiers/modules, ou tu veux garder le contexte principal propre),
délègue au sous-agent `code-reviewer` (voir `.claude/agents/code-reviewer.md`) et
rapporte une synthèse plutôt que le détail brut de la revue.

## Sortie attendue

À la fin du cycle, un résumé court : ce qui a changé, comment ça a été vérifié
concrètement (pas "les tests passent" en l'air — quels tests, quel résultat), et ce qui
reste à faire s'il y a un suivi.
