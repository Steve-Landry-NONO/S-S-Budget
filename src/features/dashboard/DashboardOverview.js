import React from 'react';
import {StyleSheet,Text,View,TouchableOpacity,useWindowDimensions} from 'react-native';
import {palette,spacing,radius} from '../../theme/tokens';

export default function DashboardOverview({totals,plannedTotals,forecastCashBalance,connected,syncMessage,selectedMonth,formatEuro,summary,onNavigate}) {
  const {fontScale,width}=useWindowDimensions();
  const stacked=fontScale>=1.3||width<340;
  const metrics=[['Report précédent',totals.carryOver],['Budget objectif',totals.monthlyBudget],['Versements réalisés',totals.paidIn],['Dépenses réalisées',totals.spent]];
  return <View style={styles.root}>
    
    <Text style={styles.meta}>{connected ? syncMessage : 'Hors ligne · données locales'}</Text>
    <View style={styles.hero}>
      <Text style={styles.heroLabel}>Solde réel enregistré</Text>
      <Text style={[styles.real,totals.cashBalance<0&&styles.negative]}>{formatEuro(totals.cashBalance)}</Text>
      <View style={styles.divider}/>
      <Text style={styles.heroLabel}>Solde prévisionnel</Text>
      <Text style={[styles.forecast,forecastCashBalance<0&&styles.negative]}>{formatEuro(forecastCashBalance)}</Text>
      <Text style={styles.heroNote}>Opérations prévues : {formatEuro(plannedTotals.paidIn-plannedTotals.spent)}</Text>
    </View>
    <Text style={styles.heading}>Bilan mensuel</Text>
    <View style={styles.grid}>{metrics.map(([label,value])=><View key={label} style={[styles.metric,stacked&&styles.full]}><Text style={styles.meta}>{label}</Text><Text style={styles.value}>{formatEuro(value)}</Text></View>)}</View>
    <Text style={styles.heading}>Actions rapides</Text>
    <View style={styles.grid}>{[['expenses','Dépenser','↗'],['contributions','Verser','↙']].map(([route,label,icon])=><TouchableOpacity key={route} accessibilityRole="button" onPress={()=>onNavigate(route)} style={[styles.metric,styles.action,stacked&&styles.full]}><Text style={styles.actionIcon}>{icon}</Text><Text style={styles.actionLabel}>{label}</Text></TouchableOpacity>)}</View>
    <View style={styles.grid}><Text style={styles.heading}>Enveloppes</Text><TouchableOpacity accessibilityRole="button" onPress={()=>onNavigate('categories')} style={styles.link}><Text style={styles.actionLabel}>Tout voir ›</Text></TouchableOpacity></View>
    {summary.length ? <View style={styles.grid}>{summary.slice(0,3).map(c=><View key={c.id} style={[styles.metric,stacked&&styles.full]}><Text style={styles.meta}>{c.name}</Text><Text style={styles.value}>{formatEuro(c.cashBalance)}</Text><Text style={styles.meta}>Solde réel</Text></View>)}</View> : <Text style={styles.meta}>Aucune enveloppe configurée.</Text>}
  </View>;
}
const styles=StyleSheet.create({
 action:{alignItems:'center',minHeight:64,backgroundColor:palette.lightBlue},actionIcon:{fontSize:22,color:'#304DB2'},actionLabel:{fontSize:14,fontWeight:'600',color:'#304DB2',textAlign:'center'},link:{minHeight:44,justifyContent:'center',marginLeft:'auto'}, root:{gap:spacing.sm,marginBottom:spacing.md},heading:{fontSize:20,fontWeight:'700',color:palette.midnight},meta:{fontSize:13,color:palette.muted},hero:{backgroundColor:palette.midnight,borderRadius:radius.xl,padding:spacing.lg,gap:spacing.xs},heroLabel:{color:'#D0DAE7',fontSize:15},real:{color:'#FFFFFF',fontSize:34,fontWeight:'700'},forecast:{color:'#FFFFFF',fontSize:24,fontWeight:'700'},negative:{color:'#FFB4BC'},divider:{height:1,backgroundColor:'#3B4F68',marginVertical:spacing.xs},heroNote:{color:'#F1BC6C',fontSize:13},grid:{flexDirection:'row',flexWrap:'wrap',gap:spacing.xs},metric:{flexGrow:1,flexBasis:'46%',minWidth:0,backgroundColor:palette.surface,borderRadius:radius.lg,borderWidth:1,borderColor:palette.border,padding:spacing.sm,gap:spacing.xs},full:{flexBasis:'100%'},value:{color:palette.midnight,fontSize:20,fontWeight:'700'}
});
