// All amounts EUR, all identities fictional. No live sources or persistent storage.
const model=require('../dashboard/dashboardModel.cjs');
const members=[{id:'a',name:'Partenaire A'},{id:'b',name:'Partenaire B'}];
const category={id:'weekends',name:'Weekends',monthlyPerPerson:180};
const expense=(amount,id='e')=>({id,date:'2026-11-23',label:'Courses weekend',categoryId:'weekends',paidByMemberId:'a',amount});
const contribution=(amount,id='c')=>({id,date:'2026-11-24',categoryId:'weekends',memberId:'a',amount});
const SCENARIOS={
 normal:{label:'Budget normal',categories:[category],expenses:[expense(35)],contributions:[contribution(200)],plannedExpenses:[],plannedContributions:[],connected:true},
 negative:{label:'Solde négatif',categories:[category],expenses:[expense(35)],contributions:[],plannedExpenses:[],plannedContributions:[],connected:true},
 empty:{label:'Compte vide',categories:[],expenses:[],contributions:[],plannedExpenses:[],plannedContributions:[],connected:true},
 future:{label:'Opérations futures',categories:[category],expenses:[expense(35)],contributions:[contribution(200)],plannedExpenses:[expense(50,'p')],plannedContributions:[contribution(10,'pc')],connected:true},
 offline:{label:'Hors ligne simulé',categories:[category],expenses:[expense(35)],contributions:[contribution(200)],plannedExpenses:[],plannedContributions:[],connected:false},
};
function buildScenario(key){
 const s=SCENARIOS[key]||SCENARIOS.normal;
 const summary=model.summarizeCategories(s.categories,members.length,s.expenses,s.contributions,[],[]);
 const totals=model.summarizeTotals(summary),plannedTotals=model.summarizePlanned(s.plannedExpenses,s.plannedContributions);
 const personState=members.map(member=>{const expected=s.categories.reduce((n,c)=>n+c.monthlyPerPerson,0),paid=s.contributions.filter(c=>c.memberId===member.id).reduce((n,c)=>n+c.amount,0),personallyPaidExpenses=s.expenses.filter(e=>e.paidByMemberId===member.id).reduce((n,e)=>n+e.amount,0);return {member,expected,paid,missing:expected-paid,personallyPaidExpenses};});
 return {summary,totals,plannedTotals,forecastCashBalance:model.forecastBalance(totals,plannedTotals),recent:model.recentOperations(s.expenses,s.contributions,s.categories,members),personState,connected:s.connected,syncMessage:'Synchronisation simulée',selectedMonth:'2026-11'};
}
const format=model.formatEuro;
module.exports={SCENARIOS,buildScenario,format};
