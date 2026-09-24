// Galerie : site public (lecture seule) et administration locale, dans un seul script.
// Pages : #/ accueil · #/sorties · #/sortie/<id> · #/garage · #/voiture/<clé> · #/carte · #/photos?q=

const LIBELLES = {
  tous: "Tout",
  voitures: "Voitures",
  paysages: "Paysages",
  villes: "Villes",
  architecture: "Architecture",
  nature: "Nature",
  animaux: "Animaux",
  personnes: "Personnes",
  nourriture: "Nourriture",
  sport: "Sport",
  evenements: "Événements",
  autre: "Autre",
};
const A_RANGER = "_a-ranger";

const etat = {
  photos: [],
  albums: [],
  config: { admin: false, ia: false, modele: "", categories: Object.keys(LIBELLES).filter((c) => c !== "tous") },
  liste: [], // photos de la grille affichée : la visionneuse navigue dedans
  ouverte: null,
  edition: null, // "voiture" | "lieu" | "album" (formulaires ouverts)
};

const $ = (s, racine = document) => racine.querySelector(s);
const el = (html) => {
  const t = document.createElement("template");
  t.innerHTML = html.trim();
  return t.content.firstElementChild;
};
const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);
const sansAccents = (s) => String(s ?? "").normalize("NFD").replace(/\p{Diacritic}/gu, "").toLowerCase();
const slug = (s) => sansAccents(s).replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
const pluriel = (n, mot, motPluriel = `${mot}s`) => `${n} ${n > 1 ? motPluriel : mot}`;
const parDate = (a, b) => (a.prise_le ?? "9").localeCompare(b.prise_le ?? "9");

// --- Données -------------------------------------------------------------------

async function api(url, options = {}) {
  const res = await fetch(url, options);
  if (res.status === 204) return null;
  const data = await res.json().catch(() => ({}));
  if (!res.ok && !data.id) throw new Error(data.erreur || `Erreur ${res.status}`);
  return data;
}

async function recharger() {
  const g = etat.config.admin ? await api("/api/galerie") : await api("/data/galerie.json");
  etat.photos = g.photos ?? [];
  etat.albums = g.albums ?? [];
}

function remplacer(photo) {
  const i = etat.photos.findIndex((p) => p.id === photo.id);
  if (i >= 0) etat.photos[i] = photo;
}

const trouver = (id) => etat.photos.find((p) => p.id === id);
const albumDe = (p) => etat.albums.find((a) => a.id === p?.album) ?? null;
const photosAlbum = (id) => etat.photos.filter((p) => (id === A_RANGER ? !albumDe(p) : p.album === id)).sort(parDate);
const couverture = (album) => trouver(album.couverture) ?? photosAlbum(album.id)[0];
const albumsTries = () => [...etat.albums].filter((a) => a.nb > 0 || etat.config.admin).sort((a, b) => (b.debut ?? "").localeCompare(a.debut ?? ""));

const MOIS = ["janvier", "février", "mars", "avril", "mai", "juin", "juillet", "août", "septembre", "octobre", "novembre", "décembre"];
function periode(debut, fin) {
  if (!debut) return "Date inconnue";
  const a = new Date(debut);
  const b = new Date(fin ?? debut);
  const [ja, ma, aa, jb, mb, ab] = [a.getDate(), a.getMonth(), a.getFullYear(), b.getDate(), b.getMonth(), b.getFullYear()];
  if (aa !== ab) return `${MOIS[ma]} ${aa} – ${MOIS[mb]} ${ab}`;
  if (ma !== mb) return `${ja} ${MOIS[ma]} – ${jb} ${MOIS[mb]} ${aa}`;
  if (ja !== jb) return `${ja} – ${jb} ${MOIS[ma]} ${aa}`;
  return `${ja} ${MOIS[ma]} ${aa}`;
}

// --- Voitures : une « voiture » = marque + modèle, ou le nom que tu lui as donné ------

const voitureDe = (p) => (p.analyse?.voiture?.presente && p.analyse.voiture.marque ? p.analyse.voiture : null);
function cleVoiture(p) {
  const v = voitureDe(p);
  if (!v) return null;
  return v.surnom?.trim() ? `n-${slug(v.surnom)}` : slug(`${v.marque} ${v.modele ?? ""}`);
}
function nomVoiture(p) {
  const v = voitureDe(p);
  return v.surnom?.trim() || [v.marque, v.modele].filter(Boolean).join(" ");
}
function groupesVoitures() {
  const groupes = new Map();
  for (const p of [...etat.photos].sort(parDate)) {
    const cle = cleVoiture(p);
    if (!cle) continue;
    if (!groupes.has(cle)) {
      const v = voitureDe(p);
      groupes.set(cle, { cle, nom: nomVoiture(p), marque: v.marque, modele: v.surnom?.trim() || v.modele || "", photos: [] });
    }
    groupes.get(cle).photos.push(p);
  }
  for (const g of groupes.values()) g.couverture = g.photos.find((p) => p.favori) ?? g.photos[0];
  return groupes;
}
function marques() {
  const parMarque = new Map();
  for (const g of groupesVoitures().values()) {
    if (!parMarque.has(g.marque)) parMarque.set(g.marque, { marque: g.marque, voitures: [], nb: 0 });
    const m = parMarque.get(g.marque);
    m.voitures.push(g);
    m.nb += g.photos.length;
  }
  for (const m of parMarque.values()) {
    m.voitures.sort((a, b) => b.photos.length - a.photos.length || a.nom.localeCompare(b.nom, "fr"));
    m.couverture = m.voitures[0].couverture;
  }
  return [...parMarque.values()].sort((a, b) => b.nb - a.nb);
}

// --- Recherche -----------------------------------------------------------------

function texteRecherche(p) {
  const a = p.analyse ?? {};
  const al = albumDe(p);
  return sansAccents([
    p.titre, LIBELLES[p.categorie], a.description, ...(a.tags ?? []), al?.titre, al?.lieu,
    a.voiture?.marque, a.voiture?.modele, a.voiture?.generation, a.voiture?.couleur, a.voiture?.surnom,
    a.lieu?.nom, a.lieu?.ville, a.lieu?.pays, a.animal?.espece, a.animal?.race, p.appareil,
    etat.config.admin ? p.commentaire : "",
  ].filter(Boolean).join(" "));
}
function rechercher(q, theme = "tous") {
  const mots = sansAccents(q).split(/\s+/).filter(Boolean);
  return etat.photos
    .filter((p) => (theme === "tous" || p.categorie === theme) && mots.every((m) => texteRecherche(p).includes(m)))
    .sort((a, b) => parDate(b, a));
}

// --- Composants ------------------------------------------------------------------

function etiquette(p) {
  if (etat.config.admin) {
    if (p.etat_analyse === "en_cours") return `<span class="etiquette attente"><span class="rond"></span>Analyse…</span>`;
    if (p.etat_analyse === "erreur") return `<span class="etiquette erreur">Analyse échouée</span>`;
    if (p.etat_analyse === "en_attente") return `<span class="etiquette attente">Non analysée</span>`;
  }
  return p.favori ? `<span class="etiquette favori" title="Coup de cœur">★</span>` : "";
}

