// Service DMX : maintient en memoire les 512 canaux de l'univers DMX et les
// pousse en continu (a N FPS) vers le materiel, soit via Art-Net (UDP), soit
// via une interface Enttec Open DMX USB. Si aucune sortie n'est disponible, il
// bascule en mode simulation (aucun envoi materiel) tout en gardant l'etat.
//
// Place dans le flux : c'est le composant le plus bas du backend cote sortie.
// Le reste du backend ecrit des valeurs de canaux ici ; ce service se charge de
// les transmettre physiquement et d'emettre un evenement "tick" a chaque trame.
import { EventEmitter } from "node:events";
import type { FastifyBaseLogger } from "fastify";
import { DMX, EnttecOpenUSBDMXDriver } from "dmx-ts";
import { SerialPort } from "serialport";
import { UniverseState } from "@lightbridgedmx/shared";

// Une ecriture DMX : on pose une suite de valeurs a partir d'une adresse de
// depart (premier canal occupe par le projecteur dans l'univers).
export type DmxWrite = {
  address: number;
  values: number[];
};

// Mode de sortie courant : "hardware" = on envoie reellement, "simulation" =
// on garde l'etat en memoire mais on n'ecrit sur aucun materiel.
type DmxMode = "hardware" | "simulation";
// Interface minimale du client Art-Net (paquet "artnet") dont on a besoin.
type ArtnetClient = { set: (universe: number, channel: number, values: number[]) => void; close: () => void };
// Type d'un element retourne par SerialPort.list() (un port serie detecte).
type SerialPortInfo = Awaited<ReturnType<typeof SerialPort.list>>[number];

export type DmxServiceOptions = {
  fps?: number;
  port?: string;
  universe?: number;
  output?: "enttec" | "artnet";
  artnetHost?: string;
  artnetPort?: number;
  artnetUniverse?: number;
};

// Service DMX. Herite d'EventEmitter pour emettre un evenement "tick" a chaque
// trame poussee (le reste du backend s'y abonne pour diffuser l'etat).
export class DmxService extends EventEmitter {
  private readonly logger: FastifyBaseLogger;
  private readonly universeId: number;
  // Etat des 512 canaux DMX (valeurs 0-255). C'est la source de verite poussee
  // a chaque trame.
  private universe: number[] = Array(512).fill(0);
  // Qui a ecrit chaque canal en dernier, et a quel rang d'ecriture. Deux tableaux
  // de 512 entrees tenus a jour par applyWrite/setChannel : ils ne changent rien a
  // la sortie, ils repondent seulement a « ce canal a-t-il bouge sous ma main ou
  // sous une autre ? ». Voir hasForeignWriteSince / isBlockOwnedBy.
  private writeSeq = 0;
  private channelSeq: number[] = Array(512).fill(0);
  private channelSource: Array<string | undefined> = Array(512).fill(undefined);
  // Minuteur de la boucle de trames (un setTimeout reprogramme a chaque tick).
  private tickTimer: NodeJS.Timeout | null = null;
  // Horodatage cible du prochain tick, sert a corriger la derive du minuteur.
  private nextTickAt: number | null = null;
  private fps: number;
  private lastTick = Date.now();
  private mode: DmxMode = "simulation";
  // Port serie demande par la config (peut etre absent : on auto-detecte alors).
  private configuredPort?: string;
  // Port serie reellement ouvert (apres detection).
  private activePort?: string;
  private dmx: DMX | null = null;
  private driver: EnttecOpenUSBDMXDriver | null = null;
  private readonly universeName = "main";
  // Verrou anti-reentrance : empeche deux pushFrame() de se chevaucher.
  private pushing = false;
  // Une trame a ete demandee pendant qu'un push etait deja en cours : on la
  // rejouera juste apres pour ne pas perdre la derniere valeur.
  private pendingFrame = false;
  private readonly output: "enttec" | "artnet";
  private artnet: ArtnetClient | null = null;
  private readonly artnetUniverse: number;
  private readonly artnetHost: string;
  private readonly artnetPort: number;

