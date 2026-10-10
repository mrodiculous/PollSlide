/* Offline Firebase stand-in for the browser language sweep: signed out, empty database.
   Lets every page reach its translation code without a network or an account. */
(function(){
  const chain = new Proxy(function(){}, { get(t,k){ if(k==='then') return undefined; if(k==='key') return 'x'; if(k==='exists') return ()=>false; if(k==='val') return ()=>null; if(k===Symbol.toPrimitive) return ()=>''; return chain; }, apply(){ return chain; } });
  const auth = { onAuthStateChanged(cb){ setTimeout(()=>cb(null),30); return ()=>{}; }, currentUser:null, setPersistence(){return Promise.resolve();},
    signInAnonymously(){return Promise.resolve({user:{uid:'anon',isAnonymous:true}});}, getRedirectResult(){return Promise.resolve({});}, useDeviceLanguage(){}, signOut(){return Promise.resolve();} };
  window.firebase = new Proxy(function(){}, { get(t,k){
    if (k==='apps') return [1];
    if (k==='initializeApp') return ()=>chain;
    if (k==='auth') { const a=()=>auth; a.Auth={Persistence:{LOCAL:1,SESSION:2,NONE:3}}; a.GoogleAuthProvider=function(){ return {addScope(){},setCustomParameters(){}}; }; return a; }
    if (k==='database') { const d=()=>({ ref(){ return chain; }, goOnline(){}, goOffline(){} }); d.ServerValue={TIMESTAMP:0,increment:()=>0}; return d; }
    return chain;
  }});
})();
