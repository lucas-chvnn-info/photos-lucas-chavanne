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

const etat = {
  photos: [],
  config: { admin: false, ia: false, modele: "", categories: Object.keys(LIBELLES).filter((c) => c !== "tous") },
  theme: "tous",
  voiture: null, // clé de la voiture affichée (toutes ses photos)
  recherche: "",
  vue: "galerie",
  ouverte: null, // id de la photo dans la visionneuse
  edition: null, // "voiture" | "lieu"
};

const $ = (s) => document.querySelector(s);
const el = (html) => {
  const t = document.createElement("template");
  t.innerHTML = html.trim();
  return t.content.firstElementChild;
};
const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);

// --- Données --------------------------------------------------------------

async function api(url, options = {}) {
  const res = await fetch(url, options);
  if (res.status === 204) return null;
  const data = await res.json().catch(() => ({}));
  if (!res.ok && !data.id) throw new Error(data.erreur || `Erreur ${res.status}`);
  return data;
}

function remplacer(photo) {
  const i = etat.photos.findIndex((p) => p.id === photo.id);
  if (i >= 0) etat.photos[i] = photo;
}

const voitureDe = (p) => (p.analyse?.voiture?.presente && p.analyse.voiture.marque ? p.analyse.voiture : null);

// Une « voiture » regroupe ses photos : par nom si tu lui en as donné un (pour séparer deux voitures
// du même modèle), sinon par marque + modèle.
const slug = (s) => String(s ?? "").normalize("NFD").replace(/\p{Diacritic}/gu, "").toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
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
  for (const p of etat.photos) {
    const cle = cleVoiture(p);
    if (!cle) continue;
    if (!groupes.has(cle)) groupes.set(cle, { cle, nom: nomVoiture(p), photos: [] });
    groupes.get(cle).photos.push(p);
  }
  return groupes;
}

function choisirVoiture(cle) {
  etat.voiture = cle;
  if (cle) etat.theme = "voitures";
  try {
    history.replaceState(null, "", cle ? `#voiture=${cle}` : location.pathname + location.search);
  } catch {}
  rendre();
  if (cle) scrollTo({ top: 0, behavior: "smooth" });
}
const lieuDe = (p) => (p.analyse?.lieu?.identifie ? p.analyse.lieu : null);

function sousTitre(p) {
  const v = voitureDe(p);
  if (v) return [v.marque, v.modele].filter(Boolean).join(" ");
  const l = lieuDe(p);
  if (l) return [l.nom, l.ville, l.pays].filter(Boolean).slice(0, 2).join(", ");
  if (p.analyse?.animal?.present) return [p.analyse.animal.espece, p.analyse.animal.race].filter(Boolean).join(" · ");
  return "";
}

function texteRecherche(p) {
  const a = p.analyse ?? {};
  return [
    p.titre, p.nom_fichier, LIBELLES[p.categorie], a.description, ...(a.tags ?? []),
    a.voiture?.marque, a.voiture?.modele, a.voiture?.generation, a.voiture?.couleur,
    a.lieu?.nom, a.lieu?.ville, a.lieu?.pays, a.animal?.espece, a.animal?.race, p.appareil,
  ].filter(Boolean).join(" ").normalize("NFD").replace(/\p{Diacritic}/gu, "").toLowerCase();
}

function photosFiltrees() {
  const q = etat.recherche.normalize("NFD").replace(/\p{Diacritic}/gu, "").toLowerCase().trim();
  return etat.photos.filter((p) => {
    if (etat.voiture) {
      if (cleVoiture(p) !== etat.voiture) return false;
    } else if (etat.theme !== "tous" && p.categorie !== etat.theme) return false;
    if (q && !q.split(/\s+/).every((mot) => texteRecherche(p).includes(mot))) return false;
    return true;
  });
}

// --- Rendu ----------------------------------------------------------------

