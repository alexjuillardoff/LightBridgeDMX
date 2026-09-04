// =============================================================================
// SmartLightService : registre central des lampes connectees (smart lights).
//
// Role : pour chaque lampe (aujourd'hui Nanoleaf, d'autres backends plus tard),
// ce module garde un etat "voulu" (desired) et l'envoie a l'appareil via deux
// chemins de sortie :
//   - HTTP regroupe (coalesce) : envoi PUT /state quand l'etat change (par defaut)
//   - streaming UDP extControl : flux continu basse latence (~5-15 ms)
//
// Il gere aussi le miroir DMX (mirror), le rafraichissement periodique depuis
// l'appareil (pour suivre les apps externes) et les effets.
// Il herite d'EventEmitter et emet "light_updated" a chaque changement d'etat ;
// la couche WebSocket re-diffuse (broadcast) l'evenement aux clients.
// =============================================================================
import { EventEmitter } from "node:events";
import type { FastifyBaseLogger } from "fastify";
import {
  dmxToKelvin,
  kelvinToRgb,
  SmartLight,
  SmartLightEffectConfig,
  SmartLightDmxZoneMirror,
  SmartLightState,
  SmartLightStateInput,
  SmartLightZoneLayout,
  SmartLightZonePalette,
  UniverseState
} from "@lightbridgedmx/shared";
import { DmxService } from "../dmx";
import { Store } from "../../state/store";
import { NanoleafApiError, NanoleafClient, rgbToHsv } from "./nanoleaf-client";
import { NanoleafStreamer } from "./nanoleaf-streamer";
import { HomeKitThreadClient } from "./homekit-thread-client";

// Etat de fonctionnement (runtime) garde en memoire pour chaque lampe.
// Ce n'est PAS persiste tel quel ; seul `light` reflete la base SQLite.
type RuntimeEntry = {
  light: SmartLight;
  client: NanoleafClient | null;
  /** Client du sidecar HomeKit-sur-Thread, pour les ampoules NL45 & co. Exclusif
   *  avec `client` : une lampe releve d'un backend ou de l'autre, jamais des deux. */
  threadClient: HomeKitThreadClient | null;
  streamer: NanoleafStreamer | null;
  /** Dernier etat envoye avec succes via HTTP. */
  lastPushed: SmartLightState | null;
  /** Etat voulu — compare a lastPushed par la boucle de flush. */
  desired: SmartLightState;
  /** Palette par zone optionnelle — si presente, le streamer l'envoie au lieu d'une couleur uniforme.
   *  Effacee des qu'une ecriture de couleur uniforme arrive via setState/applyState. */
  zonePalette: SmartLightZonePalette | null;
  /** Horodatage du dernier appel reseau reussi (push HTTP). */
  lastPushAt: number;
  /** Garde-fou anti-concurrence : un seul push HTTP en cours a la fois. */
  inflight: boolean;
  /** Horodatage de la derniere ecriture locale — le refresh depuis l'appareil
   *  ne se declenche que si l'on est reste calme (quiescent) depuis ce moment. */
  lastLocalWriteAt: number;
  /** Derniere combinaison de canaux DMX appliquee par le miroir, sous forme de cle.
   *  Sert a n'agir que sur un VRAI changement du DMX (voir onDmxTick). */
  /** Derniere lecture des canaux du miroir uniforme. On garde les valeurs et non
   *  une empreinte : savoir QUEL groupe a bouge decide du mode couleur. */
  lastMirror: { r?: number; g?: number; b?: number; bri?: number; ct?: number } | null;
  /** Chien de garde (watchdog) du streaming : un seul controle en vol a la fois. */
  streamCheckInflight: boolean;
  /** Horodatage avant lequel le watchdog ne retente pas (backoff exponentiel). */
  streamRetryAt: number;
  /** Echecs consecutifs de (re)activation du streaming — pilote le backoff. */
  streamFailures: number;
  /** Derniere trame par zone lue depuis le miroir DMX par zone (null si pas de miroir zones,
   *  ou tant qu'aucun tick DMX n'est passe). Sert aussi de reference pour detecter un changement. */
  dmxZones: Array<{ index: number; r: number; g: number; b: number }> | null;
  /** Dernier niveau lu sur le canal de dimmer maitre du miroir par zone, ramene a
   *  l'echelle 0..1. `null` = aucun canal de dimmer configure : les zones partent
   *  alors a pleine echelle, comme avant l'introduction du master. */
  dmxMaster: number | null;
  /** True quand le bloc DMX par zone a bouge en dernier — le DMX possede alors le bandeau
   *  (priorite sur l'effet et sur desired.on). Une ecriture locale (painter, effet, couleur)
   *  rend la main jusqu'au prochain mouvement du DMX. */
  dmxZonesOwned: boolean;
  /** Horodatage de la derniere diffusion d'un mouvement de master repercute en
   *  luminosite. Un fader bouge en continu : sans cette borne, un seul mouvement
   *  emettrait 60 evenements par seconde vers le WebSocket et vers HomeKit. */
  masterEmitAt: number;
};

// Valeurs en dur de cadence reseau. Choisies pour ne pas saturer l'appareil.
const MIN_PUSH_INTERVAL_MS = 70;     // throttle HTTP par appareil — ~14 ecritures/s
// Thread est un medium radio partage a ~125 kbps utiles : une ampoule y encaisse
// environ 5 ecritures/s avant que la file ne s'allonge plus vite qu'elle ne se vide.
// On vise volontairement plus bas, et on compte sur le fondu interne de l'ampoule
// pour lisser le mouvement entre deux ordres.
const THREAD_PUSH_INTERVAL_MS = 250;
// Tolerance de comparaison pour le chemin Thread, plus fine que le defaut de 1.
// Un pas de canal DMX vaut (1 / 255) * 100 = 0,39 point de luminosite : en dessous
// de ce seuil on ignorerait le plus petit mouvement de fader possible. On se cale
// donc juste sous ce pas, pour qu'un cran de fader soit toujours pris en compte.
const THREAD_DIFF_TOLERANCE = 0.3;
const FLUSH_INTERVAL_MS = 30;        // tick de regroupement (coalesce) ~33 Hz (chemin HTTP)
const REFRESH_INTERVAL_MS = 5000;    // refresh periodique depuis l'appareil
const REFRESH_QUIESCENT_MS = 2000;   // ne pas refresh si l'utilisateur a ecrit dans cette fenetre
const STREAM_WATCHDOG_INTERVAL_MS = 10000; // tick du chien de garde (watchdog) du streaming UDP
const STREAM_RETRY_BASE_MS = 2000;   // premier delai de backoff apres un echec de (re)activation
const STREAM_RETRY_MAX_MS = 60000;   // plafond du backoff — un appareil hors ligne n'est pas martele
const MASTER_EMIT_INTERVAL_MS = 200; // cadence max de diffusion d'un master repercute en luminosite

/** Luminosite maitre imposee a l'appareil avant toute entree en extControl.
 *
 *  La trame extControl ne transporte que des couleurs : l'appareil multiplie ensuite
 *  ce qu'il recoit par sa luminosite maitre, et cette valeur est injoignable pendant le
 *  streaming (flushAll saute les lampes en streaming). Une lampe entree en extControl a
 *  38 % plafonne donc a 38 % sans que rien ne le signale : le blanc plein sort gris.
 *  On la neutralise donc a fond, une bonne fois, et l'intensite se joue ailleurs —
 *  dans la trame, via le dimmer maitre du miroir DMX (`dimmerChannel`).
 */
