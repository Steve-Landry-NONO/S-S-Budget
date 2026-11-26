const KEYS=Object.freeze({cache:'SS_BUDGET_V2_CACHE',api:'SS_BUDGET_V2_API_URL',secret:'SS_BUDGET_V2_API_SECRET',user:'SS_BUDGET_V2_CURRENT_USER_ID',token:'SS_BUDGET_V2_AUTH_TOKEN',expires:'SS_BUDGET_V2_AUTH_EXPIRES_AT'});
const valid=(s,now=Date.now())=>Boolean(s?.token&&s?.user&&s?.expires&&Date.parse(s.expires)>now);
const scope=s=>({api:s.api,user:s.user,expires:s.expires});
function readCache(raw,s,now=Date.now()){
 if(!valid(s,now)||!raw)return null;
 try{const c=JSON.parse(raw);if(c.version!==1||!c.scope||!c.data||Object.keys(scope(s)).some(k=>c.scope[k]!==scope(s)[k]))return null;
 if(!['members','categories','expenses','contributions','activityLogs'].every(k=>Array.isArray(c.data[k])))return null;return c.data;}catch{return null;}
}
function createSessionBoundary(storage){
 let epoch=0,queue=Promise.resolve();
 const current=()=>epoch,isCurrent=e=>e===epoch;
 const enqueue=fn=>{const result=queue.then(fn);queue=result.catch(()=>{});return result;};
 const purge=()=>{epoch++;return enqueue(()=>storage.multiRemove([KEYS.cache,KEYS.token,KEYS.expires,KEYS.user]));};
 const save=(e,s,data)=>enqueue(async()=>{
 if(!isCurrent(e))return;
 if(!valid(s)){await storage.multiRemove([KEYS.cache,KEYS.token,KEYS.expires,KEYS.user]);await storage.multiSet([[KEYS.api,s.api||''],[KEYS.secret,s.secret||'']]);return;}
 await storage.multiSet([[KEYS.api,s.api||''],[KEYS.secret,s.secret||''],[KEYS.user,s.user],[KEYS.token,s.token],[KEYS.expires,s.expires]]);
 if(!isCurrent(e))return;
 if(data)await storage.setItem(KEYS.cache,JSON.stringify({version:1,scope:scope(s),data}));else await storage.removeItem(KEYS.cache);
 });
 return {current,isCurrent,purge,save};
}
module.exports={KEYS,valid,readCache,createSessionBoundary};