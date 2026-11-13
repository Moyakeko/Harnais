# RAPPORT D'AUDIT — phase 1 (lecture seule) — 2026-11-13

Auteur : manager yann-70, à partir de deux audits délégués (harnais : Opus ; serveur : Sonnet), relus et recoupés par le manager.
Rien n'a été modifié, supprimé ni redémarré, ni sur le serveur ni sur le PC. Seuls ajouts : un dossier de travail sur le serveur (`~/claude-code/livrables/audit-2026-11-13/`, clones et notes) et cette branche `audit`.

Légende : **V** = vérifié par une preuve lue ou une commande · **S** = supposé / déduit · **NV** = non vérifiable depuis le serveur.

> **Version publique.** Le dépôt Harnais est public. L'inventaire détaillé du serveur (ports, adresses, conteneurs sensibles, noms de variables secrètes, exposition réseau) a donc été retiré de ce fichier. La version complète reste sur le serveur : `~/claude-code/livrables/audit-2026-11-13/RAPPORT-AUDIT-complet.md`.

## 1. Résumé

1. **PC injoignable** : les 15 sessions Remote Control du PC sont hors ligne. L'audit du harnais repose sur GitHub, les copies serveur et 37 transcripts serveur. L'usage réel sur le PC est non vérifié.
2. **Le harnais coûte 9 000 à 16 000 tokens avant le premier message** : CLAUDE.md fait 254 lignes, dont environ 55 % d'historique de versions et de description interne des hooks.
3. **Presque rien n'est appelé** : sur le serveur en 11 jours, 1 skill du harnais sur 16 a servi (`session-checkpoint`), 0 agent, et MONITORING.csv est vide dans les 4 projets.
4. **Les hooks et `permissions.deny` sont la partie qui marche** : 7 vrais blocages utiles (3 `push` destructifs, 4 lectures de secret).
5. **Plusieurs règles fabriquent les questions et les réserves** : « pose la question », « pédagogie plutôt que vitesse », audit de sécurité avant tout outil tiers, Caveman explicitement subordonné, ECC déclaré « volontairement absent ».
6. **Les skills tiers ne se déclenchent pas** pour trois raisons : Caveman et Ponytail tiennent par les hooks de leur plugin, perdus si on les copie comme simples skills ; ECC apporte 314 skills, soit plus de 10 fois le budget de la liste ; et le harnais les contredit.
7. **Harnais v2 proposé** : CLAUDE.md de 60 lignes maximum (comportement et ton), le reste en hooks, 3 skills gardés, et un manifeste par projet qui installe les tiers comme plugins, avec leurs hooks.
8. **Nuance sur « le serveur marche sans harnais »** : les sessions manager n'ont pas de harnais, mais les 4 projets serveur ont le harnais v1.16 et ses hooks tournent.
9. **Serveur** : manager et workers vivent dans le conteneur du Hub. Un redéploiement du Hub tue tout, les workers ne sont pas isolés, la surveillance meurt avec la session manager, et aucune sauvegarde n'a été trouvée.
10. **Architecture cible** : ta piste (manager sur l'hôte) est bonne à terme, mais je recommande d'abord un manager en conteneur dédié, séparé du Hub, avec des workers en conteneurs isolés. Plan en 12 étapes, toutes en ajout et réversibles.

## 2. Classement du harnais

Catégories : **(a)** utile et utilisé · **(b)** redondant : Claude le fait seul ou une fonction native le couvre · **(c)** ignoré ou oublié, avec la raison · **(d)** à transformer en hook · **(x)** nuisible ou contradictoire.

### 2.0 Mesures

### 2.0.1 Ce qui est chargé à chaque session (estimation à environ 3,5 caractères par token, texte français)

| Élément | Taille | Tokens estimés | Mécanisme |
|---|---|---|---|
| CLAUDE.md (bloc harnais) | 21,3 Ko | ~6 100 | chargé entier au lancement (memory.md) |
| Descriptions des 16 skills et 2 agents | 6 756 car. | ~1 900 | liste des skills (skills.md) |
| SESSION.md (hook `session-start-inject`) | 2,7 à 27,5 Ko | ~800 à 7 800 | `additionalContext` SessionStart |
| Messages `update-check` et `graphify-check` | quelques lignes | <100 | SessionStart |
| **Total** | | **~9 000 (ent-calendar-sync) à ~16 000 (Vlad_Arko)** | |

### 2.0.2 Appels réels mesurés (serveur uniquement)

Les transcripts du PC ne sont **pas accessibles** (NV).

- Les transcripts serveur (37 fichiers, 12 projets) contiennent 2 appels `Skill:session-checkpoint` (ent-calendar-sync). Les autres appels de skills ne concernent pas le harnais : `claude-api` ×5, `update-config` ×2, `chrome-browser` ×2. **0 appel `Agent`/`Task`** vers `code-reviewer` ou `debugger`. (V)
- Agrégat des `harnais-metrics.jsonl` des 4 projets serveur (1 489 lignes, du 2026-11-02 au 2026-11-13) : (V)

| Source | Événements |
|---|---|
| statusline (snapshot) | 617 |
| guard-dangerous-commands | 269 allow / 181 block / 8 skip. **174 des 181 blocks sont deux rafales de 87 en une minute** (2026-11-04 09:22 et 09:23, pont-claude et conso-tokens), soit la suite de tests `test-guard.js`, qui pollue la télémétrie. **Vrais blocks : 7** (3 `git push` destructifs, 4 lectures de fichier secret). |
| hard-stop-guard | 238 pass-fresh, 28 stop-noop, **0 arrêt dur** |
| context-watchdog | 26 pass, 7 skip, 0 rappel |
| notify-desktop | 75 skip (le serveur n'a pas d'écran) |
| session-start-inject | 13 |
| update-check | 8 up-to-date, 5 throttled |
| graphify-check | 2 reminder-shown, 11 skip. **0 utilisation de graphify ensuite** |
| skill:session-checkpoint | 1 |

### 2.1 CLAUDE.md, section par section

| # | Élément (CLAUDE.md:lignes) | Classe | Preuve | V/S |
|---|---|---|---|---|
| R0 | Intro « Ce dépôt n'est pas un projet applicatif… détecte la stack » (1-7) | **x** | Copiée telle quelle dans les projets (Vlad_Arko/CLAUDE.md:2-3), donc fausse dans un projet. Détecter la stack : Claude le fait seul. | V |
| R1 | Pas de secret en clair (14-18) | **a + d** | Déjà appliquée par `permissions.deny` (39 entrées) et par le hook (4 vrais blocks de lecture de secret). La phrase « arrête-toi et préviens » pousse à interrompre la tâche. | V |
| R2 | Commandes destructrices (20-35) | **a (hook) / b (texte)** | Le hook a fait 7 vrais blocks. Les 16 lignes qui décrivent le hook dupliquent son code ; le hook renvoie déjà sa raison à Claude (stderr). | V |
| R3 | Pas de « c'est fait » sans vérification (37-40) | **a** | Règle de comportement utile, sans équivalent natif garanti. Elle renvoie à `/verify` et `dev-cycle` (0 appel). | V (règle) / S (effet) |
| R4 | Expliquer le pourquoi, pédagogie plutôt que vitesse (42-45) | **c + x** | Contredit Caveman et Ponytail (sortie courte). CLAUDE.md:95-98 le dit explicitement : « la règle n°4 prime sur la compacité ». Rend les réponses longues. | V |
| R5a | Ne devine pas une hypothèse, pose la question (48-52) | **x** | C'est **la** règle qui fait poser des questions. Elle impose aussi de justifier toute dépendance et de passer par `security-audit` (0 appel). | V |
| R5b | Rien au-delà de la demande (53-54) | **b** | Comportement par défaut des modèles récents, et cœur de Ponytail. | S |
| R5c | Changement chirurgical (55-56) | **b** | Idem. | S |
| R5d | Critères de succès avant de coder (57) | **a** (court) | Utile, mais doublon de R3. | S |
| R6 | Tenir SESSION.md, LESSONS.md « systématiquement » (59-67) | **c + d** | SESSION.md de Vlad_Arko : 320 lignes, alors que la règle dit « pointeur court ». Seulement 2 appels `session-checkpoint` en 11 jours. LESSONS.md, lui, est rempli (Vlad 412 l., ent-cal 107 l., commette 62 l.) : la partie leçons marche. | V |
| T1 | Tableau des skills (69-88) | **b** | Il duplique les descriptions déjà présentes dans la liste des skills (~2 Ko en double). | V |
| T2 | Skills globales `/verify`, `/code-review`… (90-93) | **b** | La liste native les montre déjà. | V |
| T3 | Paragraphe Caveman, objectif -33 % de tokens (95-103) | **c + x** | Objectif mesuré dans MONITORING.csv, qui est vide (0 mesure). Restreint Caveman. | V |
| T4 | Tableau des sous-agents (105-110) | **b** | Déjà dans la liste native des agents. 0 appel. | V |
| C1 | Contre-intuitif : guard (114-120) | **b** | Doublon de R2. | V |
| C2 | `permissions.deny` et variantes `.env` (121-132) | **b** | Détail d'implémentation (pourquoi pas de wildcard). C'est utile à qui maintient le harnais, pas à la session. | V |
| C3 | `disableBypassPermissionsMode` (133-135) | **b** | Réglage auto-appliqué. | V |
| C4 | One-liner d'installation bloqué par le hook (136-142) | **b** | Ne concerne que l'installation. | V |
| C5 | « Si un blocage surprend… » (143-144) | **b** | | V |
| C6 | SESSION.md injecté (145-147) | **b** | | V |
| C7 | Auto-compact désactivé, watchdogs 70/85 % (148-163) | **d (déjà) / x** | Mécanisme déjà en hook ; le texte ne sert qu'à décrire. **Risque** : `autoCompactEnabled:false` laisse le contexte se remplir si un hook échoue. 0 arrêt dur mesuré. | V |
| C8 | Crédits 5 h, reprise automatique (164-179) | **d (déjà)** | Historique (« inverse un choix antérieur V1.7… »). | V |
| C9 | V1.11 : correctif fail-open (180-187) | **b** | Journal des changements. | V |
| C10 | V1.14 : agents en arrière-plan (188-204) | **b**, sauf 1 phrase | Journal des changements. Seule la convention « un sous-agent checkpointe au fil de l'eau » est un comportement. | V |
| C11 | update-harnais en deux étapes (205-209) | **b** | | V |
| C12 | find-skills / `npx skills add` (210-216) | **x** | « Vérifie la réputation… sandbox-pretest » : des réserves en plus avant tout skill tiers. | V |
| C13 | Homonymes de graphify (217-220) | **b** | | V |
| C14 | update-check.js (221-226) | **b** | | V |
| C15 | graphify-check.js (227-235) | **b** | | V |
| A1 | « Volontairement absent » : ECC, compteurs (237-254) | **b / x** | Historique et compteurs. Présente ECC comme une approche écartée, alors que yann veut l'utiliser pour le web. | V |

### 2.2 Les skills (16)

| Skill | Desc. (car.) | Appels mesurés | Classe | Preuve / raison | V/S |
|---|---|---|---|---|---|
| session-checkpoint | 260 | 2 (transcripts), 1 (métriques) | **a / d** | Seul skill utilisé. À compléter par un hook Stop ou PreCompact qui le rappelle. | V |
| checkpoint-pause | 399 | 0 | c | Usage manuel rare ; doublon de session-checkpoint | V |
| checkpoint-resume | 277 | 0 | b | L'injection de SESSION.md fait déjà la reprise | V |
| dev-cycle | 287 | 0 | **b + x** | Explorer, planifier, coder : les modèles récents le font seuls. Ligne 35-36 : « pose la question ». Fait aussi appeler `find-skills` par Story. | V |
| onboard-project | 377 | 0 | c | Usage unique ; PROJECT.md existe dans 3 projets | V |
| security-audit | 486 | 0 | **c** | Recoupe `/security-review` (natif). Ligne 46 : « demande avant de continuer ». | V |
| config-audit | 403 | 0 | c | Sur demande uniquement | V |
| sandbox-pretest | 524 | 0 | c | | V |
| deploy-checklist | 214 | 0 | a? (occasionnel) | Savoir-faire réel (2FA, branche protégée) ; usage NV sur le PC | S |
| skill-builder | 305 | 0 | b | Le skill natif `skill-creator` existe | V |
| update-harnais | 390 | 0 | a (occasionnel) | Nécessaire au mécanisme | V |
| find-skills | 303 | 0 | c / x | Installer depuis `npx skills` = installer **sans les hooks des plugins** (cf. §3) | S |
| harnais-report | 320 | 0 | c | Télémétrie polluée par les tests | V |
| harnais-stats | 560 | 0 | **c** | « Mode automatique » jamais déclenché : MONITORING.csv vide ×3. 14 mentions de demande ou confirmation dans le skill. | V |
| perplexity-research | 550 | 0 | c | Le MCP Perplexity n'est configuré dans aucun projet (aucun `.mcp.json`) | S |
| graphify | 458 | 0 (2 rappels affichés) | c | Un rappel par hook ne déclenche pas l'usage | V |

### 2.3 Agents, hooks, réglages et commandes

| Élément | Classe | Preuve | V/S |
|---|---|---|---|
| agent code-reviewer | b | 0 appel ; `/code-review` natif | V |
| agent debugger | b | 0 appel | V |
| hook guard-dangerous-commands (PreToolUse) | **a** | 7 vrais blocks. 2 faux positifs documentés (Vlad_Arko/LESSONS.md:153 et :222 : du texte contenant « .env » est bloqué). Tests qui polluent les métriques. | V |
| hook session-start-inject | **a** | 13 injections. À plafonner en taille (27,5 Ko sur Vlad). | V |
| hook update-check | a | 8 up-to-date, coût faible | V |
| hook graphify-check | c | 2 rappels, 0 suite | V |
| hook context-watchdog | a? | 0 rappel déclenché ; filet de sécurité | V |
| hook hard-stop-guard (PostToolUse, après chaque outil) | a? / x | 0 arrêt dur. 404 lignes exécutées après **chaque** outil. Ne compense la désactivation de l'auto-compact que si tout marche. | V |
| hook credit-watchdog et resume-after-reset | NV | Aucun événement sur le serveur ; ouvre un terminal sous Windows | NV |
| hook notify-desktop | a (PC) / b (serveur) | 75 skip sur le serveur | V |
| hook precompact-safety-net | a? | Aucun événement journalisé | V |
| statusline.js | a | 617 snapshots ; capteur des watchdogs | V |
| `permissions.deny` (39) | **a** | Déterministe, sans coût en contexte | V |
| `disableBypassPermissionsMode` | a | | V |
| `autoCompactEnabled:false` | **x** | Les modèles récents et l'auto-compact natif suffisent (serveur) | S |
| `.claude/commands/` | — | Absent : aucune commande | V |

**Bilan** : sur environ 50 éléments, **10 sont vraiment utiles et utilisés** (R1, R3, R5d, une partie de R6, guard, session-start-inject, update-check, statusline, deny, session-checkpoint). **Le reste est redondant ou ignoré.** **6 éléments poussent activement à la prudence ou aux questions** (détail en §3.3).

Correction du manager : MONITORING.csv est vide (en-tête seul) dans les **4** projets serveur, pas 3 (V, recompté). Les transcripts contiennent 3 occurrences brutes de `session-checkpoint`, pour 2 appels distincts.

## 3. Pourquoi les skills tiers ne se déclenchent pas de façon fiable

### 3.1 Identité des skills tiers

Le PC n'est pas accessible : la source réelle installée est NV.

| Nom | Dépôt le plus probable | Étoiles | Forme | Activation |
|---|---|---|---|---|
| Caveman | JuliusBrussee/caveman (v4.1.0) | 119 k | **plugin** : 22 skills (4 032 car. de descriptions) et hooks `SessionStart`, `SubagentStart`, `UserPromptSubmit`, `SessionEnd` | Le hook `caveman-activate.js` injecte les règles en `additionalContext` à chaque session. Le mode tient **grâce au hook, pas à la description**. |
| Ponytail | DietrichGebert/ponytail (v5.3.3) | 190 k | **plugin** : 6 skills (1 596 car.) et hooks `SessionStart`, `SubagentStart`, `UserPromptSubmit` | Même schéma (`ponytail-activate.js`). |
| Graphify | Graphify-Labs/graphify (PyPI `graphifyy`) | 147 k | CLI plus 8 fichiers d'agents, pas de SKILL.md | Le skill du harnais l'enveloppe. Homonymes : kbastani/graphify, Graphitti/graphify. |
| ECC | affaan-m/ECC (anciennement everything-claude-code, v2.2.3) | 302 k | **plugin** : **314 skills, environ 97 000 car. de descriptions**, 71 agents, 98 commandes, hooks, règles | Hooks optionnels (`hooks_enabled`). Le CLAUDE.md du harnais le cite comme approche écartée (237-241). |
| herdr, agent-reach | herdrdev/herdr ; Panniantong/Agent-Reach | 50 k ; 111 k | runtime et outil | Mentionnés uniquement dans la session PC ; aucune trace dans les dépôts. NV. |

Aucun de ces noms n'apparaît dans `enabledPlugins` ou `extraKnownMarketplaces` d'un projet. Sur le serveur, seule la marketplace officielle est connue. Ils sont donc installés au niveau utilisateur sur le PC. (S)

### 3.2 Les mécanismes réels, appuyés sur la doc officielle

1. **Seule la description est visible.** « full skill content only loads when invoked » (skills.md). Claude choisit un skill d'après sa seule description.
2. **Le budget de la liste est de 1 % du contexte.** Sur 200 k tokens, cela fait environ 2 000 tokens, soit environ 8 000 caractères. En cas de dépassement, « Claude Code drops descriptions starting with the skills you invoke least » (skills.md). Le harnais seul prend déjà 6 756 caractères. **ECC à lui seul en ajoute environ 97 000, soit plus de 10 fois le budget.** Les descriptions des skills peu utilisés disparaissent et il ne reste que leur nom. C'est un cercle vicieux : un skill jamais appelé perd sa description, donc il ne sera jamais appelé. (V pour la doc et les tailles ; S pour l'effet exact sur le PC)
3. **Les modes Caveman et Ponytail tiennent par les hooks.** Installés comme plugin (`/plugin install`), ils s'activent à chaque session. Copiés comme simple skill (via `find-skills`, `npx skills add`, ou en copiant le dossier dans `.claude/skills`), **leurs hooks ne viennent pas avec**. Le mode ne s'active alors que si Claude décide de charger la description, c'est-à-dire de façon aléatoire. (V pour la structure ; S pour le mode d'installation choisi sur le PC)
4. **Les descriptions se font concurrence.** `security-audit` et `/security-review`, `code-reviewer` et `/code-review`, `skill-builder` et `skill-creator`, et les skills ECC de sécurité, de revue ou de mémoire couvrent les mêmes demandes. Le modèle doit choisir et, souvent, n'en choisit aucun. (S)
5. **Les règles du harnais contredisent les skills tiers.** Voir §3.3 : la règle 4 et CLAUDE.md:95-98 subordonnent Caveman ; le harnais décrit ECC comme « volontairement absent ». Face à une consigne prioritaire contradictoire, le modèle suit CLAUDE.md, qui est chargé entier à chaque session. (V pour les textes ; S pour l'effet)
6. **Le volume de consignes est élevé.** Il y a 9 000 à 16 000 tokens de règles avant la tâche, dont environ 55 % d'historique. Cela dilue les quelques règles qui comptent. (V pour la mesure ; S pour l'effet)
7. **Ordre de priorité des emplacements.** « personal over project » (skills.md) : un skill de même nom dans `~/.claude/skills` masque celui du projet. Les skills de plugin sont préfixés (`caveman:…`), donc pas de collision. (V doc)
8. **Aucun hook ne peut forcer l'appel d'un skill.** On peut seulement injecter du texte (`additionalContext`) via `SessionStart` ou `UserPromptSubmit`. C'est ce que font Caveman et Ponytail. (V doc)

