// Suggested next step per account, written by Claude from the rep's own CRM notes. The numbers stay in calc.js: Claude only
// reads notes and writes one short piece of advice per account. Runs after each sync, a few accounts at a time.
import { norm, diff } from './calc.js';

const SISTEMA = `Eres el mejor gerente de ventas que ha tenido Bodega Dos Búhos y revisas las notas del CRM de un vendedor para decirle cuál es el siguiente paso con cada cuenta.

Dos Búhos: viñedo y bodega boutique con certificación orgánica en San Miguel de Allende, Guanajuato. Vende a restaurantes, hoteles, tiendas de vino y distribuidores en México. El vendedor visita, da a probar y da seguimiento hasta que la cuenta cataloga el vino y recompra.

Para cada cuenta recibes sus últimas notas (la más reciente primero), cuántos días lleva sin contacto y si el seguimiento que prometió está vencido. Escribe UN siguiente paso: lo que haría un vendedor excelente esta semana.

Reglas:
- Concreto y accionable: a quién buscar, por qué medio, qué decir o qué llevar, y cuándo. Nada de "dar seguimiento" a secas.
- Usa lo que dice la nota. Si quedó de volver en una fecha o un mes y ya llegó, dilo ("Ya es noviembre: ..."). Si menciona a una persona ("Francisco es el encargado"), el paso es llegar a esa persona.
- No aceptes pretextos. Si la nota es una excusa (no estaba el que paga, no han contestado, están muy ocupados, no van a cambiar la carta), propone cómo destrabarlo: otra persona que decida, otro medio, una fecha compromiso, ir en persona a una hora en que sí estén.
- Cobranza: pide fecha de pago por escrito, pregunta quién más autoriza, manda el estado de cuenta y los datos de transferencia el mismo día, y propone pasar en persona. Sin amenazas.
- Si probaron el vino y les gustó pero no cambian la carta, propone quitarles la fricción: vino por copa o vino del mes sin tocar la carta, un inserto o tarjeta para la carta actual, o plantearle a Eric que Dos Búhos pague la reimpresión de la carta.
- Otras herramientas de la casa: cata para el personal de piso, capacitación de meseros, muestras, invitar al comprador o al chef al viñedo, maridaje con un platillo de su menú, primer pedido chico de prueba.
- No inventes precios, descuentos, plazos de crédito ni promociones. Si haría falta uno, di "plantéaselo a Eric".
- Si la cuenta de verdad está fría (varios intentos sin respuesta), di cuál es el último intento que vale la pena y cuándo cerrarla.
- Tono: directo, de colega que quiere que venda, sin regaños ni adornos. Español de México, de tú. Una o dos frases, máximo 40 palabras. Sin emojis ni signos de exclamación.

Entrega el resultado llamando a la herramienta guardar_pasos, una sola vez, con un paso por cuenta y el mismo "i" que recibiste. No escribas nada más: ni panorama general, ni diagnóstico, ni comentarios. Si no pudieras usar la herramienta, responde únicamente con JSON: [{"i": 0, "paso": "..."}].`;

const HERRAMIENTA = { name: 'guardar_pasos', description: 'Guarda el siguiente paso sugerido de cada cuenta.',
  input_schema: { type: 'object', required: ['pasos'], properties: { pasos: { type: 'array', items: { type: 'object', required: ['i', 'paso'], properties: { i: { type: 'integer', description: 'El mismo i de la cuenta recibida' }, paso: { type: 'string', description: 'Una o dos frases, máximo 40 palabras' } } } } } } };

async function secreto(v) { try { return typeof v === 'string' ? v : (v && typeof v.get === 'function' ? (await v.get()) || '' : ''); } catch { return ''; } }

