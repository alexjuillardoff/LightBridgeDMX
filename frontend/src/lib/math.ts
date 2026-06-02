// Petites fonctions utilitaires de calcul partagees par l'UI.
// Bornage de valeurs numeriques et conversion de couleurs hex -> rgba().

/**
 * Borne (clamp) une valeur dans la plage [min, max].
 * Si la valeur n'est pas un nombre (NaN), on retourne min comme valeur
 * de repli, pour eviter de propager un NaN dans le reste de l'interface.
 */
export const clamp = (value: number, min: number, max: number) => {
  if (Number.isNaN(value)) return min;
  return Math.max(min, Math.min(max, value));
};

/**
 * Convertit une couleur hexadecimale (ex. "#1a2b3c") en chaine rgba()
 * en lui ajoutant une transparence (alpha).
 * Sert a generer des couleurs semi-transparentes pour les styles CSS.
 */
export const addAlpha = (hex: string, alpha: number) => {
  // On retire le "#" eventuel puis on isole les composantes r, g, b
  // par decalage et masque de bits sur l'entier 24 bits.
  const normalized = hex.replace("#", "");
  const bigint = parseInt(normalized, 16);
  const r = (bigint >> 16) & 255;
  const g = (bigint >> 8) & 255;
  const b = bigint & 255;
  return `rgba(${r}, ${g}, ${b}, ${alpha})`;
};