function rendreStatut() {
  const n = etat.photos.length;
  const avecGps = etat.photos.filter((p) => p.gps).length;
  let texte = `${n} photo${n > 1 ? "s" : ""} · ${avecGps} sur la carte`;
  if (etat.config.admin) {
    texte += etat.config.ia
      ? ` · IA locale : ${esc(etat.config.modele)}`
      : ` · <span class="ia-off">IA indisponible : ${esc(etat.config.raison_ia)}</span>`;
  }
  $("#statut").innerHTML = texte;
}

function rendreThemes() {
  const compte = { tous: etat.photos.length };
  for (const p of etat.photos) compte[p.categorie] = (compte[p.categorie] ?? 0) + 1;

  const cles = ["tous", ...etat.config.categories.filter((c) => compte[c] || c === etat.theme)];
  $("#themes").replaceChildren(
    ...cles.map((c) => {
      const b = el(`<button class="puce${c === etat.theme ? " actif" : ""}">${LIBELLES[c] ?? c}<span class="n">${compte[c] ?? 0}</span></button>`);
      b.onclick = () => { etat.theme = c; choisirVoiture(null); };
      return b;
    }),
  );

  // Dans « Voitures » : une pastille par voiture, avec sa miniature.
  const groupes = [...groupesVoitures().values()].sort((a, b) => a.nom.localeCompare(b.nom, "fr"));
  const zone = $("#marques");
  zone.hidden = etat.theme !== "voitures" || !groupes.length;
  zone.replaceChildren(
    ...[{ cle: null, nom: "Toutes les voitures" }, ...groupes].map((g) => {
      const b = el(`<button class="puce voiture-puce${g.cle === etat.voiture ? " actif" : ""}">
        ${g.photos ? `<img src="${g.photos[0].miniature}" alt="">` : ""}${esc(g.nom)}${g.photos ? `<span class="n">${g.photos.length}</span>` : ""}
      </button>`);
      b.onclick = () => choisirVoiture(g.cle);
      return b;
    }),
  );
}

function etiquette(p) {
  if (!etat.config.admin) {
    const v = voitureDe(p);
    return v && p.categorie === "voitures"
      ? `<span class="etiquette voiture">${esc(v.marque)}</span>`
      : `<span class="etiquette">${LIBELLES[p.categorie] ?? p.categorie}</span>`;
  }
  if (p.etat_analyse === "en_cours") return `<span class="etiquette attente"><span class="rond"></span>Analyse…</span>`;
  if (p.etat_analyse === "erreur") return `<span class="etiquette erreur">Analyse échouée</span>`;
  if (p.etat_analyse === "en_attente") return `<span class="etiquette attente">Non analysée</span>`;
  const v = voitureDe(p);
  if (v && p.categorie === "voitures") return `<span class="etiquette voiture">${esc(v.marque)}</span>`;
  return `<span class="etiquette">${LIBELLES[p.categorie] ?? p.categorie}</span>`;
}

function rendreGrille() {
  const liste = photosFiltrees();
  $("#vide").hidden = etat.photos.length > 0 || !etat.config.admin;
  $("#aucun").textContent = etat.photos.length ? "Aucune photo ne correspond." : "Aucune photo pour le moment.";
  $("#aucun").hidden = liste.length > 0 || !$("#vide").hidden;
  $("#grille").replaceChildren(
    ...liste.map((p) => {
      const st = sousTitre(p);
      const carte = el(`
        <button class="carte-photo" aria-label="${esc(p.titre)}">
          <img src="${p.miniature}" alt="${esc(p.analyse?.description || p.titre)}" loading="lazy" width="${p.largeur}" height="${p.hauteur}">
          ${etiquette(p)}
          <span class="infos"><span class="titre">${esc(p.titre)}</span>${st ? `<span class="sous-titre">${esc(st)}</span>` : ""}</span>
        </button>`);
      carte.onclick = () => ouvrir(p.id);
      return carte;
    }),
  );
}

function rendre() {
  rendreStatut();
  rendreThemes();
  rendreGrille();
  if (etat.vue === "carte") rendreCarte();
  if (etat.ouverte) rendrePanneau();
}

