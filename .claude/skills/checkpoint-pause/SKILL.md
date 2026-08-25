---
name: checkpoint-pause
description: Capture immédiatement l'état d'avancement dans SESSION.md ("En cours /
  bloqué") et s'arrête — pour un arrêt manuel volontaire (l'utilisateur doit partir, la
  tâche prend plus de temps que prévu) sans perdre le contexte, à reprendre plus tard
  même dans une autre session via checkpoint-resume. Triggers on "/checkpoint-pause",
  "je dois arrêter là", "sauvegarde et arrête-toi", "je n'ai plus le temps".
---

# checkpoint-pause

Checkpoint **d'urgence** : contrairement à `session-checkpoint` (réfléchi, déclenché à
la fin d'une étape significative, réécrit toutes les sections avec soin), celui-ci est
déclenché explicitement par l'utilisateur à tout moment, va vite, et ne touche que le
strict nécessaire pour ne rien perdre avant de s'arrêter.

**Mécanisme important à garder en tête** : cette skill ne peut pas interrompre
elle-même une action en cours — si Claude est en plein milieu d'un outil, l'utilisateur
doit d'abord interrompre (Échap/Ctrl+C, déjà natif à Claude Code) avant de taper
`/checkpoint-pause`. La skill capture l'état **tel qu'il est au moment de l'appel**
(interrompu ou non), elle ne suppose pas spécifiquement une interruption.

## Ce que cette skill fait

1. Écrit dans `SESSION.md` § "En cours / bloqué" un état précis et mécanique de
   l'instant présent : la tâche en cours, le ou les fichiers en cours d'édition, la
   dernière action complétée, la prochaine action concrète à faire à la reprise. Ne
   réécrit pas les autres sections (Fait/Prochaines étapes) si elles ne sont pas
   concernées — priorité à la vitesse.
2. Met à jour la ligne "Dernier checkpoint" avec un horodatage et la mention explicite
   « checkpoint d'urgence (arrêt manuel) » — une future session doit savoir que ce
   relevé n'a pas eu le lissage habituel d'un `session-checkpoint`.
3. Ajoute une entrée à `.claude/session-log.md` (même gabarit que `session-checkpoint` :
   session ID, fichiers touchés, quoi/pourquoi, vérifié par), avec la mention « arrêt
   manuel via checkpoint-pause ».
4. Termine par **une seule ligne** de confirmation (ex : « État enregistré dans
   SESSION.md — tu peux fermer, `/checkpoint-resume` pour reprendre. »). Pas de
   récapitulatif long : l'utilisateur est pressé par hypothèse.

## Ce que cette skill ne fait pas

- Ne termine pas la tâche interrompue et ne pose pas de question avant d'écrire.
- Ne remplace pas `session-checkpoint` — à préférer quand il n'y a pas d'urgence, pour
  un checkpoint réfléchi qui réécrit toutes les sections.
- Ne peut pas interrompre elle-même une action en cours (voir ci-dessus).

## Télémétrie

En fin de skill, journalise une ligne (best-effort, n'affecte jamais le déroulé si la
commande échoue) :
`node .claude/hooks/lib/metrics.js "skill:checkpoint-pause" "pause" "<résumé court>"`
