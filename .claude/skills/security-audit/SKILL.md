---
name: security-audit
description: Lightweight pre-commit/pre-deploy security routine — scans for hardcoded secrets, checks .gitignore hygiene, and flags dependency risk. Triggers on "avant de commit", "audit de sécurité", "security-audit", "vérifie les secrets", or before deploy-checklist. Defers to /security-review for deep OWASP-style analysis — this skill does not duplicate it.
---

# security-audit

Routine légère à lancer par habitude (avant un commit/PR, ou avant `deploy-checklist`) —
pas une revue de sécurité complète. Pour l'analyse approfondie (injections, auth, OWASP),
utilise la skill globale déjà disponible `/security-review` — ne réimplémente pas ça ici.

## 1. Scan de secrets en clair

Cherche dans les fichiers modifiés/ajoutés (pas tout l'historique git, sauf demande
explicite) des patterns typiques :
- Clés API/tokens : `sk-`, `ghp_`, `AKIA`, `xox[baprs]-`, chaînes longues en base64/hex à
  côté de mots-clés comme `key`, `secret`, `token`, `password`, `api_key`.
- URL de connexion avec identifiants en dur (`postgres://user:pass@...`,
  `mongodb://user:pass@...`).
- Fichiers `.env`, `.env.local`, `credentials.json` ou équivalents ajoutés au staging git
  (`git status`/`git diff --cached`).

Si quelque chose matche : ne le corrige pas silencieusement en le supprimant — signale-le
clairement à l'utilisateur et propose la correction (variable d'env + `.gitignore`).

## 2. Hygiène `.gitignore`

Vérifie que `.gitignore` couvre bien : `.env`, `.env.*` (sauf `.env.example`), les
dossiers de dépendances (`node_modules`, `venv`, `__pycache__`, `target`, `vendor` selon
la stack détectée), et les fichiers de build/credentials locaux.

## 3. Hygiène des dépendances (opportuniste, pas bloquant)

Selon le manifeste présent dans le repo, suggère (sans l'exécuter automatiquement sans
accord) l'outil d'audit correspondant :
- `package.json` → `npm audit`
- `requirements.txt`/`pyproject.toml` → `pip-audit`
- `Cargo.toml` → `cargo audit`
- `go.mod` → `govulncheck`

Ne bloque pas la tâche en cours pour ça — c'est une checklist, pas un gate.

## 4. Pièges typiques du code généré par IA

Passe le diff en revue contre cette liste — ce sont les erreurs que l'IA (toi compris)
introduit le plus souvent sans les signaler :

- **Dépendance hallucinée ou typosquattée** : pour chaque paquet *nouvellement ajouté*,
  vérifie qu'il existe vraiment sur le registre officiel et que l'orthographe est bien
  celle du paquet voulu (`npm view <pkg>`, `pip index versions <pkg>`, ou la page du
  registre). Le "slopsquatting" (publier un paquet malveillant sous un nom que les LLM
  hallucinent) est une attaque réelle et en croissance.
- **TLS/SSL désactivé** : `verify=False`, `rejectUnauthorized: false`,
  `NODE_TLS_REJECT_UNAUTHORIZED=0`, `InsecureSkipVerify`, `curl -k`/`--insecure`.
- **Exécution/désérialisation dynamique de données externes** : `eval(`/`exec(`,
  `pickle.loads`, `yaml.load` sans `SafeLoader`, `Function(...)` sur une entrée.
- **Injection SQL** : requête construite par concaténation/f-string/template literal —
  il faut des requêtes paramétrées, sans exception.
- **XSS** : `innerHTML`/`dangerouslySetInnerHTML`/`v-html` avec des données utilisateur.
- **Crypto faible** : `md5`/`sha1` pour des mots de passe (→ bcrypt/argon2),
  `Math.random()`/`random` pour des tokens ou secrets (→ `crypto`/`secrets`).
- **Config laxiste** : CORS `*` combiné aux credentials, mode debug actif dans une
  config destinée à la prod, endpoint d'admin/debug sans authentification.

## 5. Escalade obligatoire

Si le diff touche à l'authentification/sessions, au paiement, à l'upload de fichiers, au
parsing d'entrée utilisateur, ou à des données personnelles : lance `/security-review`
(passe approfondie) avant le commit. Dans ces cas-là ce n'est **pas optionnel** — la
checklist ci-dessus ne suffit pas.

## 6. Rapport

Sortie courte : ce qui a été trouvé (ou "rien détecté"), et une ligne d'action par
problème. Termine en rappelant que `/security-review` reste disponible pour une passe
plus approfondie si le projet le justifie (auth, paiements, données sensibles).
