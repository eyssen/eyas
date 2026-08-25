---
title: Profils vocaux
description: Voix interne et externe — dimensions, préréglages, expressions bloquées, signature.
---

**Chemin :** `/agents/:id` → onglet **Voix**.

Chaque agent a deux styles d'élocution :

| Profil | Utilisé pour |
|--------|--------------|
| **Communication interne** | Vous et les coéquipiers |
| **Communication externe** | Clients, inconnus, canaux publics |

L'exécution choisit un profil d'après le contexte (**AUTO**) sauf si vous le forcez sur une conversation ([Portée de la voix](/docs/fr/daily/conversations/)).

---

## Préréglages

| Commande | Signification |
|----------|---------------|
| **Préréglage interne** | Liste des styles intégrés pour la voix interne |
| **Préréglage externe** | Idem pour l'externe |
| **Personnalisé** | Automatique dès que vous éditez des champs individuels |

### Préréglages intégrés

| Préréglage | Caractère |
|------------|-----------|
| **Jarvis** | Formel, concis, professionnel |
| **Best buddy** | Amical, équilibré |
| **Senior CEO** | Sérieux, très direct |
| **Buddy Dev** | Décontracté, style développeur |
| **Standup** | Enjoué, provocateur |
| **Diplomat** | Formel, détaillé |
| **Coach** | Direct, motivant |
| **Tutor** | Amical, détaillé |

Choisir un préréglage remplit les six dimensions ci-dessous.

---

## Dimensions

| Dimension | Options |
|-----------|---------|
| **Formule d'adresse** | Informel (te) · Formel (maga) · Formel (ön) · Selon le contexte |
| **Ton** | Sérieux · Équilibré · Amical · Décontracté · Enjoué |
| **Niveau de détail** | Concis · Équilibré · Détaillé |
| **Franchise** | Très direct · Direct + poli · Diplomatique · Indirect |
| **Humour** | Aucun · Sec / spirituel · Léger · Tranchant / provocateur |
| **Emoji** | Jamais · Fonctionnel · Souvent |

Chaque dimension est définie **deux fois** (bloc interne + bloc externe).

---

## Champs supplémentaires

| Champ | Signification |
|-------|---------------|
| **Expressions bloquées (une par ligne)** | Expressions que l'agent ne doit pas utiliser (p. ex. excuses vides) |
| **Signature** | Ligne de signature de clôture (p. ex. `— EYAS, votre assistant`) |

## Actions

| Commande | Signification |
|----------|---------------|
| **Enregistrer le profil vocal** | Persister les deux profils + extras |

## Voir aussi

- [Créer et configurer](/docs/fr/agents/configure/)
- [Conversations — portée de la voix](/docs/fr/daily/conversations/)