function sousTitre(p) {
  if (voitureDe(p)) return nomVoiture(p);
  const l = p.analyse?.lieu;
  if (l?.identifie) return [l.nom, l.ville, l.pays].filter(Boolean).slice(0, 2).join(", ");
  return "";
}

function grille(liste, { vide = "Aucune photo ici pour le moment." } = {}) {
  etat.liste = liste;
  if (!liste.length) return el(`<p class="aucun">${esc(vide)}</p>`);
  const g = el(`<div class="grille"></div>`);
  g.append(
    ...liste.map((p) => {
      const st = sousTitre(p);
      const carte = el(`
        <button class="carte-photo" aria-label="${esc(p.titre)}">
          <img src="${p.miniature}" alt="${esc(p.analyse?.description || p.titre)}" loading="lazy" width="${p.largeur}" height="${p.hauteur}">
          ${etiquette(p)}
          <span class="infos"><span class="titre">${esc(p.titre)}</span>${st ? `<span class="sous-titre">${esc(st)}</span>` : ""}</span>
        </button>`);
      carte.onclick = () => ouvrir(p.id, liste);
      return carte;
    }),
  );
  return g;
}

function carteAlbum(album) {
  const siennes = photosAlbum(album.id);
  const cov = couverture(album);
  const autres = siennes.filter((p) => p !== cov).slice(0, 2);
  const mosaique = autres.length === 2;
  return `
    <a class="album-carte" href="#/sortie/${encodeURIComponent(album.id)}">
      <div class="album-images${mosaique ? " mosaique" : ""}">
        ${cov ? `<img src="${cov.miniature}" alt="" loading="lazy">` : `<div class="album-vide">Aucune photo</div>`}
        ${mosaique ? autres.map((p) => `<img src="${p.miniature}" alt="" loading="lazy">`).join("") : ""}
        <span class="album-nb">${pluriel(siennes.length, "photo")}</span>
      </div>
      <div class="album-texte">
        <h3>${esc(album.titre)}</h3>
        <p>${esc(periode(album.debut, album.fin))}${album.lieu ? ` · ${esc(album.lieu)}` : ""}</p>
      </div>
    </a>`;
}

function carteVoiture(g, { avecMarque = false } = {}) {
  return `
    <a class="voiture-carte" href="#/voiture/${encodeURIComponent(g.cle)}">
      <img src="${g.couverture.miniature}" alt="" loading="lazy">
      <div>
        <h3>${esc(avecMarque ? g.nom : g.modele || `${g.marque} (modèle non précisé)`)}</h3>
        <p>${pluriel(g.photos.length, "photo")}</p>
      </div>
    </a>`;
}

function entetePage({ retour, surtitre, titre, meta, description, actions = "" }) {
  return `
    <header class="page-entete">
      ${retour ? `<a class="retour" href="${retour[0]}">← ${esc(retour[1])}</a>` : ""}
      ${surtitre ? `<p class="surtitre">${esc(surtitre)}</p>` : ""}
      <div class="page-titre"><h1>${esc(titre)}</h1>${actions}</div>
      ${meta ? `<p class="page-meta">${meta}</p>` : ""}
      ${description ? `<p class="page-description">${esc(description)}</p>` : ""}
    </header>`;
}

// --- Pages ---------------------------------------------------------------------------

function pageAccueil(page) {
  const albums = albumsTries();
  const lesMarques = marques();
  const favoris = etat.photos.filter((p) => p.favori);
  // Une photo différente à chaque visite : un coup de cœur, sinon la couverture d'une sortie.
  const candidates = favoris.length ? favoris : albums.filter((a) => a.nb).map(couverture).filter(Boolean);
  const heros = candidates[Math.floor(Math.random() * candidates.length)];
  const nbVoitures = [...groupesVoitures().keys()].length;
  const aRanger = photosAlbum(A_RANGER).length;
  const nonAnalysees = etat.photos.filter((p) => p.etat_analyse && p.etat_analyse !== "ok").length;

  page.innerHTML = `
    ${heros ? `
    <section class="heros">
      <img src="${heros.grand}" alt="${esc(heros.analyse?.description || heros.titre)}">
      <div class="heros-texte">
        <p class="surtitre">Photographie · Automobile · Paysages</p>
        <h1>Les photos de Lucas</h1>
        <p class="heros-stats">${pluriel(etat.photos.length, "photo")} · ${pluriel(albums.filter((a) => a.nb).length, "sortie")} · ${pluriel(nbVoitures, "voiture")} de ${pluriel(lesMarques.length, "marque")}</p>
        <div class="heros-actions">
          <a class="bouton principal" href="#/sorties">Voir les sorties</a>
          <a class="bouton verre" href="#/garage">Le garage</a>
        </div>
      </div>
      <button class="heros-legende" data-photo="${heros.id}">${esc(heros.titre)}${albumDe(heros) ? ` — ${esc(albumDe(heros).titre)}` : ""}</button>
    </section>` : `
    <section class="bienvenue">
      <h1>Les photos de Lucas</h1>
      <p>${etat.config.admin ? "Ta galerie est vide. Glisse des photos dans la page ou clique sur « Ajouter »." : "La galerie arrive bientôt."}</p>
    </section>`}

    ${etat.config.admin && (aRanger || nonAnalysees) ? `
    <section class="rappel-admin">
      ${aRanger ? `<a class="bouton" href="#/sortie/${A_RANGER}">📥 ${pluriel(aRanger, "photo")} à ranger dans une sortie</a>` : ""}
      ${nonAnalysees ? `<span>${pluriel(nonAnalysees, "photo non analysée", "photos non analysées")}</span>` : ""}
    </section>` : ""}

    ${albums.length ? `
    <section class="section">
      <div class="section-titre"><h2>Dernières sorties</h2><a href="#/sorties">Toutes les sorties (${albums.length}) →</a></div>
      <div class="albums">${albums.slice(0, 6).map(carteAlbum).join("")}</div>
    </section>` : ""}

    ${lesMarques.length ? `
    <section class="section">
      <div class="section-titre"><h2>Le garage</h2><a href="#/garage">${pluriel(nbVoitures, "voiture")} →</a></div>
      <div class="marques">${lesMarques.slice(0, 8).map((m) => `
        <a class="marque-carte" href="#/garage#${slug(m.marque)}">
          <img src="${m.couverture.miniature}" alt="" loading="lazy">
          <span class="marque-nom">${esc(m.marque)}</span>
          <span class="marque-nb">${pluriel(m.voitures.length, "modèle")} · ${pluriel(m.nb, "photo")}</span>
        </a>`).join("")}
      </div>
    </section>` : ""}

    ${favoris.length ? `
    <section class="section">
      <div class="section-titre"><h2>Coups de cœur</h2></div>
      <div id="grille-favoris"></div>
    </section>` : ""}

    <section class="section">
      <a class="bandeau-carte" href="#/carte">
        <span><strong>La carte</strong> — ${pluriel(albums.filter((a) => a.gps).length, "sortie")} placées, du Nürburgring à Ferrari Land</span>
        <span>Ouvrir →</span>
      </a>
    </section>`;

  if (favoris.length) $("#grille-favoris", page).replaceWith(grille(favoris.slice(0, 12)));
  const legende = $(".heros-legende", page);
  if (legende) legende.onclick = () => ouvrir(legende.dataset.photo, [heros]);
  return "Photos · Lucas Chavanne";
}

