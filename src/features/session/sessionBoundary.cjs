// Session identity is a local cache namespace, not an authentication credential.
let serial=0;
const newSessionId=()=>Date.now().toString(36)+'-'+(++serial).toString(36)+'-'+Math.random().toString(36).slice(2)+'-'+Math.random().toString(36).slice(2);
const nonempty=v=>typeof v==='string'&&v.length>0;
const valid=(s,now=Date.now())=>Boolean(nonempty(s?.api)&&nonempty(s?.token)&&nonempty(s?.user)&&nonempty(s?.sessionId)&&Date.parse(s.expires)>now);
const scope=s=>({api:s.api,user:s.user,expires:s.expires,sessionId:s.sessionId});
const rows=(data,key,check)=>Array.isArray(data?.[key])&&data[key].every(row=>row&&typeof row==='object'&&!Array.isArray(row)&&nonempty(row.id)&&check(row));
const financialRow=r=>Number.isFinite(r.amount)&&nonempty(r.categoryId)&&nonempty(r.date);
const isSnapshot=data=>Boolean(rows(data,'members',r=>typeof r.name==='string')&&rows(data,'categories',r=>typeof r.name==='string'&&Number.isFinite(r.monthlyPerPerson))&&rows(data,'expenses',r=>financialRow(r)&&typeof r.label==='string'&&nonempty(r.paidByMemberId))&&rows(data,'contributions',r=>financialRow(r)&&nonempty(r.memberId))&&rows(data,'activityLogs',r=>nonempty(r.action)));
function readStoredSession(raw,api,secret,now=Date.now()){
 try{const c=JSON.parse(raw);if(c?.version!==2||c.api!==api)return null;const s={api,secret,user:c.user,token:c.token,expires:c.expires,sessionId:c.sessionId};return valid(s,now)?s:null;}catch{return null;}
}
function readCache(raw,s,now=Date.now()){
 if(!valid(s,now)||!raw)return null;
 try{const c=JSON.parse(raw);if(c.version!==2||!c.scope||!isSnapshot(c.data)||Object.keys(scope(s)).some(k=>c.scope[k]!==scope(s)[k]))return null;return c.data;}catch{return null;}
}
function createSessionBoundary(storage,KEYS){
 let epoch=0,queue=Promise.resolve();
 const current=()=>epoch,isCurrent=e=>e===epoch;
 const requestStatus=(e,s,now=Date.now())=>!isCurrent(e)?'stale':s?.token&&!valid(s,now)?'expired':'current';
 const enqueue=fn=>{const result=queue.then(fn);queue=result.catch(()=>{});return result;};
 const credentials=[KEYS.cache,KEYS.auth,KEYS.token,KEYS.expires,KEYS.user];
 const purge=()=>{epoch++;return enqueue(()=>storage.multiRemove(credentials));};
 const save=(e,s,data)=>enqueue(async()=>{
  if(!isCurrent(e))return;
  if(!valid(s)){await storage.multiRemove(credentials);await storage.multiSet([[KEYS.api,s.api||''],[KEYS.secret,s.secret||'']]);return;}
  await storage.multiSet([[KEYS.api,s.api||''],[KEYS.secret,s.secret||'']]);
  if(!isCurrent(e))return;
  await storage.setItem(KEYS.auth,JSON.stringify({version:2,...scope(s),token:s.token}));
  if(!isCurrent(e))return;
  if(data&&isSnapshot(data))await storage.setItem(KEYS.cache,JSON.stringify({version:2,scope:scope(s),data}));else await storage.removeItem(KEYS.cache);
 });
 return {current,isCurrent,requestStatus,purge,save};
}
module.exports={valid,newSessionId,readStoredSession,readCache,isSnapshot,createSessionBoundary};
