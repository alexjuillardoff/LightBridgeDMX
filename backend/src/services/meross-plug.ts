// Service prise connectee Meross (Smart Plug Mini) pilotee en LOCAL sur le LAN.
//
// Role : surveiller les changements de valeur DMX de certains projecteurs (par
// defaut la lyre Stairville MH X20 et les Par 56 Lava / Cafe) et, des qu'une de
// leurs valeurs bouge, s'assurer que la prise Meross qui les alimente est allumee.
//
// La prise reste appairee a l'app Maison (HomeKit) : on ne passe pas par HomeKit
// pour la commander mais par son protocole LOCAL Meross (HTTP sur le port 80,
// endpoint /config). Cela respecte l'esprit "LAN only" du projet : aucune requete
// cloud, tout se joue sur le reseau local. La signature des messages necessite la
// "device key" Meross (recuperee une seule fois depuis le compte Meross).
//
// La configuration (IP, device key, canal, interrupteur logiciel) est persistee en
// base via le Store et modifiable a chaud depuis l'UI (Reglages) : reconfigure()
// reconstruit le client sans redemarrer le backend.
//
// Place dans le flux : ce service s'abonne a l'evenement "tick" du DmxService
// (comme le pont HomeKit et les lampes connectees) et ne fait qu'emettre des
// commandes vers la prise ; il n'ecrit jamais dans l'univers DMX.
import { EventEmitter } from "node:events";
import crypto from "node:crypto";
import type { FastifyBaseLogger } from "fastify";
import {
  Fixture,
  MerossConfig,
  MerossConsumption,
  MerossConsumptionDay,
  MerossElectricity,
  MerossStatus,
  UniverseState
} from "@lightbridgedmx/shared";
import { DmxService } from "./dmx";
import { Store } from "../state/store";

// Reglages du service NON persistes en base (constantes / valeurs d'environnement).
export type MerossServiceOptions = {
  // Noms des projecteurs dont un changement DMX doit rallumer la prise.
  triggerFixtureNames: string[];
  // Au-dela de ce delai, un nouveau changement DMX re-affirme l'etat "allume"
  // (garde-fou si la prise a ete eteinte par ailleurs). En millisecondes.
  reassertMs: number;
  // Extinction automatique : duree (ms) pendant laquelle TOUS les canaux de la
  // condition d'extinction doivent rester a 0 avant de couper la prise.
  offTimeoutMs: number;
  // Timeout d'une requete HTTP vers la prise (millisecondes).
  requestTimeoutMs: number;
  // Periode d'interrogation de la mesure electrique instantanee (millisecondes).
  electricityPollMs: number;
};

// Un canal DMX surveille : son univers et son index 0-based dans le tableau de 512.
type WatchedChannel = { universe: number; index: number };

// Condition d'extinction automatique : pour chaque projecteur (par nom), la liste
// des canaux (par nom d'affichage) qui doivent etre a 0. La prise n'est coupee que
// si TOUS les canaux de TOUS ces projecteurs sont a 0 (ET logique) pendant offTimeoutMs.
const DEFAULT_OFF_CONDITIONS: Array<{ fixture: string; channels: string[] }> = [
  { fixture: "Par 56 Lava", channels: ["Red", "Green", "Blue", "Full Color", "Mode"] },
  { fixture: "Par 56 Cafe", channels: ["Red", "Green", "Blue", "Full Color", "Mode"] },
  { fixture: "Par 56 Lampe", channels: ["Master"] },
  { fixture: "Stairville MH X20", channels: ["Shutter", "Dimmer"] }
];

// Apres un echec reseau, on attend ce delai avant de retenter (anti-martelage).
const RETRY_BACKOFF_MS = 2000;

// L'historique journalier ne bouge qu'a l'echelle de la journee : on ne redemande
// pas le releve a la prise plus souvent que ca (l'UI peut poller librement).
const CONSUMPTION_CACHE_MS = 60_000;

