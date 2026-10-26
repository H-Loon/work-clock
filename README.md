# work-clock

Compte le temps que Claude travaille, par jour et par chat, et l'affiche au-dessus de la saisie et dans un tableau de bord à côté du chat.

- Au-dessus de la saisie, un widget résume la journée du chat en cours : son nom, son temps aujourd'hui, le total de la journée, le nombre de tours et le plus long. Un petit Claude animé danse sur une tuile orange à vagues, plus agitées quand Claude travaille.
- Le bouton « Tableau ↗ » du widget, ou la commande `/work-clock`, ouvre le tableau de bord : le jour, la semaine en barres (un clic sur un jour montre ses chats), la série, le record et la moyenne.
- Les chats portent le nom que leur donne l'app, lu dans leur transcript.
- `/work-clock cacher` masque le widget, `/work-clock afficher` le remet.

## Installation

Dans le terminal, tapez :

```bash
/plugin install work-clock --marketplace H-Loon/work-clock
```

Puis répondez `y` pour ajouter la marketplace et choisissez une portée.

Depuis un shell :

```bash
claude plugin install work-clock --marketplace H-Loon/work-clock
```

Dans l'app de bureau, où `/plugin` ne fonctionne pas : cliquez sur + à côté de la zone de saisie, puis Plugins, Add marketplace avec `H-Loon/work-clock`, puis Add plugin.

## Notes

- Seuls les tours de l'agent principal sont comptés ; les sous-agents ne le sont pas.
- Un tour qui passe minuit compte pour le jour où il a commencé.
- Les données sont dans le magasin du mod, partagé entre les sessions, et ne quittent pas l'ordinateur.
- Pour lire le nom d'un chat, le mod lance `findstr` (Windows) ou `grep` sur son transcript dans `~/.claude/projects`.