function pageSorties(page) {
  const albums = albumsTries();
  const parAnnee = new Map();
  for (const a of albums) {
    const annee = a.debut ? new Date(a.debut).getFullYear() : "Sans date";
    if (!parAnnee.has(annee)) parAnnee.set(annee, []);
    parAnnee.get(annee).push(a);
  }
  const aRanger = photosAlbum(A_RANGER);
  page.innerHTML = `
    ${entetePage({
      titre: "Sorties",
      meta: `${pluriel(albums.length, "sortie")} · ${pluriel(etat.photos.length, "photo")}`,
      actions: etat.config.admin ? `<button class="bouton petit" data-action="nouvelle-sortie">+ Nouvelle sortie</button>` : "",
    })}
    ${etat.config.admin && aRanger.length ? `<div class="section"><div class="albums">${carteAlbum({ id: A_RANGER, titre: "📥 À ranger", lieu: "photos sans sortie", nb: aRanger.length })}</div></div>` : ""}
    <nav class="annees">${[...parAnnee.keys()].map((an) => `<a href="#/sorties" data-annee="${an}">${an}</a>`).join("")}</nav>
    ${[...parAnnee].map(([annee, liste]) => `
      <section class="section" id="annee-${annee}">
        <div class="section-titre"><h2>${annee}</h2><span>${pluriel(liste.length, "sortie")}</span></div>
        <div class="albums">${liste.map(carteAlbum).join("")}</div>
      </section>`).join("")}`;
  page.querySelectorAll("[data-annee]").forEach((a) => {
    a.onclick = (ev) => {
      ev.preventDefault();
      $(`#annee-${a.dataset.annee}`)?.scrollIntoView({ behavior: "smooth" });
    };
  });
  return "Sorties · Photos de Lucas";
}

function pageSortie(page, id) {
  const aRanger = id === A_RANGER;
  const album = aRanger ? { id, titre: "À ranger", lieu: "", description: "Photos qui ne sont dans aucune sortie. Ouvre-les pour choisir leur sortie." } : etat.albums.find((a) => a.id === id);
  if (!album || (aRanger && !etat.config.admin)) return pageIntrouvable(page);
  const siennes = photosAlbum(id);
  const dates = siennes.map((p) => p.prise_le).filter(Boolean).sort();
  const voitures = new Map();
  for (const p of siennes) {
    const cle = cleVoiture(p);
    if (cle) voitures.set(cle, (voitures.get(cle) ?? 0) + 1);
  }
  const groupes = groupesVoitures();
  const index = albumsTries().findIndex((a) => a.id === id);
  const [suivante, precedente] = [albumsTries()[index - 1], albumsTries()[index + 1]];

  const edition = etat.edition === "album" && !aRanger;
  page.innerHTML = `
    ${edition ? `
      <form class="formulaire-album" data-form="album">
        <a class="retour" href="#/sorties">← Sorties</a>
        <label>Nom de la sortie<input name="titre" value="${esc(album.titre)}" required></label>
        <label>Lieu (sert à la placer sur la carte)<input name="lieu" value="${esc(album.lieu)}" placeholder="Ex. : Porsche Museum, Stuttgart"></label>
        <label>Description<textarea name="description" rows="3" placeholder="Quelques mots sur la sortie…">${esc(album.description)}</textarea></label>
        <div class="actions"><button class="bouton principal petit">Enregistrer</button><button type="button" class="bouton petit" data-action="annuler">Annuler</button>
        <span class="espace"></span><button type="button" class="bouton petit danger" data-action="supprimer-sortie">Supprimer la sortie</button></div>
      </form>` : entetePage({
      retour: ["#/sorties", "Sorties"],
      surtitre: aRanger ? "" : periode(dates[0], dates.at(-1)),
      titre: album.titre,
      meta: [album.lieu && `📍 ${esc(album.lieu)}`, pluriel(siennes.length, "photo"), album.gps && `<a href="#/carte?sortie=${encodeURIComponent(id)}">voir sur la carte</a>`].filter(Boolean).join(" · "),
      description: album.description,
      actions: etat.config.admin && !aRanger
        ? `<span class="groupe-boutons"><button class="bouton petit" data-action="ajouter-ici">+ Photos</button><button class="bouton petit" data-action="modifier-sortie">Modifier</button></span>`
        : "",
    })}
    ${voitures.size ? `
      <div class="puces-voitures">
        <span class="puces-titre">Dans cette sortie :</span>
        ${[...voitures].sort((a, b) => b[1] - a[1]).slice(0, 10).map(([cle, n]) => {
          const g = groupes.get(cle);
          return `<a class="puce voiture-puce" href="#/voiture/${encodeURIComponent(cle)}"><img src="${g.couverture.miniature}" alt="">${esc(g.nom)}<span class="n">${n}</span></a>`;
        }).join("")}
        ${voitures.size > 10 ? `<span class="puces-titre">et ${pluriel(voitures.size - 10, "autre")}</span>` : ""}
      </div>` : ""}
    <div id="grille-sortie"></div>
    ${!aRanger && (precedente || suivante) ? `
      <nav class="voisines">
        ${precedente ? `<a href="#/sortie/${encodeURIComponent(precedente.id)}">← ${esc(precedente.titre)}</a>` : "<span></span>"}
        ${suivante ? `<a href="#/sortie/${encodeURIComponent(suivante.id)}">${esc(suivante.titre)} →</a>` : ""}
      </nav>` : ""}`;
  $("#grille-sortie", page).replaceWith(grille(siennes, { vide: "Aucune photo dans cette sortie." }));
  return `${album.titre} · Photos de Lucas`;
}