  constructor(logger: FastifyBaseLogger, options?: DmxServiceOptions) {
    super();
    this.logger = logger.child({ service: "dmx" });
    this.fps = clampFps(options?.fps ?? 30);
    this.universeId = options?.universe ?? 0;
    this.configuredPort = options?.port;
    this.output = options?.output ?? "enttec";
    this.artnetHost = options?.artnetHost ?? "127.0.0.1";
    this.artnetPort = options?.artnetPort ?? 6454;
    this.artnetUniverse = options?.artnetUniverse ?? 0;
  }

  // Prepare le client Art-Net (sortie UDP). N'est appele que si output=artnet.
  private async initializeArtnet() {
    // require differe (lazy) : on ne charge la dependance que si elle sert,
    // pour ne pas l'embarquer quand on utilise l'autre sortie.
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const artnet = require("artnet");
    this.artnet = artnet({ host: this.artnetHost, port: this.artnetPort, sendAll: true });
    this.logger.info({ host: this.artnetHost, port: this.artnetPort, universe: this.artnetUniverse }, "Art-Net output ready");
  }

  // Demarre le service : initialise la sortie choisie puis lance la boucle de
  // trames. Sans effet si elle tourne deja.
  async start() {
    if (this.tickTimer) return;
    if (this.output === "enttec") {
      await this.initializeDriver();
    } else {
      await this.initializeArtnet();
      this.mode = "hardware";
    }
    this.lastTick = Date.now();
    this.nextTickAt = Date.now();
    this.scheduleNextTick();
    this.logger.info(
      {
        fps: this.fps,
        mode: this.output === "artnet" ? "artnet" : this.mode,
        port: this.activePort ?? this.configuredPort,
        artnetHost: this.output === "artnet" ? this.artnetHost : undefined
      },
      "DMX service started"
    );
  }

  // Arrete la boucle de trames et libere le materiel.
  async stop() {
    this.clearTick();
    await this.teardownHardware();
  }

  // Change la cadence (FPS) en cours de route. Si la boucle tourne deja, on la
  // reprogramme immediatement avec le nouvel intervalle.
  setFrameRate(fps: number) {
    this.fps = clampFps(fps);
    if (this.tickTimer) {
      this.clearTick();
      this.nextTickAt = Date.now();
      this.scheduleNextTick();
      this.logger.info({ fps: this.fps }, "DMX frame rate updated");
    }
  }

  // Applique une ecriture DMX : pose les valeurs a partir de l'adresse de depart.
  // NB : address est 1-based (canal 1 = 1er canal), d'ou le "- 1" pour l'index
  // du tableau. Les canaux hors univers sont ignores en silence.
  //
  // `source` identifie l'auteur de l'ecriture (ex. "effect:<id>"). Il n'a aucun
  // effet sur la sortie : il sert a repondre a la question « qui a ecrit ce canal
  // en dernier ? », dont un ecrivain periodique a besoin pour savoir si quelqu'un
  // d'autre lui est passe dessus entre deux de ses trames. Sans lui, un effet qui
  // repeint le meme bloc 30 fois par seconde ecraserait silencieusement un blackout.
  applyWrite(write: DmxWrite, source?: string) {
    const { address, values } = write;
    values.forEach((value, idx) => {
      const channel = address + idx - 1;
      if (channel >= 0 && channel < this.universe.length) {
        this.universe[channel] = clampValue(value);
        this.channelSeq[channel] = ++this.writeSeq;
        this.channelSource[channel] = source;
      }
    });
  }

  // Ecrit un seul canal (numerote 1 a 512).
  setChannel(channel: number, value: number, source?: string) {
    if (channel < 1 || channel > 512) return;
    this.universe[channel - 1] = clampValue(value);
    this.channelSeq[channel - 1] = ++this.writeSeq;
    this.channelSource[channel - 1] = source;
  }

  /** Numero de la derniere ecriture effectuee, tous canaux confondus. A memoriser
   *  juste apres avoir ecrit pour pouvoir demander ensuite « quelqu'un a-t-il ecrit
   *  apres moi ? » (voir hasForeignWriteSince). */
  writeSequence(): number {
    return this.writeSeq;
  }

  /** Un auteur AUTRE que `source` a-t-il ecrit sur ce bloc depuis l'ecriture n° `since` ?
   *  C'est ce qui permet a un ecrivain periodique de rendre la main : un fader, une
   *  scene ou un blackout qui touche le bloc est detecte meme s'il est deja recouvert
   *  par la trame suivante de cet ecrivain. */
  hasForeignWriteSince(startChannel: number, count: number, source: string, since: number): boolean {
    for (let i = 0; i < count; i++) {
      const channel = startChannel + i - 1;
      if (channel < 0 || channel >= this.universe.length) continue;
      if (this.channelSeq[channel] > since && this.channelSource[channel] !== source) return true;
    }
    return false;
  }

