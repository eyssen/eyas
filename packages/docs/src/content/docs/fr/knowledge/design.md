---
title: "Canevas de design"
description: "Dessinez UI, landing, print ou deck — puis joignez-les à une conversation ou un projet."
---

**À quoi ça sert.** Un design est un ensemble de plans de travail sur un canevas panoramique et zoomable. Vous le créez, l’importez ou le faites ébaucher par un agent ; vous l’éditez à la main, sur le canevas ou par IA ; vous le versionnez et le joignez pour que la conversation le voie. Le format de fichier est celui de Claude Design ; le runtime est celui d’EYAS.

## Quand l’utiliser

- Vous concevez une UI, un landing, une pièce print ou un deck et le voulez dans EYAS, pas seulement dans un outil externe.
- Un agent doit lire des plans nommés (tokens, components, page) au lieu de deviner un look.
- Importer un canevas Claude Design publié, ou exporter PNG/PDF.
- Une conversation ou un projet doit emporter le canevas à chaque tour.

## Déroulement typique

1. Ouvrez **Design** dans la barre latérale (**Contenu**) — route `/design`.
2. Tapez un nom et **New** (ou **Import** d’un HTML de canevas publié).
3. Éditez sur le canevas, dans **Source** ou via le panneau **AI**. **Save** (une version par enregistrement).
4. Dans une conversation, l’icône **Designs** pour le joindre. L’agent doit pouvoir récupérer des parties ; le canevas apparaît avec une coche.

Un design est un ensemble de plans de travail disposés sur un canevas navigable et
zoomable. Chaque plan est un fichier `.dc.html` ; `canvas.json` note où chacun se
trouve, à quelle page il appartient et sur quelle vue une ouverture fraîche
arrive. Les images vivent dans le canevas sous leur propre nom de fichier.

Le format de fichier est celui de Claude Design : un canevas créé là-bas s'importe
et s'affiche ici, un canevas exporté d'ici s'y régénère. EYAS l'affiche avec son
propre moteur — les deux outils partagent un format, pas du code.

## Créer un design

Sur `/design`, saisissez un nom et appuyez sur **Nouveau**. Vous obtenez un plan
de départ à remplacer.

**Importer** accepte le HTML complet d'une page de canevas publiée. Une page dont
le contenu réside dans le magasin de la plateforme hôte plutôt que dans la page
elle-même est refusée : sa copie intégrée n'est qu'un instantané périmé de la
première ouverture, et l'importer vous donnerait silencieusement une vieille
version.

Un agent peut aussi en créer un. Tout ce qu'un agent produit passe par les mêmes
contrôles que vos propres modifications.

## Se déplacer sur le canevas

Faites glisser le fond. La molette fait défiler, **Maj**+molette latéralement, et
**Ctrl/⌘**+molette zoome — le zoom reste ancré sur le pointeur : ce qui est sous
le curseur y reste. **Fit** cadre tout ce qui est sur la page.

Le déplacement fonctionne dans l'espace *autour* des plans, pas dessus. Un plan de
travail est un cadre isolé qui garde ses propres événements souris — c'est
précisément ce qui permet à un prototype interactif de fonctionner.

Quand un canevas a plusieurs pages, les boutons apparaissent dans l'en-tête.

## Ouvrir un seul plan de travail

À côté de chaque nom se trouve un bouton d'ouverture — ou double-cliquez le nom.
Le plan occupe la vue à lui seul, et **Échap** vous ramène où vous étiez.

Sa façon de s'ouvrir lui appartient : par défaut il est réduit en entier pour
tenir ; un plan réglé sur remplir est élargi à la largeur de la vue à son échelle
naturelle et défile, ce que veut un design à largeur fluide.

## Trois façons de modifier

**Sur le canevas.** Ouvrez **Modifier** et cliquez un élément. Le panneau de
propriétés change sa typographie, sa couleur, sa boîte, sa bordure et sa
disposition ; une grille dont les colonnes sont toutes égales se modifie comme un
simple nombre de colonnes. Le texte se modifie sur place, sauf s'il vient de la
logique du plan — le panneau le dit plutôt que d'écraser la liaison.

Cmd/Ctrl+Z annule, Maj rétablit, et rien n'est enregistré avant que vous
n'enregistriez : une version par enregistrement, pas par frappe.

Un plan marqué interactif garde ses propres commandes et se modifie dans le
panneau de code — la sélection avalerait les clics dont son prototype a besoin.

**Dans le code.** Le panneau de code liste tous les fichiers du canevas et les
modifie directement.

**Par l'IA.** Ouvrez le panneau IA, décrivez le changement, appliquez-le.

Quel que soit le résultat et d'où qu'il vienne, il est vérifié contre les règles du
canevas avant d'être enregistré : un plan sans élément racine, une entrée de mise
en page pointant vers un fichier inexistant, une référence d'image sans rien
derrière, ou un attribut de style avec une condition hors des accolades — tout
cela est refusé, et la version précédente reste exactement telle quelle. Si la
première tentative du modèle échoue, EYAS lui montre les problèmes précis et le
relance une fois.

Cela fonctionne pareil avec chaque fournisseur configuré. EYAS ne confie pas la
tâche à l'outillage d'un éditeur au motif que celui-ci est configuré ; le prompt,
les contrôles et le résultat enregistré sont identiques dans les deux cas.

