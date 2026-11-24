// V2-compatible pure aggregation. Inputs are the existing classified V2 rows.
// Do not change date/status rules, category inclusion, or rounding in this slice.
function summarizeCategories(categories, memberCount, monthExpenses, monthContributions, previousExpenses, previousContributions) {
  const sum = (rows,id) => rows.filter(row=>row.categoryId===id).reduce((n,row)=>n+Number(row.amount||0),0);
  return categories.map(category=>{
    const spent=sum(monthExpenses,category.id), paidIn=sum(monthContributions,category.id);
    const previousSpent=sum(previousExpenses,category.id), previousPaidIn=sum(previousContributions,category.id);
    const monthlyBudget=Number(category.monthlyPerPerson||0)*memberCount;
    const carryOver=previousPaidIn-previousSpent;
    const availableBudget=carryOver+monthlyBudget;
    const remainingBudget=availableBudget-spent;
    const cashBalance=carryOver+paidIn-spent;
    return {...category,spent,paidIn,previousSpent,previousPaidIn,carryOver,monthlyBudget,availableBudget,remainingBudget,cashBalance,overBudget:spent>availableBudget,needsFunding:cashBalance<0};
  });
}
function summarizeTotals(summary) {
  return summary.reduce((acc,c)=>({
    monthlyBudget:acc.monthlyBudget+c.monthlyBudget,
    availableBudget:acc.availableBudget+c.availableBudget,
    carryOver:acc.carryOver+c.carryOver,
    spent:acc.spent+c.spent,
    paidIn:acc.paidIn+c.paidIn,
    cashBalance:acc.cashBalance+c.cashBalance,
  }),{monthlyBudget:0,availableBudget:0,carryOver:0,spent:0,paidIn:0,cashBalance:0});
}
function summarizePlanned(expenses,contributions) {
  return {spent:expenses.reduce((sum,e)=>sum+Number(e.amount||0),0),paidIn:contributions.reduce((sum,c)=>sum+Number(c.amount||0),0)};
}
function forecastBalance(totals,planned) {return totals.cashBalance+planned.paidIn-planned.spent;}
// Read-only preview of already classified realized operations, scoped by caller to selected month.
function recentOperations(expenses,contributions,categories,members,limit=4) {
  const name=(items,id,fallback)=>items.find(x=>x.id===id)?.name||fallback;
  const rows=[
    ...expenses.map(e=>({key:'expense:'+e.id,date:e.date,label:e.label||'Dépense',category:name(categories,e.categoryId,'Enveloppe inconnue'),amount:-Number(e.amount||0)})),
    ...contributions.map(c=>({key:'contribution:'+c.id,date:c.date,label:'Versement · '+name(members,c.memberId,'Membre'),category:name(categories,c.categoryId,'Enveloppe inconnue'),amount:Number(c.amount||0)})),
  ];
  return rows.sort((a,b)=>String(b.date).localeCompare(String(a.date))||a.key.localeCompare(b.key)).slice(0,limit);
}
// Presentation only: usage is spending / available budget, never cash / target.
function envelopePresentation(category) {
  const available=Number(category.availableBudget);
  const spent=Number(category.spent);
  const usage=Number.isFinite(available)&&available>0&&Number.isFinite(spent)
    ? Math.min(100,Math.max(0,spent/available*100)) : null;
  return {usage, status:category.needsFunding?'À alimenter':category.overBudget?'Dépassement':null};
}
function dashboardNotices({totals,forecast,summary,connected}) {
  const notices=[];
  if(!connected) notices.push({key:'offline',text:'Hors ligne : les données locales peuvent ne pas être à jour.'});
  if(!summary.length) notices.push({key:'empty',text:'Aucune enveloppe configurée. Commencez par créer une enveloppe.'});
  if(totals.cashBalance<0) notices.push({key:'negative',text:'Le solde réel enregistré est négatif.'});
  if(forecast<0) notices.push({key:'forecast',text:'Le solde prévisionnel est négatif.'});
  return notices;
}
module.exports={summarizeCategories,summarizeTotals,summarizePlanned,forecastBalance,recentOperations,envelopePresentation,dashboardNotices};
