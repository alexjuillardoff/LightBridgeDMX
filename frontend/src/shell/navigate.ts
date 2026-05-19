import { TabId, isTabId } from "./tabs";

export const setActiveTabHash = (id: TabId) => {
  if (!isTabId(id)) return;
  window.location.hash = id;
};
