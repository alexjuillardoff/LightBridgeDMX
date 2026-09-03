// Package partage @lightbridgedmx/shared : source unique de verite des types.
//
// Ce fichier rassemble tous les schemas Zod (et les types TypeScript qu'ils
// produisent) utilises a la fois par le backend Fastify et le frontend React.
// Chaque schema sert deux roles : valider les entrees API (corps de requete,
// presets...) et fournir un type partage cote client et serveur.
//
// On y trouve : projecteurs (fixtures) DMX, scenes, presets, etat de l'univers
// DMX, Mode Dance (chenillard), lampes connectees (smart lights, Nanoleaf),
// effets position-aware, disposition (layout) 3D des zones, evenements
// WebSocket, et le parsing des fichiers QXF (bibliotheque de projecteurs).
// Il contient aussi quelques helpers purs pour construire des layouts 3D,
// partages tels quels entre backend et frontend.
import { z } from "zod";

// Liste de toutes les capabilities (roles de canal) reconnues.
// Une capability decrit ce que pilote un canal DMX : intensite, rouge, pan...
// "as const" fige le tuple pour que z.enum genere une union de litteraux exacte.
const capabilities = [
  "intensity",
  "r",
  "g",
  "b",
  "w",
  "uv",
  "strobe",
  "colorTemp",
  "color",
  "pan",
  "tilt",
  "gobo",
  "beam",
  "effect",
  "speed",
  "prism",
  "focus",
  "maintenance",
  "other"
] as const;

export const CapabilitySchema = z.enum(capabilities);

export type Capability = z.infer<typeof CapabilitySchema>;

// Override manuel des canaux RGB exposes a HomeKit.
// Utile quand l'auto-detection des capabilities r/g/b ne suffit pas.
// Chaque valeur est un canal absolu (1-512) dans l'univers DMX.
export const FixtureHomeKitDmxSchema = z.object({
  r: z.number().int().min(1).max(512),
  g: z.number().int().min(1).max(512),
  b: z.number().int().min(1).max(512)
});

export type FixtureHomeKitDmx = z.infer<typeof FixtureHomeKitDmxSchema>;

// Override des canaux d'une lyre (moving head) exposee a HomeKit.
// Les canaux sont ici relatifs a l'adresse de depart du projecteur, pas absolus.
// Les valeurs ...Default servent de position de repos pour pan/tilt.
export const FixtureHomeKitMovingHeadChannelsSchema = z.object({
  dimmerChannel: z.number().int().min(1).optional(),
  shutterChannel: z.number().int().min(1).optional(),
  panChannel: z.number().int().min(1).optional(),
  tiltChannel: z.number().int().min(1).optional(),
  colorChannel: z.number().int().min(1).optional(),
  goboChannel: z.number().int().min(1).optional(),
  panDefault: z.number().int().min(0).max(255).optional(),
  tiltDefault: z.number().int().min(0).max(255).optional()
});

export type FixtureHomeKitMovingHeadChannels = z.infer<typeof FixtureHomeKitMovingHeadChannelsSchema>;

// Configuration de l'exposition d'un projecteur dans HomeKit (app Maison).
// Permet de (de)activer l'expo, renommer l'accessoire, et forcer le mapping
// des canaux RGB (dmxChannels) ou des canaux de lyre (movingHeadChannels).
export const FixtureHomeKitSchema = z.object({
  enabled: z.boolean().default(true).optional(),
  name: z.string().min(1).optional(),
  deviceId: z.string().min(1).optional(),
  /** Numero de generation de l'accessoire HomeKit.
   *
   *  Le nom d'un accessoire appartient a la maison de l'utilisateur, pas a
   *  l'accessoire : iOS le retient au premier ajout et l'accessoire ne peut plus
   *  jamais l'ecraser. Tant que l'UUID ne bouge pas, Maison reconnait le meme
   *  appareil et lui reapplique le nom qu'il avait retenu.
   *
   *  Incrementer ce compteur change l'UUID, donc fait apparaitre un accessoire
   *  NEUF qui prend le nom courant — au prix de sa piece et des automatisations
   *  qui le referencaient. 0 (ou absent) = generation d'origine : c'est ce qui
   *  garantit que tous les accessoires existants gardent leur identite. */
  accessoryRevision: z.number().int().min(0).optional(),
  dmxChannels: FixtureHomeKitDmxSchema.optional(),
  movingHeadChannels: FixtureHomeKitMovingHeadChannelsSchema.optional()
});

export type FixtureHomeKit = z.infer<typeof FixtureHomeKitSchema>;

// Un canal d'un projecteur : son numero (relatif a l'adresse de depart),
// sa capability (role) et un nom lisible optionnel.
export const FixtureChannelSchema = z.object({
  channel: z.number().int().min(1).max(512),
  capability: CapabilitySchema,
  name: z.string().min(1).optional()
});

export type FixtureChannel = z.infer<typeof FixtureChannelSchema>;

// Origine d'un projecteur importe depuis la bibliotheque QXF (fichiers QLC+).
// Garde la trace du fabricant / modele / mode pour pouvoir s'y retrouver.
export const FixtureProfileSchema = z.object({
  source: z.literal("qxf"),
  manufacturer: z.string(),
  model: z.string(),
  mode: z.string()
});

export type FixtureProfile = z.infer<typeof FixtureProfileSchema>;

// Un projecteur (fixture) complet : c'est l'entite centrale du systeme.
// Il possede une adresse de depart dans un univers DMX, une liste de canaux,
// et eventuellement un profil QXF, une config HomeKit et une piece (room).
export const FixtureSchema = z.object({
  id: z.string().uuid(),
  name: z.string().min(1),
  address: z.number().int().min(1).max(512),
  channels: z.array(FixtureChannelSchema).min(1),
  universe: z.number().int().min(0).default(0),
  createdAt: z.string().datetime(),
  profile: FixtureProfileSchema.optional(),
  homekit: FixtureHomeKitSchema.optional(),
  room: z.string().min(1).optional()
});

export type Fixture = z.infer<typeof FixtureSchema>;

