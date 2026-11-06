// Proposal PDF template — three Letter pages rendered by Browser Rendering (see worker.js /pdf).
// Takes the quote the app computed (public/index.html → proposalData()) and returns a self-contained HTML document.
import { FONT_CSS, LOGO_DARK, LOGO_LIGHT } from './assets.js';

const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const para = s => esc(s).split(/\n\s*\n/).filter(Boolean).map(p => `<p>${p.replace(/\n/g, '<br>')}</p>`).join('');

const SPACE = {
  bodega: { name: 'La Bodega de Arte', photo: 'bodega-arte.jpg', cap: 'La Bodega de Arte, lista para la mesa' },
  garden: { name: 'El Winegarden', photo: 'winegarden-night.jpg', cap: 'El Winegarden al caer la tarde' },
  rest: { name: 'El restaurante', photo: 'lunch-table.jpg', cap: 'Nuestra mesa bajo los mezquites' },
};

const lc1 = s => s ? s.charAt(0).toLowerCase() + s.slice(1) : s;
export function introText(d) {
  const who = d.cliente ? esc(d.cliente) + ', gracias' : 'Gracias';
  const ev = d.evento ? ` para su ${esc(lc1(d.evento.replace(/^(la|el|su|una?)\s+/i, '')))}` : '';
  const where = d.space?.est ? 'con la hacienda completa en exclusiva' : ({ bodega: 'en la Bodega de Arte', garden: 'en el Winegarden', rest: 'en nuestro restaurante' }[d.space?.key] || '');
  const bits = [[d.pax ? `${d.pax} invitados` : '', where].filter(Boolean).join(' '), d.space?.key && d.space.key !== 'rest' ? `${d.space.hrs || 3} horas` : '', d.fecha ? `el ${esc(lc1(d.fecha))}` : ''].filter(Boolean);
  return `${who} por pensar en Dos Búhos${ev}. ` +
    (bits.length ? `Esta propuesta reúne lo que platicamos: ${bits.join(', ')}. ` : 'Esta propuesta reúne lo que platicamos. ') +
    'Todo lo que ve aquí lo hace nuestro equipo en casa: la cocina, los vinos de nuestro viñedo orgánico y la coordinación del día.';
}

