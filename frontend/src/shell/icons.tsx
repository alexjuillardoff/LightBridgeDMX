// Icônes SVG inline du chrome grandMA3 (aucune dépendance : tout est dessiné ici).
// Chaque icône fait 1em × 1em et hérite de la couleur du texte (currentColor) ;
// la taille se règle donc par le font-size du conteneur.
import type { SVGProps } from "react";

type IconProps = SVGProps<SVGSVGElement> & { title?: string };

// Enveloppe commune : traits fins, coins ronds, calée sur une grille 24×24.
function Svg({ title, children, ...rest }: IconProps) {
  return (
    <svg
      className="ma-icon"
      viewBox="0 0 24 24"
      width="1em"
      height="1em"
      fill="none"
      stroke="currentColor"
      strokeWidth={1.6}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden={title ? undefined : true}
      role={title ? "img" : undefined}
      focusable="false"
      {...rest}
    >
      {title ? <title>{title}</title> : null}
      {children}
    </svg>
  );
}

// Chemin d'une roue dentée : polygone à `teeth` dents entre deux rayons.
function gearPath(teeth: number, outer: number, inner: number, cx = 12, cy = 12): string {
  const parts: string[] = [];
  const step = (Math.PI * 2) / teeth;
  for (let i = 0; i < teeth; i += 1) {
    const a = i * step;
    const pts = [
      [a - step * 0.22, inner],
      [a - step * 0.14, outer],
      [a + step * 0.14, outer],
      [a + step * 0.22, inner]
    ];
    for (const [ang, r] of pts) {
      const x = (cx + Math.cos(ang) * r).toFixed(2);
      const y = (cy + Math.sin(ang) * r).toFixed(2);
      parts.push(`${parts.length === 0 ? "M" : "L"}${x} ${y}`);
    }
  }
  return `${parts.join(" ")} Z`;
}
const GEAR = gearPath(8, 10, 7.6);

// --- Control bar ------------------------------------------------------------

/** Power : arc ouvert + trait vertical. */
export const IconPower = (p: IconProps) => (
  <Svg {...p}>
    <path d="M12 3.5v8" />
    <path d="M7.2 6.8a7 7 0 1 0 9.6 0" />
  </Svg>
);

/** Roue dentée (menu). */
export const IconGear = (p: IconProps) => (
  <Svg {...p}>
    <path d={GEAR} strokeWidth={1.4} />
    <circle cx="12" cy="12" r="2.8" />
  </Svg>
);

/** Vues / fenêtres : cadre avec un second cadre en perspective (icône « Views » de MA3). */
export const IconViews = (p: IconProps) => (
  <Svg {...p}>
    <rect x="3.5" y="3.5" width="17" height="17" rx="1" />
    <path d="M8.2 8.2h7.6v7.6H8.2z" />
    <path d="M3.5 20.5l4.7-4.7M20.5 20.5l-4.7-4.7" />
  </Svg>
);

/** Trois faders verticaux (Command Section). */
export const IconFaders = (p: IconProps) => (
  <Svg {...p}>
    <path d="M6 3.5v17M12 3.5v17M18 3.5v17" />
    <path d="M4 9.5h4M10 14.5h4M16 7.5h4" strokeWidth={2.4} />
  </Svg>
);

/** Cercle + trois carrés (Special Masters). */
export const IconSpecialMaster = (p: IconProps) => (
  <Svg {...p}>
    <circle cx="12" cy="7.5" r="3.8" />
    <rect x="3" y="15" width="4.6" height="4.6" />
    <rect x="9.7" y="15" width="4.6" height="4.6" />
    <rect x="16.4" y="15" width="4.6" height="4.6" />
  </Svg>
);

/** Deux ronds superposés + deux faders (Master Controls). */
export const IconMasterFader = (p: IconProps) => (
  <Svg {...p}>
    <circle cx="6" cy="9" r="2.3" />
    <circle cx="6" cy="15" r="2.3" />
    <path d="M13 3.5v17M19 3.5v17" />
    <path d="M11 9.5h4M17 14h4" strokeWidth={2.4} />
  </Svg>
);

