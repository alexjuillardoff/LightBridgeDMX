// Service Dance (Mode Dance) : joue des chenillards (chase) lumineux automatiques.
//
// Role : a intervalle aleatoire, il allume/eteint des "groupes" (projecteurs PAR,
// lyres, cotes de bandeaux LED) selon un motif (pattern) choisi au hasard, pour
// faire "danser" la lumiere. Il sait aussi piloter une lyre (moving head) pour
// qu'elle suive le chenillard, et pousser des couleurs sur des lampes connectees.
//
// Place dans le flux : DanceService -> DmxService (canaux DMX) et -> SmartLightService
// (zones des bandeaux LED). La boucle "tick" cadence le tout (voir tick()).
import { EventEmitter } from "node:events";
import type { FastifyBaseLogger } from "fastify";
import {
  Capability,
  DanceConfig,
  DancePatternId,
  DanceState,
  Fixture
} from "@lightbridgedmx/shared";
import { DmxService } from "./dmx";
import { Store } from "../state/store";
import { SmartLightService } from "./smart-lights";

// Capabilities pan/tilt d'une lyre. Sert a les exclure du chenillard si demande.
const PAN_TILT_CAPS: ReadonlySet<Capability> = new Set<Capability>(["pan", "tilt"]);

/** Un "groupe" dans le chenillard (chase) : soit un ensemble de canaux DMX
 *  (projecteur PAR / variateur de lyre), soit une plage continue de zones sur un
 *  bandeau LED (un cote du layout). Chaque etape du motif allume/eteint ces groupes. */
type DanceGroup =
  | {
      kind: "dmx";
      name: string;
      // Identifiant unique : sert a ordonner les groupes et a regrouper les canaux par projecteur.
      fixtureId: string;
      channels: { channel: number; value: number }[];
    }
  | {
      kind: "smart-light-side";
      name: string;
      // `"<smartLightId>:<sideLabel>"` — id stable qui ne peut jamais entrer en collision avec un fixtureId.
      fixtureId: string;
      smartLightId: string;
      zoneStart: number;
      zoneEnd: number;
    };

export class DanceService extends EventEmitter {
  private readonly logger: FastifyBaseLogger;
  private readonly dmx: DmxService;
  private readonly store: Store;
  private readonly smartLights: SmartLightService;
  private config: DanceConfig | null = null;
  private running = false;
  private timer: NodeJS.Timeout | null = null;
  private currentPattern: boolean[][] | null = null;
  private currentPatternName: DancePatternId | null = null;
  private stepIdx = 0;
  private lastMask: boolean[] | null = null;
  private groups: DanceGroup[] = [];
  // Lampes connectees (smart lights) actuellement reservees par Dance — liberees au stop().
  private claimedSmartLightIds: Set<string> = new Set();
  private rememberedSnapshot = new Map<number, { value: number; fixtureId: string }>();
  private fixturesCache: Fixture[] = [];
  private shutterChannels: number[] = []; // canaux absolus de capability "strobe" (shutter) sur les lyres
  private lyreFixtures: {
    fixtureId: string;
    name: string;
    shutterChannel: number;
    dimmerChannel: number;
    panChannel: number | null;
    tiltChannel: number | null;
    speedChannel: number | null;
  }[] = [];
  private lastLyrePan: number | null = null;
  private lastLyreTilt: number | null = null;
  // Horodatage (ms epoch) ou la lyre doit avoir fini son deplacement physique en cours.
  // Tant que Date.now() < cette valeur, la lyre est "en transit" : son variateur (dimmer)
  // et son shutter sont forces a 0 (blackout) pour eviter l'effet de "spot volant"
  // (le faisceau qui balaie la piece pendant que la tete bouge).
  private lyreMoveEndAt = 0;
  private lastRefreshAt = 0;
  private phasesSent = 0;

  constructor(
    logger: FastifyBaseLogger,
    dmx: DmxService,
    store: Store,
    smartLights: SmartLightService
  ) {
    super();
    this.logger = logger.child({ service: "dance" });
    this.dmx = dmx;
    this.store = store;
    this.smartLights = smartLights;
  }

  // Chargement initial au demarrage du backend : lit la config persistee, amorce les
  // valeurs par defaut (lyres, bandeaux), et relance le mode Dance s'il etait actif.
  async init(): Promise<void> {
    this.config = await this.store.getDanceConfig();
    await this.autoseedLyrePositions();
    await this.autoseedSmartLights();
    if (this.config.enabled) {
      this.logger.info("Resuming Dance mode from persisted config");
      await this.start();
    }
  }

  /**
   * Confort au premier lancement (auto-amorcage) : si aucune lampe connectee n'a encore
   * ete configuree pour Dance, on active Dance pour toutes celles qui ont deja des cotes
   * nommes dans leur zoneLayout. Avoir nomme des cotes signifie que l'utilisateur a
   * decoupe le bandeau en sections spatiales — signal clair qu'il veut le faire
   * participer aux chenillards.
   */
  private async autoseedSmartLights() {
    if (!this.config) return;
    if (this.config.smartLights.lightIds.length > 0) return;
    const lights = this.smartLights.listWithState();
    const candidates = lights
      .filter((l) => (l.zoneLayout?.sides?.length ?? 0) > 0)
      .map((l) => l.id);
    if (candidates.length === 0) return;
    this.config = await this.store.saveDanceConfig({
      ...this.config,
      smartLights: { enabled: true, lightIds: candidates },
      updatedAt: new Date().toISOString()
    });
    this.logger.info({ lightIds: candidates }, "Auto-seeded smart lights for Dance mode");
  }