function pageGarage(page) {
  const lesMarques = marques();
  const total = lesMarques.reduce((n, m) => n + m.voitures.length, 0);
  page.innerHTML = `
    ${entetePage({ titre: "Le garage", meta: `${pluriel(total, "voiture")} · ${pluriel(lesMarques.length, "marque")} · ${pluriel(lesMarques.reduce((n, m) => n + m.nb, 0), "photo")}` })}
    <nav class="annees">${lesMarques.map((m) => `<a href="#/garage" data-marque="${slug(m.marque)}">${esc(m.marque)} <span class="n">${m.voitures.length}</span></a>`).join("")}</nav>
    ${lesMarques.map((m) => `
      <section class="section" id="marque-${slug(m.marque)}">
        <div class="section-titre"><h2>${esc(m.marque)}</h2><span>${pluriel(m.voitures.length, "modèle")} · ${pluriel(m.nb, "photo")}</span></div>
        <div class="voitures">${m.voitures.map((g) => carteVoiture(g)).join("")}</div>
      </section>`).join("")}`;
  const aller = (s) => $(`#marque-${s}`)?.scrollIntoView({ behavior: "smooth" });
  page.querySelectorAll("[data-marque]").forEach((a) => {
    a.onclick = (ev) => {
      ev.preventDefault();
      aller(a.dataset.marque);
    };
  });
  const cible = location.hash.split("#")[2];
  if (cible) requestAnimationFrame(() => aller(cible));
  return "Le garage · Photos de Lucas";
}

function pageVoiture(page, cle) {
  const g = groupesVoitures().get(cle);
  if (!g) return pageIntrouvable(page);
  const v = voitureDe(g.photos[0]);
  const sorties = new Map();
  for (const p of g.photos) {
    const a = albumDe(p);
    if (a) sorties.set(a.id, a);
  }
  const autres = marques().find((m) => m.marque === g.marque)?.voitures.filter((x) => x.cle !== cle) ?? [];
  page.innerHTML = `
    ${entetePage({
      retour: [`#/garage#${slug(g.marque)}`, `Garage · ${g.marque}`],
      surtitre: g.marque,
      titre: g.nom,
      meta: [v.generation, v.annees, pluriel(g.photos.length, "photo")].filter(Boolean).map(esc).join(" · "),
    })}
    ${sorties.size ? `<div class="puces-voitures"><span class="puces-titre">Vue pendant :</span>${[...sorties.values()].map((a) => `<a class="puce" href="#/sortie/${encodeURIComponent(a.id)}">${esc(a.titre)}</a>`).join("")}</div>` : ""}
    <div id="grille-voiture"></div>
    ${autres.length ? `
      <section class="section">
        <div class="section-titre"><h2>Autres ${esc(g.marque)}</h2></div>
        <div class="voitures">${autres.slice(0, 8).map((x) => carteVoiture(x)).join("")}</div>
      </section>` : ""}`;
  $("#grille-voiture", page).replaceWith(grille(g.photos));
  return `${g.nom} · Garage · Photos de Lucas`;
}

let carte;
function pageCarte(page, params) {
  const albums = albumsTries().filter((a) => a.gps && a.nb);
  const libres = etat.photos.filter((p) => p.gps && !albumDe(p)?.gps);
  page.innerHTML = `
    ${entetePage({ titre: "La carte", meta: `${pluriel(albums.length, "sortie")}${libres.length ? ` et ${pluriel(libres.length, "photo")} hors sortie` : ""}` })}
    <div class="carte-page">
      <div id="carte"></div>
      <ol class="carte-liste">${albums.map((a) => `
        <li><button data-album="${esc(a.id)}">
          <img src="${couverture(a)?.miniature}" alt="">
          <span><strong>${esc(a.titre)}</strong><small>${esc(a.lieu)} · ${pluriel(a.nb, "photo")}</small></span>
        </button></li>`).join("")}
      </ol>
    </div>`;

  carte?.remove();
  carte = null;
  if (!window.L) {
    $("#carte", page).textContent = "La carte n'a pas pu se charger (connexion internet requise).";
    return "La carte · Photos de Lucas";
  }
  carte = L.map($("#carte", page), { worldCopyJump: true, scrollWheelZoom: true });
  L.tileLayer("https://tile.openstreetmap.org/{z}/{x}/{y}.png", {
    attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>',
    maxZoom: 19,
  }).addTo(carte);
  const calque = L.featureGroup().addTo(carte);
  const marqueurs = new Map();
  for (const a of albums) {
    const icone = L.divIcon({
      className: "",
      html: `<div class="marqueur-album" style="background-image:url('${couverture(a)?.miniature}')"><span>${a.nb}</span></div>`,
      iconSize: [64, 64],
      iconAnchor: [32, 32],
    });
    const m = L.marker([a.gps.lat, a.gps.lon], { icon: icone, title: a.titre, riseOnHover: true })
      .bindTooltip(`<strong>${esc(a.titre)}</strong><br>${esc(periode(a.debut, a.fin))}`, { direction: "top", offset: [0, -30] })
      .on("click", () => (location.hash = `#/sortie/${encodeURIComponent(a.id)}`))
      .addTo(calque);
    marqueurs.set(a.id, m);
  }
  for (const p of libres) {
    const icone = L.divIcon({ className: "", html: `<div class="marqueur-photo${p.gps.approx ? " approx" : ""}" style="background-image:url('${p.miniature}')"></div>`, iconSize: [46, 46], iconAnchor: [23, 23] });
    L.marker([p.gps.lat, p.gps.lon], { icon: icone, title: p.titre }).on("click", () => ouvrir(p.id, libres)).addTo(calque);
  }
  const focus = params.get("sortie");
  if (focus && marqueurs.has(focus)) carte.setView(marqueurs.get(focus).getLatLng(), 12);
  else if (calque.getLayers().length) carte.fitBounds(calque.getBounds(), { padding: [50, 50], maxZoom: 12 });
  else carte.setView([46.5, 6.5], 6);

  page.querySelectorAll("[data-album]").forEach((b) => {
    const m = marqueurs.get(b.dataset.album);
    b.onmouseenter = () => m?.openTooltip();
    b.onmouseleave = () => m?.closeTooltip();
    b.onclick = () => {
      carte.flyTo(m.getLatLng(), 12, { duration: 0.8 });
      m.openTooltip();
      if (matchMedia("(max-width: 760px)").matches) $("#carte", page).scrollIntoView({ behavior: "smooth" });
    };
  });
  setTimeout(() => carte?.invalidateSize(), 0);
  return "La carte · Photos de Lucas";
}

function pagePhotos(page, params) {
  const q = params.get("q") ?? "";
  const theme = params.get("theme") ?? "tous";
  const compte = { tous: etat.photos.length };
  for (const p of etat.photos) compte[p.categorie] = (compte[p.categorie] ?? 0) + 1;
  const themes = ["tous", ...etat.config.categories.filter((c) => compte[c])];
  const resultats = rechercher(q, theme);
  const lien = (t) => `#/photos?${new URLSearchParams({ ...(q ? { q } : {}), ...(t !== "tous" ? { theme: t } : {}) })}`;
  page.innerHTML = `
    ${entetePage({
      titre: q ? `« ${q} »` : "Toutes les photos",
      meta: q ? `${pluriel(resultats.length, "résultat")}${resultats.length ? "" : " — essaie un autre mot"}` : pluriel(resultats.length, "photo"),
    })}
    <nav class="themes">${themes.map((t) => `<a class="puce${t === theme ? " actif" : ""}" href="${lien(t)}">${LIBELLES[t] ?? t}<span class="n">${compte[t] ?? 0}</span></a>`).join("")}</nav>
    <div id="grille-photos"></div>`;
  $("#grille-photos", page).replaceWith(grille(resultats, { vide: "Aucune photo ne correspond." }));
  return `${q ? `${q} · ` : ""}Toutes les photos · Photos de Lucas`;
}