/** Trois rangées de blocs (Encoder Bar). */
export const IconEncoderBar = (p: IconProps) => (
  <Svg {...p}>
    <rect x="3" y="4" width="5.2" height="3.2" />
    <rect x="9.4" y="4" width="5.2" height="3.2" />
    <rect x="15.8" y="4" width="5.2" height="3.2" />
    <rect x="3" y="10.4" width="5.2" height="3.2" />
    <rect x="9.4" y="10.4" width="5.2" height="3.2" />
    <rect x="15.8" y="10.4" width="5.2" height="3.2" />
    <rect x="3" y="16.8" width="5.2" height="3.2" />
    <rect x="9.4" y="16.8" width="5.2" height="3.2" />
    <rect x="15.8" y="16.8" width="5.2" height="3.2" />
  </Svg>
);

/** Écran sur pied (Displays). */
export const IconDisplay = (p: IconProps) => (
  <Svg {...p}>
    <rect x="3" y="4" width="18" height="12" rx="1" />
    <path d="M12 16v4M8 20h8" />
  </Svg>
);

/** Fader + trois blocs (Command Wing Bar). */
export const IconWing = (p: IconProps) => (
  <Svg {...p}>
    <path d="M6 3.5v17" />
    <path d="M4 10h4" strokeWidth={2.4} />
    <rect x="11" y="4" width="10" height="3.4" />
    <rect x="11" y="10.3" width="10" height="3.4" />
    <rect x="11" y="16.6" width="10" height="3.4" />
  </Svg>
);

/** Entonnoir (bouton At). */
export const IconFunnel = (p: IconProps) => (
  <Svg {...p}>
    <path d="M4 5h16l-6 7.2V18l-4 2v-7.8z" />
  </Svg>
);

// --- Command line -------------------------------------------------------------

export const IconTriangleLeft = (p: IconProps) => (
  <Svg {...p}>
    <path d="M16.5 4.5 6.5 12l10 7.5z" fill="currentColor" stroke="none" />
  </Svg>
);

export const IconTriangleRight = (p: IconProps) => (
  <Svg {...p}>
    <path d="M7.5 4.5 17.5 12l-10 7.5z" fill="currentColor" stroke="none" />
  </Svg>
);

/** Clavier. */
export const IconKeyboard = (p: IconProps) => (
  <Svg {...p}>
    <rect x="2.5" y="6.5" width="19" height="11" rx="1" />
    <path d="M5.5 9.5h1M8.5 9.5h1M11.5 9.5h1M14.5 9.5h1M17.5 9.5h1M5.5 12.5h1M8.5 12.5h1M11.5 12.5h1M14.5 12.5h1M17.5 12.5h1M8 15h8" strokeWidth={1.8} />
  </Svg>
);

/** Cercle barré (décoratif). */
export const IconNoEntry = (p: IconProps) => (
  <Svg {...p}>
    <circle cx="12" cy="12" r="8" />
    <path d="M6.6 6.6l10.8 10.8" />
    <path d="M12 12l3.5-3.5" strokeWidth={2.2} />
  </Svg>
);

/** Micro barré (décoratif). */
export const IconMicMuted = (p: IconProps) => (
  <Svg {...p}>
    <rect x="9" y="3" width="6" height="10.5" rx="3" />
    <path d="M6 11a6 6 0 0 0 12 0M12 17v3.5M9 20.5h6" />
    <path d="M4.5 4.5l15 15" />
  </Svg>
);

/** Globe (backend joignable). */
export const IconGlobe = (p: IconProps) => (
  <Svg {...p}>
    <circle cx="12" cy="12" r="8.5" />
    <path d="M3.5 12h17M12 3.5c3.2 3.2 3.2 13.8 0 17M12 3.5c-3.2 3.2-3.2 13.8 0 17" />
  </Svg>
);

/** Enveloppe (Message Center). */
export const IconEnvelope = (p: IconProps) => (
  <Svg {...p}>
    <rect x="3" y="5.5" width="18" height="13" rx="1" />
    <path d="M3.5 6.5 12 13l8.5-6.5" />
  </Svg>
);

/** Réseau : arbre de trois boîtes (état du WebSocket). */
export const IconNetwork = (p: IconProps) => (
  <Svg {...p}>
    <rect x="9" y="3" width="6" height="4.5" />
    <rect x="2.5" y="16" width="6" height="4.5" />
    <rect x="15.5" y="16" width="6" height="4.5" />
    <path d="M12 7.5V12M5.5 16v-4h13v4" />
  </Svg>
);

// --- View bar, fenêtres, divers ----------------------------------------------------

/** Œil (vue affectée). */
export const IconEye = (p: IconProps) => (
  <Svg {...p}>
    <path d="M2.5 12s3.6-6 9.5-6 9.5 6 9.5 6-3.6 6-9.5 6-9.5-6-9.5-6z" />
    <circle cx="12" cy="12" r="2.8" />
  </Svg>
);