/**
 * Construit la liste de canaux d'un projecteur "bandeau adressable" : 3 canaux
 * (rouge, vert, bleu) par zone, dans l'ordre des zones. Les numeros de canaux sont
 * relatifs a l'adresse de depart du projecteur (le canal 1 = l'adresse de depart),
 * exactement comme pour un projecteur importe de la bibliotheque QXF.
 *
 * Partage backend/frontend pour que les deux cotes decrivent le meme mapping :
 * la zone i occupe les canaux 3i+1 (R), 3i+2 (G), 3i+3 (B).
 */
export function buildZoneRgbChannels(zoneCount: number): FixtureChannel[] {
  const channels: FixtureChannel[] = [];
  for (let i = 0; i < zoneCount; i++) {
    channels.push({ channel: i * 3 + 1, capability: "r", name: `Zone ${i + 1} Rouge` });
    channels.push({ channel: i * 3 + 2, capability: "g", name: `Zone ${i + 1} Vert` });
    channels.push({ channel: i * 3 + 3, capability: "b", name: `Zone ${i + 1} Bleu` });
  }
  return channels;
}

// ─── Mode Dance (chenillard) ─────────────────────────────────────────────────

// Identifiants des motifs (patterns) de chenillard (chase).
// On garde les ids en anglais car ils sont utilises tels quels dans le code.
// Chaque motif decrit comment la lumiere se deplace de groupe en groupe.
export const DancePatternIds = [
  "chase",
  "reverseChase",
  "pingPong",
  "waveLR",
  "waveRL",
  "alternate",
  "pairs",
  "randomSubset",
  "allHit",
  "strobeSync",
  "bookendIn",
  "bookendOut"
] as const;

export const DancePatternIdSchema = z.enum(DancePatternIds);
export type DancePatternId = z.infer<typeof DancePatternIdSchema>;

// Position memorisee d'une lyre (pan/tilt) pour un projecteur donne.
// Sert d'ancre (point d'ancrage) connue pour l'interpolation des mouvements.
export const DanceLyrePositionSchema = z.object({
  fixtureId: z.string().uuid(),
  pan: z.number().int().min(0).max(255),
  tilt: z.number().int().min(0).max(255)
});

export type DanceLyrePosition = z.infer<typeof DanceLyrePositionSchema>;

// Ancre libre (pan/tilt seuls, sans projecteur associe).
// Utilisee comme point de reference supplementaire aux extremites de la chaine.
export const DanceFreeAnchorSchema = z.object({
  pan: z.number().int().min(0).max(255),
  tilt: z.number().int().min(0).max(255)
});

export type DanceFreeAnchor = z.infer<typeof DanceFreeAnchorSchema>;

// Reglages du Mode Dance pour une lyre (moving head).
// La lyre peut suivre le chenillard en se deplacant entre des positions ancrees ;
// les valeurs ci-dessous controlent son ouverture, son intensite et sa vitesse.
export const DanceLyreModeSchema = z.object({
  enabled: z.boolean(),
  shutterOpenValue: z.number().int().min(0).max(255),
  dimmerOnValue: z.number().int().min(0).max(255),
  followChase: z.boolean(),
  positions: z.array(DanceLyrePositionSchema),
  // Bord du mur a droite du projecteur le plus a droite dans la chaine visuelle.
  // Sert d'ancre supplementaire pour interpoler/extrapoler au-dela du dernier projecteur.
  wallEdgeRight: DanceFreeAnchorSchema.nullable(),
  // Valeur DMX ecrite sur le canal "speed" de la lyre (vitesse de reponse).
  // Pour la Stairville MH-X20 : 0 = mouvement le plus rapide, 251 = le plus lent
  // (255 = modes vectoriels).
  speedValue: z.number().int().min(0).max(255),
  // Temps que met la lyre pour parcourir 1 unite DMX de pan ou tilt, en ms.
  // Sert a calculer la duree de chaque mouvement selon la distance — et a faire un
  // blackout du dimmer + fermer le shutter pendant le deplacement (une lyre qui clignote
  // en plein vol, ca fait moche : effet de spot volant).
  // Pour la Stairville MH-X20 a speed=0 : ~40 ms/unite (Lava→Café = 10 unites ≈ 400 ms).
  msPerPanUnit: z.number().int().min(1).max(500)
});

export type DanceLyreMode = z.infer<typeof DanceLyreModeSchema>;

// Reglages du Mode Dance pour les lampes connectees (smart lights).
export const DanceSmartLightsModeSchema = z.object({
  enabled: z.boolean(),
  // IDs des lampes connectees qui rejoignent la dance. Chaque lampe fournit un groupe
  // par "side" (cote) defini dans son zoneLayout (voir SmartLightZoneLayout.sides).
  // Ces groupes participent aux motifs de chenillard a cote des projecteurs DMX et
  // flashent dans la couleur ambiante actuelle de la lampe
  // (desired.hue/sat → RGB a 100% de luminosite).
  lightIds: z.array(z.string().uuid())
});

export type DanceSmartLightsMode = z.infer<typeof DanceSmartLightsModeSchema>;

// Configuration complete du Mode Dance.
// Pieces concernees, plage d'intervalle entre etapes, motifs autorises, et
// sous-configs pour les lyres et les lampes connectees.
export const DanceConfigSchema = z.object({
  enabled: z.boolean(),
  rooms: z.array(z.string().min(1)),
  intervalMinMs: z.number().int().min(1).max(2000),
  intervalMaxMs: z.number().int().min(1).max(2000),
  patterns: z.array(DancePatternIdSchema),
  excludePanTilt: z.boolean(),
  excludeCapabilities: z.array(CapabilitySchema),
  lyre: DanceLyreModeSchema,
  smartLights: DanceSmartLightsModeSchema,
  updatedAt: z.string().datetime()
});

export type DanceConfig = z.infer<typeof DanceConfigSchema>;

// ─── Prise connectee Meross (pilotee en local sur le LAN) ────────────────────

// Configuration persistee de la prise Meross. Source de verite cote backend
// (remplace la config par variables d'environnement). channel = sortie ciblee
// (0 pour un Plug Mini a une seule prise).
export const MerossConfigSchema = z.object({
  enabled: z.boolean().default(false),
  host: z.string().default(""),
  key: z.string().default(""),
  channel: z.number().int().min(0).max(31).default(0),
  updatedAt: z.string().datetime()
});

export type MerossConfig = z.infer<typeof MerossConfigSchema>;