// Date locale au format "YYYY-MM-DD", pour reperer la ligne du jour en cours dans
// l'historique renvoye par la prise (qui utilise sa propre horloge locale).
const localDate = (d: Date): string =>
  `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;

// Client bas niveau du protocole local Meross. Signe et envoie les messages
// JSON vers http://<host>/config. Voir la doc communautaire du protocole local
// (header signe en MD5 : md5(messageId + key + timestamp)).
class MerossLocalClient {
  private readonly endpoint: string;
  private readonly key: string;
  private readonly channel: number;
  private readonly timeoutMs: number;

  constructor(opts: { host: string; key: string; channel: number; timeoutMs: number }) {
    this.endpoint = `http://${opts.host}/config`;
    this.key = opts.key;
    this.channel = opts.channel;
    this.timeoutMs = opts.timeoutMs;
  }

  // Construit l'enveloppe signee attendue par l'appareil.
  private buildMessage(namespace: string, method: "GET" | "SET", payload: unknown) {
    const messageId = crypto.randomBytes(16).toString("hex");
    const timestamp = Math.floor(Date.now() / 1000);
    // Signature locale Meross : MD5 hexadecimal de la concatenation.
    const sign = crypto.createHash("md5").update(`${messageId}${this.key}${timestamp}`).digest("hex");
    return {
      header: {
        messageId,
        namespace,
        method,
        payloadVersion: 1,
        from: "/app/0-0/subscribe",
        timestamp,
        sign
      },
      payload
    };
  }

  // Envoie un message et renvoie la reponse JSON (ou leve en cas d'echec / timeout).
  private async request(namespace: string, method: "GET" | "SET", payload: unknown): Promise<any> {
    const body = JSON.stringify(this.buildMessage(namespace, method, payload));
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), this.timeoutMs);
    try {
      const res = await fetch(this.endpoint, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body,
        signal: controller.signal
      });
      if (!res.ok) throw new Error(`Meross HTTP ${res.status}`);
      return await res.json();
    } finally {
      clearTimeout(timer);
    }
  }

  // Allume (ou eteint) la prise via Appliance.Control.ToggleX.
  async setOn(on: boolean): Promise<void> {
    await this.request("Appliance.Control.ToggleX", "SET", {
      togglex: { channel: this.channel, onoff: on ? 1 : 0 }
    });
  }

  // Lit la mesure electrique instantanee (Appliance.Control.Electricity).
  // Unites brutes de la prise : puissance en mW, tension en 0.1 V, courant en mA.
  // Renvoie undefined si le modele ne fait pas de metrologie (pas de payload).
  async getElectricity(): Promise<MerossElectricity | undefined> {
    const res = await this.request("Appliance.Control.Electricity", "GET", {
      electricity: { channel: this.channel }
    });
    const e = res?.payload?.electricity;
    if (!e || typeof e.power !== "number") return undefined;
    return {
      power: e.power / 1000,
      voltage: typeof e.voltage === "number" ? e.voltage / 10 : 0,
      current: typeof e.current === "number" ? e.current / 1000 : 0,
      sampledAt: new Date().toISOString()
    };
  }

  // Lit l'historique de consommation journaliere (Appliance.Control.ConsumptionX),
  // en Wh par jour sur ~30 jours glissants. La prise renvoie les jours dans un
  // ordre arbitraire : on trie par date croissante.
  async getConsumption(): Promise<MerossConsumptionDay[] | undefined> {
    const res = await this.request("Appliance.Control.ConsumptionX", "GET", {});
    const rows = res?.payload?.consumptionx;
    if (!Array.isArray(rows)) return undefined;
    return rows
      .filter((r: { date?: unknown; value?: unknown }) => typeof r?.date === "string" && typeof r?.value === "number")
      .map((r: { date: string; value: number }) => ({ date: r.date, wh: r.value }))
      .sort((a: MerossConsumptionDay, b: MerossConsumptionDay) => a.date.localeCompare(b.date));
  }

  // Lit l'etat courant : renvoie true/false, ou undefined si on n'a pas su
  // interpreter la reponse (modeles/firmwares variables -> on reste tolerant).
  async getOn(): Promise<boolean | undefined> {
    const res = await this.request("Appliance.System.All", "GET", {});
    const togglex = res?.payload?.all?.digest?.togglex;
    if (Array.isArray(togglex)) {
      const entry = togglex.find((t: { channel?: number }) => t?.channel === this.channel) ?? togglex[0];
      if (entry && typeof entry.onoff === "number") return entry.onoff === 1;
    }
    return undefined;
  }
}