  /**
   * Auto-amorcage des positions pan/tilt connues pour les PARs du salon, la premiere
   * fois qu'on les voit. Ces valeurs servent d'ancres (points de reference) pour que la
   * lyre vise le bon endroit. Elles viennent des mesures de l'utilisateur :
   *   Par 56 - Café  → pan=51, tilt=9   (spot a droite du mur du fond)
   *   Par 56 - Lava  → pan=41, tilt=7   (spot a gauche du mur du fond, les faisceaux se croisent)
   */
  private async autoseedLyrePositions() {
    if (!this.config) return;
    const fixtures = await this.store.listFixtures();
    const seeds: Record<string, { pan: number; tilt: number }> = {
      "Par 56 - Café": { pan: 51, tilt: 9 },
      "Par 56 - Lava": { pan: 41, tilt: 7 }
    };
    const existing = new Set(this.config.lyre.positions.map((p) => p.fixtureId));
    const additions = [];
    for (const f of fixtures) {
      const seed = seeds[f.name];
      if (seed && !existing.has(f.id)) {
        additions.push({ fixtureId: f.id, pan: seed.pan, tilt: seed.tilt });
      }
    }
    if (additions.length > 0) {
      this.config = await this.store.saveDanceConfig({
        ...this.config,
        lyre: {
          ...this.config.lyre,
          positions: [...this.config.lyre.positions, ...additions]
        },
        updatedAt: new Date().toISOString()
      });
      this.logger.info({ additions }, "Auto-seeded lyre positions");
    }
  }

  // Retourne l'etat courant (config + groupes actifs + motif en cours) pour l'UI et le WebSocket.
  async getState(): Promise<DanceState> {
    if (!this.config) this.config = await this.store.getDanceConfig();
    return {
      config: this.config,
      running: this.running,
      activeFixtureIds: this.groups.map((g) => g.fixtureId),
      currentPattern: this.currentPatternName,
      phasesSent: this.phasesSent
    };
  }

  // Applique une modification partielle de la config et la persiste. Si Dance tourne deja,
  // on reconcilie a chaud : reservation/liberation des lampes et reconstruction des groupes,
  // pour que les changements (pieces, lyre, exclusions...) prennent effet immediatement.
  async updateConfig(patch: Partial<DanceConfig>): Promise<DanceState> {
    const current = this.config ?? (await this.store.getDanceConfig());
    const prevLyreEnabled = current.lyre.enabled;
    const next: DanceConfig = {
      ...current,
      ...patch,
      updatedAt: new Date().toISOString()
    };
    const prevSmartLightIds = new Set(current.smartLights.lightIds);
    const prevSmartLightsEnabled = current.smartLights.enabled;
    this.config = await this.store.saveDanceConfig(next);
    if (this.running) {
      // Reconcilie les reservations de lampes : on libere celles retirees (ou desactivees)
      // et on reserve les nouvelles. Si smartLights est totalement desactive, on libere tout.
      const nextEnabled = this.config.smartLights.enabled;
      const nextIds = new Set(this.config.smartLights.lightIds);
      if (prevSmartLightsEnabled && !nextEnabled) {
        this.releaseAllSmartLights();
      } else {
        for (const id of this.claimedSmartLightIds) {
          if (!nextIds.has(id)) {
            this.smartLights.setDanceClaim(id, false);
            this.claimedSmartLightIds.delete(id);
          }
        }
        if (nextEnabled) {
          for (const id of nextIds) {
            if (this.claimedSmartLightIds.has(id)) continue;
            if (this.smartLights.setDanceClaim(id, true)) {
              this.claimedSmartLightIds.add(id);
            }
          }
        }
      }
      void prevSmartLightIds; // variable non utilisee : gardee pour un futur log de diff si besoin
      // Reconstruit les groupes actifs pour appliquer tout de suite les changements (pieces, exclusions, lyre, bandeaux).
      await this.refreshGroups({ force: true });
      this.currentPattern = null;
      this.lastMask = null;
      // Si l'utilisateur vient de desactiver le mode lyre en cours de route : on ferme shutter + variateur.
      if (prevLyreEnabled && !this.config.lyre.enabled) {
        this.closeShutters();
        for (const lyre of this.lyreFixtures) {
          this.dmx.setChannel(lyre.dimmerChannel, 0);
        }
      }
    }
    this.emitState();
    return this.getState();
  }

  // Demarre le mode Dance : reserve les lampes, construit les groupes et lance la boucle tick().
  async start(): Promise<DanceState> {
    if (this.running) return this.getState();
    if (!this.config) this.config = await this.store.getDanceConfig();
    if (!this.config.enabled) {
      this.config = await this.store.saveDanceConfig({ ...this.config, enabled: true, updatedAt: new Date().toISOString() });
    }
    this.running = true;
    this.phasesSent = 0;
    this.rememberedSnapshot.clear();
    this.claimConfiguredSmartLights();
    await this.refreshGroups({ force: true });
    this.scheduleNext(0);
    this.logger.info({ groups: this.groups.length, smartLights: this.claimedSmartLightIds.size }, "Dance started");
    this.emitState();
    return this.getState();
  }