// Entree de mise a jour de la config (PUT) : tous les champs optionnels (patch).
export const MerossConfigInputSchema = MerossConfigSchema.omit({ updatedAt: true }).partial();

export type MerossConfigInput = z.infer<typeof MerossConfigInputSchema>;

// Mesure electrique instantanee remontee par la prise. Seuls les modeles avec
// metrologie la fournissent (MSS310 / MSS315...) ; sur un Plug Mini elle est absente.
// Le backend convertit les unites brutes Meross (mW, 0.1 V, mA) en unites SI.
export const MerossElectricitySchema = z.object({
  power: z.number(),    // puissance instantanee, en watts
  voltage: z.number(),  // tension du secteur, en volts
  current: z.number(),  // intensite, en amperes
  sampledAt: z.string() // horodatage ISO de la mesure
});

export type MerossElectricity = z.infer<typeof MerossElectricitySchema>;

// Consommation d'une journee (energie cumulee sur ce jour), telle que comptabilisee
// par la prise elle-meme. Le compteur du jour en cours est partiel.
export const MerossConsumptionDaySchema = z.object({
  date: z.string(), // "YYYY-MM-DD" (fuseau de la prise)
  wh: z.number()    // energie consommee ce jour-la, en Wh
});

export type MerossConsumptionDay = z.infer<typeof MerossConsumptionDaySchema>;

// Historique de consommation journaliere (~30 jours glissants), trie du plus
// ancien au plus recent.
export const MerossConsumptionSchema = z.object({
  days: z.array(MerossConsumptionDaySchema),
  todayWh: z.number().nullable(),   // energie du jour en cours (null si absente du releve)
  totalWh: z.number(),              // somme de l'historique renvoye
  sampledAt: z.string()             // horodatage ISO du releve
});

export type MerossConsumption = z.infer<typeof MerossConsumptionSchema>;

// Etat de la prise renvoye par l'API (lecture seule, pour l'UI Reglages).
export const MerossStatusSchema = z.object({
  enabled: z.boolean(),                 // drapeau de config (interrupteur logiciel)
  active: z.boolean(),                  // reellement operationnel (enabled + host + key)
  host: z.string(),
  key: z.string(),                      // renvoyee pour pre-remplir le formulaire (app LAN sans auth)
  channel: z.number().int(),
  on: z.boolean().nullable(),           // dernier etat connu de la prise (null = inconnu)
  reachable: z.boolean().nullable(),    // succes du dernier echange reseau (null = jamais tente)
  watchedFixtures: z.array(z.string()), // noms des projecteurs surveilles (declenchent l'allumage)
  watchedChannelCount: z.number().int(),
  // Extinction automatique : tous les canaux surveilles a 0 pendant offTimeoutMs -> on coupe.
  offWatchedChannelCount: z.number().int(),
  offTimeoutMs: z.number().int(),
  offCountdownMs: z.number().nullable(), // ms restantes avant extinction auto (null = condition non remplie / prise deja eteinte)
  // Derniere mesure electrique connue (null si le modele n'a pas de metrologie,
  // si la prise est injoignable ou si aucun releve n'a encore abouti).
  electricity: MerossElectricitySchema.nullable(),
  lastError: z.string().nullable()      // dernier message d'erreur reseau, le cas echeant
});

export type MerossStatus = z.infer<typeof MerossStatusSchema>;

// Etat courant du Mode Dance, diffuse aux clients (broadcast WebSocket).
// Indique si le chenillard tourne, quels projecteurs sont actifs, le motif en
// cours et le nombre de phases deja envoyees.
export const DanceStateSchema = z.object({
  config: DanceConfigSchema,
  running: z.boolean(),
  activeFixtureIds: z.array(z.string().uuid()),
  currentPattern: z.string().nullable(),
  phasesSent: z.number().int().nonnegative()
});

export type DanceState = z.infer<typeof DanceStateSchema>;

// ─── Scenes et presets ───────────────────────────────────────────────────────

// Une etape de scene : pour un projecteur donne, les valeurs (0-255) a appliquer
// canal par canal, dans l'ordre de ses canaux.
export const SceneStepSchema = z.object({
  fixtureId: z.string().uuid(),
  values: z.array(z.number().int().min(0).max(255)).min(1)
});

export type SceneStep = z.infer<typeof SceneStepSchema>;

// Une scene : etat enregistre de plusieurs projecteurs que l'on peut rappeler.
export const SceneSchema = z.object({
  id: z.string().uuid(),
  name: z.string().min(1),
  steps: z.array(SceneStepSchema).default([])
});

export type Scene = z.infer<typeof SceneSchema>;

// Un preset (reglage predefini) : un ensemble de valeurs de canaux reutilisable.
// Le payload (contenu) associe un numero de canal (en cle, sous forme de chaine)
// a sa valeur 0-255.
export const PresetSchema = z.object({
  id: z.string().uuid(),
  name: z.string().min(1),
  payload: z.record(z.number().int().min(0).max(255))
});

export type Preset = z.infer<typeof PresetSchema>;

// ─── Etat de l'univers DMX et journaux ──────────────────────────────────────

// Instantane (snapshot) des 512 canaux d'un univers DMX a un instant t.
// Diffuse en continu aux clients via WebSocket (evenement universe_tick).
// "values" fait toujours exactement 512 entrees (un univers complet).
export const UniverseStateSchema = z.object({
  fps: z.number().nonnegative(),
  universe: z.number().int().min(0),
  values: z.array(z.number().int().min(0).max(255)).length(512),
  timestamp: z.string().datetime()
});

export type UniverseState = z.infer<typeof UniverseStateSchema>;

// Un evenement de journal diffuse a l'UI (niveau, message, horodatage).
export const LogEventSchema = z.object({
  level: z.enum(["info", "warn", "error"]),
  message: z.string(),
  timestamp: z.string().datetime()
});

export type LogEvent = z.infer<typeof LogEventSchema>;

// ─── Smart Lights (Nanoleaf / HomeKit / Matter externes) ────────────────────
// Tout ce qui concerne les lampes connectees (smart lights) : type de backend
// (marque), config d'acces, miroir DMX (mirror), etat couleur et streaming UDP.

