#!/usr/bin/env node
/* PollSlide QA — server code that READS a name nobody defined.
 * ---------------------------------------------------------------------------
 * WHY THIS EXISTS
 * api/team.js used `who.email` in five places and never defined `who` (found 2026-09-27).
 * Every one of those lines threw at runtime, half-way through a change: removing a member
 * detached them but left them on the paid plan; Admin's "Add existing user", "change
 * plan", "start demo" and "end demo" all crashed after their first write. The file loaded,
 * the syntax was valid, no test ran it — qa-undefined.js only looks at the web pages.
 *
 * WHAT IT DOES
 * For every api/*.js and lib/*.js: strip comments, strings and regexes; collect every name
 * that is declared, assigned, a parameter, or a method; report any other bare name that is
 * read and isn't a JavaScript/Node global. Deliberately conservative — anything that looks
 * defined anywhere in the file counts as defined — so it may miss a bug, but it shouldn't
 * cry wolf.
 *
 *   node scripts/qa-server-undefined.js [file ...]
 * --------------------------------------------------------------------------- */
const fs=require('fs'),path=require('path');
const ROOT=path.resolve(__dirname,'..');
const G=new Set(('Array Boolean Date Error Function JSON Map Math Number Object Promise Proxy Reflect RegExp Set String Symbol WeakMap WeakSet BigInt Intl parseInt parseFloat isNaN isFinite encodeURIComponent decodeURIComponent encodeURI decodeURI structuredClone queueMicrotask '+
'require module exports process Buffer console setTimeout clearTimeout setInterval clearInterval setImmediate fetch URL URLSearchParams AbortController TextEncoder TextDecoder crypto globalThis __dirname __filename Response Headers FormData Blob atob btoa undefined NaN Infinity arguments this super new typeof instanceof void delete in of return throw await async yield if else for while do switch case break continue try catch finally function class extends const let var true false null default import export static get set').split(' '));
function strip(src){ // remove comments, strings, template literal text (keep ${} expressions), regexes roughly
  let out='',i=0,n=src.length;
  while(i<n){const c=src[i],d=src[i+1];
    if(c==='/'&&d==='/'){while(i<n&&src[i]!=='\n')i++;continue;}
    if(c==='/'&&d==='*'){i+=2;while(i<n&&!(src[i]==='*'&&src[i+1]==='/'))i++;i+=2;continue;}
    if(c==='"'||c==="'"){const q=c;i++;while(i<n&&src[i]!==q){if(src[i]==='\\')i++;i++;}i++;out+='""';continue;}
    if(c==='`'){i++;let depth=0;out+=' ';while(i<n){if(src[i]==='\\'){i+=2;continue;}if(src[i]==='`'&&depth===0){i++;break;}
        if(src[i]==='$'&&src[i+1]==='{'){ // copy expression
          i+=2;let b=1,expr='';while(i<n&&b>0){if(src[i]==='{')b++;else if(src[i]==='}'){b--;if(!b)break;}expr+=src[i];i++;}i++;out+=' '+strip(expr)+' ';continue;}
        i++;}continue;}
    if(c==='/'&&(/[=(,:;!&|?{}\[\n>]\s*$/.test(out.slice(-3))||/\b(?:return|typeof|case|in|of)\s*$/.test(out.slice(-8)))){ // regex literal
      i++;let cls=false;while(i<n&&(src[i]!=='/'||cls)){if(src[i]==='\\')i++;else if(src[i]==='[')cls=true;else if(src[i]===']')cls=false;i++;}i++;while(/[a-z]/.test(src[i]||''))i++;out+='R';continue;}
    out+=c;i++;}
  return out;}
function check(file){
  const s=strip(fs.readFileSync(file,'utf8'));
  const def=new Set();
  const add=x=>x&&def.add(x);
  for(const m of s.matchAll(/\b(?:const|let|var|function|class|catch)\s*\(?\s*([A-Za-z_$][\w$]*)/g))add(m[1]);
  for(const m of s.matchAll(/\b(?:const|let|var)\s*[{\[]([^}\]]*)[}\]]/g))m[1].split(',').forEach(p=>{const x=p.split(':').pop().split('=')[0].replace(/\.\.\./,'').trim();if(/^[A-Za-z_$][\w$]*$/.test(x))add(x);});
  // params: function(...) / (...)=> / x=>
  for(const m of s.matchAll(/\bfunction\s*[\w$]*\s*\(([^)]*)\)/g))m[1].split(/[,{}\[\]=:]/).forEach(p=>{const x=p.replace(/\.\.\./,'').trim();if(/^[A-Za-z_$][\w$]*$/.test(x))add(x);});
  for(const m of s.matchAll(/\(([^()]*)\)\s*=>/g))m[1].split(/[,{}\[\]=:]/).forEach(p=>{const x=p.replace(/\.\.\./,'').trim();if(/^[A-Za-z_$][\w$]*$/.test(x))add(x);});
  for(const m of s.matchAll(/([A-Za-z_$][\w$]*)\s*=>/g))add(m[1]);
  for(const m of s.matchAll(/(?:^|[\s,{])(?:async\s+)?([A-Za-z_$][\w$]*)\s*\(([^()]*)\)\s*\{/g)){add(m[1]);m[2].split(/[,{}\[\]=:]/).forEach(p=>{const x=p.replace(/\.\.\./,'').trim();if(/^[A-Za-z_$][\w$]*$/.test(x))add(x);});}
  for(const m of s.matchAll(/\bfor\s*\(\s*(?:const|let|var)\s*([A-Za-z_$][\w$]*)/g))add(m[1]);
  for(const m of s.matchAll(/(?:^|[^.\w$])([A-Za-z_$][\w$]*)\s*=[^=>]/g))add(m[1]); // plain assignment
  // method shorthand names inside object literals are not references; property keys `x:` skipped below
  const bad=new Map();
  for(const m of s.matchAll(/(^|[^.\w$])([A-Za-z_$][\w$]*)\b(?!\s*:(?!:))/g)){
    const name=m[2]; if(G.has(name)||def.has(name)||/^\d/.test(name))continue;
    const after=s.slice(m.index+m[0].length,m.index+m[0].length+2);
    const before=s.slice(Math.max(0,m.index-1),m.index+1);
    if(name==='R')continue;
    bad.set(name,(bad.get(name)||0)+1);
  }
  return [...bad.entries()];
}
const args=process.argv.slice(2);
const files=args.length?args:[...fs.readdirSync(ROOT+'/api').map(f=>path.join(ROOT,'api',f)),...fs.readdirSync(ROOT+'/lib').map(f=>path.join(ROOT,'lib',f))].filter(f=>f.endsWith('.js'));
let bad=0;
for(const f of files){const b=check(f);if(b.length){bad+=b.length;console.log('  ✗ '+path.relative(ROOT,f)+': '+b.map(([k,v])=>k+(v>1?' ×'+v:'')).join(', '));}}
if(bad){console.log('\nThese names are read but never defined in their file. Each one throws the moment that line runs.');process.exit(1);}
console.log('  ✓ '+files.length+' server file(s): every name that is read is defined');
