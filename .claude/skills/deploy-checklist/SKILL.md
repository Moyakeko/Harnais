---
name: deploy-checklist
description: Pre-deployment checklist for a real service used by the user or friends/family — platform-agnostic (VPS, PaaS, or undecided). Triggers on "déploie", "mise en prod", "deploy-checklist", "je veux mettre ça en ligne".
---

# deploy-checklist

Checklist pour un "petit prod solo" — un service que l'utilisateur ou ses proches vont
réellement utiliser, pas du CI/CD d'entreprise. Reste agnostique de la cible : ne suppose
jamais VPS ou PaaS par défaut.

## 1. Questions préalables (courtes, pas un interrogatoire)

- Cible de déploiement : VPS/self-host (Docker ou non), PaaS (Vercel/Railway/Render/
  Fly.io/etc.), ou pas encore décidé ? Si pas décidé, aide à trancher en fonction du
  projet (budget, besoin de contrôle, complexité) plutôt que d'imposer un choix par
  défaut.
- Premier déploiement de ce service, ou mise à jour d'un service déjà utilisé par
  quelqu'un ? (change complètement le niveau de prudence — une mise à jour d'un service
  déjà utilisé a besoin d'un plan de rollback, un premier déploiement non.)
- Le service manipule-t-il des secrets, une base de données, ou des données
  personnelles de proches ?

## 2. Recherche ciblée avant la checklist (find-skills + web si besoin)

Avant de dérouler la checklist, prends le temps d'aller dans le détail plutôt que de te
précipiter :

1. Identifie précisément la stack de déploiement réelle (langage, framework, base de
   données, provider) depuis `PROJECT.md`/le repo — jamais une supposition générique.
2. Appelle `find-skills` avec une requête ciblée sur cette stack précise (ex:
   "déploiement Fly.io Node Postgres") pour repérer une skill existante pertinente.
   Présente les candidats trouvés ; n'installe qu'après accord explicite de
   l'utilisateur (comportement standard de `find-skills`, inchangé).
3. Si rien de pertinent, ou en cas de doute sur l'actualité d'un outil/MCP pour ce
   provider : recherche web ciblée (`WebSearch` natif, ou `perplexity-research` si
   configuré) — ne réponds pas de mémoire sur un écosystème qui évolue vite.
4. Résume ce qui a été trouvé (ou "rien de spécifique, checklist générique seule") avant
   de continuer avec la checklist ci-dessous.

Choix délibéré : cette skill ne construit pas de checklist de déploiement figée par
techno — la recherche se refait dynamiquement à chaque projet plutôt que de figer un
contenu qui deviendrait vite obsolète.

## 3. Checklist — avant de déployer

- [ ] Build/compilation passe sans erreur.
- [ ] Tests passent (via `/verify` si pas déjà fait dans le cycle de dev).
- [ ] `security-audit` lancé — aucun secret en clair détecté.
- [ ] Premier déploiement, dépendance nouvellement ajoutée, ou changement à risque
      (réseau, système de fichiers, code non relu) : `sandbox-pretest` exécuté — build +
      tests passés en environnement isolé avant de toucher la cible réelle.
- [ ] Variables d'environnement définies **côté cible** (pas committées) — vérifier
      qu'aucune valeur de `.env` local n'a été copiée en dur dans un fichier de config
      versionné.
- [ ] Si mise à jour d'un service déjà en usage réel : plan de rollback identifié (version
      précédente déployable rapidement, ou backup de la base de données si migration de
      schéma).
- [ ] Logs minimaux en place (au moins de quoi diagnostiquer un crash après coup — pas
      besoin d'une stack d'observabilité complète pour un usage solo).
- [ ] Si le service est exposé publiquement : HTTPS actif, pas de port de debug/admin
      exposé sans authentification.
- [ ] Si le projet a un remote git (GitHub/GitLab) : protection de la branche principale
      activée côté serveur (interdire force-push et suppression de branche). Le hook du
      socle ne protège que cette machine — un service réel mérite l'équivalent serveur.
      Proposer, ne pas l'activer sans accord (c'est le compte de l'utilisateur).
- [ ] Si base de données : le compte utilisé par l'application a les privilèges minimum
      (lecture/écriture sur ses tables, pas de DROP/CREATE, pas de superuser) et est
      distinct du compte admin qui gère les migrations. Un bug ou une injection dans
      l'app ne doit pas pouvoir détruire la base.
- [ ] Rappels d'actions que seul l'utilisateur peut faire (Claude ne peut ni les
      vérifier ni les exécuter — les rappeler, puis le croire sur parole) : 2FA activée
      sur le compte GitHub/GitLab et sur le compte de la plateforme de déploiement.

## 4. Checklist — après déploiement

- [ ] Vérifier que le service répond réellement (pas juste "le déploiement a réussi" côté
      plateforme — ouvrir l'URL / taper la commande de santé).
- [ ] Si des proches utilisent le service, prévenir en cas de changement visible ou de
      coupure prévue.

## Ce que cette skill ne fait pas

Ne choisit pas d'outil d'infra à la place de l'utilisateur (pas de recommandation de
plateforme par défaut) — le choix de cible reste sien, cette skill vérifie juste que rien
d'évident n'a été oublié avant de pousser en prod. Ne construit pas non plus de skill de
déploiement générique figée par techno (voir section 2) — la recherche se refait à chaque
projet.

## Télémétrie

En fin de skill, journalise une ligne (best-effort, n'affecte jamais le déroulé si la
commande échoue) :
`node .claude/hooks/lib/metrics.js "skill:deploy-checklist" "deploy" "<résumé court>"`
