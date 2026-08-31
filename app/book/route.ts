// Public booking page, served from studiooscloud.com/book?event=<EVENT_ID>.
//
// Why this lives here (and not only in the Supabase `booking-page` edge function):
// Supabase forces edge-function HTML responses to be served as `text/plain`
// (anti-phishing), so the page shows as raw source instead of rendering. Serving
// it from our own Next.js domain renders correctly AND gives parents a clean,
// trusted URL. The booking JSON APIs (availability/create/webhook) stay on
// Supabase — this page just fetches them cross-origin (they send CORS `*`).
//
// Identical markup/logic to the edge function, with one change: the API base is
// the absolute Supabase functions URL instead of `location.origin`.

const html = `<!doctype html>
<html lang='en'>
<head>
<meta charset='utf-8'>
<meta name='viewport' content='width=device-width, initial-scale=1'>
<title>Book your session</title>
<style>
*{box-sizing:border-box}
body{margin:0;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif;background:#f4f5f7;color:#15171a}
.wrap{max-width:540px;margin:0 auto;padding:20px 16px 64px}
#slogo img{display:block;max-height:56px;max-width:220px;object-fit:contain;margin:0 0 12px}
.card{background:#fff;border:1px solid #e6e8eb;border-radius:16px;padding:22px;margin-bottom:16px;box-shadow:0 1px 2px rgba(0,0,0,.04)}
h1{font-size:22px;margin:0 0 4px}
.sub{color:#5b6470;font-size:14px;margin:0}
.fee{display:flex;align-items:baseline;gap:8px;margin-top:14px}
.fee .amt{font-size:26px;font-weight:700}
.fee .cur{color:#5b6470;font-size:13px}
.feedesc{margin:8px 0 0;font-size:14px;color:#374049;line-height:1.45}
.badge{display:inline-block;margin-top:10px;background:#eef6ee;color:#1f7a34;border:1px solid #cfe7d2;font-size:12px;font-weight:600;padding:4px 10px;border-radius:999px}
.notebox{margin-top:12px;background:#fff8e1;border:1px solid #ffe082;border-radius:10px;padding:10px 12px;font-size:13px;color:#6b5310;line-height:1.5}
.creditnote{margin-top:12px;background:#eef6ee;border:1px solid #cfe7d2;border-radius:10px;padding:10px 12px;font-size:13px;color:#1f6730;line-height:1.5}
.contact{margin:12px 0 0;font-size:13px;color:#5b6470}
.contact a{color:#2563eb;text-decoration:none}
.where{display:flex;gap:8px;align-items:flex-start;margin-top:10px;color:#374049;font-size:14px;line-height:1.4}
.where .pin{flex:0 0 auto}
.where .address{display:block;color:#69727d;font-size:13px}
.dayplace{margin:-2px 0 10px}
.dayhdr{font-size:13px;font-weight:700;text-transform:uppercase;letter-spacing:.04em;color:#5b6470;margin:18px 0 8px}
.dayhdr .spots{margin-left:8px;display:inline-block;background:#eef1f4;color:#374049;border-radius:999px;padding:2px 10px;font-size:12px;font-weight:600;text-transform:none;letter-spacing:0}
.dayhdr .spots.low{background:#fdecec;color:#b3261e}
.slots{display:grid;grid-template-columns:repeat(auto-fill,minmax(92px,1fr));gap:8px}
.slot{appearance:none;border:1px solid #d6dadf;background:#fff;border-radius:10px;padding:11px 6px;font-size:14px;font-weight:600;cursor:pointer;color:#15171a}
.slot:hover{border-color:#15171a}
.slot.sel{background:#15171a;color:#fff;border-color:#15171a}
.slot.taken{background:#fdecec;border-color:#f3c0bd;color:#b3261e;cursor:not-allowed;text-decoration:line-through;opacity:.9}
.slot.taken:hover{border-color:#f3c0bd}
.lunchbreak{grid-column:1/-1;display:flex;align-items:center;justify-content:center;gap:7px;margin:5px 0;padding:11px 12px;background:#fff0f0;border:1px solid #ef9a95;border-left:5px solid #c62828;border-radius:10px;color:#a61919;font-size:13px;font-weight:800;letter-spacing:.02em;text-align:center}
.lunchbreak span{font-weight:600}
label{display:block;font-size:13px;font-weight:600;margin:14px 0 6px}
input[type=text],input[type=email]{width:100%;padding:12px;border:1px solid #d6dadf;border-radius:10px;font-size:16px}
.row{display:flex;gap:10px}
.row>div{flex:1}
.consent{display:flex;gap:10px;align-items:flex-start;margin-top:16px;font-size:13px;color:#374049;line-height:1.4;font-weight:400}
.btn{display:block;width:100%;margin-top:18px;background:#15171a;color:#fff;border:1px solid #15171a;border-radius:12px;padding:15px;font-size:16px;font-weight:700;line-height:1.25;text-align:center;text-decoration:none;cursor:pointer}
.btn.secondary{background:#fff;color:#15171a;border-color:#cfd4da}
.btn[disabled]{opacity:.5;cursor:not-allowed}
.btn:focus-visible,.slot:focus-visible,input:focus-visible{outline:3px solid #82b1ff;outline-offset:2px}
.muted{color:#5b6470;font-size:13px;text-align:center;margin-top:14px}
.err{background:#fdecec;color:#b3261e;border:1px solid #f5c6c4;border-radius:10px;padding:12px;font-size:14px;margin-top:12px}
.ok{text-align:center;padding:14px 0}
.ok .big{font-size:30px;font-weight:800;color:#1f7a34}
.pinwrap{margin-top:18px;padding:16px;border:1px dashed #c9ccd1;border-radius:12px;text-align:center}
.pinwrap .lbl{font-size:12px;color:#5b6470}
.pinwrap .val{font-size:30px;font-weight:800;letter-spacing:5px;margin:6px 0}
.hidden{display:none}
#pay{margin-top:16px}
</style>
</head>
<body>
<div class='wrap'>
  <div class='card'>
    <div id='slogo'></div>
    <h1 id='title'>Loading...</h1>
    <p class='sub' id='sub'>Photo session booking</p>
    <div class='where hidden' id='eventwhere'></div>
    <div class='creditnote hidden' id='creditnotice'>Studio credit is applied automatically when you use the same email as your cancelled booking.</div>
    <div id='feebox'></div>
  </div>
  <div class='card' id='step-slots'>
    <div id='status' class='muted'>Loading available times...</div>
    <div id='slotwrap'></div>
  </div>
  <div class='card hidden' id='step-form'>
    <div class='dayhdr' id='picked'></div>
    <div class='where hidden' id='pickedwhere'></div>
    <div class='row'>
      <div><label>Student first name</label><input id='fn' type='text' autocomplete='given-name'></div>
      <div><label>Student last name</label><input id='ln' type='text' autocomplete='family-name'></div>
    </div>
    <label>Class / Grade</label>
    <input id='cls' type='text' autocomplete='off' list='clslist' placeholder='e.g. Grade 8B'>
    <datalist id='clslist'></datalist>
    <label>Parent / guardian name</label>
    <input id='pn' type='text' autocomplete='name'>
    <label>Email for confirmation</label>
    <input id='em' type='email' autocomplete='email' inputmode='email'>
    <label class='consent'><input id='cons' type='checkbox'><span>I am the parent or guardian and consent to this session and to receiving emails about it.</span></label>
    <div id='pay' class='hidden'></div>
    <div id='formerr'></div>
    <button class='btn' id='go'>Continue</button>
    <div class='muted' id='securenote'></div>
  </div>
  <div class='card hidden' id='step-done'>
    <div class='ok'><div class='big'>Booked</div><h1>You are all set!</h1><p class='sub' id='donesub'></p></div>
    <div class='pinwrap hidden' id='pinbox'>
      <div class='lbl'>Your gallery PIN</div>
      <div class='val' id='pinval'></div>
      <div class='lbl'>Save this - you'll use it to view your photos when the gallery is ready. It is also in your confirmation email.</div>
    </div>
    <a class='btn secondary hidden' id='manageBooking' rel='noreferrer'>Manage or change this booking</a>
  </div>
</div>
<script>
(function(){
  var base = 'https://bwqhzczxoevouiondjak.supabase.co/functions/v1';
  var params = new URLSearchParams(location.search);
  var eventId = params.get('event') || '';
  var creditHint = params.get('credit') === '1';
  var S = {ev:null, slots:[], taken:[], slot:null, stripe:null, elements:null, cs:null, pin:'', credit:false, manageUrl:''};
  var $ = function(id){return document.getElementById(id)};

  function money(cents, cur){
    try{ return new Intl.NumberFormat('en-US',{style:'currency',currency:(cur||'cad').toUpperCase()}).format((cents||0)/100) }catch(e){ return '$'+((cents||0)/100).toFixed(2) }
  }
  function fmtDay(iso, tz){ return new Intl.DateTimeFormat('en-US',{weekday:'long',month:'long',day:'numeric',timeZone:tz}).format(new Date(iso)) }
  function fmtTime(iso, tz){ return new Intl.DateTimeFormat('en-US',{hour:'numeric',minute:'2-digit',timeZone:tz}).format(new Date(iso)) }
  function localMinutes(iso, tz){
    var parts = new Intl.DateTimeFormat('en-US',{hour:'2-digit',minute:'2-digit',hourCycle:'h23',timeZone:tz}).formatToParts(new Date(iso));
    var hour = Number((parts.filter(function(p){return p.type==='hour'})[0]||{}).value||0);
    var minute = Number((parts.filter(function(p){return p.type==='minute'})[0]||{}).value||0);
    return hour*60+minute;
  }
  function escapeHtml(s){ return String(s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;') }
  function escapeAttr(s){ return escapeHtml(s).replace(/"/g,'&quot;').replace(/'/g,'&#39;') }
  function firstText(obj, keys){
    if(!obj || typeof obj !== 'object') return '';
    for(var i=0;i<keys.length;i++){
      var value=obj[keys[i]];
      if((typeof value === 'string' || typeof value === 'number') && String(value).trim()) return String(value).trim();
    }
    return '';
  }
  function rawPlace(obj){
    if(!obj || typeof obj !== 'object') return {label:'',address:''};
    var label=firstText(obj,['locationName','location_name','location','venueName','venue_name','venue','siteName','studioLocation']);
    var address=firstText(obj,['locationAddress','location_address','address','venueAddress','venue_address','studioAddress']);
    var nested=obj.location && typeof obj.location === 'object' ? obj.location : null;
    if(nested){
      if(!label) label=firstText(nested,['name','label','title','locationName']);
      if(!address) address=firstText(nested,['address','formattedAddress','formatted_address','streetAddress']);
    }
    return {label:label,address:address};
  }
  function placeOf(items){
    var place={label:'',address:''};
    (items||[]).forEach(function(item){
      var next=rawPlace(item);
      if(!place.label && next.label) place.label=next.label;
      if(!place.address && next.address) place.address=next.address;
    });
    if(place.address && place.label && place.address.toLowerCase() === place.label.toLowerCase()) place.address='';
    return place;
  }
  function placeText(place){ return [place.label,place.address].filter(Boolean).join(' — ') }
  function setPlace(id, place){
    var el=$(id); if(!el) return;
    el.innerHTML='';
    if(!place.label && !place.address){ el.classList.add('hidden'); return }
    var pin=document.createElement('span'); pin.className='pin'; pin.setAttribute('aria-hidden','true'); pin.textContent='📍';
    var copy=document.createElement('span');
    if(place.label){ var name=document.createElement('strong'); name.textContent=place.label; copy.appendChild(name) }
    if(place.address){ var addr=document.createElement('span'); addr.className='address'; addr.textContent=place.address; copy.appendChild(addr) }
    el.appendChild(pin); el.appendChild(copy); el.classList.remove('hidden');
  }
  function safeManageUrl(value){
    if(!value) return '';
    try{
      var url=new URL(String(value),location.origin);
      var path=url.pathname;
      if(path.length>1 && path.charAt(path.length-1)==='/') path=path.slice(0,-1);
      var currentOrigin=url.origin===location.origin;
      var productionOrigin=url.protocol==='https:' && (url.hostname==='www.studiooscloud.com' || url.hostname==='studiooscloud.com');
      if((!currentOrigin && !productionOrigin) || path!=='/manage' || url.username || url.password) return '';
      return url.href;
    }catch(e){ return '' }
  }

  function load(){
    if(!eventId){ $('status').innerHTML = '<div class=err>Missing booking link.</div>'; return }
    fetch('/api/public/booking-availability?event=' + encodeURIComponent(eventId),{credentials:'same-origin'})
      .then(function(r){ return r.json() })
      .then(function(d){
        if(d.error){ $('title').textContent='Booking unavailable'; $('status').innerHTML='<div class=err>'+escapeHtml(d.error)+'</div>'; return }
        S.ev = d.event; S.slots = d.slots || []; S.taken = d.takenSlots || [];
        renderHead(); renderSlots();
      })
      .catch(function(){ $('status').innerHTML='<div class=err>Could not load. Please try again.</div>' });
  }

  function renderHead(){
    var ev = S.ev;
    if(ev.studioLogoUrl){
      var li = document.createElement('img');
      li.src = ev.studioLogoUrl; li.alt = ev.studioName || 'Studio logo';
      li.onerror = function(){ var w = $('slogo'); if(w) w.innerHTML=''; };
      var lw = $('slogo'); if(lw){ lw.innerHTML=''; lw.appendChild(li); }
    }
    $('title').textContent = ev.schoolName || 'Photo session';
    $('sub').textContent = 'Pick a time below to book your portrait session.';
    setPlace('eventwhere',placeOf([ev]));
    $('creditnotice').classList.toggle('hidden',!creditHint);
    var h = '';
    if((ev.feeCents||0) > 0){ h += '<div class=fee><span class=amt>'+money(ev.feeCents,ev.currency)+'</span><span class=cur>sitting fee</span></div>' }
    if(ev.feeDescription){ h += '<p class=feedesc>'+escapeHtml(ev.feeDescription)+'</p>' }
    if(ev.includesDigital){ h += '<span class=badge>Includes digital image downloads</span>' }
    var mins = ev.slotMinutes || 5;
    h += '<div class=notebox>Please arrive a few minutes early. Each session is just '+mins+' minute'+(mins===1?'':'s')+' long, so being on time makes sure your child does not miss their turn. Thank you!</div>';
    var cbits = [];
    if(ev.studioPhone){ cbits.push('<a href="tel:'+String(ev.studioPhone).replace(/[^+0-9]/g,'')+'">'+escapeHtml(ev.studioPhone)+'</a>') }
    if(ev.studioEmail){ cbits.push('<a href="mailto:'+encodeURIComponent(String(ev.studioEmail))+'">'+escapeHtml(ev.studioEmail)+'</a>') }
    if(ev.studioName || cbits.length){
      h += '<p class=contact>Questions? Contact '+(ev.studioName?('<strong>'+escapeHtml(ev.studioName)+'</strong>'):'the studio')+(cbits.length?(' — '+cbits.join(' · ')):'')+'</p>';
    }
    $('feebox').innerHTML = h;
    var dl = $('clslist');
    if(dl){
      dl.innerHTML = '';
      (ev.classNames || []).forEach(function(c){ var o = document.createElement('option'); o.value = c; dl.appendChild(o) });
    }
  }

  function renderSlots(){
    var open = S.slots || []; var taken = S.taken || [];
    if(!open.length && !taken.length){ $('status').textContent = 'No times are available right now.'; $('slotwrap').innerHTML=''; return }
    $('status').textContent = '';
    var tz = S.ev.timezone;
    var groups = {}; var order = [];
    function bucket(s, isTaken){
      var day=fmtDay(s.start_at,tz); var place=placeOf([s,S.ev]); var key=JSON.stringify([day,place.label,place.address]);
      if(!groups[key]){ groups[key]={day:day,place:place,open:[],all:[]}; order.push(key) }
      if(!isTaken){ groups[key].open.push(s) }
      groups[key].all.push({s:s,taken:isTaken});
    }
    open.forEach(function(s){ bucket(s, false) });
    taken.forEach(function(s){ bucket(s, true) });
    var html = '';
    order.forEach(function(key){
      var g = groups[key];
      var n = g.open.length;
      var spotsLbl = n === 0 ? 'fully booked' : (n <= 5 ? ('only ' + n + ' left') : (n + ' spots left'));
      g.all.sort(function(a,b){ return new Date(a.s.start_at) - new Date(b.s.start_at) });
      html += '<div class=dayhdr>'+escapeHtml(g.day)+'<span class="spots'+(n<=5?' low':'')+'">'+spotsLbl+'</span></div>';
      if(g.place.label || g.place.address) html += '<div class="where dayplace"><span class=pin aria-hidden=true>📍</span><span>'+escapeHtml(placeText(g.place))+'</span></div>';
      html += '<div class=slots>';
      g.all.forEach(function(it,index){
        if(index>0 && localMinutes(g.all[index-1].s.start_at,tz)<750 && localMinutes(it.s.start_at,tz)>=780){
          html += '<div class=lunchbreak role=note>🍴 LUNCH <span>12:30 PM–1:00 PM · Not available</span></div>';
        }
        var label=fmtTime(it.s.start_at,tz)+(placeText(g.place)?' at '+placeText(g.place):'');
        if(it.taken){ html += '<button class="slot taken" type=button disabled title="Booked" aria-label="'+escapeAttr(label+' — booked')+'">'+escapeHtml(fmtTime(it.s.start_at,tz))+'</button>' }
        else { html += '<button class=slot type=button data-id="'+escapeAttr(it.s.id)+'" aria-label="'+escapeAttr(label)+'">'+escapeHtml(fmtTime(it.s.start_at,tz))+'</button>' }
      });
      html += '</div>';
    });
    $('slotwrap').innerHTML = html;
    Array.prototype.forEach.call(document.querySelectorAll('.slot[data-id]'), function(b){ b.addEventListener('click', function(){ pick(b.getAttribute('data-id')) }) });
  }

  function pick(id){
    S.slot = S.slots.filter(function(s){return s.id===id})[0];
    if(!S.slot) return;
    Array.prototype.forEach.call(document.querySelectorAll('.slot'), function(b){ b.classList.toggle('sel', b.getAttribute('data-id')===id) });
    var tz = S.ev.timezone;
    $('picked').textContent = fmtDay(S.slot.start_at,tz) + ' at ' + fmtTime(S.slot.start_at,tz);
    setPlace('pickedwhere',placeOf([S.slot,S.ev]));
    $('step-form').classList.remove('hidden');
    var pay = (S.ev.feeCents||0) > 0 && S.ev.requirePayment;
    $('securenote').textContent = pay ? ('You will pay '+money(S.ev.feeCents,S.ev.currency)+' securely to confirm.') : '';
    $('go').textContent = pay ? 'Continue to payment' : 'Confirm booking';
    $('step-form').scrollIntoView({behavior:'smooth'});
  }

  function valid(){
    if(!$('fn').value.trim() || !$('ln').value.trim()){ return 'Please enter the student name.' }
    if(!$('cls').value.trim()){ return 'Please enter the class or grade.' }
    if(!$('em').value.trim() || $('em').value.indexOf('@')<0){ return 'Please enter a valid email.' }
    if(!$('cons').checked){ return 'Please confirm consent to continue.' }
    return '';
  }
  function formErr(m){ $('formerr').innerHTML='<div class=err>'+escapeHtml(m)+'</div>' }
  function payLabel(){ return ((S.ev.feeCents||0)>0 && S.ev.requirePayment)?'Continue to payment':'Confirm booking' }
  function reset(){ $('go').disabled=false; $('go').textContent = payLabel() }

  $('go').addEventListener('click', function(){
    if(S.cs){ doPay(); return }
    var v = valid();
    if(v){ formErr(v); return }
    $('formerr').innerHTML=''; $('go').disabled=true; $('go').textContent='Working...';
    fetch(base + '/booking-create', {method:'POST', headers:{'Content-Type':'application/json'}, body: JSON.stringify({
      eventId: eventId, slotId: S.slot.id,
      studentFirstName: $('fn').value.trim(), studentLastName: $('ln').value.trim(),
      className: $('cls').value.trim(),
      parentName: $('pn').value.trim(), parentEmail: $('em').value.trim()
    })}).then(function(r){ return r.json().then(function(j){ return {status:r.status, j:j} }) })
    .then(function(res){
      var d = res.j;
      if(res.status===200 && (d.confirmed || d.requiresPayment)) S.manageUrl=safeManageUrl(d.manageUrl || d.manage_url || d.managementUrl || d.management_url);
      if(res.status===200 && d.confirmed){ S.pin = d.accessPin || ''; S.credit = !!d.creditApplied; done(false); return }
      if(res.status===200 && d.requiresPayment){ S.pin = d.accessPin || ''; startPay(d); return }
      if(res.status===503 || d.error==='payments_not_configured'){ formErr('Online payment is not set up for this event yet. Please contact the studio.'); reset(); return }
      if(res.status===409){ formErr('That time was just taken. Please pick another.'); reset(); setTimeout(load, 800); return }
      formErr((d && d.error) || 'Something went wrong. Please try again.'); reset();
    }).catch(function(){ formErr('Network error. Please try again.'); reset() });
  });

  function startPay(d){
    S.cs = d.clientSecret;
    loadStripe(function(){
      try{
        S.stripe = Stripe(d.publishableKey, {stripeAccount: d.stripeAccount});
        S.elements = S.stripe.elements({clientSecret: d.clientSecret});
        var pe = S.elements.create('payment');
        pe.mount('#pay');
        $('pay').classList.remove('hidden');
        $('fn').disabled=$('ln').disabled=$('cls').disabled=$('pn').disabled=$('em').disabled=true;
        $('go').disabled=false; $('go').textContent='Pay '+money(S.ev.feeCents,S.ev.currency);
      }catch(e){ formErr('Could not start payment.'); reset() }
    });
  }
  function doPay(){
    $('go').disabled=true; $('go').textContent='Processing...';
    S.stripe.confirmPayment({elements: S.elements, redirect:'if_required'}).then(function(res){
      if(res.error){ formErr(res.error.message || 'Payment failed.'); $('go').disabled=false; $('go').textContent='Pay '+money(S.ev.feeCents,S.ev.currency); return }
      done(true);
    });
  }
  function loadStripe(cb){
    if(window.Stripe){ cb(); return }
    var s=document.createElement('script'); s.src='https://js.stripe.com/v3/'; s.onload=cb; s.onerror=function(){ formErr('Could not load payment form.'); reset() }; document.head.appendChild(s);
  }
  function done(paid){
    $('step-slots').classList.add('hidden'); $('step-form').classList.add('hidden'); $('step-done').classList.remove('hidden');
    var creditMsg = S.credit ? ' Your studio credit covered the fee — nothing to pay.' : '';
    $('donesub').textContent = 'A confirmation has been sent to ' + $('em').value.trim() + '.' + (paid?' Your payment was received.':'') + creditMsg;
    if(S.pin){ $('pinval').textContent = S.pin; $('pinbox').classList.remove('hidden'); }
    var manage=$('manageBooking');
    if(S.manageUrl){ manage.href=S.manageUrl; manage.classList.remove('hidden') } else { manage.removeAttribute('href'); manage.classList.add('hidden') }
    window.scrollTo(0,0);
  }

  load();
})();
</script>
</body>
</html>`;

export const dynamic = "force-static";

export async function GET() {
  return new Response(html, {
    headers: {
      "content-type": "text/html; charset=utf-8",
      "cache-control": "public, max-age=0, must-revalidate",
    },
  });
}
