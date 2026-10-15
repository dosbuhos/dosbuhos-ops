import {page,esc} from './ui.js';
import {isDate} from './schedule.js';
import {writeFulfillment} from './data.js';
import {exactDate} from './visibility.js';

export function receiptPage({env,user,sh,kind}) {
  const o=sh.o, back=`/envio/${o.subId}/${o.k}`;
  const photo=kind==='receipt';
  return page({env,user,tab:'agenda',title:'Comprobante de recepción',body:`
  <p><a href="${back}">← Envío</a></p><h1>Comprobante de recepción</h1>
  <div class="card"><b>${esc(sh.sub.member_name)} · Envío #${o.n}</b><p class="small">${esc(o.club.name)} · ${o.expectedBottles} botellas · previsto ${esc(exactDate(o.due))}</p>
  <p class="small">Guarda evidencia de quién recibió la caja. No cambia el estado de entrega; confírmalo por separado en el envío.</p></div>
  <form id="receipt-form" action="${back}/comprobante" method="post" enctype="multipart/form-data">
  <input type="hidden" name="version" value="${o.f?.version||0}">
  <div class="card"><label for="recipient">Nombre de quien recibe</label><input id="recipient" name="recipient" maxlength="120" value="${esc(sh.sub.member_name)}" required>
  <label for="received-on">Fecha de recepción</label><input id="received-on" name="received_on" type="date" max="${sh.ctx.today}" value="${sh.ctx.today}" required>
  <label for="evidence-kind">Tipo de comprobante</label><select id="evidence-kind" name="kind"><option value="signature" ${photo?'':'selected'}>Firma en pantalla</option><option value="receipt" ${photo?'selected':''}>Foto o captura de pantalla</option></select>
  <div id="signature-panel" ${photo?'hidden':''}><p>Firma aquí con el dedo o el mouse.</p>
  <canvas id="signature-pad" width="1000" height="350" aria-label="Área para dibujar la firma" style="display:block;width:100%;height:auto;background:white;border:2px solid var(--wine);border-radius:10px;touch-action:none"></canvas>
  <button type="button" class="btn sm quiet" id="clear-signature" style="margin-top:8px">Borrar firma y volver a intentar</button>
  <p class="small muted">Al guardar, confirmas la recepción de esta caja. También puedes subir una foto si prefieres firmar en papel.</p></div>
  <div id="receipt-photo-panel" ${photo?'':'hidden'}><label for="receipt-file">Foto del recibo firmado o captura de WhatsApp</label><input type="file" id="receipt-file" name="file" accept="image/jpeg,image/png,image/webp" ${photo?'required':''}>
  <p class="small muted">Elige una imagen de tus archivos o toma una foto. Debe mostrar la confirmación de recepción.</p><img id="receipt-preview" alt="Vista previa del comprobante" hidden style="max-width:100%;max-height:400px;margin-top:10px"></div>
  <label for="receipt-note">Nota (opcional)</label><textarea id="receipt-note" name="note" maxlength="500" placeholder="Ej. recibió su esposa; confirmación por WhatsApp"></textarea>
  <p class="small muted">Registrado por: ${esc(user.email)}. La firma o imagen queda guardada con este envío.</p>
  <p id="receipt-error" role="alert" style="color:var(--red)"></p><button id="receipt-save" class="btn">Guardar comprobante</button></div></form>
  <script>
  const rf=document.getElementById('receipt-form'),pad=document.getElementById('signature-pad'),ink=pad.getContext('2d'),kind=document.getElementById('evidence-kind'),file=document.getElementById('receipt-file'),err=document.getElementById('receipt-error');
  let drawn=false,drawing=false,busy=false,previewURL;
  function clearPad(){ink.fillStyle='white';ink.fillRect(0,0,pad.width,pad.height);ink.strokeStyle='#151515';ink.fillStyle='#151515';ink.lineWidth=5;ink.lineCap='round';ink.lineJoin='round';drawn=false}
  clearPad();
  function point(e){const r=pad.getBoundingClientRect();return [(e.clientX-r.left)*pad.width/r.width,(e.clientY-r.top)*pad.height/r.height]}
  pad.addEventListener('pointerdown',e=>{if(e.button!==0&&e.pointerType==='mouse')return;e.preventDefault();drawing=true;pad.setPointerCapture(e.pointerId);const [x,y]=point(e);ink.beginPath();ink.arc(x,y,2.5,0,Math.PI*2);ink.fill();ink.beginPath();ink.moveTo(x,y);drawn=true});
  pad.addEventListener('pointermove',e=>{if(!drawing)return;e.preventDefault();ink.lineTo(...point(e));ink.stroke()});
  for(const event of ['pointerup','pointercancel','lostpointercapture'])pad.addEventListener(event,()=>drawing=false);
  document.getElementById('clear-signature').onclick=()=>{clearPad();err.textContent=''};
  kind.onchange=()=>{const photo=kind.value==='receipt';document.getElementById('signature-panel').hidden=photo;document.getElementById('receipt-photo-panel').hidden=!photo;file.required=photo;err.textContent=''};
  file.onchange=()=>{if(previewURL)URL.revokeObjectURL(previewURL);const img=document.getElementById('receipt-preview');img.hidden=!file.files[0];if(file.files[0])img.src=previewURL=URL.createObjectURL(file.files[0])};
  rf.addEventListener('submit',async e=>{e.preventDefault();e.stopImmediatePropagation();if(busy)return;err.textContent='';
    if(kind.value==='signature'&&!drawn){err.textContent='Dibuja la firma antes de guardar.';return}
    const button=document.getElementById('receipt-save');busy=true;button.disabled=true;button.textContent='Guardando…';
    try{const fd=new FormData(rf);let blob;
      if(kind.value==='signature'){blob=await new Promise(r=>pad.toBlob(r,'image/png'));fd.set('ink','1');fd.set('file',blob,'firma.png')}
      else{const original=file.files[0];if(!original)throw new Error('Elige una foto o captura.');const img=await createImageBitmap(original);const scale=Math.min(1,2200/Math.max(img.width,img.height));const c=document.createElement('canvas');c.width=Math.round(img.width*scale);c.height=Math.round(img.height*scale);c.getContext('2d').drawImage(img,0,0,c.width,c.height);img.close();blob=await new Promise(r=>c.toBlob(r,'image/jpeg',.88));fd.set('file',blob,'comprobante.jpg')}
      if(!blob||blob.size>1900000)throw new Error('La imagen pesa demasiado. Usa una imagen más pequeña.');
      const response=await fetch(rf.action,{method:'POST',body:fd});const result=await response.json();if(!response.ok)throw new Error(result.error||'No se pudo guardar.');location.assign(result.redirect)
    }catch(error){err.textContent=error.message;busy=false;button.disabled=false;button.textContent='Guardar comprobante'}
  });</script>`});
}

