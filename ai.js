// Analyse d'une photo avec un modèle de vision local (Ollama) : gratuit, rien ne quitte le Mac.
export const OLLAMA_URL = process.env.OLLAMA_URL || "http://127.0.0.1:11434";
export const MODELE = process.env.OLLAMA_MODEL || "qwen3-vl:8b";

export const CATEGORIES = [
  "voitures",
  "paysages",
  "villes",
  "architecture",
  "nature",
  "animaux",
  "personnes",
  "nourriture",
  "sport",
  "evenements",
  "autre",
];

const CONFIANCE = { type: "string", enum: ["faible", "moyenne", "elevee"] };

const SCHEMA = {
  type: "object",
  required: ["categorie", "titre", "description", "tags", "voiture", "lieu", "animal"],
  properties: {
    categorie: { type: "string", enum: CATEGORIES },
    titre: { type: "string" },
    description: { type: "string" },
    tags: { type: "array", items: { type: "string" } },
    voiture: {
      type: "object",
      required: ["presente", "marque", "modele", "generation", "annees", "carrosserie", "couleur", "confiance", "indices"],
      properties: {
        presente: { type: "boolean" },
        marque: { type: "string" },
        modele: { type: "string" },
        generation: { type: "string" },
        annees: { type: "string" },
        carrosserie: { type: "string" },
        couleur: { type: "string" },
        confiance: CONFIANCE,
        indices: { type: "string" },
      },
    },
    lieu: {
      type: "object",
      required: ["identifie", "nom", "ville", "pays", "confiance", "indices"],
      properties: {
        identifie: { type: "boolean" },
        nom: { type: "string" },
        ville: { type: "string" },
        pays: { type: "string" },
        confiance: CONFIANCE,
        indices: { type: "string" },
      },
    },
    animal: {
      type: "object",
      required: ["present", "espece", "race"],
      properties: {
        present: { type: "boolean" },
        espece: { type: "string" },
        race: { type: "string" },
      },
    },
  },
};

const SYSTEM = `Tu catalogues les photos d'une galerie personnelle. Réponds uniquement en JSON, en français.

- categorie : le sujet principal. Si le sujet principal est un véhicule (voiture, moto, camion), c'est "voitures".
- titre : 2 à 6 mots, évocateur. description : 1 à 3 phrases. tags : 3 à 8 mots-clés en minuscules.
- voiture : si un véhicule est visible, identifie la marque, le modèle et si possible la génération ou la finition (calandre, phares, feux, logos, jantes, proportions). Donne ta meilleure estimation, avec la période de production dans "annees", et règle "confiance" honnêtement. Explique les indices visuels dans "indices".
- lieu : utilise les coordonnées GPS si elles sont fournies, sinon les indices visibles (monuments, panneaux, architecture). Si rien ne permet de situer la photo, identifie = false.
- animal : espèce et race si un animal est le sujet.
- Les champs sans objet sont des chaînes vides.`;

/** Ollama tourne-t-il, et le modèle est-il téléchargé ? */
export async function etatIA() {
  try {
    const res = await fetch(`${OLLAMA_URL}/api/tags`, { signal: AbortSignal.timeout(2000) });
    const { models = [] } = await res.json();
    const present = models.some((m) => m.name === MODELE || m.model === MODELE);
    return present ? { ok: true } : { ok: false, raison: `Modèle manquant : lance « ollama pull ${MODELE} »` };
  } catch {
    return { ok: false, raison: "Ollama n'est pas lancé : ouvre l'app Ollama ou lance « ollama serve »" };
  }
}

/**
 * @param {Buffer} jpeg image redimensionnée
 * @param {{ gps?: {lat:number, lon:number}, date?: string, appareil?: string }} contexte
 */
export async function analyserPhoto(jpeg, contexte = {}) {
  const infos = [];
  if (contexte.gps) infos.push(`Coordonnées GPS : ${contexte.gps.lat.toFixed(5)}, ${contexte.gps.lon.toFixed(5)}`);
  if (contexte.date) infos.push(`Date de prise de vue : ${contexte.date}`);
  if (contexte.appareil) infos.push(`Appareil : ${contexte.appareil}`);

  let res;
  try {
    res = await fetch(`${OLLAMA_URL}/api/chat`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        model: MODELE,
        stream: false,
        format: SCHEMA,
        options: { temperature: 0.2 },
        messages: [
          { role: "system", content: SYSTEM },
          {
            role: "user",
            content: `Analyse cette photo.\n${infos.length ? `Métadonnées :\n${infos.join("\n")}` : "Aucune métadonnée."}`,
            images: [jpeg.toString("base64")],
          },
        ],
      }),
      signal: AbortSignal.timeout(5 * 60_000),
    });
  } catch (e) {
    const { raison } = await etatIA();
    throw new Error(raison ?? `Ollama ne répond pas (${e.message})`);
  }

  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(`Ollama : ${data.error ?? res.status}`);

  let analyse;
  try {
    analyse = JSON.parse(data.message?.content ?? "");
  } catch {
    throw new Error("Réponse illisible de l'IA, réessaie.");
  }
  if (!CATEGORIES.includes(analyse.categorie)) analyse.categorie = "autre";
  return { ...analyse, modele_ia: MODELE, analysee_le: new Date().toISOString() };
}