// Accounts whose suggestion is missing or out of date, most urgent first.
export function pendientes(seguimiento, activity, guardadas, hoy) {
  const porCuenta = new Map();
  for (const r of activity) {
    if (!r.cuenta || !/^\d{4}-\d{2}-\d{2}$/.test(r.fecha || '')) continue;
    const k = r.persona + '|' + norm(r.cuenta);
    if (!porCuenta.has(k)) porCuenta.set(k, []);
    porCuenta.get(k).push(r);
  }
  const ya = new Map(guardadas.map((s) => [s.persona + '|' + s.clave, s.firma]));
  const out = [];
  for (const s of seguimiento) {
    if (s.estado === 'cerrada') continue;
    const k = s.persona + '|' + norm(s.cuenta);
    const notas = (porCuenta.get(k) || []).sort((a, b) => (a.fecha < b.fecha ? 1 : -1));
    if (!notas.length || !notas.some((n) => (n.resultado || n.siguiente_paso || '').trim())) continue;
    // Rewritten when a new note arrives or the follow-up goes from on time to overdue.
    const firma = `${notas[0].fecha}|${notas.length}|${s.estado}`;
    if (ya.get(k) === firma) continue;
    out.push({ persona: s.persona, clave: norm(s.cuenta), firma, urg: s.estado === 'vencida' ? 0 : 1, dias: s.dias_sin_contacto,
      datos: { cuenta: s.cuenta, vendedor: s.persona, etapa: s.etapa || undefined, dias_sin_contacto: s.dias_sin_contacto,
        seguimiento: s.estado === 'vencida' ? `vencido hace ${s.dias_vencido} días (prometió volver el ${s.proximo})` : s.estado === 'al día' ? `programado para ${s.proximo}` : 'sin fecha de próximo contacto',
        notas: notas.slice(0, 3).map((n) => ({ fecha: n.fecha, actividad: n.actividad, medio: n.medio || undefined, resultado: n.resultado || undefined, siguiente_paso: n.siguiente_paso || undefined, dias_atras: diff(n.fecha, hoy) })) } });
  }
  return out.sort((a, b) => a.urg - b.urg || a.dias - b.dias);
}

// Claude's reply as a list, whatever wraps the JSON.
export function leer(texto) {
  const a = texto.indexOf('['), b = texto.lastIndexOf(']');
  if (a < 0 || b <= a) return [];
  try { return JSON.parse(texto.slice(a, b + 1)).filter((x) => x && Number.isInteger(x.i) && typeof x.paso === 'string' && x.paso.trim()); } catch { return []; }
}

export async function sugerir(env, modelo, activity, { max = 40, lote = 10 } = {}) {
  const key = await secreto(env.ANTHROPIC_API_KEY);
  if (!key) return { skipped: 'Falta ANTHROPIC_API_KEY' };
  const guardadas = (await env.DB.prepare('SELECT persona, clave, firma FROM sugerencias').all()).results;
  const cola = pendientes(modelo.seguimiento, activity, guardadas, modelo.hoy);
  let escritas = 0;
  for (let i = 0; i < Math.min(cola.length, max); i += lote) {
    const grupo = cola.slice(i, Math.min(i + lote, max));
    const r = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST', headers: { 'x-api-key': key, 'anthropic-version': '2023-06-01', 'content-type': 'application/json' },
      body: JSON.stringify({ model: env.AI_MODEL || 'claude-sonnet-5-5', max_tokens: 4000, system: SISTEMA,
        thinking: { type: 'between_tools' },                                             // this model's way of saying "no extended thinking"
        tools: [HERRAMIENTA],                                                             // this model does not accept a forced tool_choice; the prompt asks for the tool and plain JSON is read as a fallback
       
        messages: [{ role: 'user', content: `Hoy es ${modelo.hoy}.\nCuentas (JSON):\n` + JSON.stringify(grupo.map((g, j) => ({ i: j, ...g.datos }))) }] }) });
    if (!r.ok) throw new Error(`Claude ${r.status}: ${(await r.text()).slice(0, 160)}`);
    const j = await r.json();
    const uso = (j.content || []).find((c) => c.type === 'tool_use'), crudo = (j.content || []).filter((c) => c.type === 'text').map((c) => c.text).join('');
    const pasos = uso && Array.isArray(uso.input?.pasos) ? uso.input.pasos.filter((x) => x && Number.isInteger(x.i) && typeof x.paso === 'string' && x.paso.trim()) : leer(crudo);
    // Nothing usable came back: say what did, so the cause shows in Ajustes instead of a silent zero.
    if (!pasos.length) throw new Error(`Claude no devolvió pasos (stop: ${j.stop_reason}; bloques: ${(j.content || []).map((c) => c.type).join(',') || 'ninguno'}): ${crudo.slice(0, 200)}`);
    const stmts = pasos.filter((x) => grupo[x.i]).map((x) => env.DB.prepare('INSERT INTO sugerencias (persona, clave, firma, texto, creado) VALUES (?,?,?,?,?) ON CONFLICT(persona, clave) DO UPDATE SET firma=excluded.firma, texto=excluded.texto, creado=excluded.creado')
      .bind(grupo[x.i].persona, grupo[x.i].clave, grupo[x.i].firma, x.paso.trim().slice(0, 400), modelo.hoy));
    if (stmts.length) await env.DB.batch(stmts);
    escritas += stmts.length;
  }
  return { escritas, faltan: Math.max(0, cola.length - escritas) };
}
