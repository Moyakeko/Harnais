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

## 2. Checklist — avant de déployer

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

## 3. Checklist — après déploiement

- [ ] Vérifier que le service répond réellement (pas juste "le déploiement a réussi" côté
      plateforme — ouvrir l'URL / taper la commande de santé).
- [ ] Si des proches utilisent le service, prévenir en cas de changement visible ou de
      coupure prévue.

## Ce que cette skill ne fait pas

Ne choisit pas d'outil d'infra à la place de l'utilisateur (pas de recommandation de
plateforme par défaut) — le choix de cible reste sien, cette skill vérifie juste que rien
d'évident n'a été oublié avant de pousser en prod.
