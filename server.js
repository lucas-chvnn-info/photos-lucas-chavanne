// Serveur d'administration, à lancer sur ton Mac uniquement (npm start).
// Le site public (Vercel) ne sert que le dossier public/, en lecture seule.
import express from "express";
import multer from "multer";
import sharp from "sharp";
import exifr from "exifr";
import { randomUUID } from "node:crypto";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { mkdir, readFile, writeFile, rm } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { analyserPhoto, etatIA, CATEGORIES, MODELE } from "./ai.js";
import { geocoder } from "./geo.js";

const ici = path.dirname(fileURLToPath(import.meta.url));
const PUBLIC = path.join(ici, "public");
// Base complète (commentaires, noms de fichiers…) : reste sur le Mac, jamais publiée.
const FICHIER_PRIVE = path.join(ici, "donnees", "galerie.json");
// Version nettoyée lue par le site public.
const FICHIER_PUBLIC = path.join(PUBLIC, "data", "galerie.json");
const ANCIEN_FICHIER = path.join(PUBLIC, "data", "photos.json");
const DOSSIER_ORIGINAUX = path.join(ici, "originaux"); // jamais publiés (contiennent l'EXIF complet)
const PORT = Number(process.env.PORT) || 3000;
const git = promisify(execFile);

for (const d of [path.join(PUBLIC, "photos", "grand"), path.join(PUBLIC, "photos", "miniatures"), path.join(PUBLIC, "data"), path.dirname(FICHIER_PRIVE), DOSSIER_ORIGINAUX]) {
  await mkdir(d, { recursive: true });
}

// --- Base JSON ---------------------------------------------------------------

let photos = [];
let albums = [];
try {
  ({ photos = [], albums = [] } = JSON.parse(await readFile(FICHIER_PRIVE, "utf8")));
} catch {
  // Première fois : reprise de l'ancien format (un seul fichier public).
  try {
    photos = JSON.parse(await readFile(ANCIEN_FICHIER, "utf8"));
  } catch {}
}
// Une analyse interrompue par un arrêt du serveur ne doit pas rester « en cours ».
for (const p of photos) if (p.etat_analyse === "en_cours") p.etat_analyse = "en_attente";

const trouver = (id) => photos.find((p) => p.id === id);
const trouverAlbum = (id) => albums.find((a) => a.id === id);
const parDate = (a, b) => (a.prise_le ?? a.ajoutee_le).localeCompare(b.prise_le ?? b.ajoutee_le);

let ecriture = Promise.resolve();
function sauvegarder() {
  photos.sort((a, b) => parDate(b, a));
  const prive = JSON.stringify({ albums, photos }, null, 2) + "\n";
  const publie = JSON.stringify(exporter(false)) + "\n";
  ecriture = ecriture.then(async () => {
    await writeFile(FICHIER_PRIVE, prive);
    await writeFile(FICHIER_PUBLIC, publie);
    await rm(ANCIEN_FICHIER, { force: true });
  });
  return ecriture;
}

// --- Export : ce que voit le site ----------------------------------------------

const slug = (s) => String(s ?? "").normalize("NFD").replace(/\p{Diacritic}/gu, "").toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");

// « bmw », « Bmw » et « BMW » → la forme la plus fréquente qui n'est pas tout en minuscules.
function formesMarques() {
  const compte = {};
  for (const p of photos) {
    const m = p.analyse?.voiture?.marque?.trim();
    if (!m) continue;
    compte[m.toLowerCase()] ??= {};
    compte[m.toLowerCase()][m] = (compte[m.toLowerCase()][m] ?? 0) + 1;
  }
  const formes = {};
  for (const [cle, variantes] of Object.entries(compte)) {
    const triees = Object.entries(variantes).sort((a, b) => (a[0] === cle) - (b[0] === cle) || b[1] - a[1]);
    formes[cle] = triees[0][0] === cle ? cle.replace(/\b\p{L}/gu, (c) => c.toUpperCase()) : triees[0][0];
  }
  return formes;
}

const arrondi = (gps, d = 4) => gps && { lat: +gps.lat.toFixed(d), lon: +gps.lon.toFixed(d), ...(gps.approx ? { approx: true } : {}) };

