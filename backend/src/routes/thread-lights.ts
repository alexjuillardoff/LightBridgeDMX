// Routes du patch automatise des ampoules HomeKit-sur-Thread.
//
// Ajouter une ampoule a la main demandait sept etapes reparties entre un terminal
// et trois onglets : reset, appairage BLE, provisionnement Thread, bascule CoAP,
// declaration de la lampe, recherche d'une adresse DMX libre, creation du
// projecteur et de son miroir. Ces trois endpoints ramenent tout cela a deux
// gestes dans la vue Patch — un formulaire d'appairage, puis un bouton « Patcher ».
//
//   GET  /api/smart-lights/thread/candidates  -> appairees cote sidecar, pas encore patchees
//   POST /api/smart-lights/thread/adopt       -> declare la lampe + patch DMX automatique
//   POST /api/smart-lights/thread/pair        -> lance l'appairage (necessite Bluetooth)
import { spawn } from "node:child_process";
import path from "node:path";
import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { Fixture, SmartLight } from "@lightbridgedmx/shared";
import { listSidecarLights } from "../services/smart-lights/homekit-thread-client";
import { ErrorHandler, RouteContext } from "./types";

/** Emplacement du sidecar et de son script d'appairage. */
const TOOLS_DIR = path.resolve(process.cwd(), "..", "tools", "homekit-thread");
const SIDECAR_URL = process.env.THREAD_SIDECAR_URL ?? "http://127.0.0.1:5056";

/** Gabarit du projecteur cree pour une ampoule : 4 canaux, dimmer puis RVB.
 *  Volontairement fixe : ces ampoules n'ont pas d'autre geometrie. */
// Les Nanoleaf A19 exposent une temperature de couleur en plus du RVB : sans un
// canal dedie, la facade DMX ne sait pas la piloter et le blanc chaud n'est
// atteignable que depuis Maison. Meme decoupage que les projecteurs poses a la
// main (cf. "Lampe Canape", 33-37).
const BULB_CHANNELS = [
  { channel: 1, capability: "intensity" as const, name: "Dimmer" },
  { channel: 2, capability: "r" as const, name: "Rouge" },
  { channel: 3, capability: "g" as const, name: "Vert" },
  { channel: 4, capability: "b" as const, name: "Bleu" },
  { channel: 5, capability: "colorTemp" as const, name: "Temp. couleur" }
];

/** Numero DMX absolu du canal de temperature de couleur, ou undefined.
 *
 *  On cree nos projecteurs avec BULB_CHANNELS, donc le canal est toujours la.
 *  Mais un RATTACHEMENT vise un projecteur existant, qui peut n'avoir que du
 *  RVB : y poser un ctChannel deduit de l'adresse ecrirait alors dans le
 *  projecteur d'a cote. On lit donc la capacite reelle plutot que de compter.
 */
const ctChannelOf = (fixture: Fixture | null, address: number): number | undefined => {
  if (!fixture) return address + 4;
  const ct = fixture.channels.find((c) => c.capability === "colorTemp");
  return ct ? fixture.address + ct.channel - 1 : undefined;
};