const EXT_CONTROL_MASTER_BRIGHTNESS = 100;

/** Nom que Nanoleaf renvoie dans effects/select quand l'appareil est en mode extControl.
 *  C'est le seul temoin fiable, cote appareil, que le flux UDP est reellement pris en compte. */
const EXT_CONTROL_EFFECT = "*ExtControl*";

/**
 * Gere un registre de "smart lights" (Nanoleaf aujourd'hui, d'autres backends
 * plus tard) avec deux chemins de sortie :
 *   - HTTP regroupe PUT /state (par defaut, ~100 ms de latence, sans etat supplementaire sur l'appareil)
 *   - streaming UDP extControl v2 (~5-15 ms de latence, necessite streamer.enable())
 *
 * En plus :
 *   - miroir DMX bidirectionnel (recopie RGB/luminosite depuis des canaux DMX configures)
 *   - refresh periodique de l'etat depuis l'appareil (pour rester synchro avec les apps externes)
 *   - effets : TOUS calcules localement par le moteur d'effets, jamais delegues aux
 *     effets embarques de l'appareil (voir setEffect)
 *
 * Emet "light_updated" a chaque changement d'etat d'une lampe (apres un push
 * reussi ou apres une synchro depuis l'appareil). Les ecouteurs (couche WebSocket) re-diffusent.
 */
export class SmartLightService extends EventEmitter {
  private readonly logger: FastifyBaseLogger;
  private readonly runtime = new Map<string, RuntimeEntry>();
  private flushTimer: NodeJS.Timeout | null = null;
  private refreshTimer: NodeJS.Timeout | null = null;
  private streamWatchdogTimer: NodeJS.Timeout | null = null;
  private readonly store: Store;
  private readonly dmx: DmxService;
  private readonly tickHandler: (state: UniverseState) => void;

  constructor(logger: FastifyBaseLogger, dmx: DmxService, store: Store) {
    super();
    this.logger = logger.child({ service: "smart-lights" });
    this.dmx = dmx;
    this.store = store;
    this.tickHandler = (state) => this.onDmxTick(state);
  }

  // Demarre le service : charge les lampes depuis la base, branche le tick DMX
  // et lance les trois boucles periodiques (flush HTTP, streaming UDP, refresh).
  async start(): Promise<void> {
    const lights = await this.store.listSmartLights();
    for (const light of lights) await this.registerInternal(light);

    this.dmx.on("tick", this.tickHandler);
    this.flushTimer = setInterval(() => this.flushAll(), FLUSH_INTERVAL_MS);
    this.refreshTimer = setInterval(() => this.refreshAllIfQuiescent(), REFRESH_INTERVAL_MS);
    this.streamWatchdogTimer = setInterval(() => this.watchStreamingAll(), STREAM_WATCHDOG_INTERVAL_MS);
    this.logger.info({ count: lights.length }, "SmartLightService started");

    // Premiere passe du watchdog : rattrape les lampes dont enable() a echoue
    // pendant registerInternal (appareil encore en train de booter, par exemple).
    this.watchStreamingAll();

    // Synchro initiale "au mieux" depuis chaque appareil pour que l'UI affiche un etat reel.
    for (const entry of this.runtime.values()) {
      void this.refreshFromDevice(entry);
    }
  }

  // Arrete le service : coupe les boucles, debranche le tick DMX et desactive
  // les streamers UDP encore actifs avant de vider le registre.
  async stop(): Promise<void> {
    if (this.flushTimer) clearInterval(this.flushTimer);
    if (this.refreshTimer) clearInterval(this.refreshTimer);
    if (this.streamWatchdogTimer) clearInterval(this.streamWatchdogTimer);
    this.flushTimer = this.refreshTimer = this.streamWatchdogTimer = null;
    this.dmx.off("tick", this.tickHandler);
    for (const entry of this.runtime.values()) {
      if (entry.streamer) await entry.streamer.disable().catch(() => {});
    }
    this.runtime.clear();
  }

  // Enregistre (ou met a jour) une lampe et tente une synchro immediate avec l'appareil.
  async register(light: SmartLight): Promise<void> {
    await this.registerInternal(light);
    const entry = this.runtime.get(light.id);
    if (entry) void this.refreshFromDevice(entry);
  }

  // Retire une lampe du registre et coupe son streamer UDP s'il tournait.
  async unregister(id: string): Promise<void> {
    const entry = this.runtime.get(id);
    if (entry?.streamer) await entry.streamer.disable().catch(() => {});
    this.runtime.delete(id);
  }

  // Liste toutes les lampes en y injectant l'etat voulu courant (pour l'API/UI).
  listWithState(): SmartLight[] {
    return [...this.runtime.values()].map((entry) => ({
      ...entry.light,
      state: entry.desired
    }));
  }

  // Renvoie une lampe precise avec son etat voulu courant, ou undefined si inconnue.
  getWithState(id: string): SmartLight | undefined {
    const entry = this.runtime.get(id);
    if (!entry) return undefined;
    return { ...entry.light, state: entry.desired };
  }

  // Applique une modification d'etat (couleur, on/off, luminosite...) a la lampe.
  // On ne fait que mettre a jour l'etat "desired" en memoire ; l'envoi reel a
  // l'appareil est fait plus tard par la boucle flushAll (chemin HTTP).
  applyState(id: string, patch: SmartLightStateInput): SmartLight | undefined {
    const entry = this.runtime.get(id);
    if (!entry) return undefined;
    entry.lastLocalWriteAt = Date.now();

    const next: SmartLightState = { ...entry.desired };
    if (patch.rgb) {
      // Nanoleaf raisonne en HSB ; on convertit donc le RGB recu en teinte/saturation.
      const { h, s, v } = rgbToHsv(patch.rgb.r, patch.rgb.g, patch.rgb.b);
      next.hue = h;
      next.sat = s;
      next.colorMode = "hs";
      // La luminosite n'est deduite du RGB que si l'appelant ne l'a pas precisee a part.
      if (patch.brightness === undefined) next.brightness = v;
      // Pratique : envoyer une couleur non noire sans dire on:true rallume la lampe.
      if (patch.on === undefined && (patch.rgb.r > 0 || patch.rgb.g > 0 || patch.rgb.b > 0)) {
        next.on = true;
      }
    }
    if (patch.on !== undefined) next.on = patch.on;
    if (patch.hue !== undefined) {
      next.hue = patch.hue;
      next.colorMode = "hs";
    }
    if (patch.sat !== undefined) {
      next.sat = patch.sat;
      next.colorMode = "hs";
    }
    if (patch.brightness !== undefined) next.brightness = patch.brightness;
    if (patch.ct !== undefined) {
      next.ct = patch.ct;
      next.colorMode = "ct";
    }

    const previous = entry.desired;
    entry.desired = next;
    entry.zonePalette = null; // une ecriture de couleur uniforme efface toute palette par zone
    entry.dmxZonesOwned = false; // et rend la main au pilotage local jusqu'au prochain mouvement DMX

    // Le reste de LightBridge n'apprend l'etat d'une lampe que par cet evenement.
    // Il n'etait emis que par flushAll, apres un push HTTP reussi — or flushAll
    // saute les lampes en streaming : une couleur posee depuis l'app Maison
    // changeait bien le bandeau, mais l'onglet Lampes et le pupitre restaient sur
    // l'ancienne valeur, sans que rien ne vienne jamais les detromper.
    // On ne diffuse que sur changement reel : une consigne identique repetee
    // (curseur repose au meme endroit) n'a rien a annoncer.
    const modeChanged = next.colorMode !== previous.colorMode;
    if (modeChanged || computeStateDiff(previous, next, 0) !== null) {
      this.emit("light_updated", { ...entry.light, state: next });
    }
    return { ...entry.light, state: next };
  }

