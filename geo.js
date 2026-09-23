// Position approximative d'une photo sans GPS, à partir du lieu reconnu par l'IA ou saisi à la main.
// Service gratuit Nominatim (OpenStreetMap) : 1 requête par seconde au maximum.
const URL_NOMINATIM = "https://nominatim.openstreetmap.org/search";
const AGENT = "galerie-photos (https://photo.lucas-chvnn.ch)";

let file = Promise.resolve();
const pause = (ms) => new Promise((r) => setTimeout(r, ms));

async function chercher(q) {
  const url = `${URL_NOMINATIM}?format=jsonv2&limit=1&accept-language=fr&q=${encodeURIComponent(q)}`;
  const res = await fetch(url, { headers: { "User-Agent": AGENT }, signal: AbortSignal.timeout(10_000) });
  if (!res.ok) return null;
  const [r] = await res.json();
  return r ? { lat: Number(r.lat), lon: Number(r.lon) } : null;
}

/** @returns {Promise<{lat:number, lon:number, approx:true} | null>} */
export function geocoder(lieu) {
  const { nom, ville, pays } = lieu ?? {};
  // Du plus précis au plus large ; le nom seul avec le pays marche le mieux pour les lieux connus.
  const essais = [...new Set([
    [nom, pays], [nom, ville, pays], [ville, pays], [nom],
  ].map((parts) => parts.filter(Boolean).join(", ")).filter(Boolean))];

  const tache = file.then(async () => {
    for (const q of essais) {
      try {
        const pos = await chercher(q);
        await pause(1100);
        if (pos) return { ...pos, approx: true };
      } catch {
        return null; // pas de réseau : on réessaiera au prochain démarrage
      }
    }
    return null;
  });
  file = tache.catch(() => {});
  return tache;
}
