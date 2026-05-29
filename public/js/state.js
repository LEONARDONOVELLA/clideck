export const state = {
  ws: null,
  terms: new Map(),
  active: null,
  cfg: { commands: [], defaultPath: '', defaultTheme: 'catppuccin-mocha' },
  themes: [],
  presets: [],
  resumable: [],
  filter: { query: '', tab: 'all' },
  pills: new Map(),
  activePill: null,
  transcriptCache: {},
  remoteVersion: null,
};

export function send(msg) {
  if (!state.ws || state.ws.readyState !== WebSocket.OPEN) return;
  state.ws.send(JSON.stringify(msg));
}