  /** Tout ce bloc a-t-il ete ecrit en dernier par `source` ? Sert a reconnaitre ses
   *  propres valeurs en relisant l'univers, au lieu de les prendre pour une commande
   *  exterieure. */
  isBlockOwnedBy(startChannel: number, count: number, source: string): boolean {
    for (let i = 0; i < count; i++) {
      const channel = startChannel + i - 1;
      if (channel < 0 || channel >= this.universe.length) continue;
      if (this.channelSource[channel] !== source) return false;
    }
    return true;
  }

  // Renvoie une copie figee (instantane) des 512 canaux courants.
  getUniverseSnapshot(): number[] {
    return [...this.universe];
  }

  // Restaure des valeurs deja persistees dans le buffer de l'univers. On peut
  // l'appeler avant start() : ainsi la toute premiere trame Art-Net porte deja
  // l'etat restaure. Les projecteurs gardent donc leur derniere valeur "allume"
  // au redemarrage du backend.
  restoreUniverse(values: number[]) {
    for (let i = 0; i < Math.min(values.length, this.universe.length); i++) {
      this.universe[i] = clampValue(values[i]);
    }
  }

  // Construit l'etat publie a chaque tick (diffuse via WebSocket).
  // Le FPS renvoye est mesure (et non theorique) : on le deduit du temps ecoule
  // depuis le tick precedent, ce qui reflete la cadence reelle.
  getState(): UniverseState {
    const now = Date.now();
    const delta = now - this.lastTick;
    const fps = delta > 0 ? Math.round(1000 / delta) : this.fps;
    this.lastTick = now;

    return {
      fps,
      universe: this.universeId,
      values: [...this.universe],
      timestamp: new Date().toISOString()
    };
  }

  /** Producteurs appeles JUSTE AVANT la construction de chaque trame.
   *
   *  Pourquoi un point d'accroche plutot qu'un minuteur a eux : un ecrivain
   *  periodique qui bat sur sa propre horloge (setInterval 33 ms) derive contre
   *  celle de la sortie. Les deux cadences battent l'une contre l'autre et il en
   *  sort, regulierement, une trame ou l'ecrivain n'a pas encore recalcule — donc
   *  une valeur repetee. Mesure sur le moteur d'effets : 4 trames repetees sur 90,
   *  soit un accroc toutes les 0,75 s dans un fondu qui devrait etre lisse.
   *  En calculant ici, chaque trame envoyee porte une valeur fraiche, une seule fois. */
  private readonly frameProducers = new Set<() => void>();

  /** Enregistre un producteur de trame. Renvoie de quoi se desabonner. */
  onBeforeFrame(producer: () => void): () => void {
    this.frameProducers.add(producer);
    return () => this.frameProducers.delete(producer);
  }

  // Un battement de la boucle : laisse les producteurs ecrire, pousse la trame
  // courante, puis emet "tick".
  // Tout est protege par try/catch pour qu'une erreur n'arrete jamais la boucle.
  private safeTick() {
    try {
      for (const produce of this.frameProducers) {
        try {
          produce();
        } catch (err) {
          // Un producteur en echec ne doit pas emporter la sortie DMX avec lui.
          this.logger.error({ err }, "Producteur de trame en echec");
        }
      }
      this.pendingFrame = true;
      this.pushFrame();
      const state = this.getState();
      this.emit("tick", state);
    } catch (err) {
      this.logger.error({ err }, "DMX tick failed");
    }
  }

  // Programme le prochain tick avec correction de derive : au lieu d'un
  // setInterval fixe (qui accumule du retard), on vise un horodatage cible
  // (nextTickAt) et on ajuste le delai a chaque fois pour rester aligne sur le
  // FPS demande.
  private scheduleNextTick() {
    const interval = 1000 / this.fps;
    const now = Date.now();
    if (this.nextTickAt === null) this.nextTickAt = now;
    const delay = Math.max(0, this.nextTickAt - now);

    this.tickTimer = setTimeout(() => {
      this.safeTick();
      const next = (this.nextTickAt ?? now) + interval;
      // Ne jamais cibler une date deja passee : si on a pris du retard, on
      // repart de maintenant pour eviter une rafale de ticks de rattrapage.
      const driftCorrected = Math.max(next, Date.now());
      this.nextTickAt = driftCorrected;
      this.scheduleNextTick();
    }, delay);
  }

