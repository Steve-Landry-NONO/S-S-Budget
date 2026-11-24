// FROZEN ORACLE — do not "fix" or refactor.
// Line-for-line transcription of the V2 inline aggregation of App.js as it stood
// at 2a4053b^ (before "extract V2 financial aggregation"), with the useMemo
// wrappers removed and the closure variables turned into parameters.
// Used only by scripts/finance.test.cjs to prove dashboardModel parity with V2.
function v2Aggregate({ categories, members, monthExpenses, monthContributions, previousExpenses, previousContributions, plannedMonthExpenses, plannedMonthContributions }) {
  const summary = categories.map((category) => {
    const spent = monthExpenses.filter((e) => e.categoryId === category.id).reduce((sum, e) => sum + Number(e.amount || 0), 0);
    const paidIn = monthContributions.filter((c) => c.categoryId === category.id).reduce((sum, c) => sum + Number(c.amount || 0), 0);
    const previousSpent = previousExpenses.filter((e) => e.categoryId === category.id).reduce((sum, e) => sum + Number(e.amount || 0), 0);
    const previousPaidIn = previousContributions.filter((c) => c.categoryId === category.id).reduce((sum, c) => sum + Number(c.amount || 0), 0);
    const monthlyBudget = Number(category.monthlyPerPerson || 0) * members.length;
    const carryOver = previousPaidIn - previousSpent;
    const availableBudget = carryOver + monthlyBudget;
    const remainingBudget = availableBudget - spent;
    const cashBalance = carryOver + paidIn - spent;
    return {
      ...category,
      spent,
      paidIn,
      previousSpent,
      previousPaidIn,
      carryOver,
      monthlyBudget,
      availableBudget,
      remainingBudget,
      cashBalance,
      overBudget: spent > availableBudget,
      needsFunding: cashBalance < 0,
    };
  });

  const totals = summary.reduce((acc, c) => ({
    monthlyBudget: acc.monthlyBudget + c.monthlyBudget,
    availableBudget: acc.availableBudget + c.availableBudget,
    carryOver: acc.carryOver + c.carryOver,
    spent: acc.spent + c.spent,
    paidIn: acc.paidIn + c.paidIn,
    cashBalance: acc.cashBalance + c.cashBalance,
  }), { monthlyBudget: 0, availableBudget: 0, carryOver: 0, spent: 0, paidIn: 0, cashBalance: 0 });

  const plannedTotals = {
    spent: plannedMonthExpenses.reduce((sum, e) => sum + Number(e.amount || 0), 0),
    paidIn: plannedMonthContributions.reduce((sum, c) => sum + Number(c.amount || 0), 0),
  };

  const forecastCashBalance = totals.cashBalance + plannedTotals.paidIn - plannedTotals.spent;
  return { summary, totals, plannedTotals, forecastCashBalance };
}

module.exports = { v2Aggregate };
