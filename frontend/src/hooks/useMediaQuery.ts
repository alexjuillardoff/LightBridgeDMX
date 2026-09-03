// Hook : suit une media query CSS depuis React.
//
// Sert au plan de travail du pupitre, qui n'a de sens qu'à partir d'une certaine
// largeur : sous ~1024 px, les fenêtres déplaçables deviennent des cartes
// empilées. Plutôt que de dupliquer le point de rupture entre la CSS et le JS,
// on interroge le navigateur avec la même chaîne.
import { useEffect, useState } from "react";

export const useMediaQuery = (query: string): boolean => {
  // Valeur initiale lue en synchrone : évite un premier rendu dans le mauvais
  // mode, puis un saut de mise en page juste après.
  const [matches, setMatches] = useState(() =>
    typeof window === "undefined" ? false : window.matchMedia(query).matches
  );

  useEffect(() => {
    const mql = window.matchMedia(query);
    const onChange = (event: MediaQueryListEvent) => setMatches(event.matches);
    // La requête a pu changer entre le rendu initial et l'effet.
    setMatches(mql.matches);
    mql.addEventListener("change", onChange);
    return () => mql.removeEventListener("change", onChange);
  }, [query]);

  return matches;
};