  // Arrete le mode Dance : stoppe la boucle, eteint proprement lyres et shutters, et libere les lampes.
  async stop(): Promise<DanceState> {
    if (!this.running && !this.timer) {
      return this.getState();
    }
    this.running = false;
    if (this.timer) clearTimeout(this.timer);
    this.timer = null;
    this.currentPattern = null;
    this.currentPatternName = null;
    this.lastMask = null;
    // Ferme les shutters pour que la lyre s'eteigne proprement. Les canaux des PAR gardent
    // leur derniere valeur (comportement d'origine : on laisse en l'etat).
    this.closeShutters();
    // Met aussi a 0 le variateur de chaque lyre, sinon elle resterait allumee sur le dernier masque.
    for (const lyre of this.lyreFixtures) {
      this.dmx.setChannel(lyre.dimmerChannel, 0);
    }
    // Libere toutes les lampes connectees — elles reprennent leur effet d'ambiance persiste.
    this.releaseAllSmartLights();
    // Reinitialise la cible memorisee de la lyre, pour que le prochain start reparte de zero.
    this.lastLyrePan = null;
    this.lastLyreTilt = null;
    this.lyreMoveEndAt = 0;
    if (this.config?.enabled) {
      this.config = await this.store.saveDanceConfig({
        ...this.config,
        enabled: false,
        updatedAt: new Date().toISOString()
      });
    }
    this.logger.info("Dance stopped");
    this.emitState();
    return this.getState();
  }

  /** Reserve (claim) toutes les lampes connectees listees dans `config.smartLights.lightIds`.
   *  Seules celles dont le streaming UDP est actif sont reservables — les autres sont
   *  ignorees avec un avertissement (sinon applyZones planterait plus tard). */
  private claimConfiguredSmartLights() {
    this.claimedSmartLightIds.clear();
    if (!this.config?.smartLights.enabled) return;
    for (const id of this.config.smartLights.lightIds) {
      const ok = this.smartLights.setDanceClaim(id, true);
      if (ok) {
        this.claimedSmartLightIds.add(id);
      } else {
        this.logger.warn({ id }, "Could not claim smart light for Dance — streaming disabled or unknown light");
      }
    }
  }

  // Libere toutes les lampes reservees (a l'arret ou quand smartLights est desactive).
  private releaseAllSmartLights() {
    for (const id of this.claimedSmartLightIds) {
      this.smartLights.setDanceClaim(id, false);
    }
    this.claimedSmartLightIds.clear();
  }

  // ----- internes -----

  // Diffuse l'etat courant aux clients via l'evenement "state" (relaye au WebSocket).
  private emitState() {
    void this.getState()
      .then((s) => this.emit("state", s))
      .catch((err) => this.logger.error({ err }, "Failed to emit dance state"));
  }