export const SmartLightBackendTypeSchema = z.enum(["nanoleaf-http", "homekit-thread"]);
export type SmartLightBackendType = z.infer<typeof SmartLightBackendTypeSchema>;

// Config du backend : union discriminee sur `type`. Chaque backend decrit
// comment joindre l'appareil sur le reseau.
export const NanoleafHttpConfigSchema = z.object({
  type: z.literal("nanoleaf-http"),
  host: z.string().min(1),         // ex. "192.168.0.234"
  port: z.number().int().min(1).max(65535).default(16021).optional(),
  token: z.string().min(1).optional(), // jeton d'auth issu de /api/v1/new (defini apres appairage)
  deviceName: z.string().optional()    // nom rapporte par l'appareil (ex. "Light Strip 5DA6")
});
export type NanoleafHttpConfig = z.infer<typeof NanoleafHttpConfigSchema>;

// Ampoule HomeKit sur Thread (Nanoleaf Essentials NL45 et compatibles).
// Elle ne parle ni HTTP ni Matter mais HAP sur CoAP, protocole qui n'a
// d'implementation utilisable qu'en Python : le backend passe donc par le sidecar
// `tools/homekit-thread/sidecar.py`, qui tient les connexions CoAP et expose une
// API HTTP sur la boucle locale. `alias` designe l'entree du fichier d'appairage.
export const HomeKitThreadConfigSchema = z.object({
  type: z.literal("homekit-thread"),
  alias: z.string().min(1),
  /** Base du sidecar. Defaut : le port 5056 en local. */
  sidecarUrl: z.string().min(1).default("http://127.0.0.1:5056").optional(),
  deviceName: z.string().optional()
});
export type HomeKitThreadConfig = z.infer<typeof HomeKitThreadConfigSchema>;

// Liste des configs de backend supportees (union discriminee).
export const SmartLightBackendConfigSchema = z.discriminatedUnion("type", [
  NanoleafHttpConfigSchema,
  HomeKitThreadConfigSchema
]);
export type SmartLightBackendConfig = z.infer<typeof SmartLightBackendConfigSchema>;

/** Miroir DMX par zone : expose un bandeau adressable comme un vrai projecteur DMX
 *  multi-cellules. Les zones occupent un bloc de canaux CONSECUTIFS a partir de
 *  startChannel, a raison de 3 canaux par zone dans l'ordre rouge, vert, bleu :
 *
 *    zone 0 -> startChannel (R), +1 (G), +2 (B)
 *    zone 1 -> startChannel+3 (R), +4 (G), +5 (B)   ... et ainsi de suite
 *
 *  Contrairement au miroir uniforme (rChannel/gChannel/...), ce mode passe par le
 *  streaming UDP : il exige donc `streaming.enabled = true` sur la lampe.
 *  `fixtureId` memorise le projecteur (fixture) genere pour ce bloc, afin de pouvoir
 *  le mettre a jour ou le supprimer plus tard. */
export const SmartLightDmxZoneMirrorSchema = z
  .object({
    universe: z.number().int().min(0).default(0).optional(),
    startChannel: z.number().int().min(1).max(512),
    zoneCount: z.number().int().min(1).max(170), // 170 x 3 = 510 canaux, plafond d'un univers
    /** Id du projecteur DMX cree pour ce bloc (lien lampe <-> fixture). */
    fixtureId: z.string().uuid().optional()
  })
  .refine((m) => m.startChannel + m.zoneCount * 3 - 1 <= 512, {
    message: "Le bloc de zones depasse le canal 512"
  });
export type SmartLightDmxZoneMirror = z.infer<typeof SmartLightDmxZoneMirrorSchema>;

// Miroir DMX (mirror) optionnel : lie la lampe connectee a des canaux DMX de
// l'univers. Ainsi les scenes, le Mode Dance et les curseurs de canaux la
// pilotent de maniere transparente, comme un projecteur classique.
// Deux modes cohabitent : le miroir uniforme (une seule couleur pour tout le
// bandeau, via rChannel/gChannel/bChannel/briChannel) et le miroir par zone
// (`zones`), qui donne 3 canaux R/G/B a CHAQUE zone.
export const SmartLightDmxMirrorSchema = z.object({
  universe: z.number().int().min(0).default(0).optional(),
  rChannel: z.number().int().min(1).max(512).optional(),
  gChannel: z.number().int().min(1).max(512).optional(),
  bChannel: z.number().int().min(1).max(512).optional(),
  briChannel: z.number().int().min(1).max(512).optional(), // override optionnel du dimmer maitre
  /** Miroir par zone — prioritaire sur le miroir uniforme tant que le DMX bouge. */
  zones: SmartLightDmxZoneMirrorSchema.optional()
});
export type SmartLightDmxMirror = z.infer<typeof SmartLightDmxMirrorSchema>;

// Mode couleur courant d'une lampe : teinte/saturation (hs), temperature (ct)
// ou effet (effect).
export const SmartLightColorModeSchema = z.enum(["hs", "ct", "effect"]);
export type SmartLightColorMode = z.infer<typeof SmartLightColorModeSchema>;

// Etat d'une lampe connectee tel qu'on le lit / souhaite (couleur HSB, etc.).
export const SmartLightStateSchema = z.object({
  on: z.boolean(),
  hue: z.number().min(0).max(360),       // degres
  sat: z.number().min(0).max(100),       // pourcent
  brightness: z.number().min(0).max(100),// pourcent
  ct: z.number().min(1000).max(10000).optional(),         // Kelvin (NL72K3 ≈ 2127–6535)
  colorMode: SmartLightColorModeSchema.optional(),
  currentEffect: z.string().optional(),  // present quand colorMode = "effect"
  reachable: z.boolean().default(true).optional() // l'appareil repond-il (joignable) ?
});
export type SmartLightState = z.infer<typeof SmartLightStateSchema>;

// Config de streaming reglable par l'utilisateur (extControl UDP pour Nanoleaf).
// Quand c'est active, le SmartLightService maintient un flux UDP continu (streaming)
// au lieu d'ecritures HTTP coalescees (PUT /state) — la latence passe de ~100 ms
// a ~5-15 ms. Utile pour le miroir DMX et la synchro musicale.
export const SmartLightStreamingSchema = z.object({
  enabled: z.boolean().default(false).optional(),
  zoneCount: z.number().int().min(1).max(500).optional() // decouvert depuis l'appareil
});
export type SmartLightStreaming = z.infer<typeof SmartLightStreamingSchema>;

