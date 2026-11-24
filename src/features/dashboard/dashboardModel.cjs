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
module.exports={summarizeCategories,summarizeTotals,summarizePlanned,forecastBalance};
