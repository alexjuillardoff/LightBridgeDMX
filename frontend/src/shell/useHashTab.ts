import { useCallback, useEffect, useState } from "react";
import { DEFAULT_TAB, TabId, isTabId } from "./tabs";

const fromHash = (): TabId => {
  if (typeof window === "undefined") return DEFAULT_TAB;
  const h = window.location.hash.replace(/^#/, "");
  return isTabId(h) ? h : DEFAULT_TAB;
};

export const useHashTab = (): [TabId, (next: TabId) => void] => {
  const [tab, setTab] = useState<TabId>(fromHash);

  useEffect(() => {
    const onChange = () => {
      const next = fromHash();
      if (!isTabId(window.location.hash.replace(/^#/, "")) && window.location.hash) {
        console.warn(`Unknown tab hash "${window.location.hash}", falling back to #${DEFAULT_TAB}`);
      }
      setTab(next);
    };
    window.addEventListener("hashchange", onChange);
    return () => window.removeEventListener("hashchange", onChange);
  }, []);

  const setActive = useCallback((next: TabId) => {
    if (!isTabId(next)) return;
    if (window.location.hash !== `#${next}`) {
      window.location.hash = next;
    } else {
      setTab(next);
    }
  }, []);

  return [tab, setActive];
};
