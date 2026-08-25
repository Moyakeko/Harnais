---
name: harnais-stats
description: Met à jour STATS.md (usage du socle sur ce projet — skills utilisées,
  pertinence perçue, problèmes rencontrés), pensé pour être collecté et comparé entre
  plusieurs projets — TOUJOURS avec l'accord explicite de l'utilisateur avant d'écrire
  quoi que ce soit. Triggers on "stats du projet", "harnais-stats", "documente l'usage
  du harnais", fin d'étape significative si plusieurs skills viennent d'être utilisées,
  ou sur proposition de Claude avant une pause connue (comme session-checkpoint, mais
  jamais sans confirmation).
---

# harnais-stats

Maintient `STATS.md` — un relevé, par projet, de l'usage réel du socle (quelles skills
servent, à quel point, avec quels problèmes) — pour que l'utilisateur puisse ensuite
collecter ces fichiers sur plusieurs projets et comparer. Contrairement à
`session-checkpoint`, **rien ne s'écrit sans un accord explicite préalable** : c'est un
jugement sur la pertinence d'outils, pas un simple état de travail.

## Quand se déclencher

- Mêmes moments que `session-checkpoint` : fin d'une étape significative où plusieurs
  skills viennent d'être utilisées, avant une pause connue, ou sur demande explicite
  ("stats du projet", "harnais-stats").
- Ne se déclenche pas après chaque message, ni pour une session où aucune skill notable
  n'a été utilisée depuis le dernier relevé.

## Déroulé

1. **Proposer, jamais imposer.** Annonce en une phrase ce qui serait mis à jour (ex:
   "onboard-project et security-audit ont servi depuis le dernier relevé, je peux
   mettre à jour STATS.md avec ton avis dessus — ok ?") et attends une confirmation
   explicite avant d'écrire quoi que ce soit. Un refus ou un silence = ne rien écrire.
2. **Quantitatif automatique** — une fois l'accord obtenu : agrège
   `.claude/harnais-metrics.jsonl` par `source` (`skill:<nom>`), même approche que la
   skill `harnais-report` (ne réinvente pas le parsing, réutilise cette logique) — sert
   à peupler la colonne "Utilisée" et à savoir quelles skills ont bougé depuis le
   dernier relevé (comparer aux dates de `STATS.md` § "Historique des relevés").
3. **Qualitatif** — pour chaque skill utilisée depuis le dernier relevé : proposer une
   pertinence (1-5 ou « pas d'avis ») et des problèmes rencontrés, en s'appuyant
   d'abord sur ce qui s'est réellement passé dans la session (erreur, faux positif du
   hook de garde, skill qui n'a pas couvert le besoin, ou au contraire un vrai gain de
   temps) plutôt que de tout redemander si c'est déjà observable. Demander à
   l'utilisateur de confirmer/ajuster plutôt que d'inventer un jugement.
4. **Écrire** (seulement après l'accord de l'étape 1) : mettre à jour `STATS.md` —
   section "Projet" (version du socle au relevé, date), tableau "Usage par skill"
   (réécrit avec les valeurs à jour), "Retours libres" si l'utilisateur a un commentaire
   général. **Ajouter** (ne pas écraser) une ligne dans "Historique des relevés"
   (`- <date> : <résumé court de ce qui a changé depuis le relevé précédent>`) — même
   logique réécriture/accumulation que `SESSION.md`/`session-log.md` dans
   `session-checkpoint`.
5. Confirmer à l'utilisateur ce qui a été écrit, en une ou deux phrases.

## Ce que cette skill ne fait pas

- Ne remplace pas `harnais-report` (rapport quantitatif à la demande, jamais persisté
  dans un fichier).
- Ne remplace pas `session-checkpoint` (état du travail en cours, pas usage du socle).
- Ne compare pas plusieurs projets entre eux — l'utilisateur fait cette comparaison
  lui-même en collectant les `STATS.md` de ses différents projets.
- N'écrit jamais de contenu sans accord explicite préalable, y compris pour une mise à
  jour mineure.

## Télémétrie

En fin de skill, journalise une ligne (best-effort, n'affecte jamais le déroulé si la
commande échoue) :
`node .claude/hooks/lib/metrics.js "skill:harnais-stats" "stats" "<résumé court>"`