export const registerThreadLightRoutes = (
  app: FastifyInstance,
  ctx: RouteContext,
  handleError: ErrorHandler
) => {
  /**
   * Ampoules appairees cote sidecar mais pas encore declarees dans LightBridge.
   * C'est la liste « pretes a patcher » : l'etape lourde (appairage materiel) est
   * derriere, il ne reste qu'un clic.
   */
  app.get("/api/smart-lights/thread/candidates", async (_request, reply) => {
    try {
      const known = new Set(
        ctx.smartLights
          .listWithState()
          .map((l) => (l.config.type === "homekit-thread" ? l.config.alias : null))
          .filter((a): a is string => a !== null)
      );
      const lights = await listSidecarLights(SIDECAR_URL).catch(() => null);
      if (lights === null) {
        // Sidecar arrete : on le dit franchement plutot que de renvoyer une liste
        // vide, qui ferait croire qu'aucune ampoule n'est appairee.
        return reply.send({
          sidecarUp: false,
          candidates: [],
          message: `Sidecar injoignable sur ${SIDECAR_URL} — le lancer avec « ./.venv/bin/python sidecar.py » dans tools/homekit-thread.`
        });
      }
      reply.send({
        sidecarUp: true,
        candidates: lights
          .filter((l) => !known.has(l.alias))
          .map((l) => ({ alias: l.alias, name: l.name ?? l.alias, reachable: l.reachable }))
      });
    } catch (err) {
      handleError(err, reply);
    }
  });

  /**
   * Adopte une ampoule deja appairee : declaration + patch DMX en une transaction
   * logique. Si la creation du projecteur echoue, on retire la lampe pour ne pas
   * laisser un demi-ajout derriere soi.
   */
  app.post("/api/smart-lights/thread/adopt", async (request, reply) => {
    try {
      const parsed = z
        .object({
          alias: z.string().min(1),
          name: z.string().min(1).optional(),
          room: z.string().min(1).optional(),
          /** false pour declarer la lampe sans lui donner d'adresse DMX. */
          patchDmx: z.boolean().default(true).optional(),
          /** Rattache la lampe a un projecteur DEJA patche au lieu d'en creer un.
           *  Indispensable quand l'utilisateur a deja nomme et adresse son projecteur
           *  a la main : sans cela on en creerait un second et le premier resterait
           *  orphelin, deux entrees pour une seule ampoule. */
          fixtureId: z.string().uuid().optional(),
          universe: z.number().int().min(0).default(0).optional()
        })
        .parse(request.body);

      const lights = await listSidecarLights(SIDECAR_URL);
      const found = lights.find((l) => l.alias === parsed.alias);
      if (!found) {
        return reply.code(404).send({
          message: `Alias « ${parsed.alias} » inconnu du sidecar. Appairer l'ampoule d'abord.`
        });
      }
      const name = parsed.name ?? found.name ?? parsed.alias;
      const universe = parsed.universe ?? 0;
      const wantPatch = parsed.patchDmx ?? true;

      // Adresse d'abord : inutile de creer la lampe si l'univers est plein.
      let address: number | null = null;
      let existingFixture: Fixture | null = null;
      if (parsed.fixtureId) {
        // Rattachement : on prend l'adresse du projecteur choisi, sans rien creer.
        const all = await ctx.store.listFixtures();
        existingFixture = all.find((f) => f.id === parsed.fixtureId) ?? null;
        if (!existingFixture) {
          return reply.code(404).send({ message: `Projecteur ${parsed.fixtureId} introuvable.` });
        }
        address = existingFixture.address;
      } else if (wantPatch) {
        address = await ctx.store.findFreeAddress(BULB_CHANNELS.length, universe);
        if (address === null) {
          return reply.code(409).send({
            message: `Aucun bloc de ${BULB_CHANNELS.length} canaux libres dans l'univers ${universe}.`
          });
        }
      }

      const light: SmartLight = await ctx.store.createSmartLight({
        name,
        room: parsed.room,
        backend: "homekit-thread",
        config: { type: "homekit-thread", alias: parsed.alias, deviceName: found.name },
        // Le miroir n'est pose qu'une fois l'adresse connue (voir plus bas).
        dmxMirror: address === null
          ? null
          : {
              universe: existingFixture?.universe ?? universe,
              briChannel: address,
              rChannel: address + 1,
              gChannel: address + 2,
              bChannel: address + 3,
              ctChannel: ctChannelOf(existingFixture, address)
            }
      });

      let fixture: Fixture | null = existingFixture;
      if (address !== null && existingFixture === null) {
        try {
          fixture = await ctx.store.createFixture({
            name,
            address,
            universe,
            room: parsed.room,
            channels: BULB_CHANNELS,
            // Sans ca, le pont exposerait un accessoire par canal EN PLUS de la
            // lampe : quatre variateurs en doublon dans l'app Maison.
            homekit: { enabled: false }
          });
        } catch (err) {
          // Demi-ajout : on annule la lampe pour laisser l'etat propre.
          await ctx.store.deleteSmartLight(light.id).catch(() => {});
          throw err;
        }
      }

      // Enregistrement runtime : c'est ce qui cree le client sidecar, branche le
      // miroir DMX et expose l'accessoire HomeKit.
      await ctx.smartLights.register(light);
      ctx.smartLights.emit("light_updated", light);
      if (fixture) {
        await ctx.homekit.syncFixtures(await ctx.store.listFixtures()).catch(() => {});
      }
      ctx.homekit.syncSmartLights(ctx.smartLights.listWithState());

      ctx.broadcast({ type: "smart_light_updated", data: light });
      reply.send({ light, fixture, address });
    } catch (err) {
      handleError(err, reply);
    }
  });

  /**
   * Lance l'appairage d'une ampoule reinitialisee.
   *
   * ATTENTION — cette etape ne peut PAS etre entierement automatisee : elle exige
   * le Bluetooth, et macOS n'accorde jamais l'autorisation a un processus sans
   * interface (ce backend tourne sous launchd). On passe donc par AppleScript pour
   * faire executer le script d'appairage par Terminal.app, seule application a
   * pouvoir obtenir la permission. Une fenetre s'ouvre sur la session graphique ;
   * l'utilisateur y suit la progression.
   *
   * Le dataset Thread vient de l'environnement (THREAD_DATASET) : c'est un secret
   * reseau, il n'a rien a faire dans une base ni dans un formulaire web.
   */
  app.post("/api/smart-lights/thread/pair", async (request, reply) => {
    try {
      const parsed = z
        .object({
          /** Nom annonce par l'ampoule, ex. "Nanoleaf A19 1W1D". Stable a travers
           *  les resets, contrairement au device-id. */
          name: z.string().min(1),
          /** Code HomeKit a 8 chiffres, avec ou sans tirets. */
          pin: z.string().min(8),
          alias: z.string().min(1).optional(),
          timeoutSec: z.number().int().min(30).max(600).default(240).optional()
        })
        .parse(request.body);

      const dataset = process.env.THREAD_DATASET;
      if (!dataset) {
        return reply.code(503).send({
          message:
            "THREAD_DATASET absent de l'environnement du backend. Y placer le dataset " +
            "MeshCoP en hexa (voir tools/homekit-thread/README.md) puis relancer."
        });
      }

      // Alias par defaut derive du nom : "Nanoleaf A19 1W1D" -> "a19-1w1d".
      const alias =
        parsed.alias ??
        parsed.name.toLowerCase().replace(/^nanoleaf\s+/, "").replace(/[^a-z0-9]+/g, "-");

      const script = path.join(TOOLS_DIR, "pair_bulb.py");
      const python = path.join(TOOLS_DIR, ".venv", "bin", "python");
      const digits = parsed.pin.replace(/\D/g, "");

      // Commande shell executee DANS Terminal.app. Les valeurs sont mises entre
      // guillemets simples et les quotes internes echappees : le nom vient du
      // reseau, le code de l'utilisateur.
      const q = (v: string) => `'${v.replace(/'/g, "'\\''")}'`;
      const command = [
        `cd ${q(TOOLS_DIR)}`,
        [
          q(python),
          q(script),
          "--alias",
          q(alias),
          "--name",
          q(parsed.name),
          "--pin",
          q(digits),
          "--transport ble",
          "--timeout",
          String(parsed.timeoutSec ?? 240),
          "--dataset",
          q(dataset)
        ].join(" ")
      ].join(" && ");

      const applescript = `tell application "Terminal"
  activate
  do script ${JSON.stringify(command)}
end tell`;

      // Detache : l'appairage dure plusieurs minutes, la requete HTTP ne l'attend pas.
      const child = spawn("osascript", ["-e", applescript], { detached: true, stdio: "ignore" });
      child.unref();

      app.log.info({ alias, name: parsed.name }, "Appairage Thread lance dans Terminal.app");
      reply.send({
        started: true,
        alias,
        message:
          "Terminal.app s'ouvre sur la session graphique. Réinitialise l'ampoule " +
          "maintenant : éteindre 3 s, rallumer 1 s, cinq fois, jusqu'aux trois " +
          "clignotements rouges. Elle apparaîtra ensuite dans « prêtes à patcher »."
      });
    } catch (err) {
      handleError(err, reply);
    }
  });
};