### 3.3 Règles du harnais qui poussent aux réserves et aux questions

| Emplacement | Texte (extrait) | Effet |
|---|---|---|
| CLAUDE.md:17-18 | « arrête-toi et préviens immédiatement » | Interruption |
| CLAUDE.md:34-35 | « demande toujours confirmation avant » | Question |
| CLAUDE.md:44-45 | « privilégie la pédagogie à la vitesse » | Longueur, explications |
| CLAUDE.md:48-52 | « formule-la à voix haute et pose la question… justifier explicitement… voir security-audit » | **Questions** et réserves sur les dépendances |
| CLAUDE.md:57 | « transforme toute tâche vague en critères… avant de coder » | Étape de cadrage avant d'agir |
| CLAUDE.md:88 | graphify « passe par security-audit + sandbox-pretest avant toute première installation » | Réserve sur l'outil tiers |
| CLAUDE.md:95-98 | Caveman « jamais pour une session à dominante rédaction/pédagogie… la règle n°4 prime » | **Neutralise Caveman** |
| CLAUDE.md:174-175 | « Ne nettoie jamais… sans demander » | Question |
| CLAUDE.md:214-216 | « code non fiable par défaut, vérifie la réputation… sandbox-pretest » | Réserve sur tout skill tiers |
| CLAUDE.md:239-241 | ECC « volontairement absent » | Conflit avec l'usage voulu d'ECC |
| dev-cycle/SKILL.md:35-36 | « pose la question si trancher seul change… » | Question |
| security-audit/SKILL.md:46 | « à l'utilisateur avant de continuer » | Question |
| harnais-stats/SKILL.md | 14 mentions de demande, confirmation ou proposition | Dialogue au lieu d'agir |

