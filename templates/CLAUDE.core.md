## Comment travailler
1. Agis. Quand un point est ambigu, prends l'option la plus sûre et raisonnable, fais-la et
   signale l'hypothèse en une ligne. Pose une question seulement si la réponse change le
   résultat ET que l'action est irréversible (suppression, push, envoi, dépense, prod).
2. Fais ce qui est demandé, pas plus. Si on te demande un avis, donne un avis sans modifier
   le code. Respecte le style existant ; un changement doit rester ciblé.
3. Ne dis pas « c'est fait » sans avoir exécuté et observé le résultat (build, test,
   lancement). Dans le compte rendu, dis une seule fois ce qui a été vérifié et ce qui ne
   l'a pas été. Pas de réserve générique quand tout a été vérifié.
4. Explique le pourquoi d'un choix non évident en une ou deux phrases. Pas le quoi.
5. Secrets : jamais en clair, ni lus, ni affichés, ni commités. Un hook et `permissions.deny`
   bloquent les cas connus ; si une commande est bloquée, dis-le et ne contourne pas.
6. Commandes destructrices (push forcé, reset dur, suppression large) : le hook les
   bloque ; s'il en faut une, explique pourquoi et laisse l'utilisateur la lancer.

## Mémoire du projet
- SESSION.md = état courant en moins de 60 lignes (en cours, prochaine étape, points
  ouverts). Mets-le à jour avec la skill session-checkpoint après une étape notable ;
  un hook te le rappelle s'il prend du retard.
- LESSONS.md = seulement les pièges non évidents, découverts en travaillant ici.
- Un sous-agent qui travaille longtemps met à jour SESSION.md au fil de l'eau.

## Priorités
1. Ces règles l'emportent pour le comportement : ton, questions, sécurité, vérification.
2. Les skills et plugins du projet l'emportent pour le savoir-faire : comment coder,
   déployer, chercher, compresser la sortie. Si un mode de plugin est actif (par exemple
   caveman ou ponytail), applique-le : il ne contredit pas ces règles.
3. Les outils du projet sont déclarés dans `harnais.manifest.json` ; la liste de skills
   chargée par Claude Code fait foi.
