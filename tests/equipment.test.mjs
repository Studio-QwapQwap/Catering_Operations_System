import test from 'node:test';
import assert from 'node:assert/strict';
import {createApp} from '../server/index.mjs';
test('equipment categories persist, validate membership and allow moving an item',()=>{
 const app=createApp({dbPath:':memory:'});const user={id:'admin',approved:true,roles:['admin']};
 const save=(entity,record)=>app.mutate(user,{id:crypto.randomUUID(),entity,action:'save',record,baseVersion:record.version});
 try{save('equipmentCategories',{id:'wedding',name:'웨딩'});save('equipmentCategories',{id:'business',name:'기업 행사'});
 const first=save('equipmentItems',{id:'vase',name:'화병',categoryId:'wedding',quantity:12,unit:'개',notes:''}).record;
 assert.equal(app.store.get('equipmentItems','vase').categoryId,'wedding');
 assert.throws(()=>save('equipmentItems',{...first,categoryId:'missing'}));
 assert.throws(()=>save('equipmentItems',{...first,quantity:-1}));
 const moved=save('equipmentItems',{...first,categoryId:'business'}).record;assert.equal(moved.categoryId,'business');
 assert.throws(()=>app.mutate({id:'lead',approved:true,roles:['lead']},{id:crypto.randomUUID(),entity:'equipmentItems',record:{...moved,name:'changed'},baseVersion:moved.version}));
 }finally{app.store.close();}
});