// --- Carte ----------------------------------------------------------------

let carte, calque;
function rendreCarte() {
  if (!window.L) {
    $("#note-carte").textContent = "La carte n'a pas pu se charger (connexion internet requise).";
    return;
  }
  if (!carte) {
    carte = L.map("carte", { worldCopyJump: true }).setView([46.5, 2.5], 5);
    L.tileLayer("https://tile.openstreetmap.org/{z}/{x}/{y}.png", {
      attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>',
      maxZoom: 19,
    }).addTo(carte);
    calque = L.featureGroup().addTo(carte);
  }
  calque.clearLayers();
  const liste = photosFiltrees().filter((p) => p.gps);
  for (const p of liste) {
    const icone = L.divIcon({ className: "", html: `<div class="marqueur-photo${p.gps.approx ? " approx" : ""}" style="background-image:url('${p.miniature}')"></div>`, iconSize: [54, 54], iconAnchor: [27, 27] });
    L.marker([p.gps.lat, p.gps.lon], { icon: icone, title: p.titre }).on("click", () => ouvrir(p.id)).addTo(calque);
  }
  if (liste.length) carte.fitBounds(calque.getBounds(), { padding: [60, 60], maxZoom: 13 });
  const sans = photosFiltrees().length - liste.length;
  $("#note-carte").textContent = sans
    ? `${sans} photo${sans > 1 ? "s" : ""} sans position : ni GPS dans le fichier, ni lieu reconnu.${etat.config.admin ? " Indique le lieu dans la fiche de la photo pour la placer." : ""}`
    : "";
  setTimeout(() => carte.invalidateSize(), 0);
}

function changerVue(vue) {
  etat.vue = vue;
  document.querySelectorAll(".vue").forEach((b) => {
    b.classList.toggle("actif", b.dataset.vue === vue);
    b.setAttribute("aria-selected", b.dataset.vue === vue);
  });
  $("#vue-galerie").hidden = vue !== "galerie";
  $("#vue-carte").hidden = vue !== "carte";
  if (vue === "carte") rendreCarte();
}

// --- Visionneuse ----------------------------------------------------------

const dialog = $("#visionneuse");

function ouvrir(id) {
  etat.ouverte = id;
  etat.edition = null;
  const p = etat.photos.find((x) => x.id === id);
  $("#v-img").src = p.grand;
  $("#v-img").alt = p.analyse?.description || p.titre;
  rendrePanneau();
  if (!dialog.open) dialog.showModal();
}

function naviguer(sens) {
  const liste = photosFiltrees();
  const i = liste.findIndex((p) => p.id === etat.ouverte);
  if (i < 0 || liste.length < 2) return;
  ouvrir(liste[(i + sens + liste.length) % liste.length].id);
}

const boutonAdmin = (action, texte) => (etat.config.admin ? `<button class="bouton petit" data-action="${action}">${texte}</button>` : "");

function niveauConfiance(c) {
  if (c === "manuel") return `<span class="confiance">Corrigé à la main</span>`;
  const n = { faible: 1, moyenne: 2, elevee: 3 }[c] ?? 0;
  const nom = { faible: "faible", moyenne: "moyenne", elevee: "élevée" }[c] ?? "?";
  return `<span class="confiance">${[1, 2, 3].map((k) => `<i class="${k <= n ? "on" : ""}"></i>`).join("")} confiance ${nom}</span>`;
}