// ─── Disposition (layout) 3D ─────────────────────────────────────────────────
// Decrit le placement physique des zones d'un bandeau LED (strip) dans l'espace.
// Ces positions permettent aux effets "sensibles a la position" (position-aware)
// de calculer une couleur differente selon ou se trouve chaque zone.

// Un point dans l'espace 3D (metres).
export const Point3DSchema = z.object({
  x: z.number(),
  y: z.number(),
  z: z.number()
});
export type Point3D = z.infer<typeof Point3DSchema>;

/** Une zone adressable d'un bandeau LED : un segment de droite (de start a end) dans l'espace 3D.
 *  Les effets utilisent start, end et le milieu pour calculer la couleur de chaque zone. */
export const ZoneSegmentSchema = z.object({
  start: Point3DSchema,
  end: Point3DSchema
});
export type ZoneSegment = z.infer<typeof ZoneSegmentSchema>;

// Disposition (layout) complete des zones d'un bandeau LED.
export const SmartLightZoneLayoutSchema = z.object({
  /** Linked = les segments consecutifs partagent un point (polyligne). Unlinked = chaque segment est libre. */
  mode: z.enum(["linked", "unlinked"]).default("linked").optional(),
  segments: z.array(ZoneSegmentSchema).min(1).max(500),
  /** Indices (commencant a 0) des zones SPARE (LED non cablee) — presentes dans le protocole de
   *  streaming mais sans LED physique derriere. Le moteur d'effets (EffectEngine) les force en noir ;
   *  l'editeur 3D masque leurs segments ; l'outil de peinture les affiche hachurees.
   *  Cas typique sur NL72K3 quand le bandeau a moins de 50 LED. */
  spareZones: z.array(z.number().int().min(0).max(999)).optional(),
  /** Etiquettes logiques optionnelles pour les cotes (sides) (ex. "back", "left", "front", "right")
   *  avec leur plage de zones. Utilisees par le preset en U et comme repere pour l'utilisateur. */
  sides: z
    .array(
      z.object({
        label: z.string().min(1),
        zoneStart: z.number().int().min(0).max(499),
        zoneEnd: z.number().int().min(0).max(499),
        color: z.string().optional() // hex pour l'indice visuel de l'UI
      })
    )
    .optional()
});
export type SmartLightZoneLayout = z.infer<typeof SmartLightZoneLayoutSchema>;

// ─── Effets ─────────────────────────────────────────────────────────────────

// Une couleur RGB (composantes 0-255).
export const RgbColorSchema = z.object({
  r: z.number().int().min(0).max(255),
  g: z.number().int().min(0).max(255),
  b: z.number().int().min(0).max(255)
});
export type RgbColor = z.infer<typeof RgbColorSchema>;

/**
 * Config d'effet — union discriminee par `kind`. Le moteur d'effets (EffectEngine)
 * evalue ces effets a chaque trame (frame), a 30 Hz, sur la disposition (layout) des
 * zones, puis pousse une trame de couleurs (une par zone) via le streamer.
 *
 *   • "static"   — palette fixe par zone, peinte dans l'UI
 *   • "solid"    — une seule couleur sur toutes les zones
 *   • "gradient" — degrade entre deux couleurs le long d'une direction en 3D
 *   • "chase"    — une "tete" lumineuse de N zones qui se deplace le long du bandeau
 *   • "wave"     — onde sinusoidale coloree de from→to se propageant dans une direction
 */
export const EffectStaticSchema = z.object({
  kind: z.literal("static"),
  palette: z.array(RgbColorSchema),
  brightness: z.number().min(0).max(100).default(100).optional()
});
export const EffectSolidSchema = z.object({
  kind: z.literal("solid"),
  color: RgbColorSchema,
  brightness: z.number().min(0).max(100).default(100).optional()
});
export const EffectGradientSchema = z.object({
  kind: z.literal("gradient"),
  from: RgbColorSchema,
  to: RgbColorSchema,
  direction: Point3DSchema.optional(),
  scrollSpeed: z.number().default(0).optional(),
  brightness: z.number().min(0).max(100).default(100).optional()
});
export const EffectChaseSchema = z.object({
  kind: z.literal("chase"),
  color: RgbColorSchema,
  bgColor: RgbColorSchema.optional(),
  speed: z.number().min(0.1).max(50).default(5),
  width: z.number().int().min(1).max(50).default(3),
  bounce: z.boolean().default(false).optional(),
  brightness: z.number().min(0).max(100).default(100).optional()
});
export const EffectWaveSchema = z.object({
  kind: z.literal("wave"),
  from: RgbColorSchema,
  to: RgbColorSchema,
  direction: Point3DSchema.optional(),
  wavelength: z.number().min(0.05).max(50).default(1),
  speed: z.number().min(-20).max(20).default(1),
  brightness: z.number().min(0).max(100).default(100).optional()
});

// Union discriminee de toutes les configs d'effet possibles (le champ "kind"
// indique de quel effet il s'agit).
export const SmartLightEffectConfigSchema = z.discriminatedUnion("kind", [
  EffectStaticSchema,
  EffectSolidSchema,
  EffectGradientSchema,
  EffectChaseSchema,
  EffectWaveSchema
]);
export type SmartLightEffectConfig = z.infer<typeof SmartLightEffectConfigSchema>;

// ─── Constructeurs de layout (helpers purs, partages backend & frontend) ─────
// Fonctions sans effet de bord qui generent une disposition (layout) 3D de zones.
// Memes resultats cote backend et cote frontend, d'ou leur place dans le package
// partage.

// Interpolation lineaire (lerp) entre deux points 3D : a quand t=0, b quand t=1.
function _lerpPoint(a: Point3D, b: Point3D, t: number): Point3D {
  return { x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t, z: a.z + (b.z - a.z) * t };
}

