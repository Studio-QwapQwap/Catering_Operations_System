import test from 'node:test';
import assert from 'node:assert/strict';
import { payrollAmount, minutesBetween, validateAssignment } from '../server/domain.mjs';
test('payroll uses exact integer won and explicit recognized minutes',()=>{
 assert.equal(payrollAmount({recognizedMinutes:330,hourlyRate:12000,driverAllowance:0}),66000);
 assert.throws(()=>payrollAmount({recognizedMinutes:1,hourlyRate:100,driverAllowance:0}),/원/);
 assert.throws(()=>payrollAmount({hourlyRate:12000}),/필수/);
 assert.equal(minutesBetween('09:00','14:30'),330);
});
test('same date occupancy is absolute even for tentative assignments',()=>{
 const state={events:[{id:'a',date:'2026-11-12'},{id:'b',date:'2026-11-12'}],employees:[{id:'p',availableDates:['2026-11-12'],skills:['food']}],assignments:[{id:'one',eventId:'a',employeeId:'p',confirmed:false}],vehicles:[]};
 assert.throws(()=>validateAssignment({id:'two',eventId:'b',employeeId:'p',job:'food'},state),/중복/);
 state.assignments=[];
 assert.doesNotThrow(()=>validateAssignment({id:'two',eventId:'b',employeeId:'p',job:'food'},state));
 state.employees[0].availableDates=[];
 assert.throws(()=>validateAssignment({id:'two',eventId:'b',employeeId:'p',job:'food'},state),/참여/);
});

test('recommendation never overfills a vehicle to add a driver',async()=>{
 const {recommend}=await import('../server/domain.mjs');
 const s={events:[{id:'e',date:'2026-11-12',startTime:'10:00',endTime:'14:00',needs:{food:2},minExperienced:0}],employees:[{id:'one',name:'One',type:'company',skills:['food'],availableDates:['2026-11-12'],vehicleTypes:[]},{id:'two',name:'Two',type:'company',skills:['food'],availableDates:['2026-11-12'],vehicleTypes:['van']}],vehicles:[{id:'v',type:'van',seats:1}],assignments:[{id:'old',eventId:'e',employeeId:'one',job:'food',vehicleId:'v',driver:false}]};
 const result=recommend('e',s);assert.equal(result.assignments.length,1);assert.equal(result.assignments[0].vehicleId,undefined);assert(result.warnings.some(w=>w.includes('운전자')));
});