Les nombres d'étoiles des quatre dépôts tiers ont été recoupés par le manager via l'API GitHub (V). Leur correspondance avec ce qui est réellement installé sur le PC reste supposée.

## 4. Proposition de harnais v2

Proposition seulement. Rien n'est appliqué.

### 4.1 Principes

- **CLAUDE.md = comportement et ton, en 60 lignes maximum.** Pas d'historique, pas de description de hooks.
- **Ce qui doit se produire à chaque fois passe en hook** : déterministe, sans coût en contexte.
- **Le savoir-faire passe en skills, déclarés par projet** dans un manifeste. Les plugins tiers sont installés **comme plugins** (pour garder leurs hooks), activés au niveau du projet.
- **Ordre de priorité explicite** : règles de yann > skills pour le comportement (ton, questions, sécurité) ; skills > règles pour le savoir-faire (comment coder, déployer, chercher).
- **L'historique va dans `CHANGELOG.md`** (non chargé). Le « pourquoi » reste dans `SOURCES.md`.

### 4.2 Arborescence

```
Harnais/
├── CLAUDE.md                     # ≤ 60 lignes : comportement, ton, priorités
├── CHANGELOG.md                  # ex-historique V1.x de CLAUDE.md (non chargé)
├── SOURCES.md / EVOLUTION.md     # inchangés, hors session
├── harnais.manifest.example.json # modèle de manifeste par projet
├── .claude/
│   ├── settings.json             # deny, hooks, enabledPlugins lus depuis le manifeste
│   ├── rules/
│   │   └── harnais-maintenance.md  # paths: [".claude/**"] → chargé seulement si on touche .claude/
│   ├── hooks/
│   │   ├── guard-dangerous-commands.js   # gardé (+ test sans log de métriques)
│   │   ├── session-start-inject.js       # gardé, plafond 4 Ko + rappel « SESSION.md > 80 l. »
│   │   ├── update-check.js               # gardé
│   │   ├── checkpoint-nudge.js           # NOUVEAU : Stop/PreCompact → rappelle session-checkpoint si SESSION.md non modifié depuis N tours
│   │   ├── statusline.js                 # gardé (capteur)
│   │   └── notify-desktop.js             # optionnel (PC)
│   └── skills/
│       ├── session-checkpoint/   # gardé (inclut LESSONS.md)
│       ├── update-harnais/       # gardé, lit le manifeste
│       └── deploy-checklist/     # gardé (savoir-faire réel)
└── install/apply.js              # installe le core + applique le manifeste
```