  // Stoppe et oublie le minuteur de boucle.
  private clearTick() {
    if (this.tickTimer) clearTimeout(this.tickTimer);
    this.tickTimer = null;
    this.nextTickAt = null;
  }

  // Envoie une trame complete des 512 canaux vers la sortie active.
  // Anti-reentrance : si un push est deja en cours, on note pendingFrame et on
  // sort ; le push courant rejouera la trame en fin via setImmediate. On evite
  // ainsi d'envoyer deux trames concurrentes et on garde toujours la derniere.
  private pushFrame() {
    if (this.pushing) return;
    if (this.output === "artnet") {
      this.pendingFrame = false;
      this.pushing = true;
      try {
        // Offset de canal explicite a 1 : sinon le client Art-Net partirait du
        // canal 0 et perdrait le canal 1.
        this.artnet?.set(this.artnetUniverse, 1, this.universe);
      } catch (err) {
        this.logger.error({ err }, "Failed to push Art-Net frame");
      } finally {
        this.pushing = false;
        if (this.pendingFrame) {
          setImmediate(() => this.pushFrame());
        }
      }
      return;
    }
    if (this.mode !== "hardware" || !this.dmx) return;
    this.pendingFrame = false;
    // La lib dmx-ts attend une map canal->valeur indexee a partir de 1.
    const frame: Record<number, number> = {};
    for (let i = 0; i < this.universe.length; i++) {
      frame[i + 1] = this.universe[i];
    }

    this.pushing = true;
    try {
      // L'Enttec Open DMX USB est synchrone : l'envoi rend la main aussitot.
      this.dmx.update(this.universeName, frame);
    } catch (err) {
      // Une erreur d'ecriture signifie souvent que le materiel a disparu :
      // on retombe en simulation pour ne pas spammer d'erreurs a chaque trame.
      this.logger.error({ err }, "Failed to push DMX frame, switching to simulation mode");
      this.mode = "simulation";
      void this.teardownHardware();
    } finally {
      this.pushing = false;
      if (this.pendingFrame) {
        setImmediate(() => this.pushFrame());
      }
    }
  }

  // Initialise la sortie Enttec Open DMX USB. Detecte/ouvre le port serie ;
  // si rien ne convient, bascule proprement en mode simulation.
  private async initializeDriver() {
    const port = await this.detectPort();
    if (!port) {
      this.mode = "simulation";
      this.activePort = undefined;
      this.logger.warn(
        { mode: this.mode },
        "No Enttec Open DMX USB interface detected, running in simulation mode"
      );
      return;
    }

    const candidates = this.expandPortCandidates(port);

    // On tente chaque variante de port (ex. /dev/tty.* puis /dev/cu.*) ;
    // le premier qui s'ouvre gagne, sinon on finit en simulation.
    for (const candidate of candidates) {
      try {
        this.logger.info({ port: candidate }, "Initializing Enttec Open DMX USB driver");
        this.driver = new EnttecOpenUSBDMXDriver(candidate, { dmxSpeed: this.fps });

        // Astuce : on force les options du port serie interne du driver pour
        // pouvoir ouvrir le port meme si un autre processus pose un verrou
        // (frequent sur macOS avec les puces FTDI). D'ou lock: false.
        type DriverWithOptions = { _serialPortOptions?: Record<string, unknown> };
        const driverHack = this.driver as unknown as DriverWithOptions;
        const serialOptions = driverHack._serialPortOptions ?? {};
        driverHack._serialPortOptions = {
          baudRate: 250000,
          dataBits: 8,
          stopBits: 2,
          parity: "none",
          highWaterMark: 1024,
          latencyTimer: 1, // aligne sur QLC+ (libftdi) pour reduire le delai de bufferisation
          ...serialOptions,
          lock: false
        };

        this.dmx = new DMX();
        await this.dmx.addUniverse(this.universeName, this.driver);
        this.mode = "hardware";
        this.activePort = candidate;
        this.logger.info({ port: candidate }, "Enttec Open DMX USB ready");
        return;
      } catch (err) {
        this.logger.error(
          { err, port: candidate },
          "Failed to initialize DMX hardware on candidate port"
        );
        await this.teardownHardware();
      }
    }

    this.mode = "simulation";
    this.activePort = undefined;
    this.logger.warn(
      { mode: this.mode },
      "All DMX port candidates failed, running in simulation mode"
    );
  }

