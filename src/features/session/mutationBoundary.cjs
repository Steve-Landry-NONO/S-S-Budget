// V2 SQLite only. No exactly-once claim: uncertain writes need human review.
const {isSnapshot}=require('./sessionBoundary.cjs');
const refusalStatuses=new Set([400,401,403,404,409,413]);
function httpError(status,data){
 const structured=typeof data?.error==='string'&&data.error.length>0;
 const error=new Error(structured?data.error:'Réponse serveur '+status);
 error.code=data?.code;error.httpStatus=status;
 error.definiteRefusal=structured&&refusalStatuses.has(status);
 return error;
}
function createMutationJournal(storage,prefix){
 let queue=Promise.resolve();
 const enqueue=fn=>{const task=queue.then(fn);queue=task.catch(()=>{});return task;};
 // A marker survives logout/restart for the same server and account. No payload, token or amount.
 const key=s=>prefix+encodeURIComponent(s.api.trim().replace(/\/+$/,''))+':'+encodeURIComponent(s.user);
 const readUnsafe=async s=>{const raw=await storage.getItem(key(s));if(raw==null)return null;const m=JSON.parse(raw);if(m?.version!==1||typeof m.id!=='string'||!m.id||!Number.isFinite(m.at))throw Error('Marqueur de vérification invalide');return m;};
 const read=s=>enqueue(()=>readUnsafe(s));
 const begin=(s,id,current)=>enqueue(async()=>{
  if(!current())return {kind:'stale'};
  const previous=await readUnsafe(s);if(previous)return {kind:'blocked',marker:previous};
  if(!current())return {kind:'stale'};
  const marker={version:1,id,at:Date.now()};
  await storage.setItem(key(s),JSON.stringify(marker));
  return {kind:'started',marker};
 });
 const clear=(s,id,current)=>enqueue(async()=>{
  if(!current())return false;
  const marker=await readUnsafe(s);
  if(!marker||marker.id!==id||!current())return false;
  await storage.removeItem(key(s));return true;
 });
 return {read,begin,clear};
}
async function executeMutation({journal,session,id,current,send,apply}){
 let started;
 try{started=await journal.begin(session,id,current);}catch(error){return {kind:'storage-error',error};}
 if(started.kind!=='started')return started;
 const marker=started.marker;
 if(!current())return {kind:'stale',marker};
 let result;
 try{
  const data=await send();
  if(!current())return {kind:'stale',marker};
  if(!isSnapshot(data))return {kind:'unknown',marker};
  apply(data);
  result={kind:'confirmed'};
 }catch(error){
  if(!current()||error?.code==='STALE_SESSION')return {kind:'stale',marker};
  if(error?.definiteRefusal!==true)return {kind:'unknown',marker};
  result={kind:'refused',error};
 }
 try{if(!await journal.clear(session,id,current))return {...result,marker};}
 catch(error){return {...result,marker,storageError:error};}
 return result;
}
// A write invalidates outstanding reads; only the newest read in the current session can apply.
function createReadFence(){
 let version=0;
 return {invalidate:()=>{version++;},start:()=>++version,isCurrent:id=>id===version};
}
module.exports={httpError,createMutationJournal,executeMutation,createReadFence};
