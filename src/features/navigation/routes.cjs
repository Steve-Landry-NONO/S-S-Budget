const TABS = Object.freeze([
  { key: 'dashboard', label: 'Accueil' },
  { key: 'categories', label: 'Enveloppes' },
  { key: 'activity', label: 'Activité' },
  { key: 'members', label: 'Mon duo' },
]);
const ACTIONS = Object.freeze([
  { key: 'expenses', label: 'Dépense' },
  { key: 'contributions', label: 'Versement' },
]);
function parentRoute(route) {
  return ACTIONS.some(action => action.key === route) ? 'dashboard' : route;
}
function actionsFor(route) {
  if (route === 'dashboard') return ACTIONS;
  if (parentRoute(route) === 'dashboard') return [{key: 'dashboard', label: 'Retour à l’accueil'}, ...ACTIONS.filter(action => action.key !== route)];
  return [];
}
module.exports = { TABS, ACTIONS, parentRoute, actionsFor };
