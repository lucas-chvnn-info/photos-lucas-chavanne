# Galerie photos

Galerie personnelle : les photos sont rangées **par sortie** (musée, rassemblement, balade…),
**par voiture** dans le garage et **sur une carte**, et analysées par une **IA gratuite qui tourne sur le Mac**
(Ollama + Qwen3-VL). Pour une voiture, elle devine la marque, le modèle, la génération et les
années ; pour un lieu, l'endroit ; pour un animal, l'espèce et la race.

Site public : https://photos.lucas-chvnn.ch

## Comment ça marche

```
Mac (admin, localhost:3000)                    GitHub           Vercel
ajout des photos → IA locale → « Publier »  →  git push   →  site public en lecture seule
```

- **Sur le Mac** : `npm start` lance la page d'administration. On y ajoute, analyse, corrige et
  supprime les photos, puis on clique sur **Publier**.
- **Sur Vercel** : seul le dossier `public/` est mis en ligne. Personne ne peut y ajouter ou
  modifier de photos.

Tout est gratuit : l'IA tourne en local, GitHub et Vercel (offre Hobby) ne coûtent rien.

## Installation (une seule fois)

```bash
brew install ollama
brew services start ollama
ollama pull qwen3-vl:8b
npm install
```

## Ajouter des photos

```bash
npm start
```

1. Ouvre http://localhost:3000.
2. Glisse tes photos dans la page, ou utilise le bouton **+**. Chaque photo est analysée par l'IA,
   ce qui prend une dizaine de secondes par photo (un peu plus pour la première, le temps que
   le modèle se charge).
3. Corrige si besoin : clique sur le titre pour le modifier, change le thème, ou utilise
   « Corriger » sur la voiture ou le lieu.
4. Clique sur **Publier**. Le site public est à jour environ une minute plus tard.

Formats acceptés : JPEG, PNG, WebP, AVIF, TIFF. Les HEIC de l'iPhone ne passent pas : dans
Réglages → Appareil photo → Formats, choisis « Le plus compatible », ou exporte-les en JPEG.

## Le site

| Page | Contenu |
|---|---|
| Accueil `#/` | Grande photo (un coup de cœur au hasard), dernières sorties, marques du garage |
| Sorties `#/sorties` | Toutes les sorties, par année ; chaque sortie a sa page `#/sortie/<id>` |
| Garage `#/garage` | Les voitures par marque puis par modèle ; chaque voiture a sa page `#/voiture/<clé>` |
| Carte `#/carte` | Un repère par sortie |
| Toutes les photos `#/photos` | Recherche et filtres par thème |

Dans l'administration : champ « Sortie » à l'ajout, ★ coup de cœur, « Couverture de la sortie »,
déplacer une photo vers une autre sortie, modifier le nom, le lieu et la description d'une sortie,
et la boîte « À ranger » pour les photos sans sortie.

## Vie privée

- Les **originaux** restent sur le Mac (`originaux/`, jamais envoyés sur GitHub).
- La base complète (`donnees/galerie.json` : commentaires, noms de fichiers) reste sur le Mac.
  Le site ne reçoit qu'une version nettoyée (`public/data/galerie.json`). Pense à sauvegarder
  `donnees/` et `originaux/` (Time Machine, disque externe…) : ils ne sont pas sur GitHub.
- Les images publiées sont redimensionnées et **nettoyées de leurs métadonnées EXIF**.
- La **position GPS** de chaque photo est publiée pour la carte. Pour une photo prise chez toi,
  ouvre-la et clique sur « Retirer la position GPS » avant de publier.

## Structure

| Fichier | Rôle |
|---|---|
| `server.js` | Serveur d'administration (local) : envoi, redimensionnement, EXIF/GPS, publication |
| `ai.js` | Appel à l'IA locale (Ollama, réponse JSON structurée) |
| `public/` | Le site : page, style, script, `photos/` et `data/galerie.json` (version publique) |
| `donnees/` | La base complète avec tes commentaires (ignorée par git) |
| `originaux/` | Les fichiers d'origine (ignorés par git) |
| `vercel.json` | Vercel sert `public/` tel quel, sans étape de build |

Réglages dans `.env` (voir `.env.example`) :
- `OLLAMA_MODEL=...` pour utiliser un autre modèle ;
- `OLLAMA_REFLEXION=1` pour que l'IA réfléchisse avant de répondre : un peu plus précise sur
  les voitures difficiles, mais environ 4 fois plus lente (≈ 40 s par photo).