  /**
   * Reconstruit la liste des groupes participant au chenillard a partir de l'etat actuel
   * des projecteurs et des lampes. C'est ici qu'on decide QUI danse et avec quels canaux.
   *
   * Etapes : on filtre les projecteurs par piece et par capabilities exclues, on memorise
   * la derniere valeur non nulle de chaque canal suivi (snapshot additif), on regroupe par
   * projecteur, on detecte les lyres, puis on ajoute les groupes virtuels (lyres + cotes de
   * bandeaux). Throttle a 2,5 s sauf si `force` est demande.
   */
  private async refreshGroups(opts: { force?: boolean } = {}): Promise<void> {
    if (!this.config) return;
    const now = Date.now();
    // Anti-rebond : on ne reconstruit pas plus souvent que toutes les 2,5 s, sauf force.
    if (!opts.force && now - this.lastRefreshAt < 2500) return;
    this.lastRefreshAt = now;
    this.fixturesCache = await this.store.listFixtures();

    const allowedRooms = new Set(this.config.rooms);
    const excludedCaps = new Set<Capability>(this.config.excludeCapabilities);
    const snapshot = this.dmx.getUniverseSnapshot();

    // Table : canal absolu (adresse de depart + offset) -> { projecteur, capability }.
    // L'adresse DMX d'un canal absolu = address + channel - 1 (les canaux du fixture sont 1-based).
    const channelMeta = new Map<number, { fixtureId: string; fixtureName: string; capability: Capability; room?: string }>();
    for (const f of this.fixturesCache) {
      // Filtre par pieces autorisees (si la config en precise au moins une).
      if (allowedRooms.size > 0 && (!f.room || !allowedRooms.has(f.room))) continue;
      for (const ch of f.channels) {
        const abs = f.address + ch.channel - 1;
        // On peut exclure pan/tilt (eviter de faire bouger les lyres) et d'autres capabilities.
        if (this.config.excludePanTilt && PAN_TILT_CAPS.has(ch.capability)) continue;
        if (excludedCaps.has(ch.capability)) continue;
        channelMeta.set(abs, { fixtureId: f.id, fixtureName: f.name, capability: ch.capability, room: f.room });
      }
    }

    // Lecture additive du snapshot : on garde la derniere valeur non nulle vue pour chaque
    // canal suivi. POURQUOI additif : Dance ne "voit" un projecteur que si l'utilisateur l'a
    // allume au moins une fois (via la console). On memorise alors sa couleur/intensite cible.
    for (const [abs, meta] of channelMeta) {
      const v = snapshot[abs - 1] ?? 0;
      if (v > 0) {
        this.rememberedSnapshot.set(abs, { value: v, fixtureId: meta.fixtureId });
      }
    }

    // Oublie les canaux memorises qui ne sont plus suivis (ex. l'utilisateur a change de pieces).
    for (const abs of [...this.rememberedSnapshot.keys()]) {
      if (!channelMeta.has(abs)) this.rememberedSnapshot.delete(abs);
    }

    // Construit un groupe DMX par projecteur. L'ordre spatial des groupes = ordre de creation
    // en base (surchargeable plus tard par un champ `position` explicite sur le Fixture si besoin).
    const byFixture = new Map<string, Extract<DanceGroup, { kind: "dmx" }>>();
    for (const [abs, { value, fixtureId }] of this.rememberedSnapshot) {
      const meta = channelMeta.get(abs);
      if (!meta) continue;
      if (!byFixture.has(fixtureId)) {
        byFixture.set(fixtureId, { kind: "dmx", name: meta.fixtureName, fixtureId, channels: [] });
      }
      byFixture.get(fixtureId)!.channels.push({ channel: abs, value });
    }

    // Ordonne les groupes selon leur ordre d'apparition dans fixturesCache (ordre base, "presque spatial").
    const order = new Map<string, number>();
    this.fixturesCache.forEach((f, i) => order.set(f.id, i));
    this.groups = [...byFixture.values()].sort(
      (a, b) => (order.get(a.fixtureId) ?? 0) - (order.get(b.fixtureId) ?? 0)
    );

    // Detecte les lyres (moving heads) : un projecteur qui a A LA FOIS un canal strobe (shutter)
    // ET un canal d'intensite. Les lyres ignorent le filtre par pieces — elles rejoignent la danse
    // des que le mode lyre est active. On suit aussi leurs canaux pan/tilt pour qu'elles puissent
    // suivre le chenillard visuellement.
    this.lyreFixtures = [];
    this.shutterChannels = [];
    for (const f of this.fixturesCache) {
      const strobeCh = f.channels.find((c) => c.capability === "strobe");
      const dimmerCh = f.channels.find((c) => c.capability === "intensity");
      if (strobeCh && dimmerCh) {
        const shutterAbs = f.address + strobeCh.channel - 1;
        const dimmerAbs = f.address + dimmerCh.channel - 1;
        // Prend le premier canal pan/tilt "non fine" pour un positionnement grossier (le canal
        // "fine" affine au 1/256e ; inutile ici, on vise large). Repli sur n'importe quel pan/tilt.
        const panCh = f.channels.find((c) => c.capability === "pan" && !/fine/i.test(c.name ?? ""))
          ?? f.channels.find((c) => c.capability === "pan");
        const tiltCh = f.channels.find((c) => c.capability === "tilt" && !/fine/i.test(c.name ?? ""))
          ?? f.channels.find((c) => c.capability === "tilt");
        // Canal de vitesse = "Response speed" sur les lyres Stairville (capability "speed").
        const speedCh = f.channels.find((c) => c.capability === "speed");
        this.lyreFixtures.push({
          fixtureId: f.id,
          name: f.name,
          shutterChannel: shutterAbs,
          dimmerChannel: dimmerAbs,
          panChannel: panCh ? f.address + panCh.channel - 1 : null,
          tiltChannel: tiltCh ? f.address + tiltCh.channel - 1 : null,
          speedChannel: speedCh ? f.address + speedCh.channel - 1 : null
        });
        this.shutterChannels.push(shutterAbs);
      }
    }

    // Si le mode lyre est active, on ajoute chaque lyre comme groupe virtuel (c'est son
    // variateur que le motif allume/eteint). Place EXPRES en fin de chaine spatiale pour que
    // les chenillards l'incluent naturellement comme element le plus a droite.
    if (this.config?.lyre.enabled) {
      const dimmerOn = this.config.lyre.dimmerOnValue;
      for (const lyre of this.lyreFixtures) {
        // Evite un groupe en double si la lyre est deja apparue via le snapshot.
        if (this.groups.some((g) => g.fixtureId === lyre.fixtureId)) continue;
        this.groups.push({
          kind: "dmx",
          name: lyre.name,
          fixtureId: lyre.fixtureId,
          channels: [{ channel: lyre.dimmerChannel, value: dimmerOn }]
        });
      }
    }

    // Ajoute un groupe virtuel par "cote" nomme du layout de chaque lampe RESERVEE. On se base
    // sur `claimedSmartLightIds` (et non la liste de config) pour que ces groupes n'apparaissent
    // que quand la lampe est vraiment sous controle de Dance. Garantie : applyZones() ne plantera
    // pas sur un appareil dont le streaming est coupe, et un groupe-cote ne survit pas a une liberation.
    if (this.config?.smartLights.enabled && this.claimedSmartLightIds.size > 0) {
      for (const lightId of this.claimedSmartLightIds) {
        const light = this.smartLights.getWithState(lightId);
        if (!light) continue;
        const layout = light.zoneLayout;
        if (!layout || !layout.sides || layout.sides.length === 0) continue;
        for (const side of layout.sides) {
          this.groups.push({
            kind: "smart-light-side",
            name: `${light.name} · ${side.label}`,
            fixtureId: `${light.id}:${side.label}`,
            smartLightId: light.id,
            zoneStart: side.zoneStart,
            zoneEnd: side.zoneEnd
          });
        }
      }
    }
  }

  // Vrai tant que la lyre n'a pas fini son deplacement physique en cours.
  private isLyreInMotion(): boolean {
    return Date.now() < this.lyreMoveEndAt;
  }

  // Ouvre le shutter de la lyre quand elle est immobile, le ferme pendant qu'elle se deplace.
  private applyShutterOpen() {
    if (!this.config?.lyre.enabled) return;
    // Pendant le deplacement de la lyre : shutter FERME (blackout). A l'arret : ouvert.
    const value = this.isLyreInMotion() ? 0 : this.config.lyre.shutterOpenValue;
    for (const channel of this.shutterChannels) {
      this.dmx.setChannel(channel, value);
    }
  }