function pageIntrouvable(page) {
  page.innerHTML = `<section class="bienvenue"><h1>Page introuvable</h1><p>Cette sortie ou cette voiture n'existe pas (ou plus).</p><a class="bouton" href="#/">Retour à l'accueil</a></section>`;
  return "Introuvable · Photos de Lucas";
}

// --- Routeur ----------------------------------------------------------------------

function lireRoute() {
  // Anciens liens partagés : #voiture=bmw-e36
  const ancien = location.hash.match(/^#voiture=(.+)$/);
  if (ancien) history.replaceState(null, "", `#/voiture/${ancien[1]}`);
  const [chemin, qs] = location.hash.replace(/^#\/?/, "").split("#")[0].split("?");
  const [page = "accueil", id] = chemin.split("/").filter(Boolean);
  return { page, id: id && decodeURIComponent(id), params: new URLSearchParams(qs ?? "") };
}

const PAGES = { accueil: pageAccueil, sorties: pageSorties, sortie: pageSortie, garage: pageGarage, voiture: pageVoiture, carte: pageCarte, photos: pagePhotos };

function afficher({ garderDefilement = false } = {}) {
  const { page, id, params } = lireRoute();
  const rendu = PAGES[page] ?? pageIntrouvable;
  const conteneur = $("#page");
  const y = scrollY;
  if (page !== "carte") {
    carte?.remove();
    carte = null;
  }
  document.title = page === "sortie" || page === "voiture" ? rendu(conteneur, id) : rendu(conteneur, params);
  document.querySelectorAll(".menu a").forEach((a) => {
    const actif = a.dataset.page === page || (a.dataset.page === "sorties" && page === "sortie") || (a.dataset.page === "garage" && page === "voiture");
    a.classList.toggle("actif", actif);
    if (actif) a.setAttribute("aria-current", "page");
    else a.removeAttribute("aria-current");
  });
  if (page !== "photos") $("#recherche").value = "";
  else $("#recherche").value = params.get("q") ?? "";
  $("#pied-stats").textContent = `${pluriel(etat.photos.length, "photo")} · ${pluriel(etat.albums.filter((a) => a.nb).length, "sortie")}`;
  scrollTo({ top: garderDefilement ? y : 0 });
}

window.addEventListener("hashchange", () => {
  etat.edition = null;
  if (dialog.open) fermer();
  afficher();
});

$("#form-recherche").onsubmit = (ev) => {
  ev.preventDefault();
  const q = $("#recherche").value.trim();
  location.hash = q ? `#/photos?q=${encodeURIComponent(q)}` : "#/photos";
};

// Actions des pages (admin surtout)
$("#page").addEventListener("click", async (ev) => {
  const cible = ev.target.closest("[data-action]");
  if (!cible) return;
  const { id } = lireRoute();
  switch (cible.dataset.action) {
    case "modifier-sortie":
      etat.edition = "album";
      return afficher({ garderDefilement: true });
    case "annuler":
      etat.edition = null;
      return afficher({ garderDefilement: true });
    case "ajouter-ici":
      etat.albumCible = etat.albums.find((a) => a.id === id)?.titre ?? "";
      return $("#fichiers").click();
    case "nouvelle-sortie": {
      const titre = prompt("Nom de la nouvelle sortie :");
      if (!titre?.trim()) return;
      const lieu = prompt("Lieu (pour la carte), par exemple « Valleiry, France » :") ?? "";
      try {
        const album = await api("/api/albums", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ titre, lieu }) });
        await recharger();
        location.hash = `#/sortie/${encodeURIComponent(album.id)}`;
      } catch (e) {
        toast(e.message, true);
      }
      return;
    }
    case "supprimer-sortie":
      if (!confirm("Supprimer cette sortie ? Ses photos ne sont pas supprimées : elles retournent « à ranger ».")) return;
      await api(`/api/albums/${encodeURIComponent(id)}`, { method: "DELETE" });
      etat.edition = null;
      await recharger();
      location.hash = "#/sorties";
      return;
  }
});

$("#page").addEventListener("submit", async (ev) => {
  if (ev.target.dataset.form !== "album") return;
  ev.preventDefault();
  const { id } = lireRoute();
  try {
    await api(`/api/albums/${encodeURIComponent(id)}`, { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify(Object.fromEntries(new FormData(ev.target))) });
    etat.edition = null;
    await recharger();
    afficher({ garderDefilement: true });
    toast("Sortie enregistrée.");
  } catch (e) {
    toast(e.message, true);
  }
});

// --- Visionneuse ----------------------------------------------------------------------

const dialog = $("#visionneuse");

function ouvrir(id, liste = etat.liste) {
  etat.liste = liste;
  etat.ouverte = id;
  etat.edition = null;
  const p = trouver(id);
  if (!p) return;
  $("#v-img").src = p.grand;
  $("#v-img").alt = p.analyse?.description || p.titre;
  const i = liste.findIndex((x) => x.id === id);
  $("#v-compteur").textContent = liste.length > 1 ? `${i + 1} / ${liste.length}` : "";
  dialog.querySelectorAll(".v-nav").forEach((b) => (b.hidden = liste.length < 2));
  rendrePanneau();
  if (!dialog.open) dialog.showModal();
  // Précharge la suivante pour une navigation instantanée
  const suivante = liste[(i + 1) % liste.length];
  if (suivante) new Image().src = suivante.grand;
}

function naviguer(sens) {
  const liste = etat.liste;
  const i = liste.findIndex((p) => p.id === etat.ouverte);
  if (i < 0 || liste.length < 2) return;
  ouvrir(liste[(i + sens + liste.length) % liste.length].id, liste);
}

function niveauConfiance(c) {
  if (c === "manuel") return `<span class="confiance">Corrigé à la main</span>`;
  const n = { faible: 1, moyenne: 2, elevee: 3 }[c] ?? 0;
  const nom = { faible: "faible", moyenne: "moyenne", elevee: "élevée" }[c] ?? "?";
  return `<span class="confiance">${[1, 2, 3].map((k) => `<i class="${k <= n ? "on" : ""}"></i>`).join("")} confiance ${nom}</span>`;
}

const boutonAdmin = (action, texte) => (etat.config.admin ? `<button class="bouton petit" data-action="${action}">${texte}</button>` : "");