Une modification par IA sur un fournisseur CLI et un grand canevas peut prendre
plusieurs minutes. Le panneau compte le temps écoulé pendant l'opération, et
quitter la page ne l'annule pas. Chaque tentative est enregistrée : le panneau
rend compte de la dernière même après coup — appliquée, échouée avec sa raison,
ou interrompue par un redémarrage du serveur — même si la page a été rechargée
ou la connexion coupée en cours de route. Tant qu'une modification est en cours,
une seconde ne peut pas démarrer sur le même canevas.

## Réglages

Les pastilles de réglage viennent des options que le plan déclare lui-même. En
changer une réaffiche aussitôt ; l'épingler réécrit la valeur comme nouvelle
valeur par défaut du plan.

## Versions

Chaque changement est une version, avec qui l'a fait, ce que c'était, et s'il vient
d'une personne, d'un import ou de l'IA. Restaurer une ancienne version la recopie
en avant comme nouvelle : rien n'est jamais perdu.

## Nommer les plans pour qu'ils se retrouvent

Vos agents ne lisent pas tout le canevas — voir la section suivante. Ils lisent un
index qui classe chaque plan par le rôle qu'il joue, et un plan bien nommé, ils le
trouvent. Le vocabulaire :

| Rôle | Ce qui y appartient |
|---|---|
| **tokens** | La palette, les espacements, les rayons — les valeurs auxquelles tout le reste se réfère |
| **typography** | L'échelle typographique, les graisses, les fontes |
| **components** | Boutons, champs, badges : les pièces, dans leurs états |
| **patterns** | Ces pièces composées : cartes, listes, barres d'outils |
| **page** | Un écran entier ou une page imprimée |

Le rôle est lu du titre dans `canvas.json`, puis du nom de fichier. Un design avec
*Tokens*, *Typographie* et *Composants* se navigue ; cinq plans nommés *Frame 1* à
*Frame 5* s'ouvrent au hasard. Les designs générés par l'IA sont déjà nommés ainsi.

Un canevas de système de design devrait porter au moins un plan tokens et un plan
typography.

## Joindre un design

**À une conversation.** L'icône **Designs** de l'en-tête y joint un canevas. Le
nombre indique combien sont en jeu ; le menu liste tous les designs, cochés
lorsqu'ils sont joints. Les agents peuvent aussi joindre et retirer.

**À un projet.** Sous **Projets → modifier**. Une conversation créée dans le projet
démarre avec les designs du projet et les possède ensuite — en retirer un n'affecte
que cette conversation. Définis sur le projet, les nouvelles conversations les
reçoivent ; non définis, elles ne les reçoivent pas. Les modifier ensuite n'atteint
pas les conversations existantes.

C'est le même comportement que les sources de code et les dossiers de travail.

## Ce qu'un agent voit d'un design joint

Pas la toile — ce serait des dizaines de milliers de caractères par tour. Ni ses
valeurs : une **annonce**. Le design signale qu'il est joint et quel TYPE de
données contient chacune de ses parties — jetons (couleurs, espacements, rayons),
typographie, composants, motifs. Pour le design Odoo de cinq plans et 46 Ko,
cela fait **652 caractères**, et cette taille ne bouge pas quand le design grossit.

L'agent va ensuite chercher uniquement ce dont il a besoin : `design_read` avec
`part` renvoie les valeurs dérivées d'une partie, `design_read` avec `file` le
balisage complet d'un plan.

**Pourquoi ne pas simplement inclure la palette ?** Elle l'a été un temps. Le
bloc est payé à **chaque tour** ; une récupération, **une seule fois**. Dès deux
tours la récupération est moins chère, et c'est la seule forme dont le coût ne
croît pas avec la toile — c'est pourquoi même un petit design s'annonce au lieu
de s'incruster.

Le bloc indique aussi à l'agent de suivre le design, plutôt que de simplement
noter qu'il y en a un joint.

## Exporter et imprimer

Le menu d'export propose deux choses.

**Fichiers** donne le canevas lui-même : une page HTML autonome qui s'ouvre dans
n'importe quel navigateur, ou un document de canevas portable à partir duquel un
autre outil peut repartir.

**Impression** rend le design à travers un vrai navigateur : PNG du plan
sélectionné en résolution normale ou double, PDF de ce plan, ou un seul PDF du
canevas entier.

La façon dont un plan s'imprime lui appartient. Un plan **fixe** — le réglage par
défaut, et ce qu'est une affiche, un dépliant ou une page de brochure — sort en
exactement une page, exactement à sa taille sur le canevas. Un plan **en flux** —
une note, un rapport — est paginé en A4 ou Letter selon votre choix ; une colonne
plus large que la page est réduite, une plus étroite reste à la largeur pour
laquelle elle a été conçue plutôt que d'être agrandie.

Le PDF du canevas entier place chaque plan sur sa propre page, dans l'ordre de
lecture : page par page, puis de haut en bas, puis de gauche à droite. Les pages
conservent leur taille, si bien qu'une brochure faite de plans de tailles
différentes s'exporte correctement au lieu d'être forcée sur un seul format.

L'impression exige un navigateur installé à côté d'EYAS. À défaut, les entrées
d'impression sont désactivées et le menu indique quoi installer. Tout ce qui se
trouve sous **Fichiers** fonctionne dans les deux cas.

## Renommer et supprimer

Cliquez sur le titre dans l'en-tête, saisissez, Entrée. Échap annule.

L'icône de corbeille à droite de l'en-tête supprime le design entier. Elle
demande d'abord, et la question nomme ce qui part avec lui : chaque version
enregistrée, et chaque conversation ou projet auquel le design est rattaché. Il
n'y a ni annulation ni corbeille pour le récupérer.
