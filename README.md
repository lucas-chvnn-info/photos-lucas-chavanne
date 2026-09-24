# Galerie photos

Galerie personnelle : les photos sont classées par thème (voitures, paysages, villes, animaux…),
placées sur une carte grâce au GPS, et analysées par une **IA gratuite qui tourne sur le Mac**
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

## Vie privée

- Les **originaux** restent sur le Mac (`originaux/`, jamais envoyés sur GitHub).
- Les images publiées sont redimensionnées et **nettoyées de leurs métadonnées EXIF**.
- La **position GPS** de chaque photo est publiée pour la carte. Pour une photo prise chez toi,
  ouvre-la et clique sur « Retirer la position GPS » avant de publier.

## Structure

| Fichier | Rôle |
|---|---|
| `server.js` | Serveur d'administration (local) : envoi, redimensionnement, EXIF/GPS, publication |
| `ai.js` | Appel à l'IA locale (Ollama, réponse JSON structurée) |
| `public/` | Le site : page, style, script, `photos/` et `data/photos.json` |
| `originaux/` | Les fichiers d'origine (ignorés par git) |
| `vercel.json` | Vercel sert `public/` tel quel, sans étape de build |

Réglages dans `.env` (voir `.env.example`) :
- `OLLAMA_MODEL=...` pour utiliser un autre modèle ;
- `OLLAMA_REFLEXION=1` pour que l'IA réfléchisse avant de répondre : un peu plus précise sur
  les voitures difficiles, mais environ 4 fois plus lente (≈ 40 s par photo).