// Service de haut niveau : relie le flux DMX a la prise Meross.
export class MerossPlugService extends EventEmitter {
  private readonly logger: FastifyBaseLogger;
  private readonly dmx: DmxService;
  private readonly store: Store;
  private readonly options: MerossServiceOptions;

  // Configuration courante (persistee) + client derive (null si inactif).
  private config: MerossConfig = { enabled: false, host: "", key: "", channel: 0, updatedAt: "" };
  private client: MerossLocalClient | null = null;

  // Projecteurs en cache (pour re-resoudre les canaux apres reconfiguration) +
  // canaux DMX surveilles avec leur derniere valeur connue (aligne par index).
  private cachedFixtures: Fixture[] = [];
  private watched: WatchedChannel[] = [];
  private lastValues: number[] = [];
  // Canaux de la condition d'extinction + leur derniere valeur connue (aligne par index).
  private offWatched: WatchedChannel[] = [];
  private offValues: number[] = [];
  // Instant depuis lequel TOUS les canaux d'extinction sont a 0 (null si au moins un est > 0).
  private zeroSince: number | null = null;
  // Tant qu'on n'a pas etabli une premiere valeur de reference, on ne declenche
  // rien : un redemarrage du backend (univers restaure) ne doit pas rallumer la prise.
  private primed = false;

  // Etat de la prise tel qu'on le croit + garde-fous d'envoi.
  private onState: boolean | null = null;     // null = inconnu
  private reachable: boolean | null = null;   // null = jamais tente
  private lastError: string | null = null;
  private lastAssertAt = 0;
  private nextAttemptAt = 0;
  private inflight = false;

  // Metrologie : derniere mesure instantanee connue + boucle d'interrogation, et
  // historique journalier mis en cache (voir CONSUMPTION_CACHE_MS).
  private electricity: MerossElectricity | null = null;
  private electricityTimer: NodeJS.Timeout | null = null;
  private consumption: MerossConsumption | null = null;
  private consumptionFetchedAt = 0;
  private started = false;

  private tickHandler?: (state: UniverseState) => void;

  constructor(logger: FastifyBaseLogger, dmx: DmxService, store: Store, options: MerossServiceOptions) {
    super();
    this.logger = logger.child({ service: "meross-plug" });
    this.dmx = dmx;
    this.store = store;
    this.options = options;
  }

  // True si la prise est reellement pilotable (interrupteur logiciel + IP + clef).
  private isActive(): boolean {
    return this.config.enabled && this.config.host.trim() !== "" && this.config.key.trim() !== "";
  }

  // (Re)construit le client a partir de la config courante et reinitialise l'etat
  // observe (on ne sait plus rien de la prise apres un changement de cible).
  private applyConfig(): void {
    this.client = this.isActive()
      ? new MerossLocalClient({
          host: this.config.host.trim(),
          key: this.config.key.trim(),
          channel: this.config.channel,
          timeoutMs: this.options.requestTimeoutMs
        })
      : null;
    this.onState = null;
    this.reachable = null;
    this.lastError = null;
    this.lastAssertAt = 0;
    this.nextAttemptAt = 0;
    this.zeroSince = null;
    // La metrologie decrit la prise precedente : on repart de zero.
    this.electricity = null;
    this.consumption = null;
    this.consumptionFetchedAt = 0;
  }

  // Demarre le service : charge la config (seed depuis l'env au 1er lancement),
  // resout les canaux surveilles puis s'abonne au tick DMX.
  async start(fixtures: Fixture[], seed?: Partial<MerossConfig>): Promise<void> {
    this.cachedFixtures = fixtures;
    this.config = await this.store.getMerossConfig(seed);
    this.applyConfig();
    this.resolveWatchedChannels(fixtures);

    // Interrogation best-effort de l'etat reel au demarrage.
    if (this.client) await this.queryState();

    this.tickHandler = (state) => this.onTick(state);
    this.dmx.on("tick", this.tickHandler);
    this.started = true;
    this.restartElectricityPolling();
    this.logger.info(
      { active: this.isActive(), host: this.config.host, watchedChannels: this.watched.length },
      this.isActive() ? "Meross plug control started" : "Meross plug control idle (not configured/disabled)"
    );
  }