function blocVoiture(p) {
  const v = p.analyse?.voiture;
  if (etat.edition === "voiture") {
    return `<div class="bloc voiture-bloc"><h3>Voiture</h3>
      <form class="formulaire" data-form="voiture">
        <input name="marque" placeholder="Marque" value="${esc(v?.marque)}" required>
        <input name="modele" placeholder="Modèle" value="${esc(v?.modele)}">
        <input name="generation" placeholder="Génération / finition" value="${esc(v?.generation)}">
        <input name="annees" placeholder="Années" value="${esc(v?.annees)}">
        <input name="surnom" placeholder="Nom de la voiture, pour regrouper ses photos (optionnel) : ex. La E36 de Loris" value="${esc(v?.surnom)}">
        <div class="actions"><button class="bouton principal petit">Enregistrer</button><button type="button" class="bouton petit" data-action="annuler">Annuler</button></div>
      </form></div>`;
  }
  if (!v?.presente) return etat.config.admin ? `<div class="bloc"><h3>Voiture ${boutonAdmin("edit-voiture", "Indiquer")}</h3><p class="detail">Aucune voiture reconnue.</p></div>` : "";
  const cle = cleVoiture(p);
  const g = cle && groupesVoitures().get(cle);
  const marqueModele = [v.marque, v.modele].filter(Boolean).join(" ");
  return `<div class="bloc voiture-bloc">
    <h3>Voiture ${boutonAdmin("edit-voiture", "Corriger")}</h3>
    <div class="grand-nom">${esc(v.surnom?.trim() || marqueModele || "Véhicule")}</div>
    <div class="detail">${esc([v.surnom?.trim() && marqueModele, v.generation, v.annees].filter(Boolean).join(" · "))}</div>
    <dl class="fiche">
      ${v.carrosserie ? `<dt>Carrosserie</dt><dd>${esc(v.carrosserie)}</dd>` : ""}
      ${v.couleur ? `<dt>Couleur</dt><dd>${esc(v.couleur)}</dd>` : ""}
    </dl>
    ${etat.config.admin ? niveauConfiance(v.confiance) : ""}
    ${g && g.photos.length > 1 ? `<a class="bouton petit lien-bloc" href="#/voiture/${encodeURIComponent(cle)}">Les ${g.photos.length} photos de cette voiture →</a>` : ""}
  </div>`;
}

function blocSortieEtLieu(p) {
  const album = albumDe(p);
  const l = p.analyse?.lieu;
  if (etat.edition === "lieu") {
    return `<div class="bloc"><h3>Lieu de la photo</h3>
      <form class="formulaire" data-form="lieu">
        <input name="nom" placeholder="Endroit (monument, circuit…)" value="${esc(l?.nom)}">
        <input name="ville" placeholder="Ville" value="${esc(l?.ville)}">
        <input name="pays" placeholder="Pays" value="${esc(l?.pays)}">
        <div class="actions"><button class="bouton principal petit">Enregistrer</button><button type="button" class="bouton petit" data-action="annuler">Annuler</button></div>
      </form></div>`;
  }
  const lieuIA = l?.identifie ? [l.nom, l.ville, l.pays].filter(Boolean).join(", ") : "";
  const choixSortie = etat.config.admin
    ? `<select class="v-select" data-champ="album" aria-label="Sortie">
        <option value="">📥 À ranger (aucune sortie)</option>
        ${albumsTries().map((a) => `<option value="${esc(a.id)}"${a.id === p.album ? " selected" : ""}>${esc(a.titre)}</option>`).join("")}
      </select>`
    : "";
  return `<div class="bloc">
    <h3>Sortie</h3>
    ${album ? `<a class="lien-sortie" href="#/sortie/${encodeURIComponent(album.id)}"><strong>${esc(album.titre)}</strong><span>${esc(periode(album.debut, album.fin))}${album.lieu ? ` · 📍 ${esc(album.lieu)}` : ""}</span></a>` : etat.config.admin ? "" : `<p class="detail">—</p>`}
    ${choixSortie}
    ${(!album?.lieu && lieuIA) || etat.config.admin ? `
      <dl class="fiche">
        ${lieuIA ? `<dt>${album?.lieu ? "Lieu (IA)" : "Lieu"}</dt><dd>${esc(lieuIA)}</dd>` : ""}
        ${p.gps && etat.config.admin ? `<dt>Carte</dt><dd class="mono">${p.gps.lat.toFixed(4)}, ${p.gps.lon.toFixed(4)}${p.gps.approx ? `<span class="approx"> · estimée</span>` : ""}</dd>` : ""}
      </dl>` : ""}
    ${etat.config.admin ? `<div class="groupe-boutons">${boutonAdmin("edit-lieu", "Corriger le lieu")}${p.gps ? boutonAdmin("retirer-gps", "Retirer de la carte") : ""}</div>` : ""}
  </div>`;
}