  /** Envoie une palette par zone via le streamer, en allumant le streaming UDP s'il
   *  ne l'etait pas : une palette par zone n'a pas d'autre chemin de sortie. */
  async applyZones(id: string, palette: SmartLightZonePalette): Promise<SmartLight | undefined> {
    const entry = this.runtime.get(id);
    if (!entry) return undefined;
    entry.lastLocalWriteAt = Date.now();
    await this.ensureStreamingForZoneWork(id);
    if (!entry.streamer?.isEnabled()) {
      throw new Error("Streaming UDP indisponible sur cette lampe (appareil injoignable ?)");
    }
    entry.zonePalette = palette;
    entry.dmxZonesOwned = false; // peinture manuelle : le miroir DMX par zone reprend la main plus tard
    entry.streamer.sendZones(palette.zones);
    return { ...entry.light, state: entry.desired };
  }

  /** Allume le streaming UDP si une ecriture par zone (effet, painter) le reclame et
   *  qu'il est encore eteint.
   *
   *  Sans ca, peindre ou lancer un effet sur un bandeau dont le streaming est coupe ne
   *  produit RIEN : streamAll() sort au premier test (`if (!s?.isEnabled()) continue`),
   *  les canaux DMX bougent, l'UI affiche l'effet en cours, et le bandeau reste sur sa
   *  derniere trame. Aucun message, aucune erreur — c'est exactement la panne qu'on a
   *  mis une session a diagnostiquer. Demander une couleur par zone, c'est demander le
   *  seul transport qui sache la porter. */
  private async ensureStreamingForZoneWork(id: string): Promise<void> {
    const entry = this.runtime.get(id);
    if (!entry) return;
    if (entry.light.config.type !== "nanoleaf-http") return; // pas de streaming ailleurs
    if (entry.light.streaming?.enabled === true && entry.streamer?.isEnabled()) return;
    try {
      await this.setStreaming(id, true);
      this.logger.info({ id }, "Streaming UDP active automatiquement pour une ecriture par zone");
    } catch (err) {
      this.logger.warn({ err, id }, "Echec de l'activation automatique du streaming UDP");
    }
  }

  /** Met a jour la disposition (layout) physique par zone : coordonnees de
   *  debut/fin de chaque zone. Sert au moteur d'effets sensible a la position. */
  async setLayout(id: string, layout: SmartLightZoneLayout | null): Promise<SmartLight | undefined> {
    const entry = this.runtime.get(id);
    if (!entry) return undefined;
    const updated = await this.store.updateSmartLight(id, { zoneLayout: layout });
    entry.light = updated;
    this.emit("light_updated", { ...updated, state: entry.desired });
    return { ...updated, state: entry.desired };
  }

  /** Active/desactive le streaming UDP pour une lampe. Persiste le choix de
   *  l'utilisateur et (re)demarre le socket UDP en consequence. */
  async setStreaming(id: string, enabled: boolean, zoneCount?: number): Promise<SmartLight | undefined> {
    const entry = this.runtime.get(id);
    if (!entry?.client) return undefined;
    // Le streaming UDP est propre au protocole Nanoleaf : une ampoule Thread n'en a pas.
    const cfg = entry.light.config;
    if (cfg.type !== "nanoleaf-http") return undefined;

    if (enabled) {
      // Nombre de zones : valeur fournie, sinon celle deja connue, sinon 50 (NL72K3).
      const zc = zoneCount ?? entry.light.streaming?.zoneCount ?? 50;
      if (!entry.streamer) {
        entry.streamer = new NanoleafStreamer({
          host: cfg.host,
          port: 60222,
          zoneCount: zc,
          client: entry.client,
          logger: this.logger
        });
      } else {
        entry.streamer.setZoneCount(zc);
      }
      // Sous tension ET a pleine luminosite AVANT d'entrer en extControl : une fois
      // dedans, plus aucune trame ne peut ni rallumer l'appareil ni remonter sa
      // luminosite maitre. Un strip entre en extControl a 38 % y reste bloque, et
      // peint tout le show a 38 % sans que rien ne le signale.
      await entry.client
        .setState({ on: true, brightness: EXT_CONTROL_MASTER_BRIGHTNESS })
        .catch(() => {});
      await entry.streamer.enable();
    } else {
      if (entry.streamer) await entry.streamer.disable();
    }

    const updated = await this.store.updateSmartLight(id, {
      streaming: { enabled, zoneCount: zoneCount ?? entry.light.streaming?.zoneCount }
    });
    entry.light = updated;
    this.emit("light_updated", { ...updated, state: entry.desired });
    return { ...updated, state: entry.desired };
  }

