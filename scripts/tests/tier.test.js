// Tests for lib/tier.js — the guard that stops a plan silently flipping.
const path=require('path');
const { setUserTier, claimStripeEvent } = require(path.resolve(__dirname,'../../lib/tier.js'));
let pass=0,fail=0;const ok=(n,c,x)=>{c?(pass++,console.log('  ✓',n)):(fail++,console.log('  ✗',n,x!==undefined?JSON.stringify(x):''));};

function mkDb(initial={}){
  const store=JSON.parse(JSON.stringify(initial));
  const get=p=>p.split('/').reduce((o,k)=>(o==null?undefined:o[k]),store);
  const set=(p,v)=>{const ks=p.split('/');const last=ks.pop();let o=store;ks.forEach(k=>{o[k]=o[k]||{};o=o[k];});o[last]=v;};
  return { store, ref:p=>({
    get:async()=>({ val:()=>get(p), exists:()=>get(p)!==undefined }),
    set:async v=>set(p,v),
    update:async v=>{ Object.entries(v).forEach(([k,val])=>set(p+'/'+k,val)); },
    remove:async()=>set(p,undefined),
    transaction:async fn=>{ const cur=get(p)===undefined?null:get(p); const next=fn(cur);
      if(next===undefined) return {committed:false}; set(p,next); return {committed:true}; },
  })};
}

(async()=>{
console.log('IDEMPOTENCY — the actual fix for the silent flip');
{ const db=mkDb({users:{u1:{tier:'team_small'}}});
  const r=await setUserTier(db,'u1','team_small',{source:'stripe-webhook',reason:'replayed event'});
  ok('same tier => changed:false (no write, no email)', r.changed===false, r);
  ok('no audit row written for a no-op', db.store.admin===undefined, db.store.admin); }
{ const db=mkDb({users:{u1:{tier:'team_small'}}});
  const r=await setUserTier(db,'u1','free',{source:'stripe-webhook',reason:'subscription.deleted',actor:'stripe',ref:'evt_1'});
  ok('real change => changed:true', r.changed===true && r.from==='team_small' && r.to==='free', r);
  const log=db.store.admin.tier_log.u1; const e=Object.values(log)[0];
  ok('audit row records from/to', e.from==='team_small'&&e.to==='free', e);
  ok('audit row records SOURCE', e.source==='stripe-webhook', e.source);
  ok('audit row records REASON', e.reason==='subscription.deleted', e.reason);
  ok('audit row records ACTOR', e.actor==='stripe', e.actor);
  ok('audit row records correlating ref', e.ref==='evt_1', e.ref);
  ok('tier actually applied', db.store.users.u1.tier==='free'); }

console.log('\nSAFETY');
{ const db=mkDb({users:{u1:{tier:'pro'}}});
  const r=await setUserTier(db,'u1','enterprise',{source:'x'});
  ok('unknown tier refused, account untouched', r.changed===false && db.store.users.u1.tier==='pro', r); }
{ const db=mkDb({});
  const r=await setUserTier(db,'','free',{source:'x'});
  ok('missing uid is a safe no-op', r.changed===false); }
{ const db=mkDb({users:{u1:{}}});
  const r=await setUserTier(db,'u1','pro',{source:'admin-panel',actor:'help@pollslide.com',reason:'manual grant'});
  ok('user with no tier yet defaults from "free"', r.changed===true && r.from==='free', r); }

console.log('\nSTRIPE REPLAY GUARD');
{ const db=mkDb({});
  const first=await claimStripeEvent(db,'evt_abc');
  const second=await claimStripeEvent(db,'evt_abc');
  ok('first delivery is claimed', first===true);
  ok('REDELIVERY is rejected', second===false);
  const other=await claimStripeEvent(db,'evt_xyz');
  ok('a different event still processes', other===true); }
{ const db=mkDb({});
  ok('missing event id => process it (never drop real billing)', await claimStripeEvent(db,null)===true); }

console.log(`\n${pass} passed, ${fail} failed`);process.exit(fail?1:0);})();