function rendrePanneau() {
  const p = trouver(etat.ouverte);
  if (!p) return fermer();
  const a = p.analyse;
  const date = p.prise_le ? new Date(p.prise_le).toLocaleDateString("fr-FR", { weekday: "long", day: "numeric", month: "long", year: "numeric" }) : null;
  const album = albumDe(p);
  const admin = etat.config.admin;

  $("#v-panneau").innerHTML = `
    ${admin
      ? `<h2 contenteditable="plaintext-only" spellcheck="false" data-champ="titre">${esc(p.titre)}</h2>
         <div class="ligne-outils">
           <select class="v-select" data-champ="categorie" aria-label="Thème">
             ${etat.config.categories.map((c) => `<option value="${c}"${c === p.categorie ? " selected" : ""}>${LIBELLES[c] ?? c}</option>`).join("")}
           </select>
           <button class="bouton petit${p.favori ? " actif-favori" : ""}" data-action="favori" aria-pressed="${p.favori}">${p.favori ? "★ Coup de cœur" : "☆ Coup de cœur"}</button>
           ${album ? `<button class="bouton petit" data-action="couverture"${album.couverture === p.id ? " disabled" : ""}>${album.couverture === p.id ? "Couverture ✓" : "Couverture de la sortie"}</button>` : ""}
         </div>`
      : `<h2>${esc(p.titre)}</h2><a class="theme-lu" href="#/photos?theme=${p.categorie}">${LIBELLES[p.categorie] ?? p.categorie}</a>`}
    ${a?.description ? `<p class="desc">${esc(a.description)}</p>` : ""}

    ${p.etat_analyse === "en_cours" ? `<div class="chargement"><span class="rond"></span>L'IA analyse la photo…</div>` : ""}
    ${p.etat_analyse === "erreur" ? `<div class="alerte">${esc(p.erreur_analyse)}</div>` : ""}

    ${blocSortieEtLieu(p)}
    ${blocVoiture(p)}
    ${a?.animal?.present ? `<div class="bloc"><h3>Animal</h3><div class="detail" style="color:var(--texte);font-size:16px">${esc([a.animal.espece, a.animal.race].filter(Boolean).join(" · "))}</div></div>` : ""}

    ${a?.tags?.length ? `<div class="bloc"><h3>Mots-clés</h3><div class="tags">${a.tags.map((t) => `<a href="#/photos?q=${encodeURIComponent(t)}">${esc(t)}</a>`).join("")}</div></div>` : ""}

    <div class="bloc"><h3>Prise de vue</h3>
      <dl class="fiche">
        ${date ? `<dt>Date</dt><dd>${date}</dd>` : ""}
        ${p.appareil ? `<dt>Appareil</dt><dd>${esc(p.appareil)}</dd>` : ""}
        <dt>Taille</dt><dd class="mono">${p.largeur} × ${p.hauteur}</dd>
        ${admin ? `<dt>Fichier</dt><dd class="mono">${esc(p.nom_fichier)}</dd>` : ""}
      </dl>
    </div>

    ${admin ? `<div class="bloc commentaire">
      <h3>Ton commentaire pour l'IA</h3>
      <textarea data-champ="commentaire" rows="2" placeholder="Ex. : BMW M3 E46 au col du Stelvio">${esc(p.commentaire ?? "")}</textarea>
      <p class="aide">Privé : il n'est jamais publié. L'IA le prend pour une info sûre, avec le nom de la sortie.</p>
    </div>
    <div class="actions-bas">
      <button class="bouton petit" data-action="analyser"${p.etat_analyse === "en_cours" || !etat.config.ia ? " disabled" : ""}>
        <svg viewBox="0 0 24 24"><path d="M12 3v3M12 18v3M3 12h3M18 12h3M5.6 5.6l2.1 2.1M16.3 16.3l2.1 2.1M5.6 18.4l2.1-2.1M16.3 7.7l2.1-2.1"/></svg>
        ${a ? "Ré-analyser" : "Analyser avec l'IA"}
      </button>
      <button class="bouton petit danger" data-action="supprimer">Supprimer</button>
    </div>
    ${a?.modele_ia ? `<p class="mono" style="color:var(--texte-pale);margin-top:18px">Analysé par ${esc(a.modele_ia ?? p.modele_ia)}</p>` : ""}` : ""}
  `;
}

function fermer() {
  etat.ouverte = null;
  if (dialog.open) dialog.close();
}

async function modifier(id, changements) {
  try {
    remplacer(await api(`/api/photos/${id}`, { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify(changements) }));
    if ("album" in changements || "favori" in changements) await recharger();
  } catch (e) {
    toast(e.message, true);
  }
  rafraichir();
}

// Après un changement : on redessine la page sans perdre la position, et la visionneuse si ouverte.
function rafraichir() {
  const ouverte = etat.ouverte;
  const liste = etat.liste;
  afficher({ garderDefilement: true });
  if (ouverte && dialog.open) {
    etat.ouverte = ouverte;
    etat.liste = liste.map((p) => trouver(p.id)).filter(Boolean);
    rendrePanneau();
  }
}

$("#v-panneau").addEventListener("click", async (ev) => {
  if (ev.target.closest("a[href^='#']")) return fermer();
  const cible = ev.target.closest("[data-action]");
  if (!cible) return;
  const id = etat.ouverte;
  const p = trouver(id);
  switch (cible.dataset.action) {
    case "analyser": {
      const texte = $('#v-panneau [data-champ="commentaire"]')?.value.trim() ?? "";
      if (p && texte !== (p.commentaire ?? "")) await modifier(id, { commentaire: texte });
      return analyser(id);
    }
    case "favori":
      return modifier(id, { favori: !p.favori });
    case "couverture":
      await api(`/api/albums/${encodeURIComponent(p.album)}`, { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ couverture: id }) });
      await recharger();
      toast("Couverture de la sortie changée.");
      return rafraichir();
    case "edit-voiture": etat.edition = "voiture"; return rendrePanneau();
    case "edit-lieu": etat.edition = "lieu"; return rendrePanneau();
    case "retirer-gps": return modifier(id, { gps: null });
    case "annuler": etat.edition = null; return rendrePanneau();
    case "supprimer":
      if (!confirm("Supprimer définitivement cette photo ?")) return;
      await api(`/api/photos/${id}`, { method: "DELETE" });
      naviguer(1);
      etat.photos = etat.photos.filter((x) => x.id !== id);
      etat.liste = etat.liste.filter((x) => x.id !== id);
      await recharger();
      if (!etat.liste.length) fermer();
      return rafraichir();
  }
});

$("#v-panneau").addEventListener("submit", (ev) => {
  ev.preventDefault();
  const form = ev.target;
  const valeurs = Object.fromEntries(new FormData(form));
  etat.edition = null;
  modifier(etat.ouverte, form.dataset.form === "voiture" ? { voiture: valeurs, categorie: "voitures" } : { lieu: valeurs });
});

$("#v-panneau").addEventListener("change", (ev) => {
  const champ = ev.target.dataset.champ;
  if (champ === "categorie") modifier(etat.ouverte, { categorie: ev.target.value });
  if (champ === "album") modifier(etat.ouverte, { album: ev.target.value || null });
});

$("#v-panneau").addEventListener("focusout", (ev) => {
  if (ev.target.dataset.champ !== "titre") return;
  const titre = ev.target.textContent.trim();
  const p = trouver(etat.ouverte);
  if (titre && p && titre !== p.titre) modifier(p.id, { titre });
});

$("#v-panneau").addEventListener("keydown", (ev) => {
  if (ev.target.dataset.champ === "titre" && ev.key === "Enter") {
    ev.preventDefault();
    ev.target.blur();
  }
});

dialog.addEventListener("click", (ev) => {
  const nav = ev.target.closest("[data-nav]");
  if (nav) naviguer(Number(nav.dataset.nav));
});
$("#v-fermer").onclick = fermer;
dialog.addEventListener("close", () => (etat.ouverte = null));
document.addEventListener("keydown", (ev) => {
  if (!dialog.open || ev.target.closest("input, textarea, [contenteditable], select")) return;
  if (ev.key === "ArrowLeft") naviguer(-1);
  if (ev.key === "ArrowRight") naviguer(1);
});
// Balayage gauche/droite sur mobile
let debutToucher = null;
$(".v-image").addEventListener("touchstart", (ev) => (debutToucher = ev.touches[0].clientX), { passive: true });
$(".v-image").addEventListener("touchend", (ev) => {
  if (debutToucher === null) return;
  const dx = ev.changedTouches[0].clientX - debutToucher;
  if (Math.abs(dx) > 50) naviguer(dx < 0 ? 1 : -1);
  debutToucher = null;
});

// --- Envoi & analyse (admin) ------------------------------------------------------------

function toast(message, erreur = false, duree = 4500) {
  const t = el(`<div class="toast${erreur ? " erreur" : ""}"></div>`);
  t.textContent = message;
  $("#toasts").append(t);
  if (duree) setTimeout(() => t.remove(), duree);
  return t;
}

async function analyser(id) {
  const p = trouver(id);
  if (!p) return;
  p.etat_analyse = "en_cours";
  rafraichir();
  try {
    remplacer(await api(`/api/photos/${id}/analyse`, { method: "POST" }));
  } catch (e) {
    p.etat_analyse = "erreur";
    p.erreur_analyse = e.message;
  }
  rafraichir();
}

// Avant l'envoi : la sortie, et un commentaire par photo que l'IA prendra pour une info sûre.
function preparer(images) {
  const dlg = $("#preparation");
  const urls = images.map((f) => URL.createObjectURL(f));
  $("#liste-albums").replaceChildren(...albumsTries().map((a) => el(`<option value="${esc(a.titre)}"></option>`)));
  const champAlbum = $("#prep-album");
  champAlbum.value = etat.albumCible ?? "";
  etat.albumCible = null;
  const majLieu = () => {
    const nom = champAlbum.value.trim();
    $("#prep-lieu-champ").hidden = !nom || etat.albums.some((a) => slug(a.titre) === slug(nom));
  };
  champAlbum.oninput = majLieu;
  majLieu();
  $("#prep-album-lieu").value = "";

  $("#prep-liste").replaceChildren(
    ...images.map((f, i) => el(`
      <li>
        <img src="${urls[i]}" alt="">
        <label><span class="nom">${esc(f.name)}</span>
          <textarea rows="2" placeholder="Ex. : Porsche 911 GT3 RS de Marc"></textarea>
        </label>
      </li>`)),
  );
  $("#prep-copier").hidden = images.length < 2;
  $("#prep-valider").textContent = etat.config.ia ? "Ajouter et analyser" : "Ajouter";

  return new Promise((resolve) => {
    const champs = () => [...$("#prep-liste").querySelectorAll("textarea")];
    const fin = (valeur) => {
      urls.forEach(URL.revokeObjectURL);
      dlg.onclose = null;
      if (dlg.open) dlg.close();
      resolve(valeur);
    };
    $("#prep-copier").onclick = () => {
      const [premier, ...autres] = champs();
      autres.forEach((t) => {
        if (!t.value.trim()) t.value = premier.value;
      });
    };
    $("#prep-annuler").onclick = () => fin(null);
    dlg.onclose = () => fin(null); // touche Échap
    $("#prep-form").onsubmit = (ev) => {
      ev.preventDefault();
      const nom = champAlbum.value.trim();
      const existant = etat.albums.find((a) => slug(a.titre) === slug(nom));
      fin({
        album: existant?.id ?? nom,
        albumLieu: existant ? "" : $("#prep-album-lieu").value.trim(),
        commentaires: champs().map((t) => t.value.trim()),
      });
    };
    $("#prep-liste").onkeydown = (ev) => {
      if (ev.key === "Enter" && (ev.metaKey || ev.ctrlKey)) $("#prep-form").requestSubmit();
    };
    dlg.showModal();
    (champAlbum.value ? champs()[0] : champAlbum)?.focus();
  });
}

async function envoyer(fichiers) {
  const images = [...fichiers].filter((f) => f.type.startsWith("image/") || /\.(heic|heif)$/i.test(f.name));
  if (!images.length) return;
  const choix = await preparer(images);
  if (!choix) return;
  const suivi = toast(`Envoi de ${pluriel(images.length, "photo")}…`, false, 0);

  const form = new FormData();
  images.forEach((f) => form.append("photos", f));
  form.append("commentaires", JSON.stringify(choix.commentaires));
  form.append("album", choix.album);
  form.append("album_lieu", choix.albumLieu);
  let resultat;
  try {
    resultat = await api("/api/photos", { method: "POST", body: form });
  } catch (e) {
    suivi.remove();
    return toast(e.message, true);
  }
  suivi.remove();
  resultat.erreurs?.forEach((m) => toast(m, true, 8000));
  await recharger();
  const albumId = resultat.ajoutees[0]?.album;
  location.hash = albumId ? `#/sortie/${encodeURIComponent(albumId)}` : `#/sortie/${A_RANGER}`;
  afficher();

  if (!etat.config.ia) {
    if (resultat.ajoutees.length) toast(`Photos ajoutées sans analyse. ${etat.config.raison_ia ?? ""}`, true, 8000);
    return;
  }
  // L'IA tourne sur le Mac : une photo à la fois.
  for (const p of resultat.ajoutees) await analyser(p.id);
  await recharger();
  rafraichir();
  toast(`${pluriel(resultat.ajoutees.length, "photo analysée", "photos analysées")}.`);
}