  /**
   * Apres l'application du masque du motif, force le variateur de la lyre a 0 si elle est
   * encore en transit. C'est ce qui produit le "blackout pendant le vol" : la lyre ne
   * s'allume qu'une fois arrivee a sa position cible (evite l'effet de spot volant).
   */
  private applyLyreBlackoutDuringMove() {
    if (!this.config?.lyre.enabled) return;
    if (!this.isLyreInMotion()) return;
    for (const lyre of this.lyreFixtures) {
      this.dmx.setChannel(lyre.dimmerChannel, 0);
    }
  }

  // Pousse la vitesse mecanique de deplacement (canal "speed") sur chaque lyre.
  private applyLyreSpeed() {
    if (!this.config?.lyre.enabled) return;
    const speed = this.config.lyre.speedValue;
    for (const lyre of this.lyreFixtures) {
      if (lyre.speedChannel) this.dmx.setChannel(lyre.speedChannel, speed);
    }
  }

  /**
   * Calcule la cible pan/tilt en interpolant entre les positions connues des projecteurs,
   * puis deplace la lyre pour qu'elle suive les groupes allumes dans le masque courant.
   *
   * Les positions connues forment des ancres (point d'ancrage : index de groupe → pan/tilt).
   * Pour un groupe sans position stockee, on extrapole lineairement a partir des ancres les
   * plus proches. Les lyres elles-memes sont exclues du calcul de cible (la lyre est l'acteur,
   * pas une cible). La lyre vise alors le barycentre (moyenne) des groupes allumes.
   */
  private applyLyrePanTilt(mask: boolean[]) {
    if (!this.config?.lyre.enabled || !this.config.lyre.followChase) return;
    if (this.lyreFixtures.length === 0) return;

    const lyreIds = new Set(this.lyreFixtures.map((l) => l.fixtureId));
    const positionMap = new Map(this.config.lyre.positions.map((p) => [p.fixtureId, p]));

    // Construit les ancres triees par leur position sur la chaine visuelle (idx). Une ancre
    // liee a un projecteur se place a l'index de son groupe ; l'ancre optionnelle "bord de mur
    // droit" se place un cran apres le dernier groupe (idx = groups.length).
    const anchors: { idx: number; pan: number; tilt: number }[] = [];
    this.groups.forEach((g, i) => {
      if (lyreIds.has(g.fixtureId)) return;
      const pos = positionMap.get(g.fixtureId);
      if (pos) anchors.push({ idx: i, pan: pos.pan, tilt: pos.tilt });
    });
    if (this.config.lyre.wallEdgeRight) {
      anchors.push({
        idx: this.groups.length,
        pan: this.config.lyre.wallEdgeRight.pan,
        tilt: this.config.lyre.wallEdgeRight.tilt
      });
    }
    anchors.sort((a, b) => a.idx - b.idx);

    if (anchors.length === 0) return;

    // Interpolation/extrapolation lineaire par morceaux sur toutes les ancres. Pour un index
    // a l'interieur de la plage des ancres : on utilise la paire qui l'encadre. En dehors de la
    // plage : on prolonge avec le segment le plus proche.
    const sample = (i: number): { pan: number; tilt: number } => {
      if (anchors.length === 1) return { pan: anchors[0].pan, tilt: anchors[0].tilt };
      let left = anchors[0];
      let right = anchors[anchors.length - 1];
      if (i <= anchors[0].idx) {
        left = anchors[0];
        right = anchors[1];
      } else if (i >= anchors[anchors.length - 1].idx) {
        left = anchors[anchors.length - 2];
        right = anchors[anchors.length - 1];
      } else {
        for (let j = 0; j < anchors.length - 1; j++) {
          if (anchors[j].idx <= i && i <= anchors[j + 1].idx) {
            left = anchors[j];
            right = anchors[j + 1];
            break;
          }
        }
      }
      // t = position relative entre les deux ancres (0 = gauche, 1 = droite). Le "|| 1" evite
      // une division par zero si deux ancres ont le meme index. Resultat borne en 0-255 (clamp8).
      const span = right.idx - left.idx || 1;
      const t = (i - left.idx) / span;
      return {
        pan: clamp8(Math.round(left.pan + t * (right.pan - left.pan))),
        tilt: clamp8(Math.round(left.tilt + t * (right.tilt - left.tilt)))
      };
    };

    // Somme les positions des groupes allumes (hors lyres) pour en faire la moyenne (barycentre).
    let sumPan = 0;
    let sumTilt = 0;
    let count = 0;
    this.groups.forEach((g, i) => {
      if (!mask[i]) return;
      if (lyreIds.has(g.fixtureId)) return;
      const { pan, tilt } = sample(i);
      sumPan += pan;
      sumTilt += tilt;
      count++;
    });

    if (count === 0) return; // aucun groupe PAR allume → on garde la derniere position de la lyre
    const targetPan = Math.round(sumPan / count);
    const targetTilt = Math.round(sumTilt / count);

    // Cible inchangee : rien a faire.
    if (targetPan === this.lastLyrePan && targetTilt === this.lastLyreTilt) return;

    // N'interrompt pas un deplacement en cours : la lyre finit d'atteindre la cible precedente
    // avant d'en accepter une nouvelle. C'est ce qui garde un rythme allume/eteint coherent :
    // chaque nouvelle cible obtient un cycle propre blackout-puis-allumage.
    const now = Date.now();
    if (now < this.lyreMoveEndAt) return;

    // Duree estimee du deplacement : distance de l'axe le plus long × ms par unite.
    // (Pan et tilt bougent en parallele : la duree est donc limitee par l'axe le plus lent,
    // approxime par le plus grand ecart des deux.)
    const panFrom = this.lastLyrePan ?? targetPan;
    const tiltFrom = this.lastLyreTilt ?? targetTilt;
    const distance = Math.max(Math.abs(targetPan - panFrom), Math.abs(targetTilt - tiltFrom));
    const moveDurationMs = distance * this.config.lyre.msPerPanUnit;
    this.lyreMoveEndAt = now + moveDurationMs;

    this.lastLyrePan = targetPan;
    this.lastLyreTilt = targetTilt;

    for (const lyre of this.lyreFixtures) {
      if (lyre.panChannel) this.dmx.setChannel(lyre.panChannel, targetPan);
      if (lyre.tiltChannel) this.dmx.setChannel(lyre.tiltChannel, targetTilt);
    }
  }