  /**
   * Enregistre ou met a jour une lampe dans le runtime.
   * ATTENTION : on reutilise le client et le streamer existants tant que possible.
   * Les recreer a chaque mise a jour de config faisait que plusieurs sockets UDP
   * se battaient pour piloter l'appareil (scintillement visible) : le keepalive de
   * l'ancien streamer continuait a tourner apres l'installation du nouveau.
   *
   * Le streamer n'est detruit + recree que si :
   *   - l'host ou le port de la lampe a change (autre appareil physique) ;
   *   - l'utilisateur a explicitement coupe le streaming (gere par setStreaming, pas ici).
   * Sinon on garde le streamer existant et on met juste a jour son zoneCount sur place.
   */
  private async registerInternal(light: SmartLight): Promise<void> {
    const existing = this.runtime.get(light.id);
    // Config restreinte au variant Nanoleaf : `isNanoleaf` seul ne restreint pas le
    // type de `light.config` aux yeux de TypeScript (une union ne se discrimine pas
    // via un booleen intermediaire). On garde donc la valeur narrowee sous la main.
    const nl = light.config.type === "nanoleaf-http" ? light.config : null;
    const isNanoleaf = light.backend === "nanoleaf-http" && nl !== null;

    // ── Client ─────────────────────────────────────────────────────────────
    // On reutilise le client existant sauf si l'host ou le token a change.
    let client: NanoleafClient | null = existing?.client ?? null;
    if (isNanoleaf) {
      const prevConfig = existing?.light.config.type === "nanoleaf-http" ? existing.light.config : null;
      const configChanged =
        !prevConfig ||
        prevConfig.host !== nl!.host ||
        prevConfig.port !== nl!.port ||
        prevConfig.token !== nl!.token;
      if (configChanged || !client) {
        client = new NanoleafClient({
          host: nl!.host,
          port: nl!.port,
          token: nl!.token,
          logger: this.logger
        });
      }
    } else {
      client = null;
    }

    // ── Client Thread ───────────────────────────────────────────────────────
    // On reutilise l'instance existante tant que l'alias et l'URL du sidecar n'ont
    // pas bouge : la recreer ne servirait a rien, le client est sans etat.
    let threadClient: HomeKitThreadClient | null = existing?.threadClient ?? null;
    if (light.config.type === "homekit-thread") {
      const prev = existing?.light.config.type === "homekit-thread" ? existing.light.config : null;
      if (!prev || prev.alias !== light.config.alias || prev.sidecarUrl !== light.config.sidecarUrl) {
        threadClient = new HomeKitThreadClient({
          alias: light.config.alias,
          sidecarUrl: light.config.sidecarUrl,
          logger: this.logger
        });
      }
    } else {
      threadClient = null;
    }

    // ── Streamer ────────────────────────────────────────────────────────────
    // On reutilise le streamer existant si l'host n'a pas change. On met a jour
    // son nombre de zones sur place. On n'appelle enable() que s'il ne l'est pas deja.
    let streamer: NanoleafStreamer | null = existing?.streamer ?? null;
    const wantStreaming = isNanoleaf && light.streaming?.enabled === true && !!nl!.token;
    const zc = (isNanoleaf && light.streaming?.zoneCount) || 50;

    if (wantStreaming && client) {
      const prevHost = existing?.light.config.type === "nanoleaf-http" ? existing.light.config.host : null;
      const hostChanged = prevHost && prevHost !== nl!.host;
      if (hostChanged && streamer) {
        await streamer.disable().catch(() => {});
        streamer = null;
      }
      if (!streamer) {
        streamer = new NanoleafStreamer({
          host: nl!.host,
          port: 60222,
          zoneCount: zc,
          client,
          logger: this.logger
        });
        try {
          // Meme preparation que setStreaming : sous tension et luminosite maitre a
          // fond, sinon on entre en extControl sur l'etat ou l'appareil se trouvait.
          await client
            .setState({ on: true, brightness: EXT_CONTROL_MASTER_BRIGHTNESS })
            .catch(() => {});
          await streamer.enable();
        } catch (err) {
          this.logger.warn({ err, id: light.id }, "Failed to enable streaming on register — will retry on next setStreaming");
        }
      } else {
        streamer.setZoneCount(zc);
        // On ne rappelle pas enable() s'il est deja actif : le streamer a deja un
        // garde-fou, mais sauter l'appel evite tout risque de doubler les keepalive
        // (setInterval) cote streamer.
        if (!streamer.isEnabled()) {
          try {
            await streamer.enable();
          } catch (err) {
            this.logger.warn({ err, id: light.id }, "Failed to re-enable streaming on register");
          }
        }
      }
    } else if (streamer) {
      // Streaming desactive (ou backend change) — on detruit le streamer qui traine.
      await streamer.disable().catch(() => {});
      streamer = null;
    }

    // On conserve un maximum d'etat runtime existant (lastPushed, desired, palette...)
    // pour ne pas perdre la couleur/luminosite courante lors d'une simple mise a jour
    // de config. Les valeurs par defaut ne servent qu'au tout premier enregistrement.
    this.runtime.set(light.id, {
      light,
      client,
      threadClient,
      streamer,
      lastPushed: existing?.lastPushed ?? null,
      desired:
        existing?.desired ??
        { on: false, hue: 0, sat: 0, brightness: 0, reachable: true },
      zonePalette: existing?.zonePalette ?? null,
      // On repart d'une trame DMX inconnue si le bloc de zones a change (adresse ou
      // taille) : la nouvelle plage de canaux n'a rien a voir avec l'ancienne.
      dmxZones: sameZoneMirror(existing?.light.dmxMirror?.zones, light.dmxMirror?.zones)
        ? existing?.dmxZones ?? null
        : null,
      dmxZonesOwned: sameZoneMirror(existing?.light.dmxMirror?.zones, light.dmxMirror?.zones)
        ? existing?.dmxZonesOwned ?? false
        : false,
      // Meme raisonnement que dmxZones : si le bloc a bouge, le niveau lu avant ne
      // veut plus rien dire. `null` = on attend le premier tick DMX pour le savoir.
      dmxMaster: sameZoneMirror(existing?.light.dmxMirror?.zones, light.dmxMirror?.zones)
        ? existing?.dmxMaster ?? null
        : null,
      masterEmitAt: existing?.masterEmitAt ?? 0,
      lastPushAt: existing?.lastPushAt ?? 0,
      inflight: false,
      lastLocalWriteAt: existing?.lastLocalWriteAt ?? 0,
      lastMirror: existing?.lastMirror ?? null,
      streamCheckInflight: false,
      // On repart d'un backoff neuf a chaque (re)enregistrement : un changement de
      // config est justement l'occasion de retenter tout de suite.
      streamRetryAt: 0,
      streamFailures: 0
    });
  }

  /** Chien de garde (watchdog) du streaming UDP : passe en revue toutes les lampes
   *  dont l'utilisateur a demande le streaming et remet celles qui ont decroche. */
  private watchStreamingAll(): void {
    for (const entry of this.runtime.values()) void this.ensureStreaming(entry);
  }

  /**
   * Garantit qu'une lampe marquee `streaming.enabled = true` est REELLEMENT en
   * extControl sur l'appareil.
   *
   * Le drapeau persiste exprime une intention durable ("cette lampe doit rester en
   * UDP"), mais trois evenements la font sortir du mode sans que le service le voie :
   *   1. enable() a echoue au demarrage (appareil en train de booter, ou hors ligne) ;
   *   2. l'appareil a redemarre (coupure secteur) et a perdu son etat extControl ;
   *   3. une ecriture HTTP externe (app Nanoleaf, Maison/HomeKit, scene) l'a coupe —
   *      cote Nanoleaf, tout PUT /state ou PUT /effects termine l'extControl.
   *
   * Dans les cas 2 et 3, `streamer.isEnabled()` renvoie toujours true : ce drapeau est
   * purement local, et on continuerait a arroser l'appareil en UDP dans le vide. On
   * interroge donc l'etat REEL via getInfo() — hors extControl, effects/select ne
   * renvoie plus "*ExtControl*" — et on relance le mode le cas echeant.
   */
  private async ensureStreaming(entry: RuntimeEntry): Promise<void> {
    const light = entry.light;
    if (light.streaming?.enabled !== true) return;
    if (light.config.type !== "nanoleaf-http" || !light.config.token || !entry.client) return;
    if (entry.threadClient) return; // pas de streaming UDP sur une ampoule Thread
    // Un seul controle a la fois, et on respecte le backoff en cours.
    if (entry.streamCheckInflight || Date.now() < entry.streamRetryAt) return;

    entry.streamCheckInflight = true;
    try {
      const zc = light.streaming?.zoneCount ?? 50;
      if (!entry.streamer) {
        entry.streamer = new NanoleafStreamer({
          host: light.config.host,
          port: 60222,
          zoneCount: zc,
          client: entry.client,
          logger: this.logger
        });
      }
      if (!entry.streamer.isEnabled()) {
        // Cas 1 : le streamer n'a jamais demarre (echec au register, ou appareil absent).
        await entry.streamer.enable();
        this.logger.info({ id: light.id }, "Streaming UDP active par le watchdog");
      } else {
        // Cas 2 et 3 : le streamer se croit actif — on verifie aupres de l'appareil.
        const info = await entry.client.getInfo();

        // Une trame extControl ne transporte QUE des couleurs : elle n'a aucune
        // notion d'allume/eteint. Et comme flushAll() saute les lampes en
        // streaming, le `on` n'est jamais pousse en HTTP. Un appareil dont
        // l'interrupteur maitre est reste a false recoit donc nos trames sans
        // rien afficher — on peint sur un panneau hors tension, et rien dans
        // l'etat local ne le laisse deviner.
        //
        // En streaming, l'appareil reste sous tension EN PERMANENCE, et
        // l'extinction s'exprime par des trames noires. C'est la logique d'un
        // pupitre : un projecteur reste alimente, intensite 0 veut dire noir.
        //
        // Conditionner la mise sous tension a `desired.on` etait faux : sur un
        // strip pilote par miroir de zones, ce drapeau ne reflete pas ce qu'on
        // envoie reellement (le DMX possede le bandeau et passe AVANT la garde
        // desired.on). On se retrouvait a peindre des zones sur un panneau hors
        // tension, sans rien pour le signaler.
        //
        // Meme raisonnement pour la luminosite maitre : elle n'est pas dans la trame,
        // le chemin HTTP est coupe, et elle module pourtant tout ce qu'on envoie. Une
        // coupure secteur ou un passage par l'app Nanoleaf la ramene a sa valeur
        // d'avant, et le bandeau se met a plafonner sans rien signaler. Le watchdog
        // est le seul endroit qui puisse encore la voir : il la remet a fond.
        const needsPower = info.state.on === false;
        const needsFullBrightness = info.state.brightness < EXT_CONTROL_MASTER_BRIGHTNESS;
        if (needsPower || needsFullBrightness) {
          this.logger.warn(
            { id: light.id, on: info.state.on, brightness: info.state.brightness },
            needsPower
              ? "Appareil en extControl mais hors tension — remise sous tension"
              : "Luminosite maitre retombee sous 100 % en extControl — remise a fond"
          );
          // Ce PUT met fin a l'extControl : la reactivation juste apres n'est pas
          // optionnelle, elle fait partie de la meme operation.
          await entry.client.setState({ on: true, brightness: EXT_CONTROL_MASTER_BRIGHTNESS });
        }

        if (needsPower || needsFullBrightness || info.state.currentEffect !== EXT_CONTROL_EFFECT) {
          if (!needsPower && !needsFullBrightness) {
            this.logger.warn(
              { id: light.id, effect: info.state.currentEffect },
              "Appareil sorti de l'extControl — reactivation du streaming UDP"
            );
          }
          // disable() remet le drapeau local a false pour que enable() reouvre bien
          // le socket et relance le keepalive (enable() sort tot s'il se croit deja actif).
          await entry.streamer.disable().catch(() => {});
          await entry.streamer.enable();
        }
      }
      entry.streamFailures = 0;
      entry.streamRetryAt = 0;
    } catch (err) {
      // Backoff exponentiel borne : inutile de marteler un appareil injoignable.
      entry.streamFailures += 1;
      const delay = Math.min(STREAM_RETRY_MAX_MS, STREAM_RETRY_BASE_MS * 2 ** (entry.streamFailures - 1));
      entry.streamRetryAt = Date.now() + delay;
      this.logger.warn(
        { err, id: light.id, failures: entry.streamFailures, retryInMs: delay },
        "Echec de (re)activation du streaming UDP"
      );
    } finally {
      entry.streamCheckInflight = false;
    }
  }