function blocVoiture(p) {
  const v = p.analyse?.voiture;
  if (etat.edition === "voiture") {
    return `<div class="bloc voiture-bloc"><h3>Voiture</h3>
      <form class="formulaire" data-form="voiture">
        <input name="marque" placeholder="Marque" value="${esc(v?.marque)}" required>
        <input name="modele" placeholder="Modèle" value="${esc(v?.modele)}">
        <input name="generation" placeholder="Génération / finition" value="${esc(v?.generation)}">
        <input name="annees" placeholder="Années" value="${esc(v?.annees)}">
        <input name="surnom" placeholder="Nom de la voiture, pour regrouper ses photos (optionnel) : ex. Ma E36 rouge" value="${esc(v?.surnom)}">
        <div class="actions"><button class="bouton principal petit">Enregistrer</button><button type="button" class="bouton petit" data-action="annuler">Annuler</button></div>
      </form></div>`;
  }
  if (!v?.presente) return "";
  const cle = cleVoiture(p);
  const nb = cle ? groupesVoitures().get(cle).photos.length : 0;
  const lien = nb > 1 && etat.voiture !== cle
    ? `<button class="bouton petit voir-voiture" data-voiture="${cle}">Voir les ${nb} photos de cette voiture →</button>`
    : "";
  const marqueModele = [v.marque, v.modele].filter(Boolean).join(" ");
  return `<div class="bloc voiture-bloc">
    <h3>Voiture identifiée ${boutonAdmin("edit-voiture", "Corriger")}</h3>
    <div class="grand-nom">${esc(v.surnom?.trim() || marqueModele || "Véhicule")}</div>
    <div class="detail">${esc([v.surnom?.trim() && marqueModele, v.generation, v.annees].filter(Boolean).join(" · "))}</div>
    ${lien}
    <dl class="fiche">
      ${v.carrosserie ? `<dt>Carrosserie</dt><dd>${esc(v.carrosserie)}</dd>` : ""}
      ${v.couleur ? `<dt>Couleur</dt><dd>${esc(v.couleur)}</dd>` : ""}
    </dl>
    ${niveauConfiance(v.confiance)}
    ${v.indices ? `<p class="indices">${esc(v.indices)}</p>` : ""}
  </div>`;
}

function blocLieu(p) {
  const l = p.analyse?.lieu;
  if (etat.edition === "lieu") {
    return `<div class="bloc"><h3>Lieu</h3>
      <form class="formulaire" data-form="lieu">
        <input name="nom" placeholder="Endroit (monument, plage…)" value="${esc(l?.nom)}">
        <input name="ville" placeholder="Ville" value="${esc(l?.ville)}">
        <input name="pays" placeholder="Pays" value="${esc(l?.pays)}">
        <div class="actions"><button class="bouton principal petit">Enregistrer</button><button type="button" class="bouton petit" data-action="annuler">Annuler</button></div>
      </form></div>`;
  }
  const gps = p.gps
    ? `<dt>${p.gps.approx ? "Carte" : "GPS"}</dt><dd class="mono"><a href="https://www.openstreetmap.org/?mlat=${p.gps.lat}&mlon=${p.gps.lon}#map=15/${p.gps.lat}/${p.gps.lon}" target="_blank" rel="noopener">${p.gps.lat.toFixed(4)}, ${p.gps.lon.toFixed(4)}</a>${p.gps.approx ? `<span class="approx"> · position estimée d'après le lieu</span>` : ""}</dd>`
    : "";
  if (!l?.identifie && !gps) {
    if (!etat.config.admin) return "";
    return `<div class="bloc"><h3>Lieu ${boutonAdmin("edit-lieu", "Indiquer")}</h3><p class="detail">Lieu inconnu.</p></div>`;
  }
  return `<div class="bloc">
    <h3>Lieu ${boutonAdmin("edit-lieu", "Corriger")}</h3>
    ${l?.identifie ? `<div class="grand-nom" style="font-size:18px;font-weight:700">${esc(l.nom || l.ville || l.pays)}</div>
    <div class="detail">${esc([l.nom && l.ville, l.pays].filter(Boolean).join(", "))}</div>` : ""}
    <dl class="fiche">${gps}</dl>
    ${gps && etat.config.admin ? `<button class="bouton petit" style="margin-top:10px" data-action="retirer-gps">Retirer de la carte</button>` : ""}
    ${l?.identifie ? niveauConfiance(l.confiance) : ""}
    ${l?.indices ? `<p class="indices">${esc(l.indices)}</p>` : ""}
  </div>`;
}