**Retirés de la v2** (proposition) : dev-cycle, checkpoint-pause, checkpoint-resume, onboard-project, security-audit (→ `/security-review` natif), config-audit, sandbox-pretest, skill-builder (→ skill-creator natif), find-skills, harnais-report, harnais-stats et MONITORING.csv, perplexity-research, graphify (→ plugin optionnel via le manifeste), les agents code-reviewer et debugger, les hooks graphify-check, context-watchdog et hard-stop-guard, `autoCompactEnabled:false` (retour à l'auto-compact natif). Si l'arrêt crédits sur le PC reste voulu : garder credit-watchdog et resume-after-reset, en option dans le manifeste.

### 4.3 Exemple de CLAUDE.md v2 (le bloc harnais complet)

```markdown
<!-- harnais:core v2.0 start -->
## Comment travailler (règles de yann)
- Agis. Choisis l'option la plus sûre et raisonnable, fais-la, signale l'hypothèse en une ligne.
  Ne pose une question que si la réponse change le résultat ET qu'elle est irréversible.
- Ne dis jamais « c'est fait » sans l'avoir exécuté et observé (build, test, lancement).
- Change seulement ce qui est demandé ; respecte le style existant.
- Explique brièvement le pourquoi des choix non évidents (1-2 phrases), pas le quoi.
- Secrets : jamais en clair (le hook et `permissions.deny` bloquent ; si bloqué, dis-le, ne contourne pas).
- Tiens SESSION.md court (≤ 60 lignes, état courant) ; ajoute à LESSONS.md seulement les pièges non évidents.

## Priorités
1. Ces règles l'emportent pour le **comportement** (ton, questions, sécurité, vérification).
2. Les skills et plugins du projet l'emportent pour le **savoir-faire** (comment coder, déployer,
   chercher, compresser). Si un mode de plugin est actif (ex. caveman, ponytail), applique-le : il
   ne contredit pas ces règles.
3. Skills du projet : voir `harnais.manifest.json` (la liste chargée par Claude Code fait foi).
<!-- harnais:core end -->
```

### 4.4 Brancher des skills tiers par projet

`harnais.manifest.json`, versionné à la racine du projet :

```json
{
  "harnais": "2.0",
  "plugins": [
    { "name": "caveman",  "marketplace": "caveman",  "source": "github:JuliusBrussee/caveman",  "ref": "v4.1.0" },
    { "name": "ponytail", "marketplace": "ponytail", "source": "github:DietrichGebert/ponytail", "ref": "v5.3.3" }
  ],
  "skills": [
    { "name": "ecc-frontend-patterns", "from": "github:affaan-m/ECC", "path": "skills/frontend-patterns", "ref": "v2.2.3",
      "description": "Use when building or styling a web page/component (React, Next.js, CSS) in this project." }
  ],
  "optional_hooks": ["credit-watchdog"]
}
```

Ce que fait `apply.js` / `update-harnais` :

1. **Les plugins** sont écrits dans `.claude/settings.json` sous `extraKnownMarketplaces` et `enabledPlugins` (`"caveman@caveman": true`). Ce sont deux clés documentées, valables au niveau du projet. Leur format JSON exact n'a pas été trouvé dans la doc et reste à vérifier avant mise en œuvre. Ainsi, **les hooks d'activation sont conservés** et l'activation se fait **par projet**. Il faut faire confiance au dossier une fois (settings.md).
2. **Les skills isolés** (ECC à la carte, jamais le plugin complet de 314 skills) sont copiés dans `.claude/skills/<nom>/` à la version `ref` indiquée. La `description` est **réécrite pour décrire le déclencheur** (« Use when… » + contexte du projet), dans la limite de 1 536 caractères (skills.md). On peut ajouter `paths:` pour ne les activer que sur les fichiers concernés.
3. **Contrôle du budget** : `apply.js` additionne les descriptions et avertit au-delà de 6 000 caractères (une marge sous le budget de 1 %). On peut aussi utiliser `skillOverrides: "name-only"` pour les skills manuels, ou `disable-model-invocation: true` pour checkpoint et update.
4. **Contrôle d'origine** : on épingle `ref` sur un tag. `update-harnais` affiche le diff de version des tiers, sans l'appliquer d'office. Cela remplace la règle textuelle « vérifie la réputation », qui coûtait des réserves à chaque session.
5. **Mise à jour** : `/update-harnais` récupère le core v2 (en remplaçant le bloc `harnais:core`), puis relit le manifeste et ajoute ou retire les plugins et skills listés. Il ne touche jamais aux skills du projet hors manifeste, ni à SESSION.md ou LESSONS.md.

### 4.5 Transformation en hooks

| Besoin | Aujourd'hui | v2 |
|---|---|---|
| Checkpoint SESSION.md | règle R6 + skill (2 appels) | hook `Stop` / `PreCompact` qui injecte « SESSION.md non mis à jour depuis X tours → session-checkpoint » |
| SESSION.md court | règle ignorée (320 l.) | `session-start-inject` tronque à 4 Ko et signale le dépassement |
| Secrets, commandes destructrices | règle + hook | hook seul + 1 ligne dans CLAUDE.md |
| Modes Caveman / Ponytail | règle restrictive | hooks des plugins, activés par projet |
| Télémétrie | polluée par les tests | variable d'env `HARNAIS_NO_METRICS=1` dans les tests |

**Réserves du manager sur cette proposition**
- Le format exact de `enabledPlugins` et `extraKnownMarketplaces` au niveau projet n'a pas été vérifié dans la doc : à valider en phase 2 sur un projet jetable. (S)
- Retirer `hard-stop-guard`, `context-watchdog` et réactiver l'auto-compact repose sur un jugement (« les modèles récents suffisent »), pas sur une mesure faite sur le PC. À tester sur un seul projet avant de généraliser. (S)
- `credit-watchdog` et la reprise après remise à zéro du quota n'ont produit aucun événement sur le serveur. Leur utilité sur le PC est inconnue : gardés en option. (NV)
- La v1.16 reste installable telle quelle : la v2 serait une nouvelle branche ou un nouveau tag, sans écraser l'existant.

## 5. Serveur : état, évaluation, architecture cible

### 5.1 Inventaire (résumé public)

- NUC Debian, 4 cœurs, 15,5 Go de RAM dont environ 9,6 Go disponibles, disque utilisé à 15 %. (V)
- 13 conteneurs actifs : le Hub (où tournent manager et workers), le pont claude.ai, deux Chromium (un piloté par Claude via CDP, un personnel), la synchro de calendrier, et 7 applications gérées par CasaOS. (V)
- CasaOS est présent et gère 7 conteneurs ; sa version et ses services ne sont pas lisibles depuis le conteneur. (V / NV)
- Accès du manager : utilisateur non privilégié dans le conteneur du Hub, sans sudo ni clé SSH, mais avec le socket Docker en écriture et le dossier personnel monté en écriture. C'est un accès root de fait à l'hôte. (V)
- Le serveur n'est pas techniquement « Tailscale uniquement » : des services écoutent sur toutes les interfaces. Le détail, et les autres constats de sécurité, sont dans la version complète. (V pour l'écoute ; S pour l'exposition Internet actuelle)
- Chromium piloté : profil persistant avec des comptes connectés, 4 extensions dont l'autologin ENT. Toute session du Hub peut le piloter. (V)
- Organisation : `lancer-worker.sh` crée une session tmux par worker (mode auto, modèle selon le profil, consignes Caveman) ; `watch-workers.sh` lit les écrans tmux toutes les 60 s (et non 90) et signale BLOQUE ou FIGE. (V)
- Aucune sauvegarde trouvée pour les dépôts locaux, la mémoire du manager et le Hub. Trois dépôts n'ont pas de remote. (V dans le conteneur ; NV pour les tâches planifiées de l'hôte)