  // Lit l'etat reel de l'appareil et le recopie dans desired/lastPushed. En cas
  // d'echec reseau, marque la lampe comme non joignable (reachable = false).
  private async refreshFromDevice(entry: RuntimeEntry): Promise<void> {
    // Ampoule Thread : l'etat vient du sidecar, qui le relit periodiquement en CoAP.
    if (entry.threadClient) {
      try {
        const s = await entry.threadClient.getState();
        entry.desired = {
          ...entry.desired,
          on: s.on ?? entry.desired.on,
          brightness: s.brightness ?? entry.desired.brightness,
          hue: s.hue ?? entry.desired.hue,
          sat: s.sat ?? entry.desired.sat,
          // On ne reprend la temperature de l'ampoule que si on n'a pas de
          // consigne en attente : la couleur n'est poussee qu'a l'allumage, donc
          // une consigne donnee lampe eteinte serait sinon effacee avant d'avoir
          // servi.
          ...(s.ct !== undefined && !(entry.desired.colorMode === "ct" && !entry.desired.on)
            ? { ct: s.ct }
            : {}),
          // L'ampoule ne declare pas son mode : HAP n'a pas de caracteristique
          // pour ca. On garde donc le mode qu'on lui a demande, au lieu de
          // retomber systematiquement sur "hs" — ce qui effacait le blanc
          // des qu'un rafraichissement passait.
          colorMode: entry.desired.colorMode ?? "hs",
          reachable: s.reachable
        };
        entry.lastPushed = entry.desired;
        this.emit("light_updated", { ...entry.light, state: entry.desired });
      } catch (err) {
        this.logger.warn({ err, id: entry.light.id }, "Refresh Thread impossible (sidecar arrete ?)");
        entry.desired = { ...entry.desired, reachable: false };
        this.emit("light_updated", { ...entry.light, state: entry.desired });
      }
      return;
    }
    // Chemin Nanoleaf HTTP : exige un client ET un jeton d'authentification.
    if (!entry.client || entry.light.config.type !== "nanoleaf-http") return;
    if (!entry.light.config.token) return;
    try {
      const info = await entry.client.getInfo();
      entry.desired = { ...info.state, reachable: true };
      entry.lastPushed = entry.desired;
      this.emit("light_updated", { ...entry.light, state: entry.desired });
    } catch (err) {
      // 401 = token invalide : il faut refaire l'appairage (pairing) de l'appareil.
      if (err instanceof NanoleafApiError && err.status === 401) {
        this.logger.warn({ id: entry.light.id }, "Nanoleaf token invalid — re-pair the device");
      } else {
        this.logger.warn({ err, id: entry.light.id }, "Failed to refresh smart light from device");
      }
      entry.desired = { ...entry.desired, reachable: false };
      this.emit("light_updated", { ...entry.light, state: entry.desired });
    }
  }

  /** Rafraichit les lampes qui n'ont pas recu d'ecriture locale depuis
   *  REFRESH_QUIESCENT_MS. Cela rattrape les changements externes (app Maison,
   *  app Nanoleaf) sans entrer en conflit avec ce que fait l'utilisateur. */
  private refreshAllIfQuiescent(): void {
    const now = Date.now();
    for (const entry of this.runtime.values()) {
      // En mode streaming, on possede entierement le bandeau — refresh inutile.
      if (entry.streamer?.isEnabled()) continue;
      if (now - entry.lastLocalWriteAt < REFRESH_QUIESCENT_MS) continue;
      // On ne refresh que si notre diff est stabilise (pas en train de pousser un changement en attente).
      const diff = computeStateDiff(entry.lastPushed, entry.desired);
      if (diff) continue;
      void this.refreshFromDevice(entry);
    }
  }

  /** Tick DMX -> met a jour l'etat voulu de toute lampe avec un miroir DMX (mirror).
   *  C'est le sens DMX -> lampe : les canaux DMX configures pilotent la smart light.
   *  Deux miroirs peuvent coexister : le miroir par zone (bloc R/G/B par zone, chemin
   *  streaming UDP) et le miroir uniforme historique (une couleur pour tout le bandeau). */
  /** Appele a chaque trame DMX. Lit les miroirs, PUIS emet les trames UDP.
   *
   *  Le streaming n'a plus d'horloge a lui (c'etait un setInterval de 33 ms). Deux
   *  raisons de l'avoir supprime :
   *
   *  1. Meme defaut que pour la sortie DMX : deux cadences independantes derivent
   *     l'une contre l'autre et produisent des trames repetees.
   *  2. Surtout, le moteur d'effets TRAME desormais ses valeurs (dithering) : il
   *     alterne 189 et 190 pour rendre 189,5. Emettre a 30 Hz ce qui est trame a
   *     60 Hz revient a echantillonner le motif au lieu de l'integrer — on
   *     recupererait systematiquement l'une des deux valeurs, ce qui annule le
   *     tramage et peut faire battre le rendu.
   *
   *  L'ordre compte : on lit les miroirs d'abord, on emet ensuite, pour que la trame
   *  envoyee porte les valeurs de CETTE trame DMX et non de la precedente. */
  private onDmxTick(state: UniverseState): void {
    this.readMirrors(state);
    this.streamAll();
  }