export async function receiptSubmit(env,user,sh,request) {
  const fd=await request.formData();
  const fail=(error,status=400)=>Response.json({error},{status});
  const kind=fd.get('kind'), recipient=String(fd.get('recipient')||'').trim(), on=String(fd.get('received_on')||'');
  if(!['signature','receipt'].includes(kind))return fail('Elige firma o foto.');
  if(!recipient||recipient.length>120)return fail('Escribe el nombre de quien recibe (máximo 120 caracteres).');
  if(!isDate(on)||on>sh.ctx.today)return fail('Indica una fecha de recepción válida, no futura.');
  if(kind==='signature'&&fd.get('ink')!=='1')return fail('Dibuja la firma antes de guardar.');
  const file=fd.get('file');
  if(!file||typeof file==='string'||!file.size)return fail('Falta la firma o imagen del comprobante.');
  if(file.size>1900000)return fail('La imagen pesa demasiado (máximo 1.9 MB).',413);
  const data=await file.arrayBuffer(),bytes=new Uint8Array(data);
  const valid=file.type==='image/png'?bytes.length>8&&[137,80,78,71,13,10,26,10].every((v,i)=>bytes[i]===v)
    :file.type==='image/jpeg'?bytes[0]===255&&bytes[1]===216&&bytes[2]===255
    :file.type==='image/webp'?new TextDecoder().decode(bytes.slice(0,4))==='RIFF'&&new TextDecoder().decode(bytes.slice(8,12))==='WEBP':false;
  if(!valid||kind==='signature'&&file.type!=='image/png')return fail('Usa una imagen JPG, PNG o WebP válida.');
  const note=String(fd.get('note')||'').trim().slice(0,500);
  try{await writeFulfillment(env,user.email,sh.sub,sh.club,sh.o.k,{},kind==='signature'?'firma de recepción':'comprobante de recepción',{
    version:Number(fd.get('version'))||0,note:`Recibió: ${recipient} · ${on}${note?' · '+note:''}`,
    photo:{type:file.type,data,kind,recipient,received_on:on,note}
  })}catch(error){if(error.status===409)return fail('El envío cambió. Vuelve al envío y abre un comprobante nuevo antes de guardar.',409);throw error}
  return Response.json({ok:true,redirect:`/envio/${sh.o.subId}/${sh.o.k}?comprobante=1#comprobantes`});
}