  // Arrete le service : se desabonne du tick DMX et coupe la boucle de mesure.
  async stop(): Promise<void> {
    if (this.tickHandler) {
      this.dmx.off("tick", this.tickHandler);
      this.tickHandler = undefined;
    }
    this.started = false;
    this.restartElectricityPolling();
  }

  // Applique une nouvelle config a chaud (deja persistee par l'appelant) : reconstruit
  // le client et re-interroge l'etat de la prise. Renvoie le statut a jour.
  async reconfigure(config: MerossConfig): Promise<MerossStatus> {
    this.config = config;
    this.applyConfig();
    if (this.client) await this.queryState();
    this.restartElectricityPolling();
    this.logger.info({ active: this.isActive(), host: this.config.host }, "Meross plug reconfigured");
    return this.getStatus();
  }

  // Re-resout les canaux surveilles apres une modification des projecteurs
  // (creation / mise a jour / suppression). Appele depuis les routes fixtures.
  syncFixtures(fixtures: Fixture[]): void {
    this.cachedFixtures = fixtures;
    this.resolveWatchedChannels(fixtures);
    // Les index ont pu changer : on re-amorce la reference au prochain tick.
    this.primed = false;
  }

  // Teste la connexion a la prise (depuis l'UI). Met a jour reachable/onState.
  async testConnection(): Promise<{ reachable: boolean; on: boolean | null; error: string | null }> {
    if (!this.client) {
      return { reachable: false, on: null, error: "Prise non configurée ou désactivée" };
    }
    const ok = await this.queryState();
    return { reachable: ok, on: this.onState, error: ok ? null : this.lastError };
  }

  // Construit le statut expose a l'UI.
  getStatus(): MerossStatus {
    return {
      enabled: this.config.enabled,
      active: this.isActive(),
      host: this.config.host,
      key: this.config.key,
      channel: this.config.channel,
      on: this.onState,
      reachable: this.reachable,
      watchedFixtures: this.options.triggerFixtureNames,
      watchedChannelCount: this.watched.length,
      offWatchedChannelCount: this.offWatched.length,
      offTimeoutMs: this.options.offTimeoutMs,
      offCountdownMs: this.computeOffCountdownMs(),
      electricity: this.electricity,
      lastError: this.lastError
    };
  }

  // (Re)demarre la boucle d'interrogation de la mesure instantanee. Ne tourne que
  // si le service est demarre ET la prise pilotable ; sinon elle est simplement
  // coupee (appelee aussi depuis stop() et reconfigure()).
  private restartElectricityPolling(): void {
    if (this.electricityTimer) {
      clearInterval(this.electricityTimer);
      this.electricityTimer = null;
    }
    if (!this.started || !this.client) return;
    this.electricityTimer = setInterval(() => void this.pollElectricity(), this.options.electricityPollMs);
    // Ne doit pas maintenir le process en vie a lui tout seul.
    this.electricityTimer.unref?.();
    void this.pollElectricity();
  }

  // Releve la mesure instantanee. Purement additif : un echec efface la mesure
  // (l'UI n'affiche pas une valeur perimee) mais ne touche ni a reachable ni a
  // lastError, qui restent le reflet des commandes on/off.
  private async pollElectricity(): Promise<void> {
    if (!this.client || this.inflight) return;
    try {
      this.electricity = (await this.client.getElectricity()) ?? null;
    } catch {
      this.electricity = null;
    }
  }

  // Historique de consommation journaliere, mis en cache cote service. En cas
  // d'echec on renvoie le dernier releve connu (ou null si on n'en a jamais eu).
  async getConsumption(): Promise<MerossConsumption | null> {
    if (!this.client) return null;
    const now = Date.now();
    if (this.consumption && now - this.consumptionFetchedAt < CONSUMPTION_CACHE_MS) return this.consumption;
    try {
      const days = await this.client.getConsumption();
      if (!days) return this.consumption;
      const today = localDate(new Date());
      this.consumption = {
        days,
        todayWh: days.find((d) => d.date === today)?.wh ?? null,
        totalWh: days.reduce((sum, d) => sum + d.wh, 0),
        sampledAt: new Date().toISOString()
      };
      this.consumptionFetchedAt = now;
      return this.consumption;
    } catch (err) {
      this.logger.warn({ err }, "Failed to read Meross consumption history");
      return this.consumption;
    }
  }

