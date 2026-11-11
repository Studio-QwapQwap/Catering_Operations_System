import { DatabaseSync } from 'node:sqlite';
import { mkdirSync } from 'node:fs';
import { dirname } from 'node:path';
export const entities=['employees','vehicles','events','assignments','payroll','users','conflicts','equipmentCategories','equipmentItems'];
export function createStore(path='data/catering.sqlite'){if(path!==':memory:')mkdirSync(dirname(path),{recursive:true});const db=new DatabaseSync(path);db.exec(`PRAGMA journal_mode=WAL; PRAGMA foreign_keys=ON;
CREATE TABLE IF NOT EXISTS records(entity TEXT NOT NULL,id TEXT NOT NULL,data TEXT NOT NULL,PRIMARY KEY(entity,id));
CREATE TABLE IF NOT EXISTS credentials(user_id TEXT PRIMARY KEY,email TEXT UNIQUE NOT NULL,password TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS sessions(token TEXT PRIMARY KEY,user_id TEXT NOT NULL,expires INTEGER NOT NULL);
CREATE TABLE IF NOT EXISTS operations(user_id TEXT NOT NULL,id TEXT NOT NULL,result TEXT NOT NULL,PRIMARY KEY(user_id,id));
CREATE TABLE IF NOT EXISTS occupancy(assignment_id TEXT PRIMARY KEY,employee_id TEXT NOT NULL,event_date TEXT NOT NULL,UNIQUE(employee_id,event_date));
CREATE TABLE IF NOT EXISTS audit(id INTEGER PRIMARY KEY AUTOINCREMENT,data TEXT NOT NULL);`);
return {db,all(entity){return db.prepare('SELECT data FROM records WHERE entity=?').all(entity).map(r=>JSON.parse(r.data));},get(entity,id){const r=db.prepare('SELECT data FROM records WHERE entity=? AND id=?').get(entity,id);return r?JSON.parse(r.data):null;},put(entity,r){db.prepare('INSERT INTO records VALUES(?,?,?) ON CONFLICT(entity,id) DO UPDATE SET data=excluded.data').run(entity,r.id,JSON.stringify(r));return r;},state(){return Object.fromEntries(entities.map(e=>[e,this.all(e)]));},audit(entry){db.prepare('INSERT INTO audit(data) VALUES(?)').run(JSON.stringify({...entry,at:new Date().toISOString()}));},transaction(fn){db.exec('BEGIN IMMEDIATE');try{const result=fn();db.exec('COMMIT');return result;}catch(e){db.exec('ROLLBACK');throw e;}},close(){db.close();}};}