  // Ferme tous les shutters des lyres (met les canaux strobe a 0).
  private closeShutters() {
    for (const channel of this.shutterChannels) {
      this.dmx.setChannel(channel, 0);
    }
  }

  /**
   * Applique une etape du motif : pour chaque groupe, allume (valeur memorisee) ou eteint (0)
   * ses canaux DMX. Pour les cotes de bandeaux LED, on accumule une palette par lampe puis on
   * l'envoie en un seul appel applyZones() a la fin.
   */
  private async applyMask(mask: boolean[]) {
    // POURQUOI accumuler : si chaque groupe-cote appelait applyZones separement, le dernier appel
    // ecraserait la contribution des cotes precedents (palette partielle). On regroupe (coalesce)
    // donc toutes les zones d'une meme lampe avant un unique envoi.
    const palettePerLight = new Map<string, { r: number; g: number; b: number }[]>();
    const ensurePalette = (lightId: string) => {
      let arr = palettePerLight.get(lightId);
      if (!arr) {
        const light = this.smartLights.getWithState(lightId);
        const zoneCount =
          (light?.streaming?.zoneCount as number | undefined) ??
          light?.zoneLayout?.segments.length ??
          50;
        arr = Array.from({ length: zoneCount }, () => ({ r: 0, g: 0, b: 0 }));
        palettePerLight.set(lightId, arr);
      }
      return arr;
    };

    this.groups.forEach((g, i) => {
      const on = mask[i];
      if (g.kind === "dmx") {
        for (const { channel, value } of g.channels) {
          this.dmx.setChannel(channel, on ? value : 0);
        }
        return;
      }
      // smart-light-side : on s'assure que le buffer de palette de cette lampe existe meme
      // quand le cote est eteint, pour que le bandeau passe correctement en noir sur les zones
      // hors-cote (start() garantit que la lampe est claimee).
      const palette = ensurePalette(g.smartLightId);
      if (!on) return;
      const color = this.smartLightFlashColor(g.smartLightId);
      // Borne les bornes de zones a la plage valide (min/max au cas ou zoneStart > zoneEnd).
      const start = Math.max(0, Math.min(g.zoneStart, g.zoneEnd));
      const end = Math.min(palette.length - 1, Math.max(g.zoneStart, g.zoneEnd));
      for (let z = start; z <= end; z++) palette[z] = color;
    });

    // Envoie (flush) la palette de chaque lampe touchee. applyZones leve une erreur si le
    // streaming n'est pas actif — mais on n'arrive ici que pour des lampes reservees avec succes.
    for (const [lightId, zones] of palettePerLight) {
      try {
        this.smartLights.applyZones(lightId, {
          zones: zones.map((c, index) => ({ index, r: c.r, g: c.g, b: c.b }))
        });
      } catch (err) {
        this.logger.warn({ err, lightId }, "Failed to push dance zone palette");
      }
    }
  }

  /**
   * Couleur utilisee quand un cote de bandeau est "allume" dans le masque. On reprend la
   * teinte/saturation (hue/sat) voulue du bandeau a pleine luminosite, pour que la danse
   * pulse dans sa couleur d'ambiance. Repli sur le blanc si aucune couleur n'est definie
   * (luminosite 0 ou saturation 0).
   */
  private smartLightFlashColor(lightId: string): { r: number; g: number; b: number } {
    const light = this.smartLights.getWithState(lightId);
    const state = light?.state;
    if (!state || state.sat === 0 || state.brightness === 0) {
      return { r: 255, g: 255, b: 255 };
    }
    return hsvToRgb255(state.hue, state.sat, 100);
  }

  // Programme le prochain battement (tick) apres `delayMs` ms. Coeur de la cadence de Dance.
  private scheduleNext(delayMs: number) {
    if (!this.running) return;
    this.timer = setTimeout(() => {
      void this.tick();
    }, delayMs);
  }

