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
.sub{color:#5b6470;font-size:14px;margin:0}
.cur{margin-top:14px;font-size:18px;font-weight:700}
.cur span{font-weight:400;color:#5b6470;font-size:14px}
.dayhdr{font-size:13px;font-weight:700;text-transform:uppercase;letter-spacing:.04em;color:#5b6470;margin:18px 0 8px}
.slots{display:grid;grid-template-columns:repeat(auto-fill,minmax(92px,1fr));gap:8px}
.slot{appearance:none;border:1px solid #d6dadf;background:#fff;border-radius:10px;padding:11px 6px;font-size:14px;font-weight:600;cursor:pointer;color:#15171a}
.slot:hover{border-color:#15171a}
.slot.sel{background:#15171a;color:#fff;border-color:#15171a}
.btn{display:block;width:100%;margin-top:18px;background:#15171a;color:#fff;border:0;border-radius:12px;padding:15px;font-size:16px;font-weight:700;cursor:pointer}
.btn[disabled]{opacity:.5;cursor:not-allowed}
.btn.danger{background:#b3261e}
.muted{color:#5b6470;font-size:13px;margin-top:10px}
.err{background:#fdecec;color:#b3261e;border:1px solid #f5c6c4;border-radius:10px;padding:12px;font-size:14px;margin-top:12px}
.link{display:inline-block;margin-top:18px;font-size:14px;cursor:pointer}
.link.red{color:#b3261e}
.link.grey{color:#5b6470}
.ok{text-align:center;padding:14px 0}
.ok .big{font-size:30px;font-weight:800;color:#1f7a34}
.center{text-align:center}
.hidden{display:none}
</style>
</head>
<body>
<div class='wrap'>
  <div class='card'>
    <h1 id='title'>Loading...</h1>
    <p class='sub' id='sub'></p>
    <div class='cur' id='cur'></div>
  </div>
  <div class='card hidden' id='step-actions'>
    <div id='msg'></div>
    <div class='dayhdr'>Pick a new time</div>
    <div id='status' class='muted'>Loading available times...</div>
    <div id='slotwrap'></div>
    <button class='btn hidden' id='reschedule'>Confirm new time</button>
    <div class='center'><span class='link red' id='cancelLink'>Cancel my booking instead</span></div>
  </div>
  <div class='card hidden' id='step-cancel'>
    <h1>Cancel this booking?</h1>
    <p class='sub' id='cancelSub'>Your sitting fee is non-refundable. If you just need a different time, go back and pick a new slot instead.</p>
    <button class='btn danger' id='cancelConfirm'>Yes, cancel my booking</button>
    <div class='center'><span class='link grey' id='cancelBack'>Go back</span></div>
  </div>
  <div class='card hidden' id='step-done'>
    <div class='ok'><div class='big' id='doneBig'>Done</div><h1 id='doneTitle'></h1><p class='sub' id='doneSub'></p></div>
  </div>
</div>
<script>
(function(){
  var base = 'https://bwqhzczxoevouiondjak.supabase.co/functions/v1';
  var token = (new URLSearchParams(location.search)).get('token') || '';
  var S = { bk:null, slots:[], sel:null, tz:'America/Toronto' };
  var $ = function(id){ return document.getElementById(id) };
  function fmtDay(iso, tz){ return new Intl.DateTimeFormat('en-US',{weekday:'long',month:'long',day:'numeric',timeZone:tz}).format(new Date(iso)) }
  function fmtTime(iso, tz){ return new Intl.DateTimeFormat('en-US',{hour:'numeric',minute:'2-digit',timeZone:tz}).format(new Date(iso)) }
  function esc(s){ return String(s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;') }

  function load(){
    if(!token){ $('title').textContent='Link not valid'; $('sub').textContent='This management link is missing its code.'; return }
    fetch(base + '/booking-manage?token=' + encodeURIComponent(token))
      .then(function(r){ return r.json() })
      .then(function(d){
        if(!d || !d.ok || !d.booking){ $('title').textContent='Booking not found'; $('sub').textContent='This link may have expired or already been used.'; return }
        S.bk = d.booking; S.slots = d.slots || []; S.tz = d.booking.timezone || 'America/Toronto';
        render();
      })
      .catch(function(){ $('title').textContent='Could not load'; $('sub').textContent='Please try again in a moment.' });
  }
  function render(){
    var b = S.bk;
    $('title').textContent = b.schoolName || 'Your booking';
    if(b.status === 'cancelled'){
      $('sub').textContent = 'This booking has been cancelled.';
      $('cur').innerHTML = '';
      return;
    }
    $('sub').textContent = 'Session for ' + esc(b.studentName || 'your child');
    $('cur').innerHTML = b.currentStart ? (esc(fmtDay(b.currentStart, S.tz)) + ' <span>at ' + esc(fmtTime(b.currentStart, S.tz)) + '</span>') : '';
    if((b.feeCents||0) > 0){
      $('cancelSub').textContent = 'Your sitting fee is non-refundable. If you cancel, it is saved as a studio credit you can use toward a future session with the studio — applied automatically next time you book with this email. If you just need a different time, go back and pick a new slot instead.';
    }
    $('step-actions').classList.remove('hidden');
    renderSlots();
  }
  function renderSlots(){
    if(!S.slots.length){ $('status').textContent = 'No other times are open right now — you can still cancel below.'; $('slotwrap').innerHTML=''; return }
    $('status').textContent = '';
    var groups = {}; var order = [];
    S.slots.forEach(function(s){ var d = fmtDay(s.start_at, S.tz); if(!groups[d]){ groups[d]=[]; order.push(d) } groups[d].push(s) });
    var html = '';
    order.forEach(function(day){ html += '<div class=dayhdr>'+esc(day)+'</div><div class=slots>'; groups[day].forEach(function(s){ html += '<button class=slot data-id='+s.id+'>'+fmtTime(s.start_at,S.tz)+'</button>' }); html += '</div>'; });
    $('slotwrap').innerHTML = html;
    Array.prototype.forEach.call(document.querySelectorAll('.slot'), function(btn){ btn.addEventListener('click', function(){ pick(btn.getAttribute('data-id')) }) });
  }
  function pick(id){
    S.sel = id;
    Array.prototype.forEach.call(document.querySelectorAll('.slot'), function(b){ b.classList.toggle('sel', b.getAttribute('data-id')===id) });
    $('reschedule').classList.remove('hidden');
  }
  $('reschedule').addEventListener('click', function(){
    if(!S.sel) return;
    $('reschedule').disabled=true; $('reschedule').textContent='Saving...'; $('msg').innerHTML='';
    fetch(base + '/booking-manage', {method:'POST', headers:{'Content-Type':'application/json'}, body: JSON.stringify({ token:token, action:'reschedule', newSlotId:S.sel })})
      .then(function(r){ return r.json().then(function(j){ return {status:r.status, j:j} }) })
      .then(function(res){
        if(res.status===200 && res.j.ok){ done('Rescheduled', 'Your new session time is', fmtDay(res.j.newStart,S.tz)+' at '+fmtTime(res.j.newStart,S.tz)); return }
        if(res.status===409){ $('msg').innerHTML='<div class=err>That time was just taken. Please pick another.</div>'; $('reschedule').disabled=false; $('reschedule').textContent='Confirm new time'; load(); return }
        $('msg').innerHTML='<div class=err>'+esc((res.j&&res.j.error)||'Could not reschedule. Please try again.')+'</div>'; $('reschedule').disabled=false; $('reschedule').textContent='Confirm new time';
      })
      .catch(function(){ $('msg').innerHTML='<div class=err>Network error. Please try again.</div>'; $('reschedule').disabled=false; $('reschedule').textContent='Confirm new time'; });
  });
  $('cancelLink').addEventListener('click', function(){ $('step-actions').classList.add('hidden'); $('step-cancel').classList.remove('hidden'); window.scrollTo(0,0); });
  $('cancelBack').addEventListener('click', function(){ $('step-cancel').classList.add('hidden'); $('step-actions').classList.remove('hidden'); });
  $('cancelConfirm').addEventListener('click', function(){
    $('cancelConfirm').disabled=true; $('cancelConfirm').textContent='Cancelling...';
    fetch(base + '/booking-manage', {method:'POST', headers:{'Content-Type':'application/json'}, body: JSON.stringify({ token:token, action:'cancel' })})
      .then(function(r){ return r.json() })
      .then(function(j){ if(j && j.ok){ done('Cancelled', 'Your booking has been cancelled.', j.creditIssued ? 'Your sitting fee was saved as a studio credit — it will be applied automatically next time you book with this email. A confirmation email is on its way.' : 'The time slot is now open for someone else.'); } else { $('cancelConfirm').disabled=false; $('cancelConfirm').textContent='Yes, cancel my booking'; } })
      .catch(function(){ $('cancelConfirm').disabled=false; $('cancelConfirm').textContent='Yes, cancel my booking'; });
  });
  function done(big, title, sub){
    $('step-actions').classList.add('hidden'); $('step-cancel').classList.add('hidden'); $('step-done').classList.remove('hidden');
    $('doneBig').textContent=big; $('doneTitle').textContent=title; $('doneSub').textContent=sub;
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