  // Ferme et oublie toutes les ressources materielles (Art-Net + driver DMX),
  // puis repasse en mode simulation. Tolere les erreurs de fermeture.
  private async teardownHardware() {
    if (this.artnet) {
      try {
        this.artnet.close();
      } catch {
        // on ignore : la fermeture peut echouer si le socket est deja perdu
      }
    }
    this.artnet = null;
    if (this.dmx) {
      try {
        await this.dmx.close();
      } catch (err) {
        this.logger.warn({ err }, "Failed to close DMX driver cleanly");
      }
    }
    this.dmx = null;
    this.driver = null;
    this.mode = "simulation";
    this.activePort = undefined;
  }

  // Determine quel port serie ouvrir pour l'Enttec :
  // 1) si un port est configure, on le privilegie (et on l'ouvre meme s'il
  //    n'apparait pas dans le scan, car l'enumeration peut etre incomplete) ;
  // 2) sinon on cherche un port qui ressemble a une Enttec Open DMX (FTDI).
  // Renvoie null si rien n'est trouve -> le service ira en simulation.
  private async detectPort(): Promise<string | null> {
    let ports: SerialPortInfo[] = [];
    try {
      ports = await SerialPort.list();
    } catch (err) {
      this.logger.error({ err }, "Failed to list serial ports");
      if (this.configuredPort) {
        this.logger.warn(
          { port: this.configuredPort },
          "Serial enumeration failed, attempting to use configured DMX port directly"
        );
        return this.configuredPort;
      }
      return null;
    }

    if (this.configuredPort) {
      const explicit = ports.find((port) => port.path === this.configuredPort);
      if (explicit) return explicit.path;

      this.logger.warn(
        { port: this.configuredPort },
        "Configured DMX port not found in serial scan, attempting to open directly"
      );
      return this.configuredPort;
    }

    const enttecPort = ports.find((port) => this.isEnttecOpenDMX(port));
    if (enttecPort) return enttecPort.path;

    return null;
  }

  // Heuristique pour reconnaitre une interface Enttec Open DMX a partir des
  // identifiants USB : soit le fabricant mentionne "enttec", soit c'est une
  // puce FTDI (vendorId 0403) avec un productId typique (6001/6015) ou absent.
  private isEnttecOpenDMX(port: SerialPortInfo): boolean {
    const vendorId = port.vendorId?.toLowerCase();
    const productId = port.productId?.toLowerCase();
    const manufacturer = port.manufacturer?.toLowerCase() ?? "";

    const isFtdi = vendorId === "0403";
    const looksLikeOpenDmx = productId === "6001" || productId === "6015" || !productId;
    const mentionsEnttec = manufacturer.includes("enttec");

    return mentionsEnttec || (isFtdi && looksLikeOpenDmx);
  }

  // Sur macOS, un meme peripherique expose souvent deux chemins : /dev/tty.* et
  // /dev/cu.*. On ajoute la variante /dev/cu.* comme candidat de secours, car
  // c'est generalement celle qui s'ouvre sans bloquer.
  private expandPortCandidates(port: string): string[] {
    const candidates = [port];
    if (port.startsWith("/dev/tty.")) {
      const cuPath = port.replace("/dev/tty.", "/dev/cu.");
      if (!candidates.includes(cuPath)) candidates.push(cuPath);
    }
    return candidates;
  }
}

// Borne une valeur de canal dans la plage DMX valide 0-255 (entier).
// Un NaN devient 0 pour ne jamais envoyer de valeur invalide au materiel.
const clampValue = (value: number) => {
  if (Number.isNaN(value)) return 0;
  return Math.max(0, Math.min(255, Math.round(value)));
};

// Borne le FPS demande dans une plage raisonnable (1 a 60 trames/seconde).
const clampFps = (fps: number) => Math.max(1, Math.min(fps, 60));