  /**
   * Un battement (tick) de la boucle Dance : rafraichit les groupes au besoin, choisit/avance
   * le motif, applique l'etape courante, pilote la lyre, puis reprogramme le prochain tick avec
   * un delai aleatoire (entre intervalMinMs et intervalMaxMs) pour un rendu organique.
   */
  private async tick() {
    if (!this.running || !this.config) return;
    try {
      // Rafraichissement periodique : on force TOUS les groupes allumes, on laisse poser, puis
      // on relit le snapshot. POURQUOI : tout allumer brievement permet de re-detecter les
      // valeurs/couleurs cibles des projecteurs au cas ou l'utilisateur les aurait changees.
      if (Date.now() - this.lastRefreshAt > 2500 && this.groups.length > 0) {
        await this.applyMask(this.groups.map(() => true));
        await sleep(80); // ~80 ms : laisse le temps au snapshot DMX de refleter l'etat "tout allume"
        await this.refreshGroups({ force: true });
        this.currentPattern = null;
        this.lastMask = null;
      } else if (this.groups.length === 0) {
        await this.refreshGroups({ force: true });
      }

      // Aucun groupe (rien d'allume / aucune lampe) : on attend et on reessaie plus tard.
      if (this.groups.length === 0) {
        this.scheduleNext(300);
        return;
      }

      // Choisit un nouveau motif quand l'actuel est termine (ou inexistant), au hasard et pondere.
      if (!this.currentPattern || this.stepIdx >= this.currentPattern.length) {
        const pick = pickPattern(this.config.patterns, this.groups.length, this.groups.map((g) => g.name));
        this.currentPattern = pick.steps;
        this.currentPatternName = pick.name;
        this.stepIdx = 0;
      }

      // Etape suivante du motif. On n'envoie au DMX que si le masque a change (evite des trames inutiles).
      const mask = this.currentPattern[this.stepIdx++];
      if (!masksEqual(mask, this.lastMask)) {
        await this.applyMask(mask);
        this.lastMask = mask;
        this.phasesSent++;
        if (this.phasesSent % 300 === 0) this.emitState(); // diffuse l'etat 1 fois sur 300 phases (limite le trafic WebSocket)
      }

      // ATTENTION : l'ordre des 4 appels ci-dessous compte (le blackout doit gagner en dernier).
      // 1. Vitesse de deplacement mecanique (canal "response speed").
      this.applyLyreSpeed();
      // 2. Deplace la lyre pour suivre le(s) groupe(s) allume(s) sur le mur du fond.
      //    Met a jour lyreMoveEndAt, ce qui declenche le blackout-pendant-deplacement plus bas.
      this.applyLyrePanTilt(mask);
      // 3. Ouvre le shutter (ou le ferme si la lyre vole encore vers sa nouvelle cible).
      this.applyShutterOpen();
      // 4. Si la lyre est en transit, force son variateur a 0 (le masque a pu le mettre a 255
      //    plus haut ; ici le blackout l'emporte). Doit etre applique en DERNIER.
      this.applyLyreBlackoutDuringMove();

      // Delai aleatoire avant le prochain tick, entre intervalMinMs et intervalMaxMs.
      // POURQUOI aleatoire : evite un rythme metronomique et donne un rendu plus organique.
      const min = this.config.intervalMinMs;
      const max = Math.max(min, this.config.intervalMaxMs);
      const delay = Math.round(min + Math.random() * (max - min));
      this.scheduleNext(delay);
    } catch (err) {
      // En cas d'erreur, on ne casse pas la boucle : on reprogramme un tick dans 500 ms.
      this.logger.error({ err }, "Dance tick failed");
      this.scheduleNext(500);
    }
  }
}

// ----- motifs (patterns) -----
// Chaque fonction patternXxx(n) construit un motif : un tableau d'etapes, chaque etape etant un
// masque de n booleens (true = groupe allume a cette etape). n = nombre de groupes participants.

type PatternEntry = {
  id: DancePatternId;
  weight: number;
  build: (n: number, names: string[]) => boolean[][];
};

// Chenillard simple : une seule lumiere allumee qui se deplace de gauche a droite.
const patternChase = (n: number) =>
  Array.from({ length: n }, (_, i) => Array.from({ length: n }, (_, j) => j === i));
// Chenillard inverse : le meme, mais de droite a gauche.
const patternReverseChase = (n: number) => patternChase(n).reverse();
// Ping-pong : aller-retour (gauche→droite puis droite→gauche sans repeter les extremes).
const patternPingPong = (n: number) => {
  if (n <= 1) return patternChase(n);
  return [...patternChase(n), ...patternChase(n).slice(1, -1).reverse()];
};
// Alternance : un groupe sur deux allume, puis l'inverse (effet damier qui clignote).
const patternAlternate = (n: number) => {
  const a = Array.from({ length: n }, (_, i) => i % 2 === 0);
  const b = a.map((v) => !v);
  return [a, b, a, b];
};
// Sous-ensemble aleatoire : 6 etapes ou chaque groupe est allume au hasard (50 %).
// Garantit au moins un groupe allume par etape pour ne jamais tomber dans le noir total.
const patternRandomSubset = (n: number) =>
  Array.from({ length: 6 }, () => {
    const mask = Array.from({ length: n }, () => Math.random() < 0.5);
    if (!mask.some(Boolean)) mask[Math.floor(Math.random() * n)] = true;
    return mask;
  });
// Tout en meme temps : flash global (tout allume) puis tout eteint.
const patternAllHit = (n: number) => [Array(n).fill(true), Array(n).fill(false)];

// "Vrai" strobe synchronise : une longue rafale ou tous les projecteurs clignotent ensemble,
// pour que l'effet strobe soit visible comme un evenement soutenu avant de changer de motif.
// 8 cycles allume/eteint ≈ 1 a 2 s de strobe selon l'intervalle.
const patternStrobeSync = (n: number) => {
  const out: boolean[][] = [];
  const on = Array(n).fill(true);
  const off = Array(n).fill(false);
  for (let i = 0; i < 8; i++) {
    out.push(on);
    out.push(off);
  }
  return out;
};
// Paires : allume les groupes par paquets de 2, en alternant un paquet sur deux (joue 2 cycles).
const patternPairs = (n: number) => {
  const out: boolean[][] = [];
  for (let phase = 0; phase < 2; phase++) {
    out.push(Array.from({ length: n }, (_, i) => Math.floor(i / 2) % 2 === phase));
  }
  return [...out, ...out];
};
// Onde (wave) gauche→droite : deux groupes adjacents allumes qui balaient (j === i ou j === i-1).
const patternWaveLR = (n: number) =>
  Array.from({ length: n + 1 }, (_, i) =>
    Array.from({ length: n }, (_, j) => j === i || j === i - 1)
  );