function rendrePanneau() {
  const p = etat.photos.find((x) => x.id === etat.ouverte);
  if (!p) return fermer();
  const a = p.analyse;
  const date = p.prise_le ? new Date(p.prise_le).toLocaleDateString("fr-FR", { day: "numeric", month: "long", year: "numeric" }) : null;

  $("#v-panneau").innerHTML = `
    ${etat.config.admin
      ? `<h2 contenteditable="plaintext-only" spellcheck="false" data-champ="titre">${esc(p.titre)}</h2>
    <select class="v-select" data-champ="categorie" aria-label="Thème">
      ${etat.config.categories.map((c) => `<option value="${c}"${c === p.categorie ? " selected" : ""}>${LIBELLES[c] ?? c}</option>`).join("")}
    </select>`
      : `<h2>${esc(p.titre)}</h2><span class="theme-lu">${LIBELLES[p.categorie] ?? p.categorie}</span>`}
    ${a?.description ? `<p class="desc">${esc(a.description)}</p>` : ""}

    ${p.etat_analyse === "en_cours" ? `<div class="chargement"><span class="rond"></span>L'IA analyse la photo…</div>` : ""}
    ${p.etat_analyse === "erreur" ? `<div class="alerte">${esc(p.erreur_analyse)}</div>` : ""}

    ${blocVoiture(p)}
    ${a?.animal?.present ? `<div class="bloc"><h3>Animal</h3><div class="detail" style="color:var(--texte);font-size:16px">${esc([a.animal.espece, a.animal.race].filter(Boolean).join(" · "))}</div></div>` : ""}
    ${blocLieu(p)}

    ${a?.tags?.length ? `<div class="bloc"><h3>Mots-clés</h3><div class="tags">${a.tags.map((t) => `<button data-tag="${esc(t)}">${esc(t)}</button>`).join("")}</div></div>` : ""}

    <div class="bloc"><h3>Fichier</h3>
      <dl class="fiche">
        ${date ? `<dt>Prise le</dt><dd>${date}</dd>` : ""}
        ${p.appareil ? `<dt>Appareil</dt><dd>${esc(p.appareil)}</dd>` : ""}
        <dt>Taille</dt><dd class="mono">${p.largeur} × ${p.hauteur}</dd>
        ${etat.config.admin ? `<dt>Nom</dt><dd class="mono">${esc(p.nom_fichier)}</dd>` : ""}
      </dl>
    </div>

    ${etat.config.admin ? `<div class="bloc commentaire">
      <h3>Ton commentaire pour l'IA</h3>
      <textarea data-champ="commentaire" rows="2" placeholder="Ex. : BMW M3 E46 au col du Stelvio">${esc(p.commentaire ?? "")}</textarea>
      <p class="aide">L'IA le prend pour une info sûre. Modifie-le puis clique sur « Ré-analyser ».</p>
    </div>
    <div class="actions-bas">
      <button class="bouton petit" data-action="analyser"${p.etat_analyse === "en_cours" || !etat.config.ia ? " disabled" : ""}>
        <svg viewBox="0 0 24 24"><path d="M12 3v3M12 18v3M3 12h3M18 12h3M5.6 5.6l2.1 2.1M16.3 16.3l2.1 2.1M5.6 18.4l2.1-2.1M16.3 7.7l2.1-2.1"/></svg>
        ${a ? "Ré-analyser" : "Analyser avec l'IA"}
      </button>
      <button class="bouton petit danger" data-action="supprimer">Supprimer</button>
    </div>` : ""}
    ${a?.modele_ia && etat.config.admin ? `<p class="mono" style="color:var(--texte-pale);margin-top:18px">Analysé par ${esc(a.modele_ia)}</p>` : ""}
  `;
}

function fermer() {
  etat.ouverte = null;
  if (dialog.open) dialog.close();
}

async function modifier(id, changements) {
  try {
    remplacer(await api(`/api/photos/${id}`, { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify(changements) }));
  } catch (e) {
    toast(e.message, true);
  }
  rendre();
}

$("#v-panneau").addEventListener("click", async (ev) => {
  const cible = ev.target.closest("[data-action], [data-tag], [data-voiture]");
  if (!cible) return;
  const id = etat.ouverte;
  if (cible.dataset.voiture) {
    fermer();
    return choisirVoiture(cible.dataset.voiture);
  }
  if (cible.dataset.tag) {
    fermer();
    $("#recherche").value = etat.recherche = cible.dataset.tag;
    etat.theme = "tous";
    return rendre();
  }
  switch (cible.dataset.action) {
    case "analyser": {
      const texte = $('#v-panneau [data-champ="commentaire"]')?.value.trim() ?? "";
      const p = etat.photos.find((x) => x.id === id);
      if (p && texte !== (p.commentaire ?? "")) await modifier(id, { commentaire: texte });
      return analyser(id);
    }
    case "edit-voiture": etat.edition = "voiture"; return rendrePanneau();
    case "edit-lieu": etat.edition = "lieu"; return rendrePanneau();
    case "retirer-gps": return modifier(id, { gps: null });
    case "annuler": etat.edition = null; return rendrePanneau();
    case "supprimer":
      if (!confirm("Supprimer définitivement cette photo ?")) return;
      await api(`/api/photos/${id}`, { method: "DELETE" });
      etat.photos = etat.photos.filter((p) => p.id !== id);
      fermer();
      return rendre();
  }
});

$("#v-panneau").addEventListener("submit", (ev) => {
  ev.preventDefault();
  const form = ev.target;
  const valeurs = Object.fromEntries(new FormData(form));
  const cle = form.dataset.form;
  etat.edition = null;
  modifier(etat.ouverte, cle === "voiture" ? { voiture: valeurs, categorie: "voitures" } : { lieu: valeurs });
});

$("#v-panneau").addEventListener("change", (ev) => {
  if (ev.target.dataset.champ === "categorie") modifier(etat.ouverte, { categorie: ev.target.value });
});

$("#v-panneau").addEventListener("focusout", (ev) => {
  if (ev.target.dataset.champ !== "titre") return;
  const titre = ev.target.textContent.trim();
  const p = etat.photos.find((x) => x.id === etat.ouverte);
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
dialog.addEventListener("close", () => { etat.ouverte = null; });
document.addEventListener("keydown", (ev) => {
  if (!dialog.open || ev.target.closest("input, textarea, [contenteditable], select")) return;
  if (ev.key === "ArrowLeft") naviguer(-1);
  if (ev.key === "ArrowRight") naviguer(1);
});

// --- Envoi & analyse ------------------------------------------------------

function toast(message, erreur = false, duree = 4500) {
  const t = el(`<div class="toast${erreur ? " erreur" : ""}"></div>`);
  t.textContent = message;
  $("#toasts").append(t);
  if (duree) setTimeout(() => t.remove(), duree);
  return t;
}

async function analyser(id) {
  const p = etat.photos.find((x) => x.id === id);
  if (!p) return;
  p.etat_analyse = "en_cours";
  rendre();
  try {
    remplacer(await api(`/api/photos/${id}/analyse`, { method: "POST" }));
  } catch (e) {
    p.etat_analyse = "erreur";
    p.erreur_analyse = e.message;
  }
  rendre();
}

// Avant l'envoi : un commentaire par photo, que l'IA prendra pour une info sûre.
function preparer(images) {
  const dlg = $("#preparation");
  const urls = images.map((f) => URL.createObjectURL(f));
  $("#prep-liste").replaceChildren(
    ...images.map((f, i) => el(`
      <li>
        <img src="${urls[i]}" alt="">
        <label><span class="nom">${esc(f.name)}</span>
          <textarea rows="2" placeholder="Ex. : Porsche 911 GT3 RS au Nürburgring"></textarea>
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
      autres.forEach((t) => { if (!t.value.trim()) t.value = premier.value; });
    };
    $("#prep-annuler").onclick = () => fin(null);
    dlg.onclose = () => fin(null); // touche Échap
    $("#prep-form").onsubmit = (ev) => { ev.preventDefault(); fin(champs().map((t) => t.value.trim())); };
    // ⌘/Ctrl + Entrée pour valider directement
    $("#prep-liste").onkeydown = (ev) => { if (ev.key === "Enter" && (ev.metaKey || ev.ctrlKey)) $("#prep-form").requestSubmit(); };
    dlg.showModal();
    champs()[0]?.focus();
  });
}

