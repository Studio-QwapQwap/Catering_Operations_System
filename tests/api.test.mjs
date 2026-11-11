import test from 'node:test';
import assert from 'node:assert/strict';
import { createApp } from '../server/index.mjs';
test('API authentication, role filtering, replay, and conflict preservation',async(t)=>{
 const app=createApp({dbPath:':memory:'});await new Promise(r=>app.server.listen(0,'127.0.0.1',r));t.after(()=>app.close());const base=`http://127.0.0.1:${app.server.address().port}`;
 async function call(path,body,cookie){const r=await fetch(base+path,{method:body?'POST':'GET',headers:{'content-type':'application/json',...(cookie?{cookie}:{})},...(body?{body:JSON.stringify(body)}:{})});return {status:r.status,data:await r.json(),cookie:r.headers.get('set-cookie')?.split(';')[0]};}
 const setup=await call('/api/setup',{name:'관리자',email:'admin@example.com',password:'password123'});assert.equal(setup.status,201);const cookie=setup.cookie;assert.equal((await call('/api/session',null,cookie)).data.user.name,'관리자');
 const pending=await call('/api/register',{name:'대기',email:'pending@example.com',password:'password123'});assert.equal((await call('/api/state',null,pending.cookie)).data.employees.length,0);
 const payload={id:'op1',entity:'employees',action:'save',record:{id:'e',name:'직원',type:'company',skills:['food'],availableDates:['2026-11-12'],vehicleTypes:[],experience:1,hourlyRate:12000}};
 assert.equal((await call('/api/mutate',payload,pending.cookie)).status,403);
 const first=await call('/api/mutate',payload,cookie);assert.equal(first.data.record.version,1);assert.deepEqual((await call('/api/mutate',payload,cookie)).data,first.data);
 const collision=await call('/api/mutate',{...payload,id:'op2',baseVersion:0,record:{id:'e',name:'오프라인'}},cookie);assert.equal(collision.data.ok,false);assert.equal(collision.data.conflict.attempted.name,'오프라인');assert.equal(collision.data.conflict.server.name,'직원');
 assert.equal((await call('/api/mutate',{...payload,id:'op2',baseVersion:0},cookie)).data.conflict.id,collision.data.conflict.id);
 assert.equal((await call('/api/setup',{name:'다른',email:'other@example.com',password:'password123'})).status,409);
});

test('server prevents unapproved bootstrap lockout and computes draft payroll safely',async(t)=>{
 const app=createApp({dbPath:':memory:'});await new Promise(r=>app.server.listen(0,'127.0.0.1',r));t.after(()=>app.close());const base=`http://127.0.0.1:${app.server.address().port}`;
 async function call(path,body,cookie){const r=await fetch(base+path,{method:body?'POST':'GET',headers:{'content-type':'application/json',...(cookie?{cookie}:{})},...(body?{body:JSON.stringify(body)}:{})});return {status:r.status,data:await r.json(),cookie:r.headers.get('set-cookie')?.split(';')[0]};}
 assert.equal((await call('/api/register',{name:'x',email:'x@example.com',password:'password123'})).status,409);
 const cookie=(await call('/api/setup',{name:'Admin',email:'admin@example.com',password:'password123'})).cookie;
 assert.equal((await call('/api/demo',{},cookie)).status,200);
 const state=(await call('/api/state',null,cookie)).data;assert.equal(state.events.length,1);
 const payroll={id:'pay',eventId:'demo-event',employeeId:'demo-employee-0',startTime:'10:00',endTime:'14:30',extraMinutes:0,recognizedMinutes:330,hourlyRate:12000,driverAllowance:0};
 const save=await call('/api/mutate',{id:'p1',entity:'payroll',record:payroll},cookie);assert.equal(save.data.record.amount,66000);assert.equal(save.data.record.startTime,'09:00');assert.equal(save.data.record.actualMinutes,330);
 const confirmed=await call('/api/mutate',{id:'p2',entity:'payroll',action:'confirm',record:{id:'pay'},baseVersion:1},cookie);assert.equal(confirmed.data.record.confirmed,true);
 assert.equal((await call('/api/mutate',{id:'p3',entity:'payroll',record:{id:'pay',recognizedMinutes:200},baseVersion:2},cookie)).status,409);
 assert.equal((await call('/api/mutate',{id:'p4',entity:'payroll',action:'unlock',record:{id:'pay'},baseVersion:2},cookie)).status,400);
 assert.equal((await call('/api/mutate',{id:'p5',entity:'payroll',action:'unlock',record:{id:'pay',reason:'현장 기록 수정'},baseVersion:2},cookie)).data.record.confirmed,false);
 const ass={id:'a',eventId:'demo-event',employeeId:'demo-employee-0',job:'lead',driver:false};assert.equal((await call('/api/mutate',{id:'a1',entity:'assignments',record:ass},cookie)).status,200);
 assert.equal((await call('/api/mutate',{id:'a2',entity:'assignments',record:{...ass,id:'b',job:'food'}},cookie)).status,409);
 const reg=await call('/api/register',{name:'Lead',email:'lead@example.com',password:'password123'});assert.equal((await call('/api/mutate',{id:'u1',entity:'users',action:'approve',record:{id:reg.data.user.id,roles:['lead'],employeeId:'demo-employee-0'},baseVersion:1},cookie)).status,200);
 const lead=(await call('/api/state',null,reg.cookie)).data;assert.equal(lead.payroll.length,0);assert.equal(lead.workRecords[0].actualMinutes,330);assert.equal(JSON.stringify(lead).includes('hourlyRate'),false);assert.equal(JSON.stringify(lead).includes('66000'),false);
 const leadEdit=await call('/api/mutate',{id:'lead1',entity:'events',record:{id:'demo-event',field:{notes:'현장 메모'}},baseVersion:1},reg.cookie);assert.equal(leadEdit.status,200);
 assert.equal((await call('/api/mutate',{id:'lead2',entity:'events',record:{id:'demo-event',name:'안됨'},baseVersion:2},reg.cookie)).status,403);
});

