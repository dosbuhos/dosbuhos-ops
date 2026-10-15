import {esc} from './ui.js';

export function quickBenefit({member,b,used,user,today}) {
  const max=b.quantity==null?100:Math.max(0,Math.floor(b.quantity-used));
  const disabled=!!member.suspended_on||max===0;
  return `<form class="benefit-quick" method="post" action="/socio/${member.id}/beneficio" data-used="${used}" data-limit="${b.quantity??''}" data-max="${max}" data-unit="${esc(b.unit)}">
    <input type="hidden" name="quick" value="1"><input type="hidden" name="benefit_id" value="${b.id}"><input type="hidden" name="request_key" value="${crypto.randomUUID()}"><input type="hidden" name="qty" value="0">
    <div class="benefit-stepper"><button type="button" class="btn quiet benefit-minus" aria-label="Quitar un uso pendiente de ${esc(b.name)}" disabled>−</button><output class="benefit-pending" aria-live="polite">${disabled?(member.suspended_on?'Membresía suspendida':'Beneficio utilizado'):'Agregar uso'}</output><button type="button" class="btn quiet benefit-plus" aria-label="Agregar un uso de ${esc(b.name)}" ${disabled?'disabled':''}>+</button></div>
    <div class="benefit-confirm" hidden><p class="small"><b class="benefit-preview"></b><br>Hoy · ${esc(today)}<br>Registrado por ${esc(user.email)}</p><button class="btn sm benefit-save">Guardar uso</button></div></form>`;
}

export const quickBenefitScript=`<script>
document.querySelectorAll('.benefit-quick').forEach(f=>{
  let qty=0;const minus=f.querySelector('.benefit-minus'),plus=f.querySelector('.benefit-plus'),panel=f.querySelector('.benefit-confirm'),out=f.querySelector('output'),input=f.querySelector('[name=qty]'),used=Number(f.dataset.used),max=Number(f.dataset.max),limit=Number(f.dataset.limit);
  const meter=f.parentElement.querySelector('.meter i');const original=meter?.style.width;
  const update=()=>{input.value=qty;minus.disabled=qty===0;plus.disabled=qty>=max;panel.hidden=qty===0;out.textContent=qty?'+ '+qty+' '+f.dataset.unit:'Agregar uso';f.querySelector('.benefit-preview').textContent='Se registrarán '+qty+' '+f.dataset.unit+'. Total: '+(used+qty)+(limit?' de '+limit:'')+'.';if(meter)meter.style.width=qty&&limit?Math.min(100,(used+qty)/limit*100)+'%':original;};
  plus.addEventListener('click',()=>{if(qty<max){qty++;update();}});minus.addEventListener('click',()=>{if(qty>0){qty--;update();}});
  f.addEventListener('submit',e=>{if(!qty){e.preventDefault();return;}const b=f.querySelector('.benefit-save');b.disabled=true;b.textContent='Guardando…';});
});</script>`;
