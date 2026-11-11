type Pending = {id:string;entity:string;action:string;record:any;baseVersion?:number;userId:string;blocked?:boolean};
let pendingCount=0;
let syncError='';
const blockedRecords=new Set<string>();
const recordKey=(op:Pending)=>op.userId+':'+op.entity+':'+op.record.id;
const dbPromise = new Promise<IDBDatabase>((resolve,reject)=>{const q=indexedDB.open('hansang-local',1);q.onupgradeneeded=()=>q.result.createObjectStore('values');q.onsuccess=()=>resolve(q.result);q.onerror=()=>reject(q.error);});
async function local<T=any>(key:string,value?:T,write=false):Promise<T>{const db=await dbPromise;return new Promise((resolve,reject)=>{const tx=db.transaction('values',write?'readwrite':'readonly');const st=tx.objectStore('values');const q=write?st.put(value,key):st.get(key);q.onsuccess=()=>resolve(write?value:q.result);q.onerror=()=>reject(q.error);});}
async function updateQueue(change:(items:Pending[])=>Pending[]){const db=await dbPromise;return new Promise<Pending[]>((resolve,reject)=>{const tx=db.transaction('values','readwrite');const st=tx.objectStore('values');let result:Pending[]=[];const q=st.get('queue');q.onsuccess=()=>{result=change(q.result||[]);st.put(result,'queue');};tx.oncomplete=()=>resolve(result);tx.onerror=()=>reject(tx.error);});}
function announce(){window.dispatchEvent(new Event('offline-status'));}
export async function request(path:string,options:any={}){
 const rawBody=options.body??(options.method==='POST'?{}:undefined);
 const body=rawBody&&typeof rawBody!=='string'?JSON.stringify(rawBody):rawBody;
 try{const response=await fetch(path.startsWith('/api')?path:'/api'+path,{...options,body,credentials:'same-origin',headers:{...(body?{'Content-Type':'application/json'}:{}),...options.headers}});const data=await response.json();if(!response.ok){const err:any=new Error(data.error||'요청을 처리하지 못했습니다.');err.status=response.status;throw err;}if(data.user&&/\/(login|setup|register)$/.test(path)){const cached=await local('state');if(cached?.user?.id!==data.user.id)await local('state',null,true);}return data;}
 catch(e:any){if(!e.status && (path==='/api/session'||path==='/session')){const cached=await local('state');if(cached?.user)return {user:cached.user,setupRequired:false,offline:true};}throw e;}
}
function cacheState(state:any){
 const today=new Intl.DateTimeFormat('en-CA',{timeZone:'Asia/Seoul',year:'numeric',month:'2-digit',day:'2-digit'}).format(new Date());
 const admin=state.user?.roles?.includes('admin');
 const mine=new Set((state.assignments||[]).filter((a:any)=>a.employeeId===state.user?.employeeId).map((a:any)=>a.eventId));
 const events=(state.events||[]).filter((e:any)=>e.date===today&&(admin||mine.has(e.id)));
 const ids=new Set(events.map((e:any)=>e.id));const assignments=(state.assignments||[]).filter((a:any)=>ids.has(a.eventId));
 const employees=new Set(assignments.map((a:any)=>a.employeeId));const vehicles=new Set(assignments.map((a:any)=>a.vehicleId));
 return {...state,events,assignments,employees:(state.employees||[]).filter((e:any)=>employees.has(e.id)),vehicles:(state.vehicles||[]).filter((v:any)=>vehicles.has(v.id)),payroll:(state.payroll||[]).filter((p:any)=>ids.has(p.eventId)),workRecords:(state.workRecords||[]).filter((p:any)=>ids.has(p.eventId)),users:[],audit:[],conflicts:[],cachedAt:new Date().toISOString()};
}
export async function loadState(){
 try{const state=await request('/api/state');await local('state',cacheState(state),true);const pending:Pending[]=await local('queue')||[];const held=new Set(pending.filter(o=>o.blocked).map(recordKey));for(const key of blockedRecords)if(!held.has(key))blockedRecords.delete(key);await local('blockedRecords',[...blockedRecords],true);return state;}
 catch(e:any){if(e.status){if(e.status===401||e.status===403)await local('state',null,true);throw e;}const cached=await local('state');if(!cached)throw new Error('기기에 저장된 자료가 없습니다. 인터넷에 연결해 먼저 자료를 불러오세요.');return {...cached,offline:true};}
}
export async function mutate(entity:string,action:string,record:any,baseVersion?:number){
 const state=await local('state');const op:Pending={id:crypto.randomUUID(),entity,action,record:{...record,id:record.id||crypto.randomUUID()},baseVersion:baseVersion??record.version,userId:state?.user?.id};
 try{const result=await request('/api/mutate',{method:'POST',body:op});if(entity==='conflicts'&&action==='resolve'&&result.ok){for(const uid of [record.userId,state?.user?.id])blockedRecords.delete(uid+':'+record.entity+':'+record.recordId);await local('blockedRecords',[...blockedRecords],true);}return result;}
 catch(e:any){if(e.status)throw e;if(!state?.user)throw new Error('저장한 사용자 자료가 없습니다.');if(['users','conflicts'].includes(entity)||['confirm','unlock','paid','approve','resolve','delete'].includes(action))throw new Error('이 작업은 인터넷 연결 후 진행해 주세요.');
 if(blockedRecords.has(recordKey(op)))op.blocked=true;
 const queue=await updateQueue(items=>[...items,op]);pendingCount=queue.length;
 op.record.version=(record.version||0)+1;
 if(Array.isArray(state[entity])){const ix=state[entity].findIndex((x:any)=>x.id===op.record.id);if(ix>=0)state[entity][ix]={...state[entity][ix],...op.record};else state[entity].push(op.record);await local('state',state,true);}announce();return {ok:true,queued:true,record:op.record};}
}
let syncFlight:Promise<void>|null=null;
export function syncPending(){if(!syncFlight)syncFlight=performSync().finally(()=>{syncFlight=null;});return syncFlight;}
async function performSync(){
 const snapshot:Pending[]=await local('queue')||[];pendingCount=snapshot.length;if(!navigator.onLine||!snapshot.length){announce();return;}
 const session=await request('/api/session');syncError='';
 const groups=new Map<string,Pending[]>();
 for(const op of snapshot){const key=op.userId+':'+op.entity+':'+op.record.id;groups.set(key,[...(groups.get(key)||[]),op]);}
 for(const group of groups.values()){
  if(group.some(o=>o.blocked)){syncError='충돌한 자료의 후속 입력이 보류되었습니다. 입력을 확인한 뒤 보류 입력을 정리해 주세요.';continue;}
  const first=group[0],last=group[group.length-1];if(first.userId!==session.user?.id){syncError='다른 사용자의 미전송 자료가 있습니다.';continue;}
  const op={...last,record:Object.assign({},...group.map(o=>o.record)),baseVersion:first.baseVersion};
  try{const result=await request('/api/mutate',{method:'POST',body:op});const ids=new Set(group.map(o=>o.id));
   if(result.conflict){blockedRecords.add(recordKey(op));await local('blockedRecords',[...blockedRecords],true);}
   let version=result.record?.version;
   await updateQueue(items=>items.filter(x=>!ids.has(x.id)).map(x=>{if(recordKey(x)!==recordKey(op))return x;if(result.conflict)return {...x,blocked:true};if(version!==undefined)return {...x,baseVersion:version++,record:{...x.record,version:version-1}};return x;}));
   if(result.conflict)syncError='다른 기기의 변경과 충돌했습니다. 설정에서 두 내용을 확인해 주세요.';
  }catch(e:any){syncError=e.message;if(!e.status)break;}
 }
 const remaining:Pending[]=await local('queue')||[];pendingCount=remaining.length;await loadState();announce();window.dispatchEvent(new Event('data-synced'));
}
export async function discardPending(){if(!window.confirm('서버로 보내지 못한 입력을 모두 버릴까요? 저장된 서버 자료는 유지됩니다.'))return;await updateQueue(()=>[]);blockedRecords.clear();await local('blockedRecords',[],true);pendingCount=0;syncError='';await loadState();announce();window.dispatchEvent(new Event('data-synced'));}
export async function logoutCleanup(){const q:Pending[]=await local('queue')||[];if(q.length&&!window.confirm(`미전송 입력 ${q.length}건을 삭제하고 로그아웃할까요?`))return false;await request('/api/logout',{method:'POST'});await local('state',null,true);await updateQueue(()=>[]);blockedRecords.clear();await local('blockedRecords',[],true);pendingCount=0;syncError='';announce();return true;}
export function offlineStatus(){return {online:navigator.onLine,pending:pendingCount,pendingCount,error:syncError};}
local<string[]>('blockedRecords').then(keys=>(keys||[]).forEach(key=>blockedRecords.add(key))).catch(()=>{});
local<Pending[]>('queue').then(q=>{pendingCount=q?.length||0;announce();}).catch(()=>{});
window.addEventListener('online',()=>{syncPending().catch(e=>{syncError=e.message;announce();});});
window.addEventListener('offline',announce);
