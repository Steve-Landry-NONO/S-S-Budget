const test=require('node:test'),assert=require('node:assert/strict');
const {summarizeCategories,summarizeTotals,summarizePlanned,forecastBalance}=require('../src/features/dashboard/dashboardModel.cjs');
const cat=[{id:'weekends',monthlyPerPerson:100}];
const rows=(...amounts)=>amounts.map(amount=>({categoryId:'weekends',amount}));
const calc=(expenses=[],contributions=[],prevExpenses=[],prevContributions=[],categories=cat)=>summarizeTotals(summarizeCategories(categories,2,expenses,contributions,prevExpenses,prevContributions));
test('iPhone QA: 200 contribution minus 35 expense',()=>assert.equal(calc(rows(35),rows(200)).cashBalance,165));
test('budget target is not cash',()=>{const t=calc();assert.equal(t.monthlyBudget,200);assert.equal(t.cashBalance,0);});
test('rollover and current realized amounts',()=>{const t=calc(rows(35),rows(200),rows(20),rows(100));assert.equal(t.carryOver,80);assert.equal(t.cashBalance,245);});
test('future operations only affect forecast',()=>{const t=calc(rows(35),rows(200));const p=summarizePlanned(rows(50),rows(10));assert.equal(t.cashBalance,165);assert.equal(forecastBalance(t,p),125);});
test('negative balance retained',()=>assert.equal(calc(rows(35)).cashBalance,-35));
test('empty categories retain legacy zero totals',()=>assert.equal(calc([],[],[],[],[]).cashBalance,0));
test('category inclusion and planned aggregation remain V2-compatible',()=>{const orphan=[{categoryId:'unknown',amount:20}];assert.equal(calc(orphan).cashBalance,0);assert.equal(summarizePlanned(orphan,[]).spent,20);});
test('decimal display precision unchanged',()=>assert.equal(calc(rows(0.1),rows(0.3)).cashBalance.toFixed(2),'0.20'));

test('recent operations keep signs, distinct ids, order and input arrays unchanged',()=>{const {recentOperations}=require('../src/features/dashboard/dashboardModel.cjs');const e=[{id:'same',label:'Courses',categoryId:'weekends',date:'2026-11-23',amount:35}],c=[{id:'same',memberId:'a',categoryId:'weekends',date:'2026-11-24',amount:200}];const before=JSON.stringify([e,c]);const result=recentOperations(e,c,[{id:'weekends',name:'Weekends'}],[{id:'a',name:'A'}]);assert.deepEqual(result.map(x=>[x.key,x.amount]),[['contribution:same',200],['expense:same',-35]]);assert.equal(result[0].category,'Weekends');assert.equal(JSON.stringify([e,c]),before);assert.equal(recentOperations(e,c,[],[],1).length,1);assert.deepEqual(recentOperations([],[],[],[]),[]);});