### 5.2 L'organisation permet-elle « je décris, tu reviens quand c'est fini » ?

En partie. Elle l'a permis une fois de bout en bout (interface Livebox, 10-11 novembre) et aujourd'hui pour cet audit. Elle reste fragile :

| # | Obstacle | Preuve | Effet |
|---|---|---|---|
| 1 | Tout dans un seul conteneur : le déploiement du Hub tue toutes les sessions | mémoire 2026-11-04, `compose up` | Chaque évolution du Hub interrompt la mission en cours, manager compris |
| 2 | Pas de reprise auto après crash ou redémarrage | `workers: {}`, tmux en mémoire | Une panne du conteneur ou de l'hôte efface l'état des workers. Le contexte de session reste dans `~/.claude`, mais personne ne relance |
| 3 | Monitor qui expire avec la session manager | watch-workers.sh | Sans manager actif, plus de surveillance |
| 4 | Prompts de permission et de confiance | manager-en-cours, manager-autorisations | Un worker bloqué attend un humain ou un manager ; le prompt de confiance « No, exit » est piégeux |
| 5 | Classifieur auto-mode | manager-en-cours (« anything my classifier blocked ») | Des actions légitimes sont bloquées et il faut yann (ex. `gh repo create`) |
| 6 | Quota Pro partagé | mémoire conso | Une mission lourde épuise le quota du manager aussi |
| 7 | Workers sans isolation | mounts du Hub | Un worker peut lire et écrire tous les dépôts, secrets et comptes. Une erreur de l'un abîme tout |
| 8 | Manager = session claude interactive avec contexte limité | règle « fresh daily / >100k » | Les longues missions passent par un handoff manuel |
| 9 | Pas de sauvegarde | version complète, §1.9 | Une perte du disque ou une mauvaise manip fait perdre les sessions, la mémoire et les dépôts locaux |
| 10 | Exposition réseau large | version complète, §1.3 | Plus la surface est grande, plus une injection de prompt peut avoir de conséquences |

