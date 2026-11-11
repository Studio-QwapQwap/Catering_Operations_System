# Catering Operations Implementation Plan

> **For agentic workers:** Use superpowers:subagent-driven-development or superpowers:executing-plans to implement task by task.

**Goal:** PRD의 행사 운영 P0와 가입·권한·오프라인 동기화를 실행 가능한 앱으로 제공한다.
**Architecture:** React TypeScript 클라이언트, Node HTTP API, SQLite 영속 저장소. 서버가 권한과 모든 불변 조건을 검사한다.
**Tech Stack:** Node 24, SQLite, React, Vite, TypeScript.
**Spec:** ../specs/2026-11-11-catering-design.md

## Global Constraints

- 한국어 UI, 모바일 중심. 날짜는 한국 표준시, 금액 정수 원, 시간 정수 분.
- 같은 날짜 중복 직원 배정은 관리자도 차단. 급여는 명시적 인정 시간만 사용.
- 카카오톡 연동과 실제 행사 수용 검증은 구현 성공으로 주장하지 않는다.

## Review Focus

- 다른 시간대의 동일 날짜 배정도 중복 차단한다.
- 금액 정보는 관리자 외 API 응답과 캐시에서 제외한다.
- 원 미만 정산과 누락값은 확정 불가다.
- 확정 후 변경은 해제 사유와 변경 이력이 필요하다.
- 오프라인 재전송은 작업 ID로 멱등 처리하고 버전 충돌을 보존한다.

## Tasks

- [x] 서버: `server/index.mjs`, `server/domain.mjs`, `server/store.mjs`. 사용자·행사·직원·차량·배정·기물·현장·정산·충돌 API. `tests/domain.test.mjs`로 배정/정산 불변 조건 검증.
- [x] 클라이언트: `src/App.tsx`, `src/styles.css`, `src/api.ts`. API 계약을 공유하고 모든 화면과 입력·오류·대기 상태 제공. 모바일 하단 메뉴와 데스크톱 사이드바.
- [x] 통합: `src/offline.ts`, `public/sw.js`, `public/manifest.webmanifest`. 권한별 캐시, 입력 큐, 충돌 해결, 로그아웃 정리.
- [x] 검증·인수: `npm test`, `npm run build`, API 시나리오와 브라우저 화면 확인. `README.md`에 실행·초기 관리자·한계 기록.

## API Contract

`GET /api/session` returns `{user, setupRequired}`. `POST /api/setup`, `/api/login`, `/api/register` use `{name?,email,password}`; `/api/logout` clears session.
`GET /api/state` returns `{user, users, employees, vehicles, events, assignments, payroll, conflicts, audit}` filtered by role.
`POST /api/mutate` accepts `{id, entity, action, record, baseVersion?}` and returns `{ok, record?, conflict?}`. Entities: employees, vehicles, events, assignments, payroll, users, conflicts. Action: save, confirm, unlock, paid, approve, resolve. Records use string IDs and integer version. Errors return `{error}` and proper HTTP status.
Event: `{id,name,date,location,meetTime,startTime,endTime,guests,minExperienced,needs:{setting,food,tea,pastry,lead},equipment:[{id,name,required,prepared,working,checked}],field:{localAttendance,excellentWorkers,actualGuests,delivery,notes},version}`.
Employee: `{id,name,phone,type:'company'|'local',hourlyRate,experienced,skills:string[],experience:number,availableDates:string[],vehicleTypes:string[],version}`.
Vehicle: `{id,name,type,seats,version}`. Assignment: `{id,eventId,employeeId,job,vehicleId?,driver:boolean,confirmed,exceptionReason?,version}`.
Payroll: `{id,eventId,employeeId,startTime,endTime,extraMinutes,recognizedMinutes,hourlyRate,driverAllowance,confirmed,paid,reason,version}`.
User: `{id,name,email,roles:string[],approved,employeeId?}`. Roles admin, lead, driver.