// Onde droite→gauche : la meme onde, chaque masque inverse.
const patternWaveRL = (n: number) => patternWaveLR(n).map((m) => [...m].reverse());
// Bookend "vers l'interieur" : d'abord les deux extremites, puis tout le centre.
const patternBookendIn = (n: number) => {
  if (n < 2) return patternChase(n);
  return [
    Array.from({ length: n }, (_, i) => i === 0 || i === n - 1),
    Array.from({ length: n }, (_, i) => i !== 0 && i !== n - 1)
  ];
};
// Bookend "vers l'exterieur" : d'abord le centre, puis les deux extremites.
const patternBookendOut = (n: number) => {
  if (n < 3) return patternChase(n);
  return [
    Array.from({ length: n }, (_, i) => i !== 0 && i !== n - 1),
    Array.from({ length: n }, (_, i) => i === 0 || i === n - 1)
  ];
};

// Catalogue des motifs disponibles. `weight` = poids du tirage aleatoire : plus il est
// eleve, plus le motif a de chances d'etre choisi (voir pickPattern).
const PATTERNS: PatternEntry[] = [
  { id: "chase", weight: 2, build: patternChase },
  { id: "reverseChase", weight: 2, build: patternReverseChase },
  { id: "pingPong", weight: 2, build: patternPingPong },
  { id: "waveLR", weight: 3, build: patternWaveLR },
  { id: "waveRL", weight: 3, build: patternWaveRL },
  { id: "alternate", weight: 1, build: patternAlternate },
  { id: "pairs", weight: 1, build: patternPairs },
  { id: "randomSubset", weight: 2, build: patternRandomSubset },
  { id: "allHit", weight: 1, build: patternAllHit },
  { id: "strobeSync", weight: 3, build: patternStrobeSync },
  { id: "bookendIn", weight: 2, build: patternBookendIn },
  { id: "bookendOut", weight: 1, build: patternBookendOut }
];

/**
 * Choisit un motif au hasard parmi ceux actives, pondere par `weight` (tirage roulette).
 * Si la liste des motifs actives est vide, on retombe sur le catalogue complet.
 * @param enabled ids des motifs autorises par la config
 * @param n nombre de groupes participants (passe a la fonction de construction)
 * @param names noms des groupes (dispo pour de futurs motifs nommes)
 * @returns le motif choisi (son id + ses etapes deja construites)
 */
function pickPattern(
  enabled: DancePatternId[],
  n: number,
  names: string[]
): { name: DancePatternId; steps: boolean[][] } {
  const allowed = PATTERNS.filter((p) => enabled.includes(p.id));
  const pool = allowed.length > 0 ? allowed : PATTERNS;
  const total = pool.reduce((s, p) => s + p.weight, 0);
  // Tirage roulette : on tire r dans [0,total[ puis on soustrait les poids jusqu'a passer sous 0.
  let r = Math.random() * total;
  for (const p of pool) {
    if ((r -= p.weight) <= 0) {
      return { name: p.id, steps: p.build(n, names) };
    }
  }
  // Securite : si l'arrondi flottant nous fait sortir de la boucle, on prend le premier motif.
  return { name: pool[0].id, steps: pool[0].build(n, names) };
}

// Compare deux masques. Sert a n'envoyer une trame DMX que lorsque l'etat change vraiment.
function masksEqual(a: boolean[], b: boolean[] | null): boolean {
  if (!b || a.length !== b.length) return false;
  for (let i = 0; i < a.length; i++) if (a[i] !== b[i]) return false;
  return true;
}

// Petite pause asynchrone de `ms` millisecondes.
function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

// Borne (clamp) une valeur dans la plage DMX valide 0-255 (NaN → 0 par securite).
function clamp8(v: number): number {
  if (Number.isNaN(v)) return 0;
  return Math.max(0, Math.min(255, v));
}

/** Conversion HSV (h:0-360, s:0-100, v:0-100) → RGB 0-255. */
function hsvToRgb255(h: number, s: number, v: number): { r: number; g: number; b: number } {
  const sn = Math.max(0, Math.min(100, s)) / 100;
  const vn = Math.max(0, Math.min(100, v)) / 100;
  const hh = ((h % 360) + 360) % 360;
  const c = vn * sn;
  const x = c * (1 - Math.abs(((hh / 60) % 2) - 1));
  const m = vn - c;
  let r = 0;
  let g = 0;
  let b = 0;
  if (hh < 60) [r, g, b] = [c, x, 0];
  else if (hh < 120) [r, g, b] = [x, c, 0];
  else if (hh < 180) [r, g, b] = [0, c, x];
  else if (hh < 240) [r, g, b] = [0, x, c];
  else if (hh < 300) [r, g, b] = [x, 0, c];
  else [r, g, b] = [c, 0, x];
  return {
    r: Math.round((r + m) * 255),
    g: Math.round((g + m) * 255),
    b: Math.round((b + m) * 255)
  };
}