### 5.3 Ta piste : manager hors conteneur, workers en conteneurs

**Verdict : bonne direction, mais pas en premier.** Séparer le manager de ce qu'il déploie et isoler les workers règle les obstacles 1, 2, 3 et 7. Mettre le manager directement sur l'hôte a deux coûts :
- **Sécurité** : le manager lit du contenu non fiable (pages web, dépôts tiers, messages). Une instruction cachée qu'il suivrait s'exécuterait avec ses droits. Sur l'hôte, ces droits doivent donc être étroits, sinon le risque est plus grand qu'aujourd'hui.
- **Dépendance à toi** : il faut un accès administrateur à l'hôte, que le manager n'a pas, pour créer l'utilisateur et les services.

**Ce que la piste exige**
1. Un utilisateur dédié non root pour le manager, hors du groupe docker, sans sudo général ; au besoin, quelques commandes autorisées une par une.
2. Un accès Docker filtré pour le manager : il ne peut créer et arrêter que des conteneurs `worker-*`, sans mode privilégié ni montage hors liste, et ne peut pas toucher aux conteneurs existants. Correction du manager : un proxy générique du type docker-socket-proxy filtre par famille d'appels, pas par nom de conteneur ni par options. Il faudra un filtre qui inspecte les requêtes de création, à choisir et tester en phase 2. (S)
3. Un service systemd qui garde le manager en vie et le relance avec sa session après un redémarrage.
4. Une image worker (Claude Code et git, sans client Docker), un conteneur par worker, avec seulement son dépôt monté, utilisateur non root, capacités retirées, limite de 2 Go et 1 cœur. Avec 9,6 Go disponibles : 3 workers en parallèle au maximum. (S)
5. Des secrets par projet, montés en fichiers en lecture seule dans le seul conteneur concerné.
6. Un réseau dédié aux workers, sans accès au socket ni aux autres réseaux.
7. Un canal manager↔workers par fichiers (boîte d'entrée et de sortie par worker), car la messagerie entre sessions ne traverse pas forcément les conteneurs. (S)
8. Un fichier d'état des workers pour les relancer après une panne, et une surveillance qui tourne comme un service, pas dans la session du manager.
9. Une journalisation des commandes Docker passées par le filtre.
10. Une sauvegarde des dépôts locaux, de la mémoire et des profils.

Le quota du plan reste partagé entre manager et workers dans tous les cas. Aucune architecture ne lève cette limite.

**Comparaison**

| | A. Manager sur l'hôte (piste yann) | B. Manager dans un conteneur dédié, séparé du Hub, workers en conteneurs frères | C. Statu quo + durcissement |
|---|---|---|---|
| Survie au redéploiement du Hub | Oui | Oui | Non |
| Surface si injection | Hôte (user mgr), limité si sudoers étroit | Conteneur + proxy docker filtré : plus étroite | Socket docker complet |
| Persistance au reboot | systemd | `restart: unless-stopped` + tmux dans le conteneur | Idem aujourd'hui |
| Effort | Fort : user, systemd, sudoers | Moyen : une image, un compose, un proxy | Faible |
| Réversibilité | Bonne | Très bonne (tout est ajout) | — |
| Accès à l'hôte nécessaire | Oui, un accès admin ponctuel pour créer le user et les unités systemd (yann, physiquement ou via SSH) | Non | Non |

**Recommandation : B d'abord, A ensuite si tu le veux.** B apporte la séparation et l'isolation sans toucher à l'hôte ni à CasaOS, et tout y est un ajout. A devient alors une dernière étape facultative, dont B reste le repli.

### 5.4 Architecture cible (B)

```
Hôte (CasaOS + Docker, inchangés)
├─ claude-hub        existant, inchangé : interface web
├─ claude-manager    NOUVEAU : tmux + manager, hors du compose du Hub, sans socket Docker direct
├─ filtre-docker     NOUVEAU : seul accès Docker du manager, limité aux conteneurs worker-*
├─ worker-<nom>      NOUVEAU : 1 conteneur par tâche, son dépôt seulement, non root, RAM/CPU limités
└─ tout le reste     inchangé (apps CasaOS, Chromium, pont, synchro)
```

Point à tester : l'affichage des sessions du nouveau manager dans le Hub, par partage du socket tmux entre les deux conteneurs. (S)

### 5.5 Plan de migration

Règles du plan : l'existant reste en service du début à la fin ; aucune suppression de l'existant ; le retour arrière d'une étape ne retire que ce que cette étape a ajouté ; le vrai conteneur du Hub n'est jamais recréé.

| # | Étape | Retour arrière | Validation |
|---|---|---|---|
| 0 | **Sauvegarde préalable** : copier `~/claude-code`, `~/.claude`, `~/claude-hub`, `/DATA/AppData/claude-browser` vers un dossier daté (`~/backups/2026-11-13/`) | Supprimer ce dossier de sauvegarde (créé par cette étape) | `diff -rq` ou comptage fichiers OK ; restauration testée sur un fichier |
| 1 | **Inventaire de l'exposition** : demander à un worker de lire la table de redirections Livebox via l'API (lecture seule). Rien de changé ici | Rien à annuler | Liste des redirections à jour dans le livrable |
| 2 | **Réseau de test** : `docker network create workers-net` et `mgr-net` | `docker network rm workers-net mgr-net` | `docker network ls` les montre ; aucun conteneur existant rattaché |
| 3 | **Proxy docker filtré** : conteneur `docker-proxy` sur `mgr-net`, socket monté en lecture seule côté proxy, règles : conteneurs `worker-*`, pas de privileged, pas de mounts hors liste | `docker stop docker-proxy && docker rm docker-proxy` | Depuis un conteneur test sur `mgr-net` : `docker ps` OK ; création `privileged` refusée (403) ; touche `claude-hub` refusée |
| 4 | **Image worker** : `docker build -t worker-base:0.1` (node + claude + git, user non-root) | `docker rmi worker-base:0.1` | `docker run --rm worker-base:0.1 claude --version` OK ; ne tourne pas en root |
| 5 | **Un worker de test en conteneur** : `worker-test`, dépôt jetable monté, `--memory 2g --cpus 1 --cap-drop ALL --read-only` | `docker rm -f worker-test` | Le worker exécute une tâche simple, écrit dans son dépôt, ne voit ni `~/.ssh`, ni autres dépôts, ni socket ; consommation RAM relevée par `docker stats` |
| 6 | **Script `lancer-worker-conteneur.sh`** à côté de l'existant (l'ancien reste le défaut) : mêmes arguments, mode conteneur | Supprimer le nouveau script | Un vrai petit worker passe par ce chemin et rend un rapport via le canal prévu |
| 7 | **Canal manager↔workers** (inbox/outbox fichiers par worker, en plus de SendMessage) | Retirer les dossiers créés | Un message aller-retour manager→worker→manager réussit sans SendMessage |
| 8 | **`claude-manager` en conteneur dédié**, hors compose du Hub, accès docker via le proxy uniquement. Identité d'auth Claude à fournir par yann (étape humaine) | `docker rm -f claude-manager` | Session manager vit après un `compose up` du Hub **de test** (instance `hubtest` sur un autre port, jamais le vrai) ; sessions survivent |
| 9 | **Superviseur de reprise** : `restart: unless-stopped` + script d'entrée qui relance tmux/claude `--resume` + fichier d'état des workers | Retirer le script d'entrée (conteneur recréé sans) | `docker restart claude-manager` : le manager revient avec sa session ; workers listés relancés |
| 10 | **Surveillance persistante** : watch-workers.sh devient un processus du conteneur manager qui écrit vers `inbox.jsonl` (plus de Monitor à expiration) | Arrêter ce processus | Un worker bloqué volontairement est signalé en moins de 2 min sans session manager active |
| 11 | **Bascule douce** : le manager utilise le mode conteneur pour les nouveaux workers. L'ancien mode reste utilisable en secours | Repasser au script d'origine (inchangé) | Une mission complète terminée sans intervention de yann |
| 12 | **Option A plus tard** (hôte, user `mgr`, systemd) : seulement si yann souhaite le gain ; il crée le user et les unités. L'étape 8 reste le plan de repli | Désactiver les unités systemd | Même test que 8 sans conteneur manager |