  // ms restantes avant l'extinction auto, ou null si la condition n'est pas remplie
  // (au moins un canal > 0) ou si la prise est deja eteinte.
  private computeOffCountdownMs(): number | null {
    if (this.zeroSince === null || this.onState === false) return null;
    return Math.max(0, this.options.offTimeoutMs - (Date.now() - this.zeroSince));
  }

  // Lit l'etat reel de la prise et met a jour onState/reachable/lastError.
  // Renvoie true si la prise a repondu.
  private async queryState(): Promise<boolean> {
    if (!this.client) return false;
    try {
      const on = await this.client.getOn();
      this.reachable = true;
      this.lastError = null;
      if (on !== undefined) {
        this.onState = on;
        this.lastAssertAt = Date.now();
      }
      return true;
    } catch (err) {
      this.reachable = false;
      this.lastError = err instanceof Error ? err.message : String(err);
      return false;
    }
  }

  // Convertit les projecteurs surveilles (par nom) en liste de canaux DMX absolus.
  private resolveWatchedChannels(fixtures: Fixture[]): void {
    const wanted = new Set(this.options.triggerFixtureNames.map((n) => n.trim().toLowerCase()));
    const watched: WatchedChannel[] = [];
    const matched: string[] = [];

    for (const fixture of fixtures) {
      if (!wanted.has(fixture.name.trim().toLowerCase())) continue;
      matched.push(fixture.name);
      for (const ch of fixture.channels) {
        // Canal absolu (1-based) = adresse de depart + offset du canal ; -1 -> index 0-based.
        const index = fixture.address + (ch.channel - 1) - 1;
        if (index >= 0 && index < 512) {
          watched.push({ universe: fixture.universe, index });
        }
      }
    }

    this.watched = watched;
    this.lastValues = new Array(watched.length).fill(0);
    this.primed = false;

    const missing = this.options.triggerFixtureNames.filter(
      (n) => !matched.some((m) => m.trim().toLowerCase() === n.trim().toLowerCase())
    );
    if (missing.length) {
      this.logger.warn({ missing }, "Some Meross trigger fixtures were not found");
    }

    this.resolveOffChannels(fixtures);
  }

  // Resout les canaux de la condition d'extinction (par nom de projecteur + nom de canal).
  private resolveOffChannels(fixtures: Fixture[]): void {
    const byName = new Map(fixtures.map((f) => [f.name.trim().toLowerCase(), f]));
    const offWatched: WatchedChannel[] = [];
    const missing: string[] = [];

    for (const cond of DEFAULT_OFF_CONDITIONS) {
      const fixture = byName.get(cond.fixture.trim().toLowerCase());
      if (!fixture) {
        missing.push(cond.fixture);
        continue;
      }
      for (const chName of cond.channels) {
        const ch = fixture.channels.find((c) => (c.name ?? "").trim().toLowerCase() === chName.trim().toLowerCase());
        if (!ch) {
          missing.push(`${cond.fixture} → ${chName}`);
          continue;
        }
        const index = fixture.address + (ch.channel - 1) - 1;
        if (index >= 0 && index < 512) {
          offWatched.push({ universe: fixture.universe, index });
        }
      }
    }

    this.offWatched = offWatched;
    this.offValues = new Array(offWatched.length).fill(0);
    this.zeroSince = null;
    if (missing.length) {
      this.logger.warn({ missing }, "Some Meross auto-off channels were not found");
    }
  }