// Position affichée : GPS exact de la photo, sinon celui de la sortie, sinon l'estimation d'après le lieu.
function position(photo) {
  if (photo.gps_retire) return null;
  if (photo.gps && !photo.gps.approx) return photo.gps;
  return trouverAlbum(photo.album)?.gps ?? photo.gps ?? null;
}

function exporter(admin) {
  const marques = formesMarques();
  const exportees = photos.map((p) => {
    const a = p.analyse;
    const v = a?.voiture;
    const l = a?.lieu;
    const base = {
      id: p.id,
      grand: p.grand,
      miniature: p.miniature,
      largeur: p.largeur,
      hauteur: p.hauteur,
      prise_le: p.prise_le,
      appareil: p.appareil,
      categorie: p.categorie,
      titre: p.titre,
      album: p.album ?? null,
      favori: Boolean(p.favori),
      gps: arrondi(position(p), admin ? 6 : 4),
      analyse: a && {
        description: a.description ?? "",
        tags: a.tags ?? [],
        voiture: v?.presente
          ? { presente: true, marque: marques[v.marque?.trim().toLowerCase()] ?? v.marque ?? "", modele: v.modele ?? "", generation: v.generation ?? "", annees: v.annees ?? "", carrosserie: v.carrosserie ?? "", couleur: v.couleur ?? "", confiance: v.confiance, surnom: v.surnom ?? "", ...(admin ? { indices: v.indices } : {}) }
          : { presente: false },
        lieu: l?.identifie ? { identifie: true, nom: l.nom ?? "", ville: l.ville ?? "", pays: l.pays ?? "", confiance: l.confiance, ...(admin ? { indices: l.indices } : {}) } : { identifie: false },
        animal: a.animal?.present ? a.animal : { present: false },
      },
    };
    if (!admin) return base;
    return {
      ...base,
      nom_fichier: p.nom_fichier,
      commentaire: p.commentaire ?? "",
      etat_analyse: p.etat_analyse,
      erreur_analyse: p.erreur_analyse,
      gps_retire: Boolean(p.gps_retire),
      modele_ia: a?.modele_ia,
    };
  });

  const exportAlbums = albums.map((al) => {
    const siennes = photos.filter((p) => p.album === al.id).sort(parDate);
    const dates = siennes.map((p) => p.prise_le).filter(Boolean).sort();
    const couverture = trouver(al.couverture)?.album === al.id ? al.couverture : (siennes.find((p) => p.favori) ?? siennes[0])?.id ?? null;
    return {
      id: al.id,
      titre: al.titre,
      lieu: al.lieu ?? "",
      description: al.description ?? "",
      gps: arrondi(al.gps),
      couverture,
      debut: dates[0] ?? null,
      fin: dates.at(-1) ?? null,
      nb: siennes.length,
    };
  }).filter((al) => admin || al.nb > 0);

  return { albums: exportAlbums, photos: exportees };
}

// --- Carte -------------------------------------------------------------------

// Sans GPS dans la photo (appareil sans GPS, export Lightroom…), on place la photo
// d'après le lieu reconnu. Jamais si tu as retiré la position toi-même.
async function placerSurCarte(photo) {
  if (photo.gps_retire || (photo.gps && !photo.gps.approx) || !photo.analyse) return false;
  const lieu = photo.analyse.lieu?.identifie ? photo.analyse.lieu : {};
  const pos = await geocoder(lieu, photo.commentaire);
  if (!pos) return false;
  photo.gps = pos;
  return true;
}

async function placerAlbum(album) {
  album.gps = album.lieu ? await geocoder({ nom: album.lieu }) : null;
}

// --- Traitement des images -------------------------------------------------

async function lireExif(buffer) {
  try {
    const exif = await exifr.parse(buffer, { gps: true, pick: ["DateTimeOriginal", "Make", "Model", "latitude", "longitude"] });
    if (!exif) return {};
    return {
      gps: Number.isFinite(exif.latitude) && Number.isFinite(exif.longitude) ? { lat: exif.latitude, lon: exif.longitude } : null,
      date: exif.DateTimeOriginal instanceof Date ? exif.DateTimeOriginal.toISOString() : null,
      appareil: [exif.Make, exif.Model].filter(Boolean).join(" ") || null,
    };
  } catch {
    return {};
  }
}