Correction du manager : le worker suggérait de fermer des redirections réseau. Tu as exclu toute suppression : l'étape 1 est donc un simple constat, et le rapport ne propose aucune fermeture.

Les étapes 0 à 7 peuvent être menées par le manager seul. L'étape 8 demande une action de ta part (authentification Claude du nouveau conteneur). L'étape 12 demande un accès administrateur à l'hôte.

## 6. Hypothèses et points non vérifiés

**Hypothèses prudentes retenues sans te consulter**
- PC hors ligne : je n'ai rien forcé et j'ai travaillé depuis GitHub et le serveur.
- Dépôt Harnais public : j'ai retiré de ce fichier les détails de sécurité du serveur.
- Cloner des dépôts et écrire des notes dans un dossier neuf du serveur ne compte pas comme une modification de l'existant.
- Lecture de l'état réseau par des commandes de lecture dans un conteneur existant : considérée comme lecture seule.
- Aucune lecture des valeurs de secrets, des profils Chromium ni de l'API de la box.

**Supposé**
- Les modèles récents appliquent seuls les règles classées (b).
- Les règles du §3.3 causent les hésitations que tu observes : le lien est logique, pas mesuré.
- Les dépôts tiers identifiés sont bien ceux installés sur ton PC, et ils y sont installés au niveau utilisateur ou comme simples skills.
- Redirections actuelles de la box, comptes connectés dans Chromium, budget mémoire par worker, partage de tmux entre conteneurs, tous les jugements d'architecture.

**Non vérifiable depuis le serveur**
- Sur le PC : transcripts, métriques, skills et plugins installés, `.claude/` de Vlad_Arko (ignoré par git), usage réel de `deploy-checklist`, `update-harnais`, `credit-watchdog`.
- Sur l'hôte : version et services de CasaOS, configuration SSH, état et règles Tailscale, pare-feu, utilisateurs et sudoers, tâches planifiées, santé des disques.

**Phase 2** : non commencée. J'attends ta validation.