  private readMirrors(state: UniverseState): void {
    for (const entry of this.runtime.values()) {
      const mirror = entry.light.dmxMirror;
      if (!mirror) continue;
      if (mirror.zones) this.readZoneMirror(entry, mirror.zones, state);
      // Les adresses DMX sont en base 1 (canal 1 a 512) ; le tableau values est en
      // base 0, d'ou le -1. On renvoie undefined si le canal n'est pas configure.
      const read = (channel?: number) =>
        channel && channel >= 1 && channel <= 512 ? state.values[channel - 1] : undefined;

      const r = read(mirror.rChannel);
      const g = read(mirror.gChannel);
      const b = read(mirror.bChannel);
      const bri = read(mirror.briChannel);
      const ct = read(mirror.ctChannel);

      // Aucun des canaux miroir n'est cable pour ce projecteur : rien a faire.
      if (r === undefined && g === undefined && b === undefined && bri === undefined && ct === undefined) {
        continue;
      }

      const next: SmartLightState = { ...entry.desired };
      const prevMirror = entry.lastMirror;
      const moved = (value: number | undefined, previous: number | undefined) =>
        value !== undefined && prevMirror !== null && value !== previous;

      // Couleur et blanc variable sont deux modes EXCLUSIFS sur l'ampoule : on ne
      // peut pas pousser les deux. C'est donc le dernier fader touche qui decide,
      // et le mode courant qui persiste tant que personne ne bouge — sinon
      // remonter le dimmer ferait retomber sur une couleur un blanc deja regle.
      //
      // Un canal de temperature laisse a 0 ne doit surtout RIEN imposer : sans
      // cette regle, le seul fait de cabler le canal coincerait la lampe sur le
      // blanc le plus chaud et la couleur ne passerait jamais.
      const ctMoved = moved(ct, prevMirror?.ct);
      const rgbMoved = moved(r, prevMirror?.r) || moved(g, prevMirror?.g) || moved(b, prevMirror?.b);
      const hasRgb = r !== undefined || g !== undefined || b !== undefined;
      const useCt = ct !== undefined && (ctMoved || (next.colorMode === "ct" && !rgbMoved));

      if (hasRgb && !useCt) {
        const { h, s, v } = rgbToHsv(r ?? 0, g ?? 0, b ?? 0);
        next.hue = h;
        next.sat = s;
        next.colorMode = "hs";
        // Le dimmer ECHELONNE le melange RGB, il ne s'y substitue pas.
        //
        // rgbToHsv normalise : rouge a 50 % ressort en teinte 0, saturation 100,
        // VALEUR 50 — et prendre la luminosite du seul dimmer jetait cette
        // valeur. Toute couleur sortait donc a fond, le dimmer paraissant "en
        // rajouter une couche" par-dessus. Un projecteur RGB reel multiplie les
        // deux : rouge a 50 % avec dimmer a 100 % donne un rouge a mi-intensite.
        next.brightness = bri === undefined ? v : v * (bri / 255);
        next.on = next.brightness > 0;
      } else if (bri !== undefined) {
        // Pas de contribution couleur (mode blanc, ou aucun canal RGB cable) :
        // le dimmer pilote seul l'intensite.
        next.brightness = (bri / 255) * 100;
        next.on = bri > 0;
      }

      if (useCt) {
        next.ct = dmxToKelvin(ct as number);
        next.colorMode = "ct";
      }

      // Le miroir ne s'applique QUE si les canaux DMX ont reellement bouge.
      //
      // Avant, `desired` etait reecrit a chaque tick, 30 fois par seconde : le DMX
      // etait maitre absolu et ecrasait dans les 33 ms toute commande venue
      // d'ailleurs — app Maison, onglet Lampes, scene. Impossible de piloter la
      // lampe autrement qu'au fader, ce qui n'a aucun sens pour une ampoule
      // egalement exposee dans HomeKit.
      //
      // Desormais c'est le dernier qui ecrit qui gagne : bouger un fader reprend la
      // main, mais tant que le DMX ne bouge pas il laisse les autres sources agir.
      const mirrorNow = { r, g, b, bri, ct };
      const unchanged =
        prevMirror !== null &&
        prevMirror.r === r &&
        prevMirror.g === g &&
        prevMirror.b === b &&
        prevMirror.bri === bri &&
        prevMirror.ct === ct;
      entry.lastMirror = mirrorNow;
      if (unchanged) continue;

      entry.desired = next;
      entry.zonePalette = null; // le miroir DMX est une ecriture de couleur uniforme
      entry.lastLocalWriteAt = Date.now();
    }
  }

  /**
   * Lit le bloc de canaux du miroir DMX par zone et en fait une trame de couleurs
   * (une par zone). Chaque zone occupe 3 canaux consecutifs : rouge, vert, bleu.
   *
   * Politique de priorite (LTP, "latest takes precedence"), pour que configurer ce
   * miroir ne rende pas le painter et les effets inutilisables :
   *   - des que le bloc DMX BOUGE, le DMX prend la main (dmxZonesOwned = true) et
   *     garde le bandeau tant qu'on ne fait pas d'ecriture locale ;
   *   - une ecriture locale (couleur, painter, effet) rend la main jusqu'au prochain
   *     mouvement du DMX.
   * Au tout premier tick apres enregistrement, on ne prend la main que si au moins un
   * canal est allume : sinon un bloc DMX a zero eteindrait un effet en cours au demarrage.
   */
  private readZoneMirror(
    entry: RuntimeEntry,
    cfg: SmartLightDmxZoneMirror,
    state: UniverseState
  ): void {
    const zones: Array<{ index: number; r: number; g: number; b: number }> = [];
    let anyLit = false;
    for (let i = 0; i < cfg.zoneCount; i++) {
      // Canal DMX absolu en base 1 -> index base 0 dans values, d'ou le -1.
      const base = cfg.startChannel + i * 3 - 1;
      const r = state.values[base] ?? 0;
      const g = state.values[base + 1] ?? 0;
      const b = state.values[base + 2] ?? 0;
      if (r > 0 || g > 0 || b > 0) anyLit = true;
      zones.push({ index: i, r, g, b });
    }

    // Dimmer maitre : lu a chaque tick, et volontairement HORS de la logique de
    // propriete du bandeau. Bouger le master ne doit pas voler le bandeau a l'effet en
    // cours — c'est un fader d'intensite, pas une commande de contenu : il fixe le
    // niveau de ce qui joue, quelle qu'en soit la source, exactement comme le grand
    // master d'un pupitre. Le lire ici, avant toute sortie de la fonction, garantit
    // qu'il s'applique aussi aux trames que le moteur d'effets vient de publier.
    const prevMaster = entry.dmxMaster;
    entry.dmxMaster =
      cfg.dimmerChannel === undefined
        ? null
        : (state.values[cfg.dimmerChannel - 1] ?? 0) / 255;

    // Plus de garde anti-relecture ici : le bandeau ne calcule plus d'effet lui-meme.
    // Toute ecriture sur ce bloc vient donc forcement d'ailleurs — fader, scene,
    // moteur d'effets DMX — et doit etre traitee comme une commande, pas comme
    // l'echo de notre propre trame.

    const prev = entry.dmxZones;
    const changed =
      !prev ||
      prev.length !== zones.length ||
      zones.some((z, i) => z.r !== prev[i].r || z.g !== prev[i].g || z.b !== prev[i].b);
    entry.dmxZones = zones;

    // Le bloc de zones a bouge (et il y a quelque chose a montrer au tout premier
    // tick connu) : le DMX prend, ou garde, la main sur le bandeau.
    if (changed && (prev || anyLit)) {
      entry.dmxZonesOwned = true;
      entry.lastLocalWriteAt = Date.now();
      // On reporte l'allumage dans l'etat expose a l'UI, mais on ne diffuse (broadcast)
      // que sur bascule on/off : emettre a chaque tick DMX inonderait le WebSocket.
      if (entry.desired.on !== anyLit) {
        entry.desired = { ...entry.desired, on: anyLit };
        this.emit("light_updated", { ...entry.light, state: entry.desired });
      }
      return;
    }

    // Le DMX ne possede pas le bandeau : le master n'attenue alors plus rien
    // (voir streamAll), il DICTE l'intensite de la source locale qui joue.
    if (!entry.dmxZonesOwned) this.applyMasterAsBrightness(entry, prevMaster);
  }

