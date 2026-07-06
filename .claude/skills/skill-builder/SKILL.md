---
name: skill-builder
description: Meta-skill for creating new SKILL.md files consistent with this harness's conventions, and for deriving a lighter variant of the whole harness for a different context (e.g. a school-only setup). Triggers on "crée une skill", "skill-builder", "fais un socle plus léger pour X", "dérive un harnais pour...".
---

# skill-builder

Le levier d'extension de ce socle. Deux usages distincts : créer une nouvelle skill dans
ce dépôt, ou dériver un harnais plus léger pour un autre contexte.

## Usage 1 — créer une nouvelle skill

1. **Recherche préalable — ne réinvente pas ce qui existe déjà.** Avant d'écrire quoi que
   ce soit, vérifie dans l'ordre : (a) les skills globales déjà disponibles (`/verify`,
   `/code-review`, `/security-review`, etc.), (b) les skills déjà présentes dans ce
   socle (`.claude/skills/`), (c) l'annuaire communautaire **skills.sh**
   (https://www.skills.sh/) — notamment la skill `find-skills` de vercel-labs, pensée
   pour chercher une skill existante avant d'en construire une. Si quelque chose couvre
   déjà le besoin : ne crée rien, route dessus ou installe l'existant.

2. **Arbitrage : skill, sous-agent, ou règle CLAUDE.md ?**
   - Une **règle CLAUDE.md** si c'est une contrainte qui doit s'appliquer *toujours*, sans
     déclenchement explicite (ex : "jamais de secret en clair").
   - Une **skill** si c'est un workflow qu'on invoque à la demande, avec un début et une
     fin clairs, et qui reste dans le contexte principal de la conversation (ex :
     `dev-cycle`).
   - Un **sous-agent** si la tâche produirait beaucoup de bruit d'exploration qu'on ne
     veut pas polluer le contexte principal avec, et qu'on n'a besoin que de la
     conclusion (ex : `debugger`, `code-reviewer`).

3. **Framework en 6 étapes pour rédiger la skill** (avant d'écrire les instructions) :
   1. **Name it** — nom court en kebab-case, la skill fait une seule chose bien.
   2. **Trigger** — la `description` du frontmatter, celle que Claude lit pour décider de
      se déclencher : sois spécifique, liste des mots-clés concrets, pas une paraphrase
      vague.
   3. **Outcome** — définis à quoi ressemble "terminé" avant d'écrire la moindre étape.
      Une skill sans critère de fin encourage le sur-travail ou l'arrêt prématuré.
   4. **Dependencies** — liste à l'avance les fichiers de référence, outils ou skills
      externes dont elle a besoin.
   5. **Flow** — les étapes concrètes, dans l'ordre.
   6. **Edge cases** — que fait la skill si l'entrée est vague, incomplète, ou si une
      des dépendances manque ? Une skill robuste ne suppose pas le cas nominal partout.

4. **Convention de frontmatter** (à respecter pour toute nouvelle skill de ce socle) :
   ```yaml
   ---
   name: nom-en-kebab-case
   description: Phrase(s) décrivant QUAND se déclencher (mots-clés, contexte), pas
     juste ce que fait la skill. Le déclenchement dépend de cette description.
   ---
   ```
   Le corps du fichier : une section "quand se déclencher" / "ne se déclenche pas pour",
   puis les étapes concrètes, puis "ce que cette skill ne fait pas" (pour éviter le
   sur-recours et la duplication avec d'autres skills).

5. **Progressive disclosure — pour les skills qui grossissent.** Une skill, c'est 3
   couches : la `description` (toujours chargée, sert à décider si elle se déclenche),
   le corps du `SKILL.md` (chargé seulement si elle se déclenche, reste court), et des
   fichiers `references/` optionnels (chargés seulement si le corps y renvoie). Si une
   skill de ce socle dépasse ~200 lignes ou accumule des exemples détaillés, extrais-les
   dans `references/` plutôt que de tout garder dans le corps — des exemples concrets
   valent souvent mieux qu'un paragraphe d'instructions abstraites.

6. **Garde-fous** : une nouvelle skill ne doit pas dupliquer une skill globale existante
   ni une skill déjà présente dans ce socle — vérifie d'abord dans `.claude/skills/` et
   dans la liste des skills globales disponibles.

7. Écris le fichier dans `.claude/skills/<nom>/SKILL.md`, puis ajoute une ligne dans la
   table de routage du `CLAUDE.md` racine.

## Usage 2 — dériver un harnais plus léger pour un autre contexte

Exemple : un socle "études uniquement" (pas de déploiement, pas de sous-agents lourds).

1. Copie `CLAUDE.md` et retire les sections non pertinentes pour le nouveau contexte
   (ex : retirer la section déploiement si le contexte n'en a pas besoin) — mais garde
   toujours les règles non négociables de sécurité (pas de secret en clair, pas de
   commande destructrice sans confirmation) : elles s'appliquent à tout contexte.
2. Copie uniquement les skills pertinentes (ex : `dev-cycle` et `security-audit` pour un
   socle études, sans `deploy-checklist`).
3. Copie le hook `.claude/hooks/guard-dangerous-commands.js`, son enregistrement dans
   `.claude/settings.json`, et le `permissions.deny` sur les fichiers secrets tels quels
   — ce sont des garde-fous génériques, pas spécifiques à un contexte.
4. Copie aussi `SESSION.md` (remis à zéro pour le nouveau contexte), la skill
   `session-checkpoint`, et les hooks `session-start-inject.js`/
   `precompact-safety-net.js` avec leur enregistrement dans `settings.json` — la
   continuité de session est générique, utile dans tout socle dérivé.
5. N'ajoute rien de plus par défaut : un harnais dérivé commence aussi léger que possible,
   quitte à le faire grossir plus tard via cette même skill.

## Où placer ce socle : héritage ou copie

Claude Code lit les `CLAUDE.md` de proche en proche en remontant l'arborescence depuis le
dossier de travail, et les combine (le plus proche l'emporte en cas de conflit). Ça donne
deux façons de déployer ce socle sur un nouveau projet — à choisir selon le cas, pas une
règle unique :

- **Héritage (pas de copie).** Si plusieurs projets vivent sous un même dossier parent
  (ex: tous tes projets perso rangés sous un même dossier), place ce socle (`CLAUDE.md` +
  `.claude/`) à la racine de ce parent : chaque sous-dossier en hérite automatiquement,
  sans rien copier. Un `CLAUDE.md` local dans un sous-projet peut ajouter des règles
  spécifiques, qui l'emportent sur le socle en cas de conflit.
- **Copie.** Pour un projet isolé de ce dossier parent (un TP cloné ailleurs par un
  autograder/Git Classroom, un projet sur une autre machine ou un autre disque),
  copie le dossier socle tel quel dans le nouveau projet, puis lance `onboard-project`.

Les deux mécanismes coexistent sans problème : rien n'empêche d'avoir un socle hérité
pour les projets perso groupés, et des copies ponctuelles pour les projets isolés.

## Ce que cette skill ne fait pas

Ne construit pas de système de mémoire/apprentissage continu (façon ECC) — ce socle a
choisi de ne pas en avoir en V1. Si ce besoin apparaît un jour, c'est une décision à
prendre explicitement avec l'utilisateur, pas une conséquence automatique de
`skill-builder`.