export function proposalHTML(d, base, note) {
  const sp = SPACE[d.space?.key] || null;
  const isBoda = /boda|wedding|matrimonio/i.test(d.evento || '');
  const cover = `${base}/img/${isBoda ? 'wedding-toast.jpg' : 'hacienda.jpg'}`;
  const used = new Set([isBoda ? 'wedding-toast.jpg' : 'hacienda.jpg', sp ? sp.photo : '']);
  const pick = (...cands) => { const c = cands.find(x => !used.has(x)); used.add(c); return `${base}/img/${c}`; };
  const title = d.cliente || d.evento || 'Su evento';
  const sub = [d.evento && d.cliente ? d.evento : '', d.fecha, d.hora, d.pax ? `${d.pax} invitados` : ''].filter(Boolean).join('  ·  ');
  const hasTour = (d.it || []).some(r => /recorrido/i.test(r[1]));
  const lines = (L) => (L || []).map(([a, b, k]) => `<div class="ln ${k || ''}"><span>${esc(a)}</span><span>${esc(b)}</span></div>`).join('');
  const incl = d.space?.key && d.space.key !== 'rest'
    ? ['Mobiliario, mantelería y vajilla', 'Cristalería de la casa', 'Coordinación en sitio', 'Estacionamiento atendido', 'Sanitarios atendidos', `${d.space.hrs || 3} horas de evento`]
    : d.space?.key === 'rest' ? ['Mesa reservada en horario regular', 'Hasta 3 horas', 'Servicio de nuestro equipo'] : [];
  const pageHead = (k) => `<div class="ph"><img src="${LOGO_DARK}" alt="Dos Búhos"><span>${esc(k)}</span></div>`;
  const pageFoot = (n) => `<div class="pf"><span>Bodega Dos Búhos · Viñedo orgánico certificado · San Miguel de Allende, Guanajuato</span><span>${n} / 3</span></div>`;

  return `<!DOCTYPE html><html lang="es"><head><meta charset="utf-8"><title>Propuesta · ${esc(title)}</title>
<style>
${FONT_CSS}
@page{size:letter;margin:0}
*{box-sizing:border-box;margin:0;padding:0}
html,body{background:#fff;-webkit-print-color-adjust:exact;print-color-adjust:exact}
body{font-family:Lato,sans-serif;font-weight:300;color:#2b2420;font-size:10.5pt;line-height:1.5}
.pg{width:8.5in;height:11in;position:relative;overflow:hidden;page-break-after:always;background:#f6f2e7}
.pg:last-child{page-break-after:auto}
.k{font-size:8pt;letter-spacing:.26em;text-transform:uppercase;color:#a0783a}
h1,h2,h3,.serif{font-family:"Cormorant Garamond",Georgia,serif;font-weight:500;line-height:1.05}
/* cover */
.hero{position:relative;height:6.2in;background:#5c1e33 url("${cover}") center/cover no-repeat}
.hero:after{content:"";position:absolute;inset:0;background:linear-gradient(180deg,rgba(43,20,30,.25) 0%,rgba(43,20,30,0) 35%,rgba(70,22,40,.78) 78%,rgba(92,30,51,.96) 100%)}
.hero img{position:absolute;top:.6in;left:.7in;height:.46in;z-index:2}
.hero .tx{position:absolute;left:.7in;right:.7in;bottom:.6in;z-index:2;color:#f6f2e7}
.hero .k{color:#e6cfa0}
.hero h1{font-size:38pt;margin:.1in 0 .08in;color:#fffef8;font-weight:500;letter-spacing:-.005em}
.hero .sub{font-size:10.5pt;font-weight:300;opacity:.9;letter-spacing:.02em}
.cv{padding:.5in .7in 0}
.cv .intro{font-family:"Cormorant Garamond",Georgia,serif;font-size:15.5pt;line-height:1.38;color:#2b2420;max-width:6.6in}
.stats{display:grid;grid-template-columns:1fr 1fr 1fr;margin-top:.42in;border-top:1px solid #d9cfb8;border-bottom:1px solid #d9cfb8}
.stats > div{padding:.2in .2in .2in 0;border-right:1px solid #d9cfb8}
.stats > div + div{padding-left:.25in}
.stats > div:last-child{border-right:0}
.stats .v{font-family:"Cormorant Garamond",Georgia,serif;font-size:26pt;color:#5c1e33;line-height:1.05;margin-top:.06in;font-weight:500}
.stats .s{font-size:8.5pt;color:#7d7466;margin-top:.04in}
.cvf{position:absolute;left:.7in;right:.7in;bottom:.5in;display:flex;justify-content:space-between;font-size:8pt;color:#7d7466;letter-spacing:.04em}
/* inner pages */
.ph{display:flex;justify-content:space-between;align-items:center;padding:.5in .7in 0;height:1.05in}
.ph img{height:.34in}
.ph span{font-size:8pt;letter-spacing:.24em;text-transform:uppercase;color:#7d7466}
.pf{position:absolute;left:.7in;right:.7in;bottom:.45in;display:flex;justify-content:space-between;font-size:7.5pt;color:#9a9184;letter-spacing:.04em;border-top:1px solid #e4dccb;padding-top:.1in}
.bd{padding:0 .7in}
h2{font-size:24pt;color:#5c1e33;margin:.05in 0 .18in}
h2 small{display:block;font-family:Lato,sans-serif;font-weight:300;font-size:9.5pt;color:#7d7466;margin-top:.04in;letter-spacing:.02em}
h3{font-size:14pt;color:#5c1e33;margin:.24in 0 .1in}
/* itinerary */
.it{display:grid;grid-template-columns:1.05in 1fr;row-gap:.09in;column-gap:.15in;margin-bottom:.2in}
.it .t{font-size:8pt;letter-spacing:.2em;text-transform:uppercase;color:#a0783a;padding-top:.07in;border-top:1px solid #e4dccb}
.it .d{border-top:1px solid #e4dccb;padding-top:.06in}
.it .d b{display:block;font-family:"Cormorant Garamond",Georgia,serif;font-weight:500;font-size:15pt;color:#5c1e33;line-height:1.05;margin-bottom:.02in}
.it .d span{font-size:9.5pt;color:#2b2420;line-height:1.4}
/* space */
.spc{display:grid;grid-template-columns:2.75in 1fr;column-gap:.32in;align-items:start}
.spc .im{height:1.75in;background:#ccc center/cover no-repeat}
.spc .cap{font-size:7.5pt;color:#9a9184;margin-top:.06in;letter-spacing:.04em}
.spc p{font-size:9.5pt;margin-bottom:.08in}
.inc{display:grid;grid-template-columns:1fr 1fr;column-gap:.25in;row-gap:.04in;margin-top:.1in}
.inc div{font-size:9pt;color:#2b2420;padding-left:.16in;position:relative}
.inc div:before{content:"";position:absolute;left:0;top:.09in;width:5px;height:5px;background:#a0783a;border-radius:50%}
/* investment */
.ln{display:flex;justify-content:space-between;gap:.3in;padding:.075in 0;border-bottom:1px solid #e9e2d2;font-size:10pt;font-weight:400}
.ln.sub{font-weight:300;color:#7d7466;font-size:9.5pt;padding:.045in 0;border-bottom:0}
.ln.tot{border-bottom:0;border-top:1px solid #c9bd9f;margin-top:.04in;padding-top:.09in;font-family:"Cormorant Garamond",Georgia,serif;font-weight:600;font-size:13.5pt;color:#5c1e33}
.cols{display:grid;grid-template-columns:1fr 1fr;column-gap:.45in}
.grand{margin:.28in 0 .22in;background:#5c1e33;color:#f6f2e7;padding:.22in .3in;display:flex;justify-content:space-between;align-items:center}
.grand .l{font-size:8pt;letter-spacing:.24em;text-transform:uppercase;color:#e6cfa0}
.grand .n{font-size:9pt;opacity:.85;margin-top:.04in}
.grand .v{font-family:"Cormorant Garamond",Georgia,serif;font-weight:500;font-size:30pt;line-height:1;text-align:right}
.grand .pp{font-size:9pt;opacity:.85;text-align:right;margin-top:.05in}
.min{font-family:"Cormorant Garamond",Georgia,serif;font-style:italic;font-size:11.5pt;line-height:1.35;color:#5c1e33;border-left:2px solid #a0783a;padding-left:.18in;margin:.1in 0 .18in}
.notes p{font-size:9.5pt;margin-bottom:.08in}
.nx3{display:grid;grid-template-columns:1.3fr 1fr 1fr;column-gap:.35in;margin-top:.26in;padding-top:.2in;border-top:1px solid #d9cfb8}
.nx3 b{display:block;font-family:"Cormorant Garamond",Georgia,serif;font-weight:500;font-size:13pt;color:#5c1e33;margin-bottom:.06in}
.nx3 > div{font-size:9.5pt}
.nx3 a{color:inherit;text-decoration:none}
.notes p{font-size:9.5pt;margin-bottom:.07in}
.band{position:absolute;left:0;right:0;bottom:.85in;height:1.4in;background:#ccc center/cover no-repeat}
.band.tall{height:2.3in}
.band span{position:absolute;left:.7in;bottom:.18in;color:#fffef8;font-family:"Cormorant Garamond",Georgia,serif;font-style:italic;font-size:12pt;text-shadow:0 1px 6px rgba(0,0,0,.45)}
.band:before{content:"";position:absolute;inset:0;background:linear-gradient(180deg,rgba(43,20,30,0) 45%,rgba(43,20,30,.55) 100%)}
.dense .ln{padding:.05in 0;font-size:9.5pt}
.dense .ln.sub{padding:.03in 0;font-size:9pt}
.dense .ln.tot{font-size:12.5pt;padding-top:.07in}
.dense h2{margin-bottom:.14in}
.dense .grand{margin:.2in 0 .14in;padding:.17in .3in}
.dense .grand .v{font-size:26pt}
.dense .nx3{margin-top:.18in;padding-top:.16in}
.dense .nx3 > div,.dense .notes p{font-size:9pt}
.dense .min{font-size:10.5pt;margin:.06in 0 .1in}
.nx{display:grid;grid-template-columns:1fr 1fr;column-gap:.45in;margin-top:.1in}
.nx b{display:block;font-family:"Cormorant Garamond",Georgia,serif;font-weight:500;font-size:13pt;color:#5c1e33;margin-bottom:.05in}
.nx div{font-size:9.5pt}
.nx a{color:inherit;text-decoration:none}
</style></head><body>

<!-- 1 · Portada -->
<section class="pg">
  <div class="hero"><img src="${LOGO_LIGHT}" alt="Dos Búhos">
    <div class="tx"><div class="k">Propuesta de evento</div><h1>${esc(title)}</h1><div class="sub">${esc(sub)}</div></div>
  </div>
  <div class="cv">
    <div class="intro">${esc(note || '').trim() ? esc(note) : introText(d)}</div>
    <div class="stats">
      <div><div class="k">Total del evento</div><div class="v">${esc(d.grand || '$0')}</div><div class="s">Servicio e IVA incluidos</div></div>
      <div><div class="k">Por invitado</div><div class="v">${esc(d.pp || '—')}</div><div class="s">${d.pax ? esc(d.pax) + ' invitados' : '&nbsp;'}</div></div>
      <div><div class="k">El espacio</div><div class="v" style="font-size:19pt;margin-top:.1in">${esc(d.space?.est ? 'Hacienda completa' : (sp?.name || 'Por definir'))}</div><div class="s">${d.space?.key && d.space.key !== 'rest' ? esc(`${d.space.hrs || 3} horas en exclusiva`) : (d.space?.key === 'rest' ? 'Horario regular' : '&nbsp;')}</div></div>
    </div>
  </div>
  <div class="cvf"><span>${esc(d.hoy || '')}${d.hoy ? ' · ' : ''}Propuesta vigente por 15 días naturales · Precios en pesos mexicanos</span><span>${d.por ? esc(d.por) : 'eventos@dosbuhos.com'}</span></div>
</section>

<!-- 2 · La velada -->
<section class="pg">
  ${pageHead('Propuesta · ' + title)}
  <div class="bd">
    <h2>El ritmo de su velada<small>Cómo transcurre el día, de la llegada a la despedida</small></h2>
    <div class="it">${(d.it || []).length ? d.it.map(([t, h, x]) => `<div class="t">${esc(t)}&nbsp;</div><div class="d"><b>${esc(h)}</b><span>${esc(x)}</span></div>`).join('') : `<div class="t">&nbsp;</div><div class="d"><span>Afinamos juntos el menú, la barra y los tiempos.</span></div>`}</div>
    <h2 style="margin-top:0">El espacio<small>${esc(sp ? sp.name : 'Por definir')}</small></h2>
    <div class="spc">
      <div><div class="im" style="background-image:url('${base}/img/${sp ? sp.photo : (hasTour ? 'recorrido.jpg' : 'hacienda.jpg')}')"></div><div class="cap">${esc(sp ? sp.cap : 'Bodega Dos Búhos')}</div></div>
      <div>${para(d.space?.text || 'Elegimos juntos el espacio que mejor le vaya a su grupo: la Bodega de Arte, el Winegarden o una mesa en nuestro restaurante.')}
        ${incl.length ? `<div class="inc">${incl.map(x => `<div>${esc(x)}</div>`).join('')}</div>` : ''}</div>
    </div>
  </div>
  <div class="band" style="background-image:url('${pick('hacienda.jpg', 'recorrido.jpg', 'lunch-table.jpg')}')"><span>Viñedo orgánico certificado a 2,000 metros · San Miguel de Allende</span></div>
  ${pageFoot(2)}
</section>

<!-- 3 · La inversión -->
<section class="pg${d.detail ? ' dense' : ''}">
  ${pageHead('Propuesta · ' + title)}
  <div class="bd">
    <h2>La inversión<small>Precios por persona en pesos mexicanos; servicio e IVA desglosados</small></h2>
    ${d.detail ? `<div class="cols">
      <div><h3 style="margin-top:0">Alimentos y bebidas</h3>${lines(d.fb?.lines)}<div class="ln tot"><span>Total alimentos y bebidas</span><span>${esc(d.fb?.total || '$0')}</span></div></div>
      <div><h3 style="margin-top:0">El espacio</h3>${d.sp ? lines(d.sp.lines) + `<div class="ln tot"><span>Total espacio</span><span>${esc(d.sp.total)}</span></div>` : '<div class="ln sub"><span>Sin espacio elegido</span><span></span></div>'}</div>
    </div>` : `<div style="max-width:4.6in">
      <div class="ln"><span>Alimentos y bebidas · servicio e IVA incluidos</span><span>${esc(d.fb?.total || '$0')}</span></div>
      ${d.sp ? `<div class="ln"><span>${esc(d.space?.est ? 'Hacienda completa en exclusiva · IVA incluido' : (sp?.name || 'Espacio') + ' · IVA incluido')}</span><span>${esc(d.sp.total)}</span></div>` : ''}
    </div>`}
    <div class="grand"><div><div class="l">Total del evento</div><div class="n">Alimentos, bebidas, espacio, servicio e IVA incluidos</div></div><div><div class="v">${esc(d.grand || '$0')}</div><div class="pp">${esc(d.pp ? d.pp + ' por invitado' : '')}</div></div></div>
    ${d.minNote ? `<div class="min">${esc(d.minNote)}</div>` : ''}
    <div class="nx3">
    ${d.notas ? `<div><b>Notas</b><div class="notes">${para(d.notas)}</div></div>` : ''}
      <div><b>Cómo reservar</b>La fecha se aparta con 50 % de anticipo; el saldo, cinco días antes del evento. Menú y número final de invitados, diez días antes. Pagos por transferencia bancaria.</div>
      <div><b>Su contacto</b>${d.por ? esc(d.por) + '<br>' : 'Luis Alberto Quezada · Embajador de Experiencias<br>Melanie Harris · Curadora de eventos<br>'}<a href="mailto:eventos@dosbuhos.com">eventos@dosbuhos.com</a><br>WhatsApp +52 415 139 0978</div>
    </div>
  </div>
  ${d.detail ? '' : `<div class="band tall" style="background-image:url('${pick('lunch-table.jpg', 'winegarden-night.jpg', 'bodega-arte.jpg', 'recorrido.jpg')}')"><span>Los esperamos en el viñedo.</span></div>`}
  ${pageFoot(3)}
</section>
</body></html>`;
}