async function enregistrerPhoto(fichier, { commentaire = "", album = null } = {}) {
  const id = randomUUID().slice(0, 12);
  const ext = path.extname(fichier.originalname).toLowerCase() || ".jpg";
  // rotate() applique l'orientation EXIF ; sharp retire toutes les métadonnées des fichiers publiés.
  const base = sharp(fichier.buffer, { failOn: "none" }).rotate();

  let meta;
  try {
    meta = await base.clone().metadata();
  } catch {
    throw new Error(`${fichier.originalname} : format non pris en charge (utilise JPEG, PNG, WebP ou AVIF).`);
  }

  await Promise.all([
    writeFile(path.join(DOSSIER_ORIGINAUX, id + ext), fichier.buffer),
    base.clone().resize({ width: 2000, height: 2000, fit: "inside", withoutEnlargement: true }).jpeg({ quality: 82, mozjpeg: true }).toFile(path.join(PUBLIC, "photos", "grand", `${id}.jpg`)),
    base.clone().resize({ width: 700, withoutEnlargement: true }).webp({ quality: 75 }).toFile(path.join(PUBLIC, "photos", "miniatures", `${id}.webp`)),
  ]);

  const orientationTournee = (meta.orientation ?? 1) >= 5;
  const exif = await lireExif(fichier.buffer);

  return {
    id,
    nom_fichier: fichier.originalname,
    grand: `/photos/grand/${id}.jpg`,
    miniature: `/photos/miniatures/${id}.webp`,
    largeur: orientationTournee ? meta.height : meta.width,
    hauteur: orientationTournee ? meta.width : meta.height,
    ajoutee_le: new Date().toISOString(),
    prise_le: exif.date ?? null,
    appareil: exif.appareil ?? null,
    gps: exif.gps ?? null,
    categorie: "autre",
    titre: path.parse(fichier.originalname).name,
    commentaire: String(commentaire).trim().slice(0, 500),
    album,
    favori: false,
    analyse: null,
    etat_analyse: "en_attente",
    erreur_analyse: null,
  };
}

// --- Sorties (albums) ----------------------------------------------------------

async function creerAlbum({ titre, lieu = "", description = "" }) {
  titre = String(titre).trim().slice(0, 100);
  const existant = albums.find((a) => slug(a.titre) === slug(titre));
  if (existant) return existant;
  let id = slug(titre) || "sortie";
  while (trouverAlbum(id)) id = `${slug(titre)}-${randomUUID().slice(0, 4)}`;
  const album = { id, titre, lieu: String(lieu).trim().slice(0, 100), description: String(description).trim().slice(0, 600), couverture: null, gps: null };
  albums.push(album);
  await placerAlbum(album);
  return album;
}

// --- API -------------------------------------------------------------------

const app = express();
app.use(express.json());

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 50 * 1024 * 1024, files: 50 },
});

app.get("/api/config", async (_req, res) => {
  const ia = await etatIA();
  res.json({ admin: true, ia: ia.ok, raison_ia: ia.raison ?? null, modele: MODELE, categories: CATEGORIES });
});

app.get("/api/galerie", (_req, res) => res.json(exporter(true)));

const unePhoto = (p) => exporter(true).photos.find((x) => x.id === p.id);

app.post("/api/photos", upload.array("photos"), async (req, res) => {
  const ajoutees = [];
  const erreurs = [];
  let commentaires = [];
  try {
    commentaires = JSON.parse(req.body?.commentaires ?? "[]");
  } catch {}
  let album = null;
  const nomAlbum = String(req.body?.album ?? "").trim();
  if (nomAlbum) album = trouverAlbum(nomAlbum) ?? (await creerAlbum({ titre: nomAlbum, lieu: req.body?.album_lieu ?? "" }));

  for (const [i, fichier] of (req.files ?? []).entries()) {
    try {
      photos.push(await enregistrerPhoto(fichier, { commentaire: commentaires[i] ?? "", album: album?.id ?? null }));
      ajoutees.push(photos.at(-1));
    } catch (e) {
      erreurs.push(e.message);
    }
  }
  await sauvegarder();
  const galerie = exporter(true);
  res.status(ajoutees.length ? 201 : 400).json({
    ajoutees: galerie.photos.filter((p) => ajoutees.some((a) => a.id === p.id)),
    albums: galerie.albums,
    erreurs,
  });
});

