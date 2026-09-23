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
const FICHIER_DB = path.join(PUBLIC, "data", "photos.json");
const DOSSIER_ORIGINAUX = path.join(ici, "originaux"); // jamais publiés (contiennent l'EXIF complet)
const PORT = Number(process.env.PORT) || 3000;
const git = promisify(execFile);

for (const d of [path.join(PUBLIC, "photos", "grand"), path.join(PUBLIC, "photos", "miniatures"), path.join(PUBLIC, "data"), DOSSIER_ORIGINAUX]) {
  await mkdir(d, { recursive: true });
}

// --- Petite base JSON (publiée avec le site) --------------------------------

let photos = [];
try {
  photos = JSON.parse(await readFile(FICHIER_DB, "utf8"));
} catch {
  photos = [];
}
// Une analyse interrompue par un arrêt du serveur ne doit pas rester « en cours ».
for (const p of photos) if (p.etat_analyse === "en_cours") p.etat_analyse = "en_attente";

let ecriture = Promise.resolve();
function sauvegarder() {
  const tri = [...photos].sort((a, b) => (b.prise_le ?? b.ajoutee_le).localeCompare(a.prise_le ?? a.ajoutee_le));
  const contenu = JSON.stringify(tri, null, 2) + "\n";
  ecriture = ecriture.then(() => writeFile(FICHIER_DB, contenu));
  return ecriture;
}

const trouver = (id) => photos.find((p) => p.id === id);

// Sans GPS dans la photo (appareil sans GPS, export Lightroom…), on place la photo
// d'après le lieu reconnu. Jamais si tu as retiré la position toi-même.
async function placerSurCarte(photo) {
  if (photo.gps_retire || (photo.gps && !photo.gps.approx) || !photo.analyse?.lieu?.identifie) return false;
  const pos = await geocoder(photo.analyse.lieu);
  if (!pos) return false;
  photo.gps = pos;
  return true;
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

async function enregistrerPhoto(fichier) {
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
    analyse: null,
    etat_analyse: "en_attente",
    erreur_analyse: null,
  };
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

app.get("/api/photos", (_req, res) => res.json(photos));

app.post("/api/photos", upload.array("photos"), async (req, res) => {
  const ajoutees = [];
  const erreurs = [];
  for (const fichier of req.files ?? []) {
    try {
      ajoutees.push(await enregistrerPhoto(fichier));
    } catch (e) {
      erreurs.push(e.message);
    }
  }
  photos.push(...ajoutees);
  await sauvegarder();
  res.status(ajoutees.length ? 201 : 400).json({ ajoutees, erreurs });
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
    const analyse = await analyserPhoto(jpeg, { gps, date: photo.prise_le, appareil: photo.appareil });
    photo.analyse = analyse;
    photo.categorie = analyse.categorie;
    photo.titre = analyse.titre || photo.titre;
    photo.etat_analyse = "ok";
    photo.erreur_analyse = null;
    await placerSurCarte(photo);
  } catch (e) {
    photo.etat_analyse = "erreur";
    photo.erreur_analyse = e.message;
  }
  await sauvegarder();
  res.status(photo.etat_analyse === "ok" ? 200 : 502).json(photo);
});

app.patch("/api/photos/:id", async (req, res) => {
  const photo = trouver(req.params.id);
  if (!photo) return res.status(404).json({ erreur: "Photo introuvable" });

  const { titre, categorie, voiture, lieu, gps } = req.body ?? {};
  if (typeof titre === "string") photo.titre = titre.trim().slice(0, 120);
  if (CATEGORIES.includes(categorie)) photo.categorie = categorie;
  if (gps === null) {
    photo.gps = null;
    photo.gps_retire = true;
  }
  if (voiture || lieu) {
    photo.analyse ??= { tags: [], description: "", voiture: { presente: false }, lieu: { identifie: false }, animal: { present: false } };
    if (voiture) Object.assign(photo.analyse.voiture, pick(voiture, ["marque", "modele", "generation", "annees"]), { presente: true, confiance: "manuel" });
    if (lieu) {
      Object.assign(photo.analyse.lieu, pick(lieu, ["nom", "ville", "pays"]), { identifie: true, confiance: "manuel" });
      delete photo.gps_retire; // indiquer un lieu = accepter qu'il apparaisse sur la carte
      await placerSurCarte(photo);
    }
  }
  await sauvegarder();
  res.json(photo);
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

// Envoie les changements sur GitHub ; Vercel republie alors le site tout seul.
app.post("/api/publier", async (_req, res) => {
  const opts = { cwd: ici };
  try {
    await git("git", ["add", "-A", "public"], opts);
    const { stdout: modifs } = await git("git", ["diff", "--cached", "--name-only"], opts);
    if (!modifs.trim()) return res.json({ message: "Rien de nouveau à publier." });
    const n = photos.length;
    await git("git", ["commit", "-m", `Galerie : mise à jour (${n} photo${n > 1 ? "s" : ""})`], opts);
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

app.listen(PORT, "127.0.0.1", async () => {
  console.log(`Administration de la galerie : http://localhost:${PORT}`);
  const ia = await etatIA();
  console.log(ia.ok ? `IA locale prête (${MODELE})` : `⚠︎  ${ia.raison}`);

  // Photos déjà analysées mais pas encore sur la carte.
  let placees = 0;
  for (const p of photos.filter((x) => !x.gps)) if (await placerSurCarte(p)) placees++;
  if (placees) {
    await sauvegarder();
    console.log(`${placees} photo${placees > 1 ? "s" : ""} placée${placees > 1 ? "s" : ""} sur la carte d'après le lieu reconnu.`);
  }
});
