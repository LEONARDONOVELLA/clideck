// Display ordering for sidebar project groups. Pure module — no DOM, no state.
export function isSortEnabled(cfg) {
  return cfg?.sortProjectsAlphabetically !== false;
}

export function sortProjectsForDisplay(projects, cfg) {
  const pinned = projects.filter(p => p.pinned);
  const rest = projects.filter(p => !p.pinned);
  pinned.sort((a, b) => (a.pinOrder ?? 0) - (b.pinOrder ?? 0));
  if (isSortEnabled(cfg)) {
    rest.sort((a, b) => (a.name || '').localeCompare(b.name || '', undefined, { sensitivity: 'base', numeric: true }));
  }
  return [...pinned, ...rest];
}