/** Bandeau lineaire le long de l'axe X, de -0.5 a +0.5. Layout par defaut quand aucun n'est defini. */
export function buildLinearLayout(zoneCount: number): SmartLightZoneLayout {
  const segments: ZoneSegment[] = [];
  for (let i = 0; i < zoneCount; i++) {
    const t0 = i / zoneCount;
    const t1 = (i + 1) / zoneCount;
    segments.push({
      start: { x: t0 - 0.5, y: 0, z: 0 },
      end: { x: t1 - 0.5, y: 0, z: 0 }
    });
  }
  return { mode: "linked", segments };
}

/**
 * Construit un layout en U autour des 4 cotes d'une piece rectangulaire.
 *
 * Entree : nombre de zones actives par cote (back / left / front / right) + dimensions.
 * Repere : X = gauche↔droite (cotes back/front), Z = fond↔avant (cotes left/right), Y = sol.
 *
 * Le bandeau est trace **dans le sens antihoraire vu de dessus**, en entrant par le coin
 * arriere-droit, et en parcourant : back-right → back-left → front-left → front-right →
 * back-right. Cela correspond au cas courant d'un bandeau enroule autour d'une piece avec le
 * controleur dans le coin arriere-droit et le bout inutilise (spare) du bandeau pendouillant
 * pres du depart.
 *
 * Total actif = back + left + front + right. Les zones restantes (totalZones - actif)
 * deviennent automatiquement des zones spare, placees soit au debut (par defaut — le bandeau
 * entre avec des LED spare pres du controleur), soit a la fin (avec `spareAtStart: false`).
 */
export function buildUShapeLayout(opts: {
  totalZones: number;
  backZones: number;
  leftZones: number;
  frontZones: number;
  rightZones: number;
  width?: number;        // longueur des cotes back/front (defaut 4 m)
  depth?: number;        // longueur des cotes left/right (defaut 3 m)
  height?: number;       // position Y du bandeau (defaut 0)
  spareAtStart?: boolean; // defaut true — segments spare aux indices 0..k-1
}): SmartLightZoneLayout {
  const w = opts.width ?? 4;
  const d = opts.depth ?? 3;
  const y = opts.height ?? 0;
  const halfW = w / 2;
  const spareAtStart = opts.spareAtStart ?? true;
  const activeTotal = opts.backZones + opts.leftZones + opts.frontZones + opts.rightZones;
  const spareCount = Math.max(0, opts.totalZones - activeTotal);

  const segments: ZoneSegment[] = [];
  const sides: NonNullable<SmartLightZoneLayout["sides"]> = [];
  const spareZones: number[] = [];

  // Ajoute n zones spare, repliees dans un coin cache (legerement decalees en Z
  // pour ne pas se superposer). Memorise leurs indices dans spareZones.
  const pushSpares = (n: number): void => {
    for (let i = 0; i < n; i++) {
      const idx = segments.length;
      segments.push({
        start: { x: -halfW - 0.2, y, z: -0.2 - i * 0.02 },
        end:   { x: -halfW - 0.2, y, z: -0.2 - (i + 1) * 0.02 }
      });
      spareZones.push(idx);
    }
  };

  // Ajoute un cote (side) : repartit n zones le long du segment start→end et
  // enregistre la plage de zones sous l'etiquette (label) donnee.
  const pushSide = (
    label: string,
    n: number,
    color: string,
    start: Point3D,
    end: Point3D
  ): void => {
    if (n <= 0) return;
    const startIdx = segments.length;
    for (let i = 0; i < n; i++) {
      const t0 = i / n;
      const t1 = (i + 1) / n;
      segments.push({
        start: _lerpPoint(start, end, t0),
        end: _lerpPoint(start, end, t1)
      });
    }
    sides.push({ label, zoneStart: startIdx, zoneEnd: segments.length - 1, color });
  };

  if (spareAtStart) pushSpares(spareCount);

  // Sens antihoraire vu de dessus, en entrant par le coin arriere-droit :
  //   back  : x=+halfW, z=0  →  x=-halfW, z=0
  //   left  : x=-halfW, z=0  →  x=-halfW, z=d
  //   front : x=-halfW, z=d  →  x=+halfW, z=d
  //   right : x=+halfW, z=d  →  x=+halfW, z=0
  pushSide("back",  opts.backZones,  "#ffeb3b", { x: +halfW, y, z: 0 }, { x: -halfW, y, z: 0 });
  pushSide("left",  opts.leftZones,  "#4caf50", { x: -halfW, y, z: 0 }, { x: -halfW, y, z: d });
  pushSide("front", opts.frontZones, "#2196f3", { x: -halfW, y, z: d }, { x: +halfW, y, z: d });
  pushSide("right", opts.rightZones, "#f44336", { x: +halfW, y, z: d }, { x: +halfW, y, z: 0 });

  if (!spareAtStart) pushSpares(spareCount);

  return { mode: "linked", segments, spareZones, sides };
}

/**
 * Construit un layout "room loop" — le bandeau fait le tour d'une piece avec des
 * sections verticales, formant un chemin 3D ferme. Sections, dans l'ordre du bandeau :
 *
 *   1. backRightFloor    — amorce au sol dans le coin arriere-droit (entree du controleur)
 *   2. backRightUp       — montee verticale a l'arriere-droit (sol → plafond)
 *   3. topRightToLeft    — haut du mur arriere, de droite a gauche
 *   4. backLeftDown      — descente verticale a l'arriere-gauche (plafond → sol)
 *   5. leftFloorBToF     — mur gauche au sol, de l'arriere vers l'avant
 *   6. frontFloorLToR    — mur avant au sol, de gauche a droite
 *   7. rightFloorFToB    — mur droit au sol, de l'avant vers l'arriere (ferme la boucle)
 *
 * Repere : X=gauche↔droite (-halfW..+halfW), Y=bas↔haut (0..height), Z=arriere↔avant (0..depth).
 *
 * Chaque section a un nombre de zones configurable ; la somme doit valoir totalZones — tout
 * manque devient des segments spare a la fin du bandeau. Le total actif est verifie automatiquement.
 */
