// Position approximative d'une photo sans GPS, à partir du lieu reconnu par l'IA, saisi à la main
// ou écrit dans ton commentaire. Service gratuit Nominatim (OpenStreetMap) : 1 requête par seconde.
const URL_NOMINATIM = "https://nominatim.openstreetmap.org/search";
const AGENT = "galerie-photos (https://photos.lucas-chvnn.ch)";

let file = Promise.resolve();
const pause = (ms) => new Promise((r) => setTimeout(r, ms));

async function chercher(q) {
  const url = `${URL_NOMINATIM}?format=jsonv2&limit=1&accept-language=fr&q=${encodeURIComponent(q)}`;
  // Service saturé (429/5xx) : on patiente et on réessaie, sinon on prendrait ça pour « lieu introuvable ».
  for (let essai = 0; essai < 4; essai++) {
    const res = await fetch(url, { headers: { "User-Agent": AGENT }, signal: AbortSignal.timeout(10_000) });
    if (res.ok) {
      const [r] = await res.json();
      return r ? { lat: Number(r.lat), lon: Number(r.lon) } : null;
    }
    if (res.status !== 429 && res.status < 500) return null;
    await pause(2000 * (essai + 1));
  }
  throw new Error("Nominatim indisponible");
}

// « Tesla de Marc à Plan-les-Ouates » → « Plan-les-Ouates » : ce qui suit la dernière préposition de lieu.
export function lieuDuCommentaire(commentaire = "") {
  const m = commentaire.match(/.*\b(?:à|a|au|aux|en|sur|près de|vers|dans)\s+(?:la |le |les |l')?(.{3,60})$/i);
  return m ? m[1].replace(/[.!]+$/, "").trim() : "";
}

/** @returns {Promise<{lat:number, lon:number, approx:true} | null>} */
export function geocoder(lieu, commentaire = "") {
  const { nom, ville, pays } = lieu ?? {};
  // Du plus précis au plus large ; le nom seul avec le pays marche le mieux pour les lieux connus.
  const essais = [...new Set([
    [nom, pays], [nom, ville, pays], [ville, pays], [nom], [lieuDuCommentaire(commentaire)],
  ].map((parts) => parts.filter(Boolean).join(", ")).filter(Boolean))];

  const tache = file.then(async () => {
    for (const q of essais) {
      try {
        const pos = await chercher(q);
        await pause(1100);
        if (pos) return { ...pos, approx: true };
      } catch {
        return null; // pas de réseau ou service en panne : on réessaiera au prochain démarrage
      }
    }
    return null;
  });
  file = tache.catch(() => {});
  return tache;
}