/** Flèche épaisse gauche (barre de pas). */
export const IconArrowLeft = (p: IconProps) => (
  <Svg {...p}>
    <path d="M20.5 9.3h-9V4.5L3.5 12l8 7.5v-4.8h9z" fill="currentColor" stroke="none" />
  </Svg>
);

/** Flèche épaisse droite (barre de pas). */
export const IconArrowRight = (p: IconProps) => (
  <Svg {...p}>
    <path d="M3.5 9.3h9V4.5l8 7.5-8 7.5v-4.8h-9z" fill="currentColor" stroke="none" />
  </Svg>
);

/** Colonne de points + flèches circulaires (pas de phaser). */
export const IconStepLoop = (p: IconProps) => (
  <Svg {...p}>
    <circle cx="6" cy="6.5" r="1.6" fill="currentColor" stroke="none" />
    <circle cx="6" cy="12" r="1.6" fill="currentColor" stroke="none" />
    <circle cx="6" cy="17.5" r="1.6" fill="currentColor" stroke="none" />
    <path d="M11.5 10a5 5 0 0 1 8.8-1.5M20.8 5.5v3.6h-3.6" />
    <path d="M20.5 14a5 5 0 0 1-8.8 1.5M11.2 18.5v-3.6h3.6" />
  </Svg>
);

/** Petit crayon / trait diagonal (champ éditable). */
export const IconSlash = (p: IconProps) => (
  <Svg {...p}>
    <path d="M6 18 18 6" strokeWidth={1.4} />
  </Svg>
);

export const IconClose = (p: IconProps) => (
  <Svg {...p}>
    <path d="M6 6l12 12M18 6 6 18" />
  </Svg>
);

export const IconLock = (p: IconProps) => (
  <Svg {...p}>
    <rect x="5" y="10.5" width="14" height="10" rx="1" />
    <path d="M8 10.5V7a4 4 0 0 1 8 0v3.5" />
  </Svg>
);

export const IconChevronRight = (p: IconProps) => (
  <Svg {...p}>
    <path d="M9 5l7 7-7 7" />
  </Svg>
);

export const IconChevronDown = (p: IconProps) => (
  <Svg {...p}>
    <path d="M5 9l7 7 7-7" />
  </Svg>
);

export const IconPlus = (p: IconProps) => (
  <Svg {...p}>
    <path d="M12 5v14M5 12h14" />
  </Svg>
);

export const IconCheck = (p: IconProps) => (
  <Svg {...p}>
    <path d="M5 12.5l4.5 4.5L19 7" />
  </Svg>
);

export const IconTrash = (p: IconProps) => (
  <Svg {...p}>
    <path d="M4 7h16M9 7V4.5h6V7M7 7l1 13h8l1-13M10 10.5v6M14 10.5v6" />
  </Svg>
);

export const IconCopy = (p: IconProps) => (
  <Svg {...p}>
    <rect x="8" y="8" width="12" height="12" rx="1" />
    <path d="M16 8V5a1 1 0 0 0-1-1H5a1 1 0 0 0-1 1v10a1 1 0 0 0 1 1h3" />
  </Svg>
);

export const IconPlay = (p: IconProps) => (
  <Svg {...p}>
    <path d="M7 4.5 19 12 7 19.5z" fill="currentColor" stroke="none" />
  </Svg>
);

export const IconStop = (p: IconProps) => (
  <Svg {...p}>
    <rect x="6" y="6" width="12" height="12" fill="currentColor" stroke="none" />
  </Svg>
);

export const IconWindow = (p: IconProps) => (
  <Svg {...p}>
    <rect x="3" y="4" width="18" height="16" rx="1" />
    <path d="M3 8.5h18" />
  </Svg>
);

export const IconInfo = (p: IconProps) => (
  <Svg {...p}>
    <circle cx="12" cy="12" r="8.5" />
    <path d="M12 11v5.5M12 7.5v.5" strokeWidth={2} />
  </Svg>
);

export const IconDownload = (p: IconProps) => (
  <Svg {...p}>
    <path d="M12 4v11M7.5 10.5 12 15l4.5-4.5M4 19h16" />
  </Svg>
);

export const IconUpload = (p: IconProps) => (
  <Svg {...p}>
    <path d="M12 15V4M7.5 8.5 12 4l4.5 4.5M4 19h16" />
  </Svg>
);