export function buildRoomLoopLayout(opts: {
  backRightFloorZones: number;
  backRightUpZones: number;
  topRightToLeftZones: number;
  backLeftDownZones: number;
  leftFloorBToFZones: number;
  frontFloorLToRZones: number;
  rightFloorFToBZones: number;
  totalZones?: number;
  width?: number;   // etendue X (defaut 4 m)
  depth?: number;   // etendue Z (defaut 3 m)
  height?: number;  // plafond Y (defaut 2.5 m)
  /** Longueur horizontale de l'amorce depuis le coin — sert juste a donner une vraie position a la section d'amorce. */
  leadInLength?: number; // defaut 0.5 m
}): SmartLightZoneLayout {
  const W = opts.width ?? 4;
  const D = opts.depth ?? 3;
  const H = opts.height ?? 2.5;
  const lead = opts.leadInLength ?? 0.5;
  const halfW = W / 2;

  const activeTotal =
    opts.backRightFloorZones + opts.backRightUpZones + opts.topRightToLeftZones +
    opts.backLeftDownZones + opts.leftFloorBToFZones + opts.frontFloorLToRZones +
    opts.rightFloorFToBZones;
  const total = opts.totalZones ?? activeTotal;
  const spareCount = Math.max(0, total - activeTotal);

  const segments: ZoneSegment[] = [];
  const sides: NonNullable<SmartLightZoneLayout["sides"]> = [];
  const spareZones: number[] = [];

  // Ajoute une section : repartit n zones le long du segment start→end et
  // enregistre sa plage sous l'etiquette (label) donnee.
  const pushSection = (
    label: string, n: number, color: string,
    start: Point3D, end: Point3D
  ): void => {
    if (n <= 0) return;
    const startIdx = segments.length;
    for (let i = 0; i < n; i++) {
      segments.push({
        start: _lerpPoint(start, end, i / n),
        end: _lerpPoint(start, end, (i + 1) / n)
      });
    }
    sides.push({ label, zoneStart: startIdx, zoneEnd: segments.length - 1, color });
  };

  pushSection("backRightFloor",  opts.backRightFloorZones,  "#c800ff",
    { x: +halfW, y: 0, z: lead }, { x: +halfW, y: 0, z: 0 });
  pushSection("backRightUp",     opts.backRightUpZones,     "#ff6400",
    { x: +halfW, y: 0, z: 0 },    { x: +halfW, y: H, z: 0 });
  pushSection("topRightToLeft",  opts.topRightToLeftZones,  "#00ff00",
    { x: +halfW, y: H, z: 0 },    { x: -halfW, y: H, z: 0 });
  pushSection("backLeftDown",    opts.backLeftDownZones,    "#00c8ff",
    { x: -halfW, y: H, z: 0 },    { x: -halfW, y: 0, z: 0 });
  pushSection("leftFloorBToF",   opts.leftFloorBToFZones,   "#ff0000",
    { x: -halfW, y: 0, z: 0 },    { x: -halfW, y: 0, z: D });
  pushSection("frontFloorLToR",  opts.frontFloorLToRZones,  "#0000ff",
    { x: -halfW, y: 0, z: D },    { x: +halfW, y: 0, z: D });
  pushSection("rightFloorFToB",  opts.rightFloorFToBZones,  "#ffff00",
    { x: +halfW, y: 0, z: D },    { x: +halfW, y: 0, z: 0 });

  // Place les zones spare a la fin, dans un coin cache.
  for (let i = 0; i < spareCount; i++) {
    const idx = segments.length;
    segments.push({
      start: { x: -halfW - 0.2, y: 0, z: -0.3 - i * 0.02 },
      end:   { x: -halfW - 0.2, y: 0, z: -0.3 - (i + 1) * 0.02 }
    });
    spareZones.push(idx);
  }

  return { mode: "linked", segments, spareZones, sides };
}

// Une lampe connectee (smart light) complete, telle que persistee.
// Regroupe son backend (marque), sa config d'acces, son eventuel miroir DMX,
// son layout 3D, l'effet actif et son etat courant.
export const SmartLightSchema = z.object({
  id: z.string().uuid(),
  name: z.string().min(1),
  room: z.string().min(1).optional(),
  backend: SmartLightBackendTypeSchema,
  config: SmartLightBackendConfigSchema,
  dmxMirror: SmartLightDmxMirrorSchema.nullable().optional(),
  streaming: SmartLightStreamingSchema.optional(),
  /** Placement physique par zone (pour les effets sensibles a la position). */
  zoneLayout: SmartLightZoneLayoutSchema.nullable().optional(),
  /** Effet actif — tourne en continu dans le moteur d'effets (EffectEngine) quand le streaming est actif. */
  currentEffect: SmartLightEffectConfigSchema.nullable().optional(),
  state: SmartLightStateSchema.optional(),
  createdAt: z.string().datetime()
});
export type SmartLight = z.infer<typeof SmartLightSchema>;

// Contenu accepte a la creation / mise a jour d'une lampe : on retire les champs
// generes par le serveur (id, createdAt, state). id reste accepte en option pour
// permettre les mises a jour.
export const SmartLightInputSchema = SmartLightSchema.omit({
  id: true,
  createdAt: true,
  state: true
}).extend({
  id: z.string().uuid().optional()
});
export type SmartLightInput = z.infer<typeof SmartLightInputSchema>;

// Entree pour modifier l'etat d'une lampe (allumage, couleur...). Tous les champs
// sont optionnels : on ne change que ce qui est fourni.
export const SmartLightStateInputSchema = z.object({
  on: z.boolean().optional(),
  hue: z.number().min(0).max(360).optional(),
  sat: z.number().min(0).max(100).optional(),
  brightness: z.number().min(0).max(100).optional(),
  ct: z.number().min(1000).max(10000).optional(),
  // Confort : le client peut passer du RGB directement ; le backend le convertit en HSV.
  rgb: z
    .object({
      r: z.number().int().min(0).max(255),
      g: z.number().int().min(0).max(255),
      b: z.number().int().min(0).max(255)
    })
    .optional()
});
export type SmartLightStateInput = z.infer<typeof SmartLightStateInputSchema>;

// Palette par zone (pour les bandeaux comme le NL72K3 a LED adressables).
// Chaque entree associe un index de zone a une couleur ; les zones non citees
// gardent leur derniere valeur.
export const SmartLightZonePaletteSchema = z.object({
  zones: z
    .array(
      z.object({
        index: z.number().int().min(0).max(999),
        r: z.number().int().min(0).max(255),
        g: z.number().int().min(0).max(255),
        b: z.number().int().min(0).max(255),
        w: z.number().int().min(0).max(255).optional()
      })
    )
    .min(1)
});
export type SmartLightZonePalette = z.infer<typeof SmartLightZonePaletteSchema>;