  /** Repercute un mouvement du fader de master en luminosite de la lampe, quand le
   *  DMX ne possede pas le bandeau.
   *
   *  Le master ne peut pas rester un simple multiplicateur applique a tout : laisse
   *  a zero par le pupitre — son etat au repos — il rendait le bandeau totalement
   *  sourd a HomeKit, au painter et a l'onglet Lampes, dont la sortie etait
   *  multipliee par zero sans qu'aucune commande locale ne puisse jamais y remonter.
   *  Il garde pourtant tout son sens de fader d'intensite : quand il bouge alors
   *  qu'une source locale joue, c'est lui qui fixe le niveau — et l'app Maison,
   *  qui lit cette luminosite, reste d'accord avec le pupitre. */
  private applyMasterAsBrightness(entry: RuntimeEntry, prevMaster: number | null): void {
    const master = entry.dmxMaster;
    // prevMaster null = premiere lecture : un master au repos ne doit pas eteindre
    // au demarrage ce qui jouait deja.
    if (master === null || prevMaster === null || master === prevMaster) return;

    const brightness = master * 100;
    entry.desired = { ...entry.desired, brightness, on: brightness > 0 };
    entry.lastLocalWriteAt = Date.now();

    const now = Date.now();
    if (now - entry.masterEmitAt < MASTER_EMIT_INTERVAL_MS) return;
    entry.masterEmitAt = now;
    this.emit("light_updated", { ...entry.light, state: entry.desired });
  }

  /** Chemin HTTP : parcourt chaque lampe NON streaming et pousse les differences.
   *  C'est ici qu'on respecte le throttle (MIN_PUSH_INTERVAL_MS) et qu'on evite
   *  d'empiler deux requetes HTTP simultanees (garde inflight). */
  private flushAll(): void {
    const now = Date.now();
    for (const entry of this.runtime.values()) {
      // ── Ampoules Thread ───────────────────────────────────────────────────
      // Meme mecanique de regroupement que le chemin HTTP (on ne pousse que la
      // DERNIERE valeur voulue), mais a cadence bien plus basse : la radio 802.15.4
      // ne suit pas au-dela de quelques ecritures par seconde. Sans ce frein, un
      // glissement de curseur — ou un tick DMX a 30 Hz — noie le maillage et rend
      // l'ampoule MOINS reactive, pas plus.
      if (entry.threadClient) {
        if (entry.inflight) continue;
        if (now - entry.lastPushAt < THREAD_PUSH_INTERVAL_MS) continue;
        const diff = computeStateDiff(entry.lastPushed, entry.desired, THREAD_DIFF_TOLERANCE);
        if (!diff) continue;

        entry.inflight = true;
        // On date la fenetre au DEBUT de l'envoi, pas a la fin : sinon l'intervalle
        // reel devient 250 ms + le temps d'aller-retour, et la cadence derive avec
        // la latence du maillage. Le garde `inflight` empeche de toute facon deux
        // ecritures simultanees, donc dater tot ne risque pas de les empiler.
        entry.lastPushAt = Date.now();
        const threadClient = entry.threadClient;
        const target = entry.desired;
        void (async () => {
          try {
            await threadClient.setState({
              on: diff.on,
              brightness: diff.brightness,
              hue: diff.hue,
              sat: diff.sat,
              ct: diff.ct
            });
            entry.lastPushed = { ...target };
            if (!entry.desired.reachable) entry.desired = { ...entry.desired, reachable: true };
            this.emit("light_updated", { ...entry.light, state: entry.desired });
          } catch (err) {
            this.logger.warn({ err, id: entry.light.id }, "Ecriture Thread echouee");
            entry.desired = { ...entry.desired, reachable: false };
            this.emit("light_updated", { ...entry.light, state: entry.desired });
            entry.lastPushAt = Date.now() + 1000;
          } finally {
            entry.inflight = false;
          }
        })();
        continue;
      }

      if (!entry.client || entry.light.config.type !== "nanoleaf-http") continue;
      if (!entry.light.config.token) continue;
      if (entry.streamer?.isEnabled()) continue; // le streaming possede l'appareil
      if (entry.inflight) continue;
      if (now - entry.lastPushAt < MIN_PUSH_INTERVAL_MS) continue;

      // On n'envoie que ce qui a change ; si rien n'a bouge, on saute cette lampe.
      const diff = computeStateDiff(entry.lastPushed, entry.desired);
      if (!diff) continue;

      entry.inflight = true;
      const client = entry.client;
      const target = entry.desired;
      void (async () => {
        try {
          await client.setState(diff);
          entry.lastPushed = { ...target };
          entry.lastPushAt = Date.now();
          if (!entry.desired.reachable) entry.desired = { ...entry.desired, reachable: true };
          this.emit("light_updated", { ...entry.light, state: entry.desired });
        } catch (err) {
          this.logger.warn({ err, id: entry.light.id }, "Failed to push smart light state");
          entry.desired = { ...entry.desired, reachable: false };
          this.emit("light_updated", { ...entry.light, state: entry.desired });
          // En cas d'echec, on repousse le prochain essai de 500 ms (cooldown)
          // pour ne pas marteler un appareil injoignable.
          entry.lastPushAt = Date.now() + 500;
        } finally {
          entry.inflight = false;
        }
      })();
    }
  }