async function envoyer(fichiers) {
  const images = [...fichiers].filter((f) => f.type.startsWith("image/") || /\.(heic|heif)$/i.test(f.name));
  if (!images.length) return;
  const commentaires = await preparer(images);
  if (!commentaires) return;
  const suivi = toast(`Envoi de ${images.length} photo${images.length > 1 ? "s" : ""}…`, false, 0);

  const form = new FormData();
  images.forEach((f) => form.append("photos", f));
  form.append("commentaires", JSON.stringify(commentaires));
  let resultat;
  try {
    resultat = await api("/api/photos", { method: "POST", body: form });
  } catch (e) {
    suivi.remove();
    return toast(e.message, true);
  }
  suivi.remove();
  resultat.erreurs?.forEach((m) => toast(m, true, 8000));

  etat.photos.unshift(...resultat.ajoutees);
  etat.theme = "tous";
  choisirVoiture(null);

  if (!etat.config.ia) {
    if (resultat.ajoutees.length) toast(`Photos ajoutées sans analyse. ${etat.config.raison_ia ?? ""}`, true, 8000);
    return;
  }
  const file = resultat.ajoutees.map((p) => p.id);
  // L'IA tourne sur le Mac : une photo à la fois.
  for (const id of file) await analyser(id);
  toast(`${resultat.ajoutees.length} photo${resultat.ajoutees.length > 1 ? "s" : ""} analysée${resultat.ajoutees.length > 1 ? "s" : ""}.`);
}

