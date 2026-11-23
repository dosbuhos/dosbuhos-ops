// Small helpers shared by the dashboard and the show page (the show page also runs from the TV, offline).
export const $ = (s, r = document) => r.querySelector(s);
export const $$ = (s, r = document) => [...r.querySelectorAll(s)];
export const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
export const tc = (ms) => { ms = Math.max(0, Math.round(ms || 0)); const s = Math.floor(ms / 1000), h = Math.floor(s / 3600), m = Math.floor((s % 3600) / 60), x = s % 60; return (h ? h + ':' + String(m).padStart(2, '0') : m) + ':' + String(x).padStart(2, '0'); };
export const bytes = (n) => { n = Number(n) || 0; if (n < 1e6) return Math.round(n / 1e3) + ' KB'; if (n < 1e9) return (n / 1e6).toFixed(n < 1e8 ? 1 : 0) + ' MB'; return (n / 1e9).toFixed(2) + ' GB'; };
export const ago = (t) => { if (!t) return 'nunca'; const s = Math.round((Date.now() - t) / 1000); if (s < 10) return 'ahora'; if (s < 60) return `hace ${s} s`; if (s < 3600) return `hace ${Math.round(s / 60)} min`; if (s < 86400) return `hace ${Math.round(s / 3600)} h`; return new Date(t).toLocaleDateString('es-MX', { day: 'numeric', month: 'short' }); };
export const date = (t) => new Date(t).toLocaleDateString('es-MX', { day: 'numeric', month: 'short', year: 'numeric' });
export const res = (w, h) => (!w ? '' : h >= 2160 ? '4K' : h >= 1440 ? '1440p' : h >= 1080 ? '1080p' : h >= 720 ? '720p' : `${w}×${h}`);
let toastT;
export function toast(msg, ms = 3200) {
  let t = document.querySelector('.toast');
  if (!t) { t = document.createElement('div'); t.className = 'toast'; document.body.append(t); }
  t.textContent = msg; t.classList.remove('hide'); clearTimeout(toastT); toastT = setTimeout(() => t.classList.add('hide'), ms);
}
// What the TV is doing, in words (state reported by the player).
export function stateWords(st) {
  if (!st || !st.mode) return 'Sin datos';
  if (st.blackout) return 'Negro';
  return ({ idle: 'Detenido', playing: 'Reproduciendo', paused: 'En pausa', ended: 'Terminó', buffering: 'Cargando', error: 'Error' })[st.mode] || st.mode;
}
export const CMD_WORDS = { play: 'Reproducir', play_playlist: 'Reproducir lista', cue: 'CUE', go: 'GO', pause: 'Pausa', resume: 'Continuar', toggle_pause: 'Pausa / continuar',
  restart: 'Reiniciar', stop: 'Detener', blackout: 'Negro', seek: 'Ir a', skip: 'Siguiente', mute: 'Silencio', volume: 'Volumen', fit: 'Encuadre', loop: 'Repetir', identify: 'Identificar', sync_now: 'Sincronizar' };
export const STATUS_WORDS = { pending: 'Enviado · esperando al TV', delivered: 'Recibido por el TV', done: 'Confirmado por el TV', failed: 'El TV no pudo', expired: 'No se entregó (el TV no respondió)', sending: 'Enviando…' };