  /** Chemin UDP : pour chaque lampe en streaming, envoie l'etat voulu courant toutes les ~33 ms.
   *  On envoie a CHAQUE tick (pas seulement sur diff) parce que :
   *    1. l'UDP est peu couteux (pas de poignee de main TCP) ;
   *    2. un flux continu garde l'appareil en mode extControl (il en sort sinon) ;
   *    3. un changement DMX arrive en retard est applique automatiquement au tick suivant.
   *
   *  Ordre de priorite, du plus fort au plus faible :
   *    1. currentEffect defini -> le moteur d'effets (EffectEngine) calcule une trame par zone
   *    2. zonePalette definie  -> palette statique par zone (via l'API /zones)
   *    3. sinon                -> couleur uniforme issue du HSB de desired
   */
  private streamAll(): void {
    const tNow = Date.now() / 1000;
    for (const entry of this.runtime.values()) {
      const s = entry.streamer;
      if (!s?.isEnabled()) continue;

      // Miroir DMX par zone actif : le pupitre possede le bandeau. On passe donc
      // AVANT la garde desired.on, pour qu'un noir envoye depuis le DMX (blackout)
      // eteigne bien le bandeau au lieu de rendre la main a l'effet en cours.
      //
      // Le master DMX n'attenue QUE ce qui vient du DMX. La trame extControl ne
      // transportant que du R/G/B, l'intensite doit bien etre appliquee ici — mais
      // une source locale (HomeKit, painter, onglet Lampes) porte deja la sienne
      // dans desired.brightness. Multiplier les deux rendait le bandeau muet des
      // que le pupitre laissait son master a zero ; un mouvement de ce fader est
      // desormais repercute en luminosite (voir applyMasterAsBrightness).
      if (entry.dmxZonesOwned && entry.dmxZones) {
        s.sendZones(scaleZones(entry.dmxZones, entry.dmxMaster ?? 1));
        continue;
      }
      // Lampe eteinte : on envoie quand meme du noir a chaque tick pour maintenir
      // le mode extControl actif (un flux qui s'arrete fait sortir l'appareil du mode).
      if (!entry.desired.on) {
        s.sendUniform({ r: 0, g: 0, b: 0 });
        continue;
      }
      // Intensite de la source locale. desiredRgb l'inclut deja pour une couleur
      // uniforme ; une palette par zone, elle, arrive en couleurs brutes.
      if (entry.zonePalette) {
        s.sendZones(scaleZones(entry.zonePalette.zones, entry.desired.brightness / 100));
        continue;
      }
      s.sendUniform(desiredRgb(entry.desired));
    }
  }
}

/** Attenue une trame par zone par un facteur 0..1. Le clamp final est fait par le
 *  streamer (clamp8), on se contente ici du produit — et on evite d'allouer quand le
 *  master est a fond, ce qui est le cas courant. */
function scaleZones<T extends { r: number; g: number; b: number }>(zones: T[], master: number): T[] {
  if (master >= 1) return zones;
  return zones.map((z) => ({ ...z, r: z.r * master, g: z.g * master, b: z.b * master }));
}

/** Deux configs de miroir par zone visent-elles le meme bloc de canaux ?
 *  Sert a decider, lors d'un re-enregistrement, si la derniere trame DMX lue reste
 *  pertinente : deplacer l'adresse ou changer le nombre de zones l'invalide. */
function sameZoneMirror(
  a: SmartLightDmxZoneMirror | undefined,
  b: SmartLightDmxZoneMirror | undefined
): boolean {
  if (!a || !b) return false;
  return a.startChannel === b.startChannel && a.zoneCount === b.zoneCount;
}

/** Renvoie uniquement les champs qui ont change (au-dela de `tolerance`), ou null
 *  s'il n'y a rien a pousser. Sert a n'envoyer que le minimum a l'appareil.
 *  NB : on ne compare couleur/luminosite que si la lampe est allumee (next.on) :
 *  inutile d'envoyer une teinte a une lampe eteinte.
 *
 *  `tolerance` vaut 1 par defaut (echelle 0-100) : cela evite de marteler un
 *  Nanoleaf pour des micro-variations dues aux arrondis HSB. Mais cette valeur est
 *  BEAUCOUP trop grossiere pour un miroir DMX : la luminosite y vaut
 *  (canal / 255) * 100, donc un pas DMX ne pese que 0,39 point. Avec une tolerance
 *  de 1, il faut bouger un fader de trois crans avant que quoi que ce soit parte —
 *  l'utilisateur voit un curseur qui ne fait rien.
 *
 *  Baisser la tolerance n'augmente PAS le trafic : la cadence d'envoi est bornee
 *  par ailleurs (MIN_PUSH_INTERVAL_MS / THREAD_PUSH_INTERVAL_MS) et seule la
 *  DERNIERE valeur voulue part a chaque fenetre. La tolerance ne fait que decider
 *  si un mouvement compte comme un changement. */
function computeStateDiff(
  prev: SmartLightState | null,
  next: SmartLightState,
  tolerance = 1
): { on?: boolean; hue?: number; sat?: number; brightness?: number; ct?: number } | null {
  const out: { on?: boolean; hue?: number; sat?: number; brightness?: number; ct?: number } = {};
  let any = false;
  if (!prev || prev.on !== next.on) {
    out.on = next.on;
    any = true;
  }
  if (next.on) {
    // En mode "ct" (temperature de couleur) on pousse ct ; sinon on pousse teinte+saturation.
    if (next.colorMode === "ct" && next.ct !== undefined) {
      if (!prev || prev.ct !== next.ct) {
        out.ct = next.ct;
        any = true;
      }
    } else {
      if (!prev || Math.abs(prev.hue - next.hue) > tolerance) {
        out.hue = next.hue;
        any = true;
      }
      if (!prev || Math.abs(prev.sat - next.sat) > tolerance) {
        out.sat = next.sat;
        any = true;
      }
    }
    if (!prev || Math.abs(prev.brightness - next.brightness) > tolerance) {
      out.brightness = next.brightness;
      any = true;
    }
  }
  return any ? out : null;
}

/** Couleur a envoyer en streaming pour l'etat voulu, luminosite comprise.
 *
 *  Le mode couleur decide de la source : en mode blanc c'est la temperature qui
 *  fait la couleur, pas la teinte. Passer systematiquement par le HSB laissait la
 *  consigne de blanc sans aucun effet — la trame extControl ne transporte que du
 *  R/G/B, et personne ne convertissait les Kelvin. Le curseur de blanc de l'app
 *  Maison bougeait donc dans le vide, en streaming comme au painter. */
function desiredRgb(state: SmartLightState): { r: number; g: number; b: number } {
  if (state.colorMode !== "ct" || state.ct === undefined) return hsbToRgb(state);
  const white = kelvinToRgb(state.ct);
  const v = state.brightness / 100;
  return { r: white.r * v, g: white.g * v, b: white.b * v };
}

/** Convertit HSV (h:0-360, s/v:0-100) en RGB 0-255. La luminosite (brightness)
 *  agit comme multiplicateur maitre sur V. Utilise pour le chemin streaming UDP,
 *  qui envoie des couleurs RGB et non du HSB. */
function hsbToRgb(state: SmartLightState): { r: number; g: number; b: number } {
  const h = state.hue;
  const sn = state.sat / 100;
  // On applique la luminosite comme une echelle sur V=1, pour que les valeurs
  // envoyees en streaming suivent fidelement le curseur (slider) de luminosite.
  const vn = state.brightness / 100;
  const c = vn * sn;
  const x = c * (1 - Math.abs(((h / 60) % 2) - 1));
  const m = vn - c;
  let r = 0;
  let g = 0;
  let b = 0;
  if (h < 60) [r, g, b] = [c, x, 0];
  else if (h < 120) [r, g, b] = [x, c, 0];
  else if (h < 180) [r, g, b] = [0, c, x];
  else if (h < 240) [r, g, b] = [0, x, c];
  else if (h < 300) [r, g, b] = [x, 0, c];
  else [r, g, b] = [c, 0, x];
  return {
    r: Math.round((r + m) * 255),
    g: Math.round((g + m) * 255),
    b: Math.round((b + m) * 255)
  };
}