$("#btn-ajouter").onclick = () => $("#fichiers").click();
document.addEventListener("click", (ev) => { if (ev.target.closest('[data-action="ajouter"]')) $("#fichiers").click(); });
$("#fichiers").onchange = (ev) => { envoyer(ev.target.files); ev.target.value = ""; };

let profondeur = 0;
const aDesFichiers = (ev) => etat.config.admin && ev.dataTransfer?.types?.includes("Files");
document.addEventListener("dragenter", (ev) => { if (aDesFichiers(ev)) { profondeur++; $("#depot").hidden = false; } });
document.addEventListener("dragleave", (ev) => { if (aDesFichiers(ev) && --profondeur <= 0) { profondeur = 0; $("#depot").hidden = true; } });
document.addEventListener("dragover", (ev) => { if (aDesFichiers(ev)) ev.preventDefault(); });
document.addEventListener("drop", (ev) => {
  if (!aDesFichiers(ev)) return;
  ev.preventDefault();
  profondeur = 0;
  $("#depot").hidden = true;
  envoyer(ev.dataTransfer.files);
});

// --- Démarrage ------------------------------------------------------------

$("#recherche").addEventListener("input", (ev) => { etat.recherche = ev.target.value; rendreGrille(); if (etat.vue === "carte") rendreCarte(); });
document.querySelectorAll(".vue").forEach((b) => (b.onclick = () => changerVue(b.dataset.vue)));

// --- Publication (admin) ---------------------------------------------------

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

// --- Démarrage : admin en local, lecture seule sur le site public ----------

try {
  etat.config = await api("/api/config");
  etat.photos = await api("/api/photos");
  document.body.classList.add("admin");
  $("#btn-publier").onclick = publier;
} catch {
  etat.photos = await api("/data/photos.json").catch(() => []);
}
// Lien partageable : photo.lucas-chvnn.ch/#voiture=bmw-e36
const voitureLien = new URLSearchParams(location.hash.slice(1)).get("voiture");
if (voitureLien && groupesVoitures().has(voitureLien)) choisirVoiture(voitureLien);
else rendre();