app.post("/api/photos/:id/analyse", async (req, res) => {
  const photo = trouver(req.params.id);
  if (!photo) return res.status(404).json({ erreur: "Photo introuvable" });

  photo.etat_analyse = "en_cours";
  try {
    const jpeg = await sharp(path.join(PUBLIC, photo.grand))
      .resize({ width: 1280, height: 1280, fit: "inside", withoutEnlargement: true })
      .jpeg({ quality: 85 })
      .toBuffer();
    // Une position estimée vient d'une ancienne analyse : ne pas la redonner à l'IA comme un vrai GPS.
    const gps = photo.gps?.approx ? null : photo.gps;
    const album = trouverAlbum(photo.album);
    const contexte = [album && `Sortie : ${album.titre}${album.lieu ? ` (${album.lieu})` : ""}`, photo.commentaire].filter(Boolean).join(". ");
    const analyse = await analyserPhoto(jpeg, { commentaire: contexte, gps, date: photo.prise_le, appareil: photo.appareil });
    // Le nom donné à la voiture (pour regrouper ses photos) survit à une nouvelle analyse.
    const surnom = photo.analyse?.voiture?.surnom;
    if (surnom && analyse.voiture?.presente) analyse.voiture.surnom = surnom;
    photo.analyse = analyse;
    photo.categorie = analyse.categorie;
    photo.titre = analyse.titre || photo.titre;
    photo.etat_analyse = "ok";
    photo.erreur_analyse = null;
    if (!album?.gps) await placerSurCarte(photo);
  } catch (e) {
    photo.etat_analyse = "erreur";
    photo.erreur_analyse = e.message;
  }
  await sauvegarder();
  res.status(photo.etat_analyse === "ok" ? 200 : 502).json(unePhoto(photo));
});

app.patch("/api/photos/:id", async (req, res) => {
  const photo = trouver(req.params.id);
  if (!photo) return res.status(404).json({ erreur: "Photo introuvable" });

  const { titre, categorie, voiture, lieu, gps, commentaire, album, favori } = req.body ?? {};
  if (typeof titre === "string") photo.titre = titre.trim().slice(0, 120);
  if (typeof commentaire === "string") photo.commentaire = commentaire.trim().slice(0, 500);
  if (CATEGORIES.includes(categorie)) photo.categorie = categorie;
  if (typeof favori === "boolean") photo.favori = favori;
  if (album === null || trouverAlbum(album)) photo.album = album;
  if (gps === null) {
    photo.gps = null;
    photo.gps_retire = true;
  }
  if (voiture || lieu) {
    photo.analyse ??= { tags: [], description: "", voiture: { presente: false }, lieu: { identifie: false }, animal: { present: false } };
    if (voiture) Object.assign(photo.analyse.voiture, pick(voiture, ["marque", "modele", "generation", "annees", "surnom"]), { presente: true, confiance: "manuel" });
    if (lieu) {
      Object.assign(photo.analyse.lieu, pick(lieu, ["nom", "ville", "pays"]), { identifie: true, confiance: "manuel" });
      delete photo.gps_retire; // indiquer un lieu = accepter qu'il apparaisse sur la carte
      await placerSurCarte(photo);
    }
  }
  await sauvegarder();
  res.json(unePhoto(photo));
});

app.delete("/api/photos/:id", async (req, res) => {
  const photo = trouver(req.params.id);
  if (!photo) return res.status(404).json({ erreur: "Photo introuvable" });
  photos = photos.filter((p) => p.id !== photo.id);
  await sauvegarder();
  await Promise.all([
    rm(path.join(PUBLIC, photo.grand), { force: true }),
    rm(path.join(PUBLIC, photo.miniature), { force: true }),
    rm(path.join(DOSSIER_ORIGINAUX, photo.id + path.extname(photo.nom_fichier).toLowerCase()), { force: true }),
  ]);
  res.status(204).end();
});

