// Public, token-gated "Manage my booking" page, served from
// studiooscloud.com/manage?token=<public_token>. Lets a parent reschedule to
// another open slot (payment kept) or cancel (sitting fee non-refundable).
// Talks to the Supabase booking-manage edge function cross-origin.
// (Supabase serves edge-function HTML as text/plain, so this lives on our domain.)

const html = `<!doctype html>
<html lang='en'>
<head>
<meta charset='utf-8'>
<meta name='viewport' content='width=device-width, initial-scale=1'>
<title>Manage your booking</title>
<style>
*{box-sizing:border-box}
body{margin:0;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif;background:#f4f5f7;color:#15171a}
.wrap{max-width:540px;margin:0 auto;padding:20px 16px 64px}
.card{background:#fff;border:1px solid #e6e8eb;border-radius:16px;padding:22px;margin-bottom:16px;box-shadow:0 1px 2px rgba(0,0,0,.04)}
h1{font-size:22px;margin:0 0 4px}
h2{font-size:19px;margin:0 0 7px}
.sub{color:#5b6470;font-size:14px;line-height:1.5;margin:0}
.cur{margin-top:14px;font-size:18px;font-weight:700}
.cur span{font-weight:400;color:#5b6470;font-size:14px}
.where{display:flex;gap:8px;align-items:flex-start;margin-top:9px;color:#374049;font-size:14px;line-height:1.4}
.where .pin{flex:0 0 auto}
.where .address{display:block;color:#69727d;font-size:13px}
.dayhdr{font-size:13px;font-weight:700;text-transform:uppercase;letter-spacing:.04em;color:#5b6470;margin:18px 0 8px}
.dayplace{margin:-2px 0 10px}
.slots{display:grid;grid-template-columns:repeat(auto-fill,minmax(92px,1fr));gap:8px}
.slot{appearance:none;border:1px solid #d6dadf;background:#fff;border-radius:10px;padding:11px 6px;font-size:14px;font-weight:600;cursor:pointer;color:#15171a}
.slot:hover{border-color:#15171a}
.slot.sel{background:#15171a;color:#fff;border-color:#15171a}
.lunchbreak{grid-column:1/-1;display:flex;align-items:center;justify-content:center;gap:7px;margin:5px 0;padding:11px 12px;background:#fff0f0;border:1px solid #ef9a95;border-left:5px solid #c62828;border-radius:10px;color:#a61919;font-size:13px;font-weight:800;letter-spacing:.02em;text-align:center}
.lunchbreak span{font-weight:600}
.btn{display:block;width:100%;margin-top:18px;background:#15171a;color:#fff;border:1px solid #15171a;border-radius:12px;padding:14px 15px;font-size:16px;font-weight:700;line-height:1.25;text-align:center;text-decoration:none;cursor:pointer}
.btn.secondary{background:#fff;color:#15171a;border-color:#cfd4da}
.btn.danger{background:#b3261e;border-color:#b3261e}
.btn.cancel-option{color:#a6231d;border-color:#e4bfbd}
.btn[disabled]{opacity:.5;cursor:not-allowed}
.btn:focus-visible,.slot:focus-visible,.textbtn:focus-visible{outline:3px solid #82b1ff;outline-offset:2px}
.muted{color:#5b6470;font-size:13px;margin-top:10px;line-height:1.45}
.err{background:#fdecec;color:#b3261e;border:1px solid #f5c6c4;border-radius:10px;padding:12px;font-size:14px;margin-top:12px}
.selection{margin-top:16px;padding:12px 14px;border:1px solid #d9dde2;border-radius:10px;background:#f7f8fa;font-size:14px;font-weight:650;line-height:1.45}
.rebookintro{margin-top:18px;text-align:left}
.rebooklist{display:grid;gap:10px;margin-top:12px;text-align:left}
.rebookcard{border:1px solid #d9dde2;border-radius:12px;padding:14px;background:#fff}
.rebookcard .name{font-size:15px;font-weight:750}
.rebookcard .where{margin-top:7px}
.rebookcard .dates{margin-top:8px;color:#5b6470;font-size:13px;line-height:1.45}
.rebookcard .btn{margin-top:12px;padding:11px 13px;font-size:14px}
.textbtn{appearance:none;border:0;background:transparent;color:#5b6470;display:inline-block;margin-top:17px;padding:4px;font:inherit;font-size:14px;text-decoration:underline;text-underline-offset:3px;cursor:pointer}
.ok{text-align:center;padding:14px 0}
.ok .big{font-size:30px;font-weight:800;color:#1f7a34}
.center{text-align:center}
.hidden{display:none!important}
@media(max-width:380px){.card{padding:18px}.wrap{padding-left:12px;padding-right:12px}.slots{grid-template-columns:repeat(3,minmax(0,1fr))}}
</style>
</head>
<body>
<div class='wrap'>
  <div class='card'>
    <h1 id='title'>Loading...</h1>
    <p class='sub' id='sub'></p>
    <div class='cur' id='cur'></div>
    <div class='where hidden' id='currentWhere'></div>
  </div>
  <div class='card hidden' id='step-actions' aria-labelledby='actionsTitle'>
    <h2 id='actionsTitle'>What would you like to do?</h2>
    <p class='sub'>You can move this booking without cancelling it or losing its payment details.</p>
    <button class='btn' type='button' id='changeLink'>Change date or time</button>
    <button class='btn secondary cancel-option' type='button' id='cancelLink'>Cancel appointment</button>
  </div>
  <div class='card hidden' id='step-reschedule' aria-labelledby='rescheduleTitle'>
    <h2 id='rescheduleTitle' tabindex='-1'>Choose a new date or time</h2>
    <p class='sub'>Your current appointment stays reserved until you confirm a new time.</p>
    <div id='msg' role='status' aria-live='polite'></div>
    <div id='status' class='muted'>Loading available times...</div>
    <div id='slotwrap'></div>
    <div class='selection hidden' id='selectedSummary' aria-live='polite'></div>
    <button class='btn hidden' type='button' id='reschedule'>Confirm new time</button>
    <div class='center'><button class='textbtn' type='button' id='rescheduleBack'>Back to booking options</button></div>
  </div>
  <div class='card hidden' id='step-cancel' aria-labelledby='cancelTitle'>
    <h2 id='cancelTitle' tabindex='-1'>Cancel this booking?</h2>
    <p class='sub' id='cancelSub'>If you only need a different time, change the appointment instead so your current booking remains protected.</p>
    <button class='btn' type='button' id='cancelToReschedule'>Choose another time instead</button>
    <button class='btn danger' type='button' id='cancelConfirm'>Yes, cancel my booking</button>
    <div id='cancelMsg' role='alert' aria-live='assertive'></div>
    <div class='center'><button class='textbtn' type='button' id='cancelBack'>Keep my appointment</button></div>
  </div>
  <div class='card hidden' id='step-done'>
    <div class='ok'><div class='big' id='doneBig'>Done</div><h1 id='doneTitle' tabindex='-1'></h1><p class='sub' id='doneSub'></p></div>
    <div class='hidden' id='rebookOptions'>
      <h2 class='rebookintro'>Available appointments</h2>
      <p class='sub'>Choosing one creates a separate new booking; it does not restore the cancelled appointment.</p>
      <div class='rebooklist' id='rebookList'></div>
    </div>
    <a class='btn hidden' id='rebookLink' rel='noreferrer'>Book another appointment</a>
  </div>
</div>
<script>
(function(){
  var token = (new URLSearchParams(location.search)).get('token') || '';
  var S = { bk:null, data:null, slots:[], sel:null, selectedSlot:null, tz:'America/Toronto' };
  var $ = function(id){ return document.getElementById(id) };
  var panelIds = ['step-actions','step-reschedule','step-cancel','step-done'];
  function fmtDay(iso, tz){ return new Intl.DateTimeFormat('en-US',{weekday:'long',month:'long',day:'numeric',timeZone:tz}).format(new Date(iso)) }
  function fmtTime(iso, tz){ return new Intl.DateTimeFormat('en-US',{hour:'numeric',minute:'2-digit',timeZone:tz}).format(new Date(iso)) }
  function localMinutes(iso, tz){
    var parts = new Intl.DateTimeFormat('en-US',{hour:'2-digit',minute:'2-digit',hourCycle:'h23',timeZone:tz}).formatToParts(new Date(iso));
    var hour = Number((parts.filter(function(p){return p.type==='hour'})[0]||{}).value||0);
    var minute = Number((parts.filter(function(p){return p.type==='minute'})[0]||{}).value||0);
    return hour*60+minute;
  }
  function esc(s){ return String(s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;') }
  function escAttr(s){ return esc(s).replace(/"/g,'&quot;').replace(/'/g,'&#39;') }
  function firstText(obj, keys){
    if(!obj || typeof obj !== 'object') return '';
    for(var i=0;i<keys.length;i++){
      var value = obj[keys[i]];
      if((typeof value === 'string' || typeof value === 'number') && String(value).trim()) return String(value).trim();
    }
    return '';
  }
  function rawPlace(obj, current){
    if(!obj || typeof obj !== 'object') return {label:'',address:''};
    var labelKeys = current ? ['currentLocationName','current_location_name','currentLocation','current_location','locationName','location_name','location','venueName','venue_name','venue','siteName','studioLocation'] : ['locationName','location_name','location','venueName','venue_name','venue','siteName','studioLocation'];
    var addressKeys = current ? ['currentLocationAddress','current_location_address','currentAddress','current_address','locationAddress','location_address','address','venueAddress','venue_address','studioAddress'] : ['locationAddress','location_address','address','venueAddress','venue_address','studioAddress'];
    var label = firstText(obj, labelKeys);
    var address = firstText(obj, addressKeys);
    var nested = obj.location && typeof obj.location === 'object' ? obj.location : null;
    if(!nested && current && obj.currentLocation && typeof obj.currentLocation === 'object') nested = obj.currentLocation;
    if(nested){
      if(!label) label = firstText(nested,['name','label','title','locationName']);
      if(!address) address = firstText(nested,['address','formattedAddress','formatted_address','streetAddress']);
    }
    return {label:label,address:address};
  }
  function placeOf(items, current){
    var place = {label:'',address:''};
    (items || []).forEach(function(item){
      var next = rawPlace(item, current);
      if(!place.label && next.label) place.label = next.label;
      if(!place.address && next.address) place.address = next.address;
    });
    if(place.address && place.label && place.address.toLowerCase() === place.label.toLowerCase()) place.address = '';
    return place;
  }
  function placeText(place){ return [place.label,place.address].filter(Boolean).join(' — ') }
  function setPlace(id, place){
    var el = $(id); if(!el) return;
    el.innerHTML = '';
    if(!place.label && !place.address){ el.classList.add('hidden'); return }
    var pin = document.createElement('span'); pin.className='pin'; pin.setAttribute('aria-hidden','true'); pin.textContent='📍';
    var copy = document.createElement('span');
    if(place.label){ var name = document.createElement('strong'); name.textContent=place.label; copy.appendChild(name) }
    if(place.address){ var addr = document.createElement('span'); addr.className='address'; addr.textContent=place.address; copy.appendChild(addr) }
    el.appendChild(pin); el.appendChild(copy); el.classList.remove('hidden');
  }
  function safePageUrl(value, expectedPath){
    if(!value) return '';
    try{
      var url = new URL(String(value), location.origin);
      var path = url.pathname;
      if(path.length > 1 && path.charAt(path.length-1) === '/') path = path.slice(0,-1);
      var currentOrigin = url.origin === location.origin;
      var productionOrigin = url.protocol === 'https:' && (url.hostname === 'www.studiooscloud.com' || url.hostname === 'studiooscloud.com');
      if((!currentOrigin && !productionOrigin) || path !== expectedPath || url.username || url.password) return '';
      return url.href;
    }catch(e){ return '' }
  }
  function eventIdFrom(source){
    if(!source || typeof source !== 'object') return '';
    return firstText(source,['eventId','event_id','bookingEventId','booking_event_id']) || firstText(source.event,['id','eventId','event_id']) || firstText(source.booking,['eventId','event_id','bookingEventId','booking_event_id']);
  }
  function withCreditSignal(value){
    var url=new URL(value,location.origin); url.searchParams.set('credit','1'); return url.href;
  }
  function rebookUrlFor(extra){
    var sources = [extra,extra&&extra.booking,S.data,S.data&&S.data.booking,S.bk];
    var keys = ['bookingUrl','booking_url','publicBookingUrl','public_booking_url','bookUrl','book_url','rebookUrl','rebook_url'];
    for(var i=0;i<sources.length;i++){
      for(var k=0;k<keys.length;k++){
        var candidate = firstText(sources[i],[keys[k]]);
        var safe = safePageUrl(candidate,'/book');
        if(safe) return withCreditSignal(safe);
      }
    }
    for(var j=0;j<sources.length;j++){
      var eventId = eventIdFrom(sources[j]);
      if(eventId) return withCreditSignal(new URL('/book?event='+encodeURIComponent(eventId),location.origin).href);
    }
    return '';
  }
  function eventBookingUrl(event){
    var candidate=firstText(event,['bookingUrl','booking_url','publicBookingUrl','public_booking_url','bookUrl','book_url']);
    var safe=safePageUrl(candidate,'/book');
    if(safe) return withCreditSignal(safe);
    var eventId=eventIdFrom(event);
    return eventId ? withCreditSignal(new URL('/book?event='+encodeURIComponent(eventId),location.origin).href) : '';
  }
  function renderRebookOptions(source){
    var host=$('rebookOptions'); var list=$('rebookList'); var fallback=$('rebookLink');
    list.innerHTML=''; host.classList.add('hidden'); fallback.classList.add('hidden'); fallback.removeAttribute('href');
    var events=source && Array.isArray(source.rebookEvents) ? source.rebookEvents : (S.data && Array.isArray(S.data.rebookEvents) ? S.data.rebookEvents : []);
    var shown=0; var seen={};
    events.forEach(function(event){
      if(!event || typeof event !== 'object') return;
      var url=eventBookingUrl(event); if(!url || seen[url]) return; seen[url]=true;
      var card=document.createElement('div'); card.className='rebookcard';
      var name=document.createElement('div'); name.className='name'; name.textContent=firstText(event,['schoolName','school_name','name']) || 'Photo session'; card.appendChild(name);
      var place=placeOf([event]);
      if(place.label || place.address){
        var where=document.createElement('div'); where.className='where';
        var pin=document.createElement('span'); pin.className='pin'; pin.setAttribute('aria-hidden','true'); pin.textContent='📍';
        var placeCopy=document.createElement('span'); placeCopy.textContent=placeText(place); where.appendChild(pin); where.appendChild(placeCopy); card.appendChild(where);
      }
      var dates=[]; var dateSeen={}; var timezone=firstText(event,['timezone','timeZone']) || S.tz;
      (Array.isArray(event.slots)?event.slots:[]).forEach(function(slot){
        var start=slot && firstText(slot,['start_at','startAt']); if(!start) return;
        try{ var day=fmtDay(start,timezone); if(!dateSeen[day]){ dateSeen[day]=true; dates.push(day) } }catch(e){}
      });
      var dateLine=document.createElement('div'); dateLine.className='dates';
      dateLine.textContent=dates.length ? ('Available: '+dates.slice(0,3).join(' · ')+(dates.length>3?' · More dates':'')) : 'Open the booking page to see current availability.';
      card.appendChild(dateLine);
      var action=document.createElement('a'); action.className=shown===0?'btn':'btn secondary'; action.href=url; action.rel='noreferrer'; action.textContent=shown===0?'Book another appointment':'View appointments'; card.appendChild(action);
      list.appendChild(card); shown++;
    });
    if(shown){ host.classList.remove('hidden'); return }
    var fallbackUrl=rebookUrlFor(source);
    if(fallbackUrl){ fallback.href=fallbackUrl; fallback.classList.remove('hidden') }
  }
  function refreshRebookOptions(){
    fetch('/api/public/booking-manage?token='+encodeURIComponent(token),{credentials:'same-origin'})
      .then(function(r){ return r.json() })
      .then(function(d){
        if(!d || !d.ok || !d.booking) return;
        S.data=d; S.bk=d.booking; S.slots=d.slots||[]; S.tz=d.booking.timezone||d.timezone||S.tz;
        renderRebookOptions(d);
      })
      .catch(function(){});
  }
  function showPanel(id, focusId){
    panelIds.forEach(function(panelId){ $(panelId).classList.toggle('hidden',panelId!==id) });
    window.scrollTo(0,0);
    if(focusId) setTimeout(function(){ var target=$(focusId); if(target) target.focus() },0);
  }
  function setMessage(id, text){
    var host=$(id); host.innerHTML='';
    if(!text) return;
    var box=document.createElement('div'); box.className='err'; box.textContent=text; host.appendChild(box);
  }

  function load(openPicker){
    if(!token){ $('title').textContent='Link not valid'; $('sub').textContent='This management link is missing its code.'; return }
    fetch('/api/public/booking-manage?token=' + encodeURIComponent(token),{credentials:'same-origin'})
      .then(function(r){ return r.json() })
      .then(function(d){
        if(!d || !d.ok || !d.booking){ $('title').textContent='Booking not found'; $('sub').textContent='This link may have expired or already been used.'; return }
        S.data = d; S.bk = d.booking; S.slots = d.slots || []; S.tz = d.booking.timezone || d.timezone || 'America/Toronto'; S.sel=null; S.selectedSlot=null;
        render();
        if(openPicker && ['cancelled','canceled'].indexOf(String(S.bk.status||'').toLowerCase()) < 0) openReschedule();
      })
      .catch(function(){ $('title').textContent='Could not load'; $('sub').textContent='Please try again in a moment.' });
  }
  function render(){
    var b = S.bk;
    $('title').textContent = b.schoolName || b.school_name || 'Your booking';
    $('sub').textContent = 'Session for ' + (b.studentName || b.student_name || 'your child');
    var currentStart = b.currentStart || b.current_start || b.startAt || b.start_at;
    $('cur').innerHTML='';
    if(currentStart){
      $('cur').appendChild(document.createTextNode(fmtDay(currentStart,S.tz)+' '));
      var time=document.createElement('span'); time.textContent='at '+fmtTime(currentStart,S.tz); $('cur').appendChild(time);
    }
    var currentPlace = placeOf([b,S.data&&S.data.event,S.data],true);
    setPlace('currentWhere',currentPlace);
    if((b.feeCents||b.fee_cents||0) > 0){
      $('cancelSub').textContent = 'If you cancel, your non-refundable sitting fee is saved as studio credit and applied automatically the next time you book with this email. If you only need a different time, change the appointment instead.';
    }
    renderSlots();
    if(['cancelled','canceled'].indexOf(String(b.status||'').toLowerCase()) >= 0){
      done('Cancelled','This booking has been cancelled.','You can choose another available appointment below.',true,S.data);
      return;
    }
    showPanel('step-actions','changeLink');
  }
  function renderSlots(){
    $('reschedule').classList.add('hidden'); $('selectedSummary').classList.add('hidden');
    if(!S.slots.length){ $('status').textContent = 'No other times are open right now. You can go back to keep this appointment or cancel it.'; $('slotwrap').innerHTML=''; return }
    $('status').textContent = '';
    var groups = {}; var order = [];
    S.slots.forEach(function(slot){
      var day=fmtDay(slot.start_at,S.tz);
      var place=placeOf([slot,S.bk,S.data&&S.data.event,S.data],false);
      var key=JSON.stringify([day,place.label,place.address]);
      if(!groups[key]){ groups[key]={day:day,place:place,slots:[]}; order.push(key) }
      groups[key].slots.push(slot);
    });
    var html='';
    order.forEach(function(key){
      var group=groups[key]; group.slots.sort(function(a,b){ return new Date(a.start_at)-new Date(b.start_at) });
      html += '<div class=dayhdr>'+esc(group.day)+'</div>';
      if(group.place.label || group.place.address) html += '<div class="where dayplace"><span class=pin aria-hidden=true>📍</span><span>'+esc(placeText(group.place))+'</span></div>';
      html += '<div class=slots>';
      group.slots.forEach(function(slot,index){
        if(index>0 && localMinutes(group.slots[index-1].start_at,S.tz)<750 && localMinutes(slot.start_at,S.tz)>=780){
          html += '<div class=lunchbreak role=note>🍴 LUNCH <span>12:30 PM–1:00 PM · Not available</span></div>';
        }
        var label=fmtTime(slot.start_at,S.tz)+(placeText(group.place)?' at '+placeText(group.place):'');
        html += '<button class=slot type=button data-id="'+escAttr(slot.id)+'" aria-label="'+escAttr(label)+'">'+esc(fmtTime(slot.start_at,S.tz))+'</button>';
      });
      html += '</div>';
    });
    $('slotwrap').innerHTML=html;
    Array.prototype.forEach.call(document.querySelectorAll('.slot[data-id]'),function(btn){ btn.addEventListener('click',function(){ pick(btn.getAttribute('data-id')) }) });
  }
  function pick(id){
    S.sel=id; S.selectedSlot=S.slots.filter(function(slot){return String(slot.id)===String(id)})[0] || null;
    Array.prototype.forEach.call(document.querySelectorAll('.slot[data-id]'),function(btn){ btn.classList.toggle('sel',btn.getAttribute('data-id')===String(id)); btn.setAttribute('aria-pressed',btn.getAttribute('data-id')===String(id)?'true':'false') });
    if(!S.selectedSlot) return;
    var place=placeOf([S.selectedSlot,S.bk,S.data&&S.data.event,S.data],false);
    $('selectedSummary').textContent='New appointment: '+fmtDay(S.selectedSlot.start_at,S.tz)+' at '+fmtTime(S.selectedSlot.start_at,S.tz)+(placeText(place)?' · '+placeText(place):'');
    $('selectedSummary').classList.remove('hidden'); $('reschedule').classList.remove('hidden');
  }
  function openReschedule(){ showPanel('step-reschedule','rescheduleTitle') }
  $('changeLink').addEventListener('click',openReschedule);
  $('cancelToReschedule').addEventListener('click',openReschedule);
  $('rescheduleBack').addEventListener('click',function(){ showPanel('step-actions','changeLink') });
  $('reschedule').addEventListener('click',function(){
    if(!S.sel) return;
    $('reschedule').disabled=true; $('reschedule').textContent='Saving...'; setMessage('msg','');
    fetch('/api/public/booking-manage',{method:'POST',credentials:'same-origin',headers:{'Content-Type':'application/json'},body:JSON.stringify({token:token,action:'reschedule',newSlotId:S.sel})})
      .then(function(r){ return r.json().then(function(j){ return {status:r.status,j:j} }) })
      .then(function(res){
        if(res.status===200 && res.j.ok){
          var start=res.j.newStart || res.j.new_start || (S.selectedSlot&&S.selectedSlot.start_at);
          var place=placeOf([res.j,S.selectedSlot,S.bk,S.data&&S.data.event],false);
          done('Rescheduled','Your booking has been updated.',start?(fmtDay(start,S.tz)+' at '+fmtTime(start,S.tz)+(placeText(place)?' · '+placeText(place):'')):'Your new appointment is confirmed.',false,res.j); return;
        }
        if(res.status===409){ setMessage('msg','That time was just taken. Please pick another.'); $('reschedule').disabled=false; $('reschedule').textContent='Confirm new time'; load(true); return }
        setMessage('msg',(res.j&&res.j.error)||'Could not reschedule. Please try again.'); $('reschedule').disabled=false; $('reschedule').textContent='Confirm new time';
      })
      .catch(function(){ setMessage('msg','Network error. Please try again.'); $('reschedule').disabled=false; $('reschedule').textContent='Confirm new time' });
  });
  $('cancelLink').addEventListener('click',function(){ showPanel('step-cancel','cancelTitle') });
  $('cancelBack').addEventListener('click',function(){ showPanel('step-actions','cancelLink') });
  $('cancelConfirm').addEventListener('click',function(){
    $('cancelConfirm').disabled=true; $('cancelConfirm').textContent='Cancelling...'; setMessage('cancelMsg','');
    fetch('/api/public/booking-manage',{method:'POST',credentials:'same-origin',headers:{'Content-Type':'application/json'},body:JSON.stringify({token:token,action:'cancel'})})
      .then(function(r){ return r.json().then(function(j){ return {status:r.status,j:j} }) })
      .then(function(res){
        var j=res.j;
        if(res.status===200 && j && j.ok){
          S.data=Object.assign({},S.data||{},j); if(j.booking) S.bk=Object.assign({},S.bk||{},j.booking);
          done('Cancelled','Your booking has been cancelled.',j.creditIssued?'Your sitting fee was saved as studio credit. It will be applied automatically when you book again with this email.':'The time slot is now open for someone else.',true,j); refreshRebookOptions(); return;
        }
        setMessage('cancelMsg',(j&&j.error)||'Could not cancel this booking. Please try again.'); $('cancelConfirm').disabled=false; $('cancelConfirm').textContent='Yes, cancel my booking';
      })
      .catch(function(){ setMessage('cancelMsg','Network error. Please try again.'); $('cancelConfirm').disabled=false; $('cancelConfirm').textContent='Yes, cancel my booking' });
  });
  function done(big,title,sub,showRebook,source){
    showPanel('step-done','doneTitle');
    $('doneBig').textContent=big; $('doneTitle').textContent=title; $('doneSub').textContent=sub;
    if(showRebook) renderRebookOptions(source);
    else { $('rebookOptions').classList.add('hidden'); $('rebookList').innerHTML=''; $('rebookLink').removeAttribute('href'); $('rebookLink').classList.add('hidden') }
  }
  load(false);
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
