// The only bridge between the windows and the app. Renderers never touch Node or Supabase.
const { contextBridge, ipcRenderer } = require('electron');

const on = channel => cb => {
  const handler = (_e, value) => cb(value);
  ipcRenderer.on(channel, handler);
  return () => ipcRenderer.removeListener(channel, handler);
};

contextBridge.exposeInMainWorld('clawd', {
  onState: on('state'),
  onMood: on('mood'),
  onSize: on('size'),
  onPanel: on('panel'),
  ready: () => ipcRenderer.send('renderer:ready'),

  add: title => ipcRenderer.invoke('tasks:add', title),
  toggle: id => ipcRenderer.invoke('tasks:toggle', id),
  rename: (id, title) => ipcRenderer.invoke('tasks:rename', id, title),
  remove: id => ipcRenderer.invoke('tasks:remove', id),
  reorder: ids => ipcRenderer.invoke('tasks:reorder', ids),
  signIn: (email, password) => ipcRenderer.invoke('auth:sign-in', email, password),
  signOut: () => ipcRenderer.invoke('auth:sign-out'),

  setIgnoreMouse: ignore => ipcRenderer.send('clawd:ignore', ignore),
  resizeBy: delta => ipcRenderer.send('clawd:resize-by', delta),
  dragStart: () => ipcRenderer.send('clawd:drag-start'),
  dragEnd: () => ipcRenderer.send('clawd:drag-end'),
  clawdClick: () => ipcRenderer.send('clawd:click'),
  closePanel: () => ipcRenderer.send('panel:close'),
  quit: () => ipcRenderer.send('app:quit'),
});
