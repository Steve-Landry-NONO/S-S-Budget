import React, { useState } from 'react';
import { View, Text, ScrollView, TouchableOpacity, StyleSheet, useWindowDimensions } from 'react-native';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import DuoGlanceScreen from '../glance/DuoGlanceScreen';
import { BottomNavigation, NavigationActions } from '../navigation/DuoNavigation';
import { palette, spacing, radius } from '../../theme/tokens';

const FIXTURE = Object.freeze({
  balance: '1 248,60 €', forecast: '1 068,60 €',
  envelopes: [{ name: 'Courses', value: '240 €' }, { name: 'Week-end', value: '180 €' }, { name: 'Épargne voyage', value: '450 €' }],
  activity: [{ name: 'Courses', value: '− 52 €' }, { name: 'Versement partenaire A', value: '+ 300 €' }],
});
const widths = [360, 390, 430, 0];
function Card({ title, value }) {
  return <View style={styles.card}><Text style={styles.label}>{title}</Text><Text style={styles.value}>{value}</Text></View>;
}
export default function WebPreview() {
  const { width } = useWindowDimensions();
  const [size, setSize] = useState(390);
  const [route, setRoute] = useState('glance');
  const navigate = setRoute;
  const viewport = size ? Math.min(size, width) : width;
  return <SafeAreaProvider><View style={styles.root}>
    <View style={styles.toolbar}>
      <Text style={styles.notice}>DUO BUDGET · APERÇU UI · DONNÉES FICTIVES</Text>
      <View style={styles.choices}>
        {widths.map(w => <TouchableOpacity key={w} accessibilityRole="button" accessibilityState={{selected:size===w}} onPress={()=>setSize(w)} style={[styles.choice,size===w&&styles.selected]}><Text style={styles.label}>{w ? w+' px' : 'Plein écran'}</Text></TouchableOpacity>)}
        <TouchableOpacity accessibilityRole="button" onPress={()=>navigate('glance')} style={styles.choice}><Text style={styles.label}>Duo Glance</Text></TouchableOpacity>
      </View>
      <Text style={styles.caption}>Aperçu des parcours : aucun compte, aucune écriture, aucune connexion serveur.</Text>
    </View>
    <View style={[styles.device,{width:viewport}]}>
      {route==='glance' ? <DuoGlanceScreen onSignIn={()=>navigate('dashboard')} onCreateAccount={()=>navigate('dashboard')} /> : <>
        <View style={styles.header}><Text style={styles.heading}>Duo Budget</Text><Text style={styles.caption}>Démonstration · novembre 2026</Text></View>
        <NavigationActions route={route} onNavigate={navigate}/>
        <ScrollView style={styles.scroll} contentContainerStyle={styles.content}>
          {route==='dashboard' && <><View style={styles.hero}><Text style={styles.heroLabel}>Solde réel fictif</Text><Text style={styles.heroValue}>{FIXTURE.balance}</Text><Text style={styles.heroLabel}>Prévisionnel : {FIXTURE.forecast}</Text></View><Text style={styles.heading}>Vos enveloppes</Text>{FIXTURE.envelopes.map(e=><Card key={e.name} title={e.name} value={e.value}/>)}</>}
          {route==='categories' && <><Text style={styles.heading}>Enveloppes</Text>{FIXTURE.envelopes.map(e=><Card key={e.name} title={e.name} value={e.value}/>)}</>}
          {route==='activity' && <><Text style={styles.heading}>Activité</Text>{FIXTURE.activity.map(e=><Card key={e.name} title={e.name} value={e.value}/>)}</>}
          {route==='members' && <><Text style={styles.heading}>Mon duo</Text><Card title="Partenaire A" value="Membre de démonstration"/><Card title="Partenaire B" value="Membre de démonstration"/></>}
          {route==='expenses' && <><Text style={styles.heading}>Dépense</Text><Card title="Exemple de libellé" value="Courses"/><Card title="Montant fictif" value="52 €"/><Text style={styles.caption}>Écran illustratif : aucune opération enregistrée.</Text></>}
          {route==='contributions' && <><Text style={styles.heading}>Versement</Text><Card title="Exemple de versement" value="300 €"/><Text style={styles.caption}>Écran illustratif : aucune opération enregistrée.</Text></>}
        </ScrollView>
        <BottomNavigation route={route} onNavigate={navigate} unreadCount={1}/>
      </>}
    </View>
  </View></SafeAreaProvider>;
}
const styles=StyleSheet.create({
 root:{flex:1,backgroundColor:palette.border,alignItems:'center'}, toolbar:{width:'100%',padding:spacing.xs,alignItems:'center',gap:spacing.xxs,backgroundColor:palette.surface},
 notice:{fontSize:12,fontWeight:'700',color:palette.midnight,textAlign:'center'},choices:{flexDirection:'row',flexWrap:'wrap',justifyContent:'center',gap:spacing.xxs},choice:{padding:spacing.xs,borderRadius:radius.sm,backgroundColor:palette.background},selected:{backgroundColor:palette.lightBlue},
 caption:{fontSize:12,color:palette.muted,textAlign:'center'},device:{flex:1,backgroundColor:palette.background,overflow:'hidden'},header:{padding:spacing.md,backgroundColor:palette.surface},heading:{fontSize:20,fontWeight:'700',color:palette.midnight},scroll:{flex:1},content:{padding:spacing.md,gap:spacing.sm},card:{padding:spacing.md,backgroundColor:palette.surface,borderRadius:radius.lg,borderWidth:1,borderColor:palette.border,gap:spacing.xxs},label:{color:palette.muted,fontSize:13},value:{color:palette.midnight,fontSize:18,fontWeight:'700'},hero:{padding:spacing.lg,backgroundColor:palette.midnight,borderRadius:radius.lg,gap:spacing.xs},heroLabel:{color:palette.surface,fontSize:13},heroValue:{color:palette.surface,fontSize:32,fontWeight:'700'}
});