app.post("/api/albums", async (req, res) => {
  if (!String(req.body?.titre ?? "").trim()) return res.status(400).json({ erreur: "Donne un nom à la sortie." });
  const album = await creerAlbum(req.body);
  await sauvegarder();
  res.status(201).json(exporter(true).albums.find((a) => a.id === album.id));
});

app.patch("/api/albums/:id", async (req, res) => {
  const album = trouverAlbum(req.params.id);
  if (!album) return res.status(404).json({ erreur: "Sortie introuvable" });
  const { titre, lieu, description, couverture } = req.body ?? {};
  if (typeof titre === "string" && titre.trim()) album.titre = titre.trim().slice(0, 100);
  if (typeof description === "string") album.description = description.trim().slice(0, 600);
  if (typeof couverture === "string" && trouver(couverture)?.album === album.id) album.couverture = couverture;
  if (typeof lieu === "string" && lieu.trim() !== album.lieu) {
    album.lieu = lieu.trim().slice(0, 100);
    await placerAlbum(album);
  }
  await sauvegarder();
  res.json(exporter(true).albums.find((a) => a.id === album.id));
});

// Supprimer une sortie ne supprime pas ses photos : elles retournent « à ranger ».
app.delete("/api/albums/:id", async (req, res) => {
  const album = trouverAlbum(req.params.id);
  if (!album) return res.status(404).json({ erreur: "Sortie introuvable" });
  albums = albums.filter((a) => a.id !== album.id);
  for (const p of photos) if (p.album === album.id) p.album = null;
  await sauvegarder();
  res.status(204).end();
});

// Envoie les changements sur GitHub ; Vercel republie alors le site tout seul.
app.post("/api/publier", async (_req, res) => {
  const opts = { cwd: ici };
  try {
    await git("git", ["add", "-A", "public"], opts);
    const { stdout: modifs } = await git("git", ["diff", "--cached", "--name-only"], opts);
    if (modifs.trim()) {
      const n = photos.length;
      await git("git", ["commit", "-m", `Galerie : mise à jour (${n} photo${n > 1 ? "s" : ""}, ${albums.length} sortie${albums.length > 1 ? "s" : ""})`], opts);
    }
    // Aussi les changements déjà enregistrés mais pas encore envoyés (nouvelle version du site…).
    const { stdout: enAvance } = await git("git", ["rev-list", "--count", "@{u}..HEAD"], opts);
    if (Number(enAvance) === 0) return res.json({ message: "Rien de nouveau à publier." });
    await git("git", ["push"], { ...opts, timeout: 120_000 });
    res.json({ message: "Publié ! Le site sera à jour dans une minute." });
  } catch (e) {
    console.error(e);
    res.status(500).json({ erreur: `Publication échouée : ${(e.stderr || e.message).trim().split("\n").pop()}` });
  }
});

function pick(obj, cles) {
  return Object.fromEntries(cles.filter((k) => typeof obj[k] === "string").map((k) => [k, obj[k].trim().slice(0, 80)]));
}

app.use(express.static(PUBLIC, { cacheControl: false }));

app.use((err, _req, res, _next) => {
  const message = err instanceof multer.MulterError ? `Envoi refusé : ${err.message}` : "Erreur serveur";
  console.error(err);
  res.status(400).json({ erreur: message });
});

await sauvegarder(); // crée la version publique au format actuel dès le démarrage

app.listen(PORT, "127.0.0.1", async () => {
  console.log(`Administration de la galerie : http://localhost:${PORT}`);
  const ia = await etatIA();
  console.log(ia.ok ? `IA locale prête (${MODELE})` : `⚠︎  ${ia.raison}`);

  // Sorties et photos pas encore placées sur la carte.
  let placees = 0;
  for (const a of albums.filter((x) => x.lieu && !x.gps)) {
    await placerAlbum(a);
    if (a.gps) placees++;
  }
  for (const p of photos.filter((x) => !x.gps && !trouverAlbum(x.album)?.gps)) if (await placerSurCarte(p)) placees++;
  if (placees) {
    await sauvegarder();
    console.log(`${placees} élément${placees > 1 ? "s" : ""} placé${placees > 1 ? "s" : ""} sur la carte.`);
  }
});
