# work-clock

Compte le temps que Claude travaille, par jour et par chat, et l'affiche dans un tableau de bord à côté du chat.

- Le tableau affiche le total du jour par chat, avec des barres, puis les 7 derniers jours.
- Une petite animation de Claude en pixels montre s'il travaille ou se repose.
- La commande `/work-clock` ouvre le tableau et donne le total du jour.

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
- Les données sont dans le magasin du mod, partagé entre les sessions.

