---
title: Profils vocaux
description: Comment un agent parle en interne vs en externe — six dimensions, préréglages, AUTO.
---

**À quoi ça sert.** La voix est *comment* l’agent parle, pas *ce qu’il sait*. Chaque agent a deux profils : **Internal communication** (vous et l’équipe) et **External communication** (clients, inconnus, canaux publics). Le runtime choisit **AUTO** sauf si vous surchargez la portée sur une conversation.

## Quand l’utiliser

- Un ton différent avec l’équipe qu’avec un client.
- Partir d’un préréglage (Jarvis, Diplomat, Coach, …) puis ajuster une dimension.
- Phrases bloquées (excuses vides) ou une **Signature**.
- Une conversation doit forcer Internal ou External, peu importe le défaut.

## Déroulement typique

1. Ouvrez **Agents** → l’agent → onglet **Voix** — route `/agents/:id`.
2. Choisissez **Internal preset** et **External preset**, ou laissez **Custom** après édition d’un champ.
3. Ajustez les six dimensions sur chaque bloc, plus **Blocked phrases** et **Signature**. **Save voice profile**.
4. Dans la conversation, **Voice · INTERNAL / EXTERNAL / AUTO** doit correspondre ; surchargez-y si ce fil est l’exception.

## Fonctions

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
