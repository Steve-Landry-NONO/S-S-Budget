const SCENARIOS = Object.freeze({
 normal: {label:'Budget normal',balance:124860,planned:-18000,envelopes:[['Courses',24000],['Week-end',18000],['Épargne voyage',45000]],activity:[['Courses',-5200],['Versement partenaire A',30000]]},
 negative: {label:'Solde négatif',balance:-12500,planned:-5000,envelopes:[['Courses',-2500],['Week-end',0]],activity:[['Courses',-12500]]},
 empty: {label:'Compte vide',balance:0,planned:0,envelopes:[],activity:[]},
 future: {label:'Opérations futures',balance:60000,planned:-22000,envelopes:[['Courses',20000],['Week-end',10000]],activity:[['Dépense prévue',-22000]]},
});
const format = cents => (cents/100).toLocaleString('fr-FR',{style:'currency',currency:'EUR'});
const getScenario = key => SCENARIOS[key] || SCENARIOS.normal;
const forecast = scenario => scenario.balance + scenario.planned;
module.exports={SCENARIOS,format,getScenario,forecast};