  // A chaque tick DMX : detecte un changement de valeur (-> allumage) et evalue la
  // condition d'extinction automatique (tous les canaux a 0 depuis offTimeoutMs).
  private onTick(state: UniverseState): void {
    if (!this.client) return;
    if (!this.watched.length && !this.offWatched.length) return;

    // 1) Detection de changement sur les canaux qui declenchent l'allumage.
    let changed = false;
    for (let i = 0; i < this.watched.length; i++) {
      const w = this.watched[i];
      if (w.universe !== state.universe) continue; // ce tick ne concerne pas cet univers
      const value = state.values[w.index] ?? 0;
      if (value !== this.lastValues[i]) {
        this.lastValues[i] = value;
        changed = true;
      }
    }

    // 2) Mise a jour des valeurs des canaux de la condition d'extinction.
    for (let i = 0; i < this.offWatched.length; i++) {
      const w = this.offWatched[i];
      if (w.universe !== state.universe) continue;
      this.offValues[i] = state.values[w.index] ?? 0;
    }

    // Premier passage : on etablit la reference sans rien declencher.
    if (!this.primed) {
      this.primed = true;
      return;
    }

    if (changed) this.ensureOn();
    this.evaluateAutoOff();
  }

  // Condition ET : si TOUS les canaux d'extinction sont a 0 depuis offTimeoutMs,
  // on coupe la prise. Le compteur repart a zero des qu'un canal repasse > 0.
  private evaluateAutoOff(): void {
    if (!this.offWatched.length) return;
    const allZero = this.offValues.every((v) => v === 0);
    if (!allZero) {
      this.zeroSince = null;
      return;
    }
    const now = Date.now();
    if (this.zeroSince === null) {
      this.zeroSince = now;
      return;
    }
    if (now - this.zeroSince >= this.options.offTimeoutMs) {
      this.ensureOff();
    }
  }

  // S'assure que la prise est allumee, avec garde-fous (anti-concurrence, backoff,
  // re-affirmation periodique). Idempotent : renvoyer "on" a une prise deja allumee
  // est sans effet de bord.
  private ensureOn(): void {
    if (!this.client) return;
    const now = Date.now();
    if (this.inflight) return;
    if (now < this.nextAttemptAt) return;
    // Deja allumee et re-affirmee recemment : rien a faire.
    if (this.onState === true && now - this.lastAssertAt < this.options.reassertMs) return;

    this.inflight = true;
    const client = this.client;
    void client
      .setOn(true)
      .then(() => {
        const wasOff = this.onState !== true;
        this.onState = true;
        this.reachable = true;
        this.lastError = null;
        this.lastAssertAt = Date.now();
        if (wasOff) {
          this.logger.info("Meross plug turned on after DMX change");
          this.emit("status", this.getStatus());
        }
      })
      .catch((err) => {
        this.onState = false;
        this.reachable = false;
        this.lastError = err instanceof Error ? err.message : String(err);
        this.nextAttemptAt = Date.now() + RETRY_BACKOFF_MS;
        this.logger.warn({ err }, "Failed to turn on Meross plug");
      })
      .finally(() => {
        this.inflight = false;
      });
  }

  // Coupe la prise (condition d'extinction remplie). Garde-fous identiques a ensureOn.
  // On ne tente rien si on la croit deja eteinte : on n'eteint qu'une fois par episode,
  // sans lutter contre un rallumage manuel ulterieur.
  private ensureOff(): void {
    if (!this.client) return;
    const now = Date.now();
    if (this.inflight) return;
    if (now < this.nextAttemptAt) return;
    if (this.onState === false) return; // deja eteinte (croyance)

    this.inflight = true;
    const client = this.client;
    void client
      .setOn(false)
      .then(() => {
        this.onState = false;
        this.reachable = true;
        this.lastError = null;
        this.lastAssertAt = Date.now();
        this.logger.info(
          { idleMs: this.zeroSince ? Date.now() - this.zeroSince : null },
          "Meross plug turned off after sustained DMX blackout"
        );
        this.emit("status", this.getStatus());
      })
      .catch((err) => {
        this.reachable = false;
        this.lastError = err instanceof Error ? err.message : String(err);
        this.nextAttemptAt = Date.now() + RETRY_BACKOFF_MS;
        this.logger.warn({ err }, "Failed to turn off Meross plug");
      })
      .finally(() => {
        this.inflight = false;
      });
  }
}
