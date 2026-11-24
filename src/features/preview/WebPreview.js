import React,{useState} from 'react';
import {View,Text,ScrollView,TouchableOpacity,StyleSheet,useWindowDimensions,Image} from 'react-native';
import {SafeAreaProvider} from 'react-native-safe-area-context';
import DashboardOverview from '../dashboard/DashboardOverview';
import DuoGlanceScreen from '../glance/DuoGlanceScreen';
import {BottomNavigation,NavigationActions} from '../navigation/DuoNavigation';
import {palette,spacing,radius} from '../../theme/tokens';
import fixtures from './fixtures.cjs';
const {SCENARIOS,buildScenario,format}=fixtures;
export default function WebPreview(){
 const {width}=useWindowDimensions();
 const [size,setSize]=useState(390),[route,setRoute]=useState('dashboard'),[scenario,setScenario]=useState('normal'),[large,setLarge]=useState(false);
 const viewport=Math.min(size||width,width),data=buildScenario(scenario);
 const choice=(key,label,selected,onPress)=><TouchableOpacity key={key} accessibilityRole="button" accessibilityState={{selected}} onPress={onPress} style={[styles.choice,selected&&styles.selected]}><Text style={styles.text}>{label}</Text></TouchableOpacity>;
 return <SafeAreaProvider><View style={styles.root}>
  <View style={styles.toolbar}>
   <Text style={styles.title}>DUO BUDGET · QA LAB · DONNÉES FICTIVES</Text>
   <Text style={styles.text}>Aucun compte, aucune écriture, aucune connexion serveur.</Text>
   <View style={styles.row}>{[360,390,430,0].map(w=>choice(w,w?w+' px':'Plein écran',size===w,()=>setSize(w)))}</View>
   <View style={styles.row}>{Object.entries(SCENARIOS).map(([k,s])=>choice(k,s.label,scenario===k,()=>{setScenario(k);setRoute('dashboard');}))}</View>
   <View style={styles.row}>{choice('large','Disposition grande police',large,()=>setLarge(v=>!v))}{choice('glance','Glance',route==='glance',()=>setRoute('glance'))}{choice('home','Accueil',route==='dashboard',()=>setRoute('dashboard'))}</View>
   <Text style={styles.text}>Largeur : {Math.round(viewport)} px · simulation de disposition, pas de taille de police système</Text>
  </View>
  <View style={[styles.device,{width:viewport}]}>
   {route==='glance'?<DuoGlanceScreen previewWidth={viewport} previewMode onSignIn={()=>setRoute('dashboard')} onCreateAccount={()=>setRoute('dashboard')}/>:<>
    <ScrollView style={styles.scroll} contentContainerStyle={styles.content}>
     <View style={styles.row}><Image source={require('../../../assets/duo-mark-blue.png')} style={{width:32,height:32}} accessible={false}/><Text style={styles.title}>Duo Budget</Text></View>
     <Text style={styles.text}>Novembre 2026 · Démonstration</Text>
     {route==='dashboard'?<DashboardOverview {...data} formatEuro={format} onNavigate={setRoute} previewWidth={viewport} previewFontScale={large?1.5:1} disableMotion/>:<>
      <Text style={styles.title}>{({categories:'Enveloppes',activity:'Activité',members:'Mon duo',expenses:'Dépense',contributions:'Versement'})[route]}</Text>
      <Text style={styles.text}>Destination illustrative, aucune opération enregistrée.</Text>
      {route==='categories'&&data.summary.map(c=><Text key={c.id} style={styles.text}>{c.name} · {format(c.cashBalance)}</Text>)}
      {route==='activity'&&data.recent.map(r=><Text key={r.key} style={styles.text}>{r.label} · {format(r.amount)}</Text>)}
      {route==='members'&&data.personState.map(p=><Text key={p.member.id} style={styles.text}>{p.member.name} · {format(p.paid)}</Text>)}
      <NavigationActions route={route} onNavigate={setRoute}/>
     </>}
    </ScrollView>
    <BottomNavigation route={route} onNavigate={setRoute} previewWidth={viewport} previewFontScale={large?1.5:1}/>
   </>}
  </View>
 </View></SafeAreaProvider>;
}
const styles=StyleSheet.create({root:{flex:1,alignItems:'center',backgroundColor:palette.border},toolbar:{width:'100%',alignItems:'center',padding:spacing.xs,gap:spacing.xxs,backgroundColor:palette.surface},row:{flexDirection:'row',flexWrap:'wrap',alignItems:'center',justifyContent:'center',gap:spacing.xxs},choice:{padding:spacing.xs,borderRadius:radius.sm,backgroundColor:palette.background},selected:{backgroundColor:palette.lightBlue},title:{fontSize:16,fontWeight:'700',color:palette.midnight},text:{fontSize:13,color:palette.muted},device:{flex:1,backgroundColor:palette.background,overflow:'hidden'},scroll:{flex:1},content:{padding:spacing.md,gap:spacing.sm}});