test('partial event conflicts merge with current records and cannot inject payroll lifecycle flags',()=>{
 const app=createApp({dbPath:':memory:'});try{
 const user={id:'admin',roles:['admin'],approved:true};app.store.put('users',user);
 app.store.put('events',{id:'event',name:'행사',date:'2026-11-12',location:'장소',meetTime:'09:00',startTime:'10:00',endTime:'14:30',guests:10,minExperienced:0,needs:{},equipment:[],field:{notes:'서버'},version:2});
 const conflict=app.mutate(user,{id:'conflict-create',entity:'events',record:{id:'event',field:{notes:'기기'}},baseVersion:1}).conflict;
 app.mutate(user,{id:'conflict-resolve',entity:'conflicts',action:'resolve',record:{id:conflict.id,choice:'attempted'}});
 assert.equal(app.store.get('events','event').field.notes,'기기');assert.equal(app.store.get('events','event').name,'행사');
 app.store.put('employees',{id:'employee',name:'직원',type:'company',version:1});
 app.store.put('payroll',{id:'payroll',eventId:'event',employeeId:'employee',startTime:'09:00',endTime:'14:30',extraMinutes:0,recognizedMinutes:330,hourlyRate:12000,driverAllowance:0,confirmed:false,paid:false,version:2});
 const injected=app.mutate(user,{id:'pay-conflict',entity:'payroll',record:{id:'payroll',confirmed:true,paid:true},baseVersion:1}).conflict;
 app.mutate(user,{id:'pay-resolve',entity:'conflicts',action:'resolve',record:{id:injected.id,choice:'attempted'}});
 const payroll=app.store.get('payroll','payroll');assert.equal(payroll.confirmed,false);assert.equal(payroll.paid,false);
 const locked=app.mutate(user,{id:'locked-conflict',entity:'payroll',record:{id:'payroll',recognizedMinutes:400},baseVersion:1}).conflict;
 app.store.put('payroll',{...payroll,confirmed:true});
 assert.throws(()=>app.mutate(user,{id:'locked-resolve',entity:'conflicts',action:'resolve',record:{id:locked.id,choice:'attempted'}}),/해제/);
 }finally{app.store.close();}
});

test('moving a tentative event onto an occupied date rejects with 409 and rolls back',()=>{
 const app=createApp({dbPath:':memory:'});try{
 const user={id:'admin',roles:['admin'],approved:true};app.store.put('users',user);
 const event={id:'first',name:'행사',date:'2026-11-12',location:'장소',meetTime:'09:00',startTime:'10:00',endTime:'14:30',guests:10,minExperienced:0,needs:{},equipment:[],field:{},version:1};
 app.store.put('events',event);app.store.put('events',{...event,id:'second',date:'2026-11-13'});
 app.store.put('assignments',{id:'first-a',eventId:'first',employeeId:'employee',job:'food',confirmed:false,version:1});app.store.put('assignments',{id:'second-a',eventId:'second',employeeId:'employee',job:'food',confirmed:false,version:1});
 assert.throws(()=>app.mutate(user,{id:'move-event',entity:'events',record:{id:'second',date:'2026-11-12'},baseVersion:1}),e=>e.status===409&&e.message.includes('중복'));
 assert.equal(app.store.get('events','second').date,'2026-11-13');assert.equal(app.store.get('events','second').version,1);
 app.store.put('events',{...event,id:'cancelled',status:'cancelled'});app.store.put('assignments',{id:'cancelled-a',eventId:'cancelled',employeeId:'employee',job:'food',confirmed:false,version:1});
 assert.throws(()=>app.mutate(user,{id:'reactivate',entity:'events',record:{id:'cancelled',status:'active'},baseVersion:1}),e=>e.status===409);
 assert.equal(app.store.get('events','cancelled').status,'cancelled');
 }finally{app.store.close();}
});
