// Tests for lib/guard.js — the protection on public, money-spending endpoints.
const path=require('path');
const { sessionExists, rateLimit, clientIp } = require(path.resolve(__dirname,'../../lib/guard.js'));
let pass=0,fail=0;const ok=(n,c,x)=>{c?(pass++,console.log('  ✓',n)):(fail++,console.log('  ✗',n,x!==undefined?JSON.stringify(x):''));};

function mkDb(store={}, opts={}){
  const get=p=>p.split('/').reduce((o,k)=>(o==null?undefined:o[k]),store);
  const set=(p,v)=>{const ks=p.split('/');const last=ks.pop();let o=store;ks.forEach(k=>{o[k]=o[k]||{};o=o[k];});o[last]=v;};
  const node=p=>({
    limitToFirst:()=>node(p),
    get:async()=>{ if(opts.throwOnRead) throw new Error('read fail');
                   const v=get(p); return {exists:()=>v!==undefined&&v!==null, val:()=>v}; },
    transaction:async fn=>{ if(opts.throwOnWrite) throw new Error('write fail');
                            const n=fn(get(p)===undefined?null:get(p)); set(p,n);
                            return {committed:true,snapshot:{val:()=>n}}; },
    update:async()=>{}, forEach:()=>{},
  });
  return { ref:node, store };
}

(async()=>{
console.log('SESSION VALIDATION — blocks drive-by abuse');
{ const db=mkDb({quiz_builder:{ABC123:{questions:[{text:'q'}]}}});
  ok('real session passes', await sessionExists(db,'ABC123')===true);
  ok('unknown session refused', await sessionExists(db,'NOPE99')===false);
  ok('empty session refused', await sessionExists(db,'')===false);
  ok('null session refused', await sessionExists(db,null)===false); }
{ const db=mkDb({quiz_builder:{ABC123:{questions:[{}]}}},{throwOnRead:true});
  ok('FAILS OPEN on db error (never block a live room)', await sessionExists(db,'ABC123')===true); }
{ const db=mkDb({quiz_builder:{ABC123:{questions:[{}]}}});
  ok('path-injection chars stripped', await sessionExists(db,'ABC123/../../users')===false); }

console.log('\nRATE LIMITING — a valid code cannot be hammered');
{ const db=mkDb({});
  let last;
  for(let i=0;i<5;i++) last=await rateLimit(db,'s1',5,60000);
  ok('5th call within limit', last.allowed===true && last.count===5, last);
  const over=await rateLimit(db,'s1',5,60000);
  ok('6th call refused', over.allowed===false && over.count===6, over); }
{ const db=mkDb({});
  await rateLimit(db,'sA',1,60000); const a=await rateLimit(db,'sA',1,60000);
  const b=await rateLimit(db,'sB',1,60000);
  ok('limits are per-key (one abuser cannot block others)', a.allowed===false && b.allowed===true); }
{ const db=mkDb({},{throwOnWrite:true});
  ok('FAILS OPEN when the limiter store errors', (await rateLimit(db,'x',1,60000)).allowed===true); }
{ const db=mkDb({});
  const r=await rateLimit(db,'win',10,60000);
  ok('reports time until reset', r.resetIn>0 && r.resetIn<=60000, r.resetIn); }

console.log('\nCLIENT IP');
ok('takes first x-forwarded-for hop', clientIp({headers:{'x-forwarded-for':'1.2.3.4, 5.6.7.8'}})==='1.2.3.4');
ok('falls back to x-real-ip', clientIp({headers:{'x-real-ip':'9.9.9.9'}})==='9.9.9.9');
ok('unknown when absent', clientIp({headers:{}})==='unknown');
console.log(`\n${pass} passed, ${fail} failed`);process.exit(fail?1:0);})();