// Un effet integre de la lampe (nom + actif ou non), tel que rapporte par l'appareil.
export const SmartLightEffectSchema = z.object({
  name: z.string(),
  active: z.boolean().default(false).optional()
});
export type SmartLightEffect = z.infer<typeof SmartLightEffectSchema>;

// Une lampe Nanoleaf trouvee lors de la decouverte (discovery mDNS) sur le reseau.
export const NanoleafDiscoveredSchema = z.object({
  host: z.string(),
  port: z.number().int().default(16021),
  name: z.string().optional(),
  model: z.string().optional()
});
export type NanoleafDiscovered = z.infer<typeof NanoleafDiscoveredSchema>;

// ─── Inventaire unifie des appareils ────────────────────────────────────────
// Vue transverse a tous les backends (DMX, Nanoleaf, Meross, HomeKit, Matter) :
// un meme type d'entree decrit aussi bien un projecteur DMX pilote qu'une
// ampoule Thread qu'on ne sait PAS piloter. C'est volontaire : l'ecran
// "Appareils" doit expliquer les absences autant qu'il liste les presences.

/** Famille d'appareil, utilisee pour regrouper les entrees a l'affichage. */
export const DeviceCategorySchema = z.enum(["dmx", "smart-light", "plug", "bridge", "unknown"]);
export type DeviceCategory = z.infer<typeof DeviceCategorySchema>;

/** Une ligne de l'inventaire. Volontairement plate et deja formatee pour l'UI :
 *  l'agregation vit cote backend, le frontend ne fait qu'afficher. */
export const DeviceInventoryEntrySchema = z.object({
  /** Cle stable : id de l'entite quand elle existe, sinon "<source>:<hote|nom>". */
  id: z.string(),
  name: z.string(),
  category: DeviceCategorySchema,
  /** Chemin de controle en clair : "Art-Net -> QLC+ -> DMX512", "Nanoleaf HTTP + UDP"... */
  transport: z.string(),
  /** true = LightBridge sait piloter cet appareil aujourd'hui. */
  controllable: z.boolean(),
  /** Pourquoi il ne l'est pas. Toujours renseigne quand controllable = false. */
  reason: z.string().optional(),
  /** Adresse lisible : IP, ou plage de canaux DMX. */
  address: z.string().optional(),
  /** Detail court : mode de sortie, nombre de zones, etat de la prise... */
  detail: z.string().optional(),
  /** null = joignabilite inconnue (jamais testee, ou protocole sans retour). */
  reachable: z.boolean().nullable(),
  room: z.string().optional(),
  /** Action proposee par l'UI sur cette ligne. */
  action: z.enum(["pair"]).optional(),
  /** Hote a passer a l'action (appairage Nanoleaf). */
  actionHost: z.string().optional()
});
export type DeviceInventoryEntry = z.infer<typeof DeviceInventoryEntrySchema>;

/** Reponse de GET /api/devices : l'inventaire + la fraicheur du scan reseau. */
export const DeviceInventorySchema = z.object({
  devices: z.array(DeviceInventoryEntrySchema),
  /** Date ISO du dernier scan mDNS, ou null si aucun n'a encore tourne. */
  scannedAt: z.string().nullable()
});
export type DeviceInventory = z.infer<typeof DeviceInventorySchema>;

// Entree pour lancer l'appairage (pairing) d'une lampe : hote + port a contacter.
export const SmartLightPairInputSchema = z.object({
  host: z.string().min(1),
  port: z.number().int().min(1).max(65535).default(16021).optional(),
  name: z.string().min(1).optional(),
  room: z.string().min(1).optional()
});
export type SmartLightPairInput = z.infer<typeof SmartLightPairInputSchema>;

// ─── Evenements WebSocket et parsing QXF ─────────────────────────────────────

// Tous les messages diffuses aux clients via WebSocket (union discriminee sur "type").
// Le frontend s'abonne et met a jour son etat selon le "type" recu.
export const WsEventSchema = z.discriminatedUnion("type", [
  z.object({ type: z.literal("universe_tick"), data: UniverseStateSchema }),
  z.object({ type: z.literal("fixture_updated"), data: FixtureSchema }),
  z.object({ type: z.literal("scene_activated"), data: SceneSchema }),
  z.object({ type: z.literal("log"), data: LogEventSchema }),
  z.object({ type: z.literal("dance_state"), data: DanceStateSchema }),
  z.object({ type: z.literal("smart_light_updated"), data: SmartLightSchema })
]);

export type WsEvent = z.infer<typeof WsEventSchema>;

// Un canal tel que decrit dans un fichier QXF (definition de projecteur QLC+).
// Etend FixtureChannel avec les metadonnees QLC+ : nom obligatoire, groupe, preset.
export const QxfModeChannelSchema = FixtureChannelSchema.extend({
  name: z.string().min(1),
  group: z.string().optional(),
  preset: z.string().optional()
});

export type QxfModeChannel = z.infer<typeof QxfModeChannelSchema>;

// Un mode d'un projecteur QXF : une configuration de canaux (un projecteur peut
// avoir plusieurs modes, ex. 8 canaux ou 16 canaux).
export const QxfModeSchema = z.object({
  name: z.string().min(1),
  channels: z.array(QxfModeChannelSchema),
  channelCount: z.number().int().min(1)
});

export type QxfMode = z.infer<typeof QxfModeSchema>;

// Resultat du parsing d'un fichier QXF : fabricant, modele et liste des modes.
export const QxfParseResultSchema = z.object({
  manufacturer: z.string().min(1),
  model: z.string().min(1),
  modes: z.array(QxfModeSchema)
});

export type QxfParseResult = z.infer<typeof QxfParseResultSchema>;

// Une entree de la bibliotheque QXF locale : le resultat du parsing enrichi du
// chemin du fichier et, eventuellement, de la marque (deduite du dossier).
export const QxfLibraryFixtureSchema = QxfParseResultSchema.extend({
  path: z.string(),
  brand: z.string().optional()
});

export type QxfLibraryFixture = z.infer<typeof QxfLibraryFixtureSchema>;