$("#btn-ajouter").onclick = () => {
  const { page, id } = lireRoute();
  etat.albumCible = page === "sortie" ? etat.albums.find((a) => a.id === id)?.titre ?? "" : "";
  $("#fichiers").click();
};
$("#fichiers").onchange = (ev) => {
  envoyer(ev.target.files);
  ev.target.value = "";
};

let profondeur = 0;
const aDesFichiers = (ev) => etat.config.admin && ev.dataTransfer?.types?.includes("Files");
document.addEventListener("dragenter", (ev) => {
  if (!aDesFichiers(ev)) return;
  profondeur++;
  $("#depot").hidden = false;
});
document.addEventListener("dragleave", (ev) => {
  if (aDesFichiers(ev) && --profondeur <= 0) {
    profondeur = 0;
    $("#depot").hidden = true;
  }
});
document.addEventListener("dragover", (ev) => {
  if (aDesFichiers(ev)) ev.preventDefault();
});
document.addEventListener("drop", (ev) => {
  if (!aDesFichiers(ev)) return;
  ev.preventDefault();
  profondeur = 0;
  $("#depot").hidden = true;
  const { page, id } = lireRoute();
  etat.albumCible = page === "sortie" ? etat.albums.find((a) => a.id === id)?.titre ?? "" : "";
  envoyer(ev.dataTransfer.files);
});

async function publier() {
  const bouton = $("#btn-publier");
  bouton.disabled = true;
  const suivi = toast("Envoi sur GitHub…", false, 0);
  try {
    const { message } = await api("/api/publier", { method: "POST" });
    toast(message);
  } catch (e) {
    toast(e.message, true, 10000);
  }
  suivi.remove();
  bouton.disabled = false;
}

// Une image qui n'a pas pu se charger (serveur redémarré, réseau coupé…) réessaie toute seule,
// au lieu de garder l'icône d'image cassée jusqu'au prochain rechargement de la page.
document.addEventListener(
  "error",
  (ev) => {
    const img = ev.target;
    if (!(img instanceof HTMLImageElement) || !img.src || Number(img.dataset.essais ?? 0) >= 5) return;
    img.dataset.essais = Number(img.dataset.essais ?? 0) + 1;
    const url = new URL(img.src);
    url.searchParams.set("r", img.dataset.essais);
    setTimeout(() => (img.src = url.href), 1500 * img.dataset.essais);
  },
  true,
);

// --- Démarrage : admin en local, lecture seule sur le site public ----------------------

try {
  etat.config = await api("/api/config");
  document.body.classList.add("admin");
  $("#btn-publier").onclick = publier;
} catch {
  // site public
}
try {
  await recharger();
} catch {
  toast("Impossible de charger la galerie.", true, 0);
}
afficher();
