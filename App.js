import React, { useEffect, useMemo, useRef, useState } from 'react';
import {
  Alert,
  AppState,
  Platform,
  Image,
  Modal,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  View,
  useWindowDimensions,
} from 'react-native';
import { SafeAreaProvider, SafeAreaView } from 'react-native-safe-area-context';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { StatusBar } from 'expo-status-bar';
import DuoGlanceScreen from './src/features/glance/DuoGlanceScreen';
import { BottomNavigation, NavigationActions } from './src/features/navigation/DuoNavigation';
import { palette } from './src/theme/tokens';
import dashboardModel from './src/features/dashboard/dashboardModel.cjs';
import DashboardOverview from './src/features/dashboard/DashboardOverview';
import WebPreview from './src/features/preview/WebPreview';

const CACHE_KEY = 'SS_BUDGET_V2_CACHE';
const API_KEY = 'SS_BUDGET_V2_API_URL';
const SECRET_KEY = 'SS_BUDGET_V2_API_SECRET';
const USER_KEY = 'SS_BUDGET_V2_CURRENT_USER_ID';
const AUTH_TOKEN_KEY = 'SS_BUDGET_V2_AUTH_TOKEN';
const AUTH_EXPIRES_KEY = 'SS_BUDGET_V2_AUTH_EXPIRES_AT';
const AUTH_SESSION_KEY = 'SS_BUDGET_V2_AUTH_SESSION_V2';
const PENDING_MUTATION_PREFIX = 'SS_BUDGET_V2_PENDING_MUTATION:';
const DELETE_WINDOW_DAYS = 5;
const defaultStartMonth = '2026-07';

const todayKey = () => new Date().toISOString().slice(0, 10);
const currentMonthKey = () => todayKey().slice(0, 7);
const isValidPinFormat = (pin) => /^\d{4,8}$/.test(String(pin || ''));

const uid = (prefix = 'id') => `${prefix}_${Math.random().toString(36).slice(2)}_${Date.now().toString(36)}`;
// F-01: shared presentation (same cent rounding as before, never "-0,00 €").
const formatEuro = (value) => dashboardModel.formatEuro(value);
const parseAmount = (value) => Number(String(value || '').replace(',', '.'));
const monthDefaultDate = (month) => {
  const normalized = /^\d{4}-\d{2}$/.test(String(month || '')) ? month : currentMonthKey();

  // Si le mois affiché est le mois courant, on propose la date du jour.
  // Sinon, on propose le premier jour du mois consulté.
  return normalized === currentMonthKey() ? todayKey() : `${normalized}-01`;
};
const firstId = (items) => (items && items.length ? items[0].id : '');
const pad2 = (value) => String(value).padStart(2, '0');
const normalizeMonth = (value) => {
  const cleaned = String(value || '').trim().replace('/', '-');
  const match = cleaned.match(/^(\d{4})-(\d{1,2})$/);
  if (!match) return null;
  const year = Number(match[1]);
  const month = Number(match[2]);
  if (!Number.isInteger(year) || !Number.isInteger(month) || month < 1 || month > 12) return null;
  return `${year}-${pad2(month)}`;
};
const addMonths = (monthKey, delta) => {
  const normalized = normalizeMonth(monthKey) || defaultStartMonth;
  const [year, month] = normalized.split('-').map(Number);
  const index = year * 12 + (month - 1) + delta;
  const nextYear = Math.floor(index / 12);
  const nextMonth = (index % 12) + 1;
  return `${nextYear}-${pad2(nextMonth)}`;
};
const monthToIndex = (monthKey) => {
  const normalized = normalizeMonth(monthKey);
  if (!normalized) return null;
  const [year, month] = normalized.split('-').map(Number);
  return year * 12 + (month - 1);
};

const dateMonthKey = (date) => String(date || '').slice(0, 7);

const isBeforeMonth = (date, monthKey) => {
  const dateIndex = monthToIndex(dateMonthKey(date));
  const selectedIndex = monthToIndex(monthKey);
  if (dateIndex === null || selectedIndex === null) return false;
  return dateIndex < selectedIndex;
};

const isValidDateForMonth = (date, monthKey) => {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(String(date || ''))) return false;

  const [year, month, day] = String(date).split('-').map(Number);
  const normalizedMonth = normalizeMonth(monthKey);
  if (!normalizedMonth || `${year}-${pad2(month)}` !== normalizedMonth) return false;

  const parsed = new Date(year, month - 1, day);
  return parsed.getFullYear() === year && parsed.getMonth() === month - 1 && parsed.getDate() === day;
};

const isFutureDate = (date) => /^\d{4}-\d{2}-\d{2}$/.test(String(date || '')) && String(date) > todayKey();
const normalizeActionStatus = (date, status) => status === 'planned' || status === 'done' ? status : (isFutureDate(date) ? 'planned' : 'done');
const isPlannedAction = (action) => normalizeActionStatus(action?.date, action?.status) === 'planned';
const statusLabel = (action) => isPlannedAction(action) ? 'Prévu' : 'Réalisé';
const statusStyleName = (action) => isPlannedAction(action) ? 'badgePlanned' : 'badgeOk';


const activityActionLabels = {
  expense_created: 'Dépense ajoutée',
  expense_planned: 'Dépense prévue',
  expense_deleted: 'Dépense supprimée',
  expense_updated: 'Dépense modifiée',
  contribution_created: 'Versement ajouté',
  contribution_planned: 'Versement prévu',
  contribution_deleted: 'Versement supprimé',
  contribution_updated: 'Versement modifié',
  auto_contributions_created: 'Versements automatiques',
  auto_contributions_planned: 'Versements automatiques prévus',
  category_created: 'Caisse ajoutée',
  category_updated: 'Caisse modifiée',
  category_archived: 'Caisse archivée',
  category_deleted: 'Caisse supprimée',
  member_created: 'Membre ajouté',
  member_updated: 'Membre modifié',
  member_deleted: 'Membre supprimé',
  backup_created: 'Sauvegarde créée',
  export_json_created: 'Export JSON créé',
  export_csv_created: 'Export CSV créé',
  backup_restored: 'Sauvegarde restaurée',
  server_reset: 'Réinitialisation serveur',
  member_login: 'Connexion',
  pin_created: 'PIN créé',
  pin_updated: 'PIN modifié',
  login_locked: 'Profil verrouillé temporairement',
};
const activityLabel = (action) => activityActionLabels[action] || 'Action';
const formatActivityDate = (value) => {
  if (!value) return '';
  const date = new Date(String(value).replace(' ', 'T'));
  if (Number.isNaN(date.getTime())) return String(value);
  return date.toLocaleString('fr-FR', { day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit' });
};

const isTechnicalLabel = (value) => /^(category|member|expense|contribution|log)_/.test(String(value || ''));
const readableActivityLabel = (log) => {
  const details = log?.details || {};
  if (details.categoryName) return details.categoryName;
  if (details.memberName) return details.memberName;
  if (log?.label && !isTechnicalLabel(log.label)) return log.label;
  return '';
};
const isLogUnread = (log, currentUserId) => !(log?.readByMemberIds || []).includes(currentUserId);


const currentMemberRole = (member) => member?.role || (member?.id === 'steve' ? 'admin' : 'member');
const isAdminMember = (member) => currentMemberRole(member) === 'admin';
const daysSinceCreated = (createdAt) => {
  const created = createdAt ? new Date(String(createdAt).replace(' ', 'T')) : new Date();
  const diff = Date.now() - created.getTime();
  if (!Number.isFinite(diff)) return 0;
  return diff / (1000 * 60 * 60 * 24);
};
const canDeleteRecentAction = (action, currentUserId, currentRole, ownerField) => {
  if (!action) return false;
  const isRecent = daysSinceCreated(action.created_at || action.createdAt) <= DELETE_WINDOW_DAYS;
  if (!isRecent) return false;
  if (currentRole === 'admin') return true;
  return action[ownerField] === currentUserId;
};

const canEditRecentAction = canDeleteRecentAction;


const initialState = {
  members: [
    { id: 'steve', name: 'Steve', role: 'admin' },
    { id: 'sorelle', name: 'Sorelle', role: 'member' },
  ],
  categories: [
    { id: 'weekends', name: 'Weekends', monthlyPerPerson: 40, description: 'Courses, transports, sorties, etc.', locked: false, active: true },
    { id: 'ecole', name: 'Semaines écoles', monthlyPerPerson: 20, description: 'Repas, transports, sorties pendant les semaines école.', locked: false, active: true },
    { id: 'vacances', name: 'Vacances', monthlyPerPerson: 50, description: 'Vacances 1 à 3 fois par an.', locked: false, active: true },
    { id: 'cadeaux', name: 'Cadeaux proches', monthlyPerPerson: 20, description: 'Cadeaux faits aux proches au nom du couple.', locked: false, active: true },
    { id: 'epargne', name: 'Épargne bloquée', monthlyPerPerson: 50, description: 'Réserve mutuelle pour imprévus majeurs.', locked: true, active: true },
  ],
  expenses: [],
  contributions: [],
};

export default function App() {
  if (Platform.OS === 'web' && process.env.EXPO_PUBLIC_DUO_PREVIEW === '1') return <WebPreview />;
  return <AuthenticatedApp />;
}

function AuthenticatedApp() {
  const sessionStorage = require('./src/features/session/sessionBoundary.cjs');
  const mutationStorage = require('./src/features/session/mutationBoundary.cjs');
  const {fontScale, width} = useWindowDimensions();
  const largeText = fontScale >= 1.3 || width < 340;
  const [showGlance, setShowGlance] = useState(true);
  const [apiUrl, setApiUrl] = useState('');
  const [apiSecret, setApiSecret] = useState('');
  const [editingServer, setEditingServer] = useState(false);
  const [currentUserId, setCurrentUserId] = useState('steve');
  const [connected, setConnected] = useState(false);
  const [syncMessage, setSyncMessage] = useState('Non synchronisé');
  const [members, setMembers] = useState(initialState.members);
  const [categories, setCategories] = useState(initialState.categories);
  const [expenses, setExpenses] = useState([]);
  const [contributions, setContributions] = useState([]);
  const [activityLogs, setActivityLogs] = useState([]);
  const [selectedMonth, setSelectedMonth] = useState(currentMonthKey());
  const [monthDraft, setMonthDraft] = useState(currentMonthKey());
  const [monthPickerOpen, setMonthPickerOpen] = useState(false);
  const [tab, setTab] = useState('dashboard');
  const [expenseDraft, setExpenseDraft] = useState({ label: '', amount: '', categoryId: 'weekends', paidByMemberId: 'steve', date: monthDefaultDate(currentMonthKey()) });
  const [contributionDraft, setContributionDraft] = useState({ amount: '', categoryId: 'weekends', memberId: 'steve', date: monthDefaultDate(currentMonthKey()) });
  const [editingExpense, setEditingExpense] = useState(null);
  const [editingContribution, setEditingContribution] = useState(null);
  const [autoDraft, setAutoDraft] = useState({ mode: 'all', memberId: 'steve', monthsCount: '1', date: monthDefaultDate(currentMonthKey()) });
  const [categoryModal, setCategoryModal] = useState(false);
  const [editingCategory, setEditingCategory] = useState(null);
  const [settingsModal, setSettingsModal] = useState(false);
  const [memberDraft, setMemberDraft] = useState('');

  const [bootLoading, setBootLoading] = useState(true);
  const [authToken, setAuthToken] = useState('');
  const [authTokenExpiresAt, setAuthTokenExpiresAt] = useState('');
  const [sessionId,setSessionId]=useState('');
  const [appActive,setAppActive]=useState(Platform.OS==='web'||AppState.currentState==null||AppState.currentState==='active');
  const [authMembers, setAuthMembers] = useState([]);
  const [authLoading, setAuthLoading] = useState(false);
  const [authError, setAuthError] = useState('');
  const [pinStage, setPinStage] = useState(null);
  const [profileModal, setProfileModal] = useState(false);
  const [pinManageModal, setPinManageModal] = useState(false);
  const [pinManageDraft, setPinManageDraft] = useState({ currentPin: '', newPin: '', newPin2: '' });

  const boundaryRef=useRef(null);
  if(!boundaryRef.current) boundaryRef.current=sessionStorage.createSessionBoundary(AsyncStorage,{cache:CACHE_KEY,api:API_KEY,secret:SECRET_KEY,user:USER_KEY,token:AUTH_TOKEN_KEY,expires:AUTH_EXPIRES_KEY,auth:AUTH_SESSION_KEY});
  const boundary=boundaryRef.current;
  const epoch=boundary.current();
  const session={api:apiUrl,secret:apiSecret,user:currentUserId,token:authToken,expires:authTokenExpiresAt,sessionId};
  const journalRef=useRef(null), readFenceRef=useRef(null);
  if(!journalRef.current)journalRef.current=mutationStorage.createMutationJournal(AsyncStorage,PENDING_MUTATION_PREFIX);
  if(!readFenceRef.current)readFenceRef.current=mutationStorage.createReadFence();
  const journal=journalRef.current,readFence=readFenceRef.current;
  const mutationRef=useRef({kind:'checking',marker:null});
  const [mutationState,setMutationState]=useState(mutationRef.current);
  const setMutation=(kind,marker=null)=>{const next={kind,marker};mutationRef.current=next;setMutationState(next);};
  const currentSession=()=>boundary.isCurrent(epoch)&&sessionStorage.valid(session);
  const isSessionValid=()=>sessionStorage.valid(session);
  const [dataReady,setDataReady]=useState(false);
  const [storageError,setStorageError]=useState(false);
  const reportStorageError=()=>setStorageError(true);
  const resetSession=()=>{
    const purge=boundary.purge();
    readFence.invalidate();setMutation('checking');
    setAuthToken('');setAuthTokenExpiresAt('');setSessionId('');setCurrentUserId('');
    setMembers([]);setCategories([]);setExpenses([]);setContributions([]);setActivityLogs([]);
    setDataReady(false);setConnected(false);setSyncMessage('Session fermée');
    setSelectedMonth(currentMonthKey());setMonthDraft(currentMonthKey());setMonthPickerOpen(false);setTab('dashboard');
    setExpenseDraft({label:'',amount:'',categoryId:'',paidByMemberId:'',date:monthDefaultDate(currentMonthKey())});
    setContributionDraft({amount:'',categoryId:'',memberId:'',date:monthDefaultDate(currentMonthKey())});
    setAutoDraft({mode:'all',memberId:'',monthsCount:'1',date:monthDefaultDate(currentMonthKey())});
    setEditingExpense(null);setEditingContribution(null);setEditingCategory(null);setCategoryModal(false);
    setSettingsModal(false);setProfileModal(false);setPinManageModal(false);setMemberDraft('');
    setPinManageDraft({currentPin:'',newPin:'',newPin2:''});setPinStage(null);setAuthMembers([]);setAuthError('');setAuthLoading(false);
    purge.catch(reportStorageError);
    return purge;
  };
  const changeServer=(value,secret=false)=>{
    resetSession();setEditingServer(true);setShowGlance(false);
    if(secret)setApiSecret(value);else setApiUrl(value);
  };
  const stale=()=>Object.assign(new Error('Session changée'),{code:'STALE_SESSION'});
  const staleError=error=>error?.code==='STALE_SESSION'||!boundary.isCurrent(epoch);
  useEffect(()=>{
    if(!authToken)return;
    const expire=()=>{if(boundary.isCurrent(epoch)&&!isSessionValid())resetSession();};
    expire();const timer=setInterval(expire,1000);
    const sub=AppState.addEventListener('change',state=>{if(state==='active')expire();});
    return()=>{clearInterval(timer);sub.remove();};
  },[authToken,authTokenExpiresAt,currentUserId,epoch]);

  useEffect(() => { loadLocal(); }, []);
  useEffect(()=>{
    const sub=AppState.addEventListener('change',state=>setAppActive(Platform.OS==='web'||state==='active'));
    return()=>sub.remove();
  },[]);
  useEffect(()=>{
    if(bootLoading||!currentSession())return;
    let cancelled=false;
    journal.read(session).then(marker=>{if(!cancelled&&currentSession())setMutation(marker?'unknown':'idle',marker);}).catch(()=>{if(!cancelled&&currentSession())setMutation('storage-error');});
    return()=>{cancelled=true;};
  },[bootLoading,epoch,sessionId]);

  useEffect(() => {
    if (bootLoading) return;
    saveLocal();
    if (!firstId(members) || !firstId(categories)) return;
    setExpenseDraft((d) => ({ ...d, paidByMemberId: members.find((m) => m.id === d.paidByMemberId)?.id || firstId(members), categoryId: categories.find((c) => c.id === d.categoryId)?.id || firstId(categories) }));
    setContributionDraft((d) => ({ ...d, memberId: members.find((m) => m.id === d.memberId)?.id || firstId(members), categoryId: categories.find((c) => c.id === d.categoryId)?.id || firstId(categories) }));
    setAutoDraft((d) => ({ ...d, memberId: members.find((m) => m.id === d.memberId)?.id || firstId(members) }));
  }, [members, categories, expenses, contributions, activityLogs, selectedMonth, apiUrl, apiSecret, currentUserId, authToken, authTokenExpiresAt, sessionId, bootLoading, dataReady, epoch]);

  useEffect(() => {
    setMonthDraft(selectedMonth);
    const date = monthDefaultDate(selectedMonth);
    setExpenseDraft((d) => ({ ...d, date }));
    setContributionDraft((d) => ({ ...d, date }));
    setAutoDraft((d) => ({ ...d, date }));
  }, [selectedMonth]);

  useEffect(() => {
    if (bootLoading || !apiUrl || !isSessionValid() || mutationState.kind!=='idle' || !appActive) return;
    syncFromServer(false);
    const timer = setInterval(() => { if (isSessionValid()) syncFromServer(false); }, 15000);
    return () => clearInterval(timer);
  }, [apiUrl, apiSecret, currentUserId, authToken, authTokenExpiresAt, sessionId, bootLoading, epoch, mutationState.kind, appActive]);

  useEffect(() => {
    if (!bootLoading && apiUrl && !editingServer && !isSessionValid()) fetchAuthStatus();
  }, [apiUrl, apiSecret, authToken, authTokenExpiresAt, editingServer, bootLoading, epoch]);

  const request = async (path, options = {}) => {
    if (!boundary.isCurrent(epoch)) throw stale();
    if (boundary.requestStatus(epoch,session)==='expired') { resetSession(); throw stale(); }
    if (!apiUrl.trim()) throw new Error('Aucune URL serveur configurée.');
    const url = `${apiUrl.replace(/\/$/, '')}${path}`;
    const controller=new AbortController();
    // Timeout is a transport failure, never proof that a write was rejected.
    const timer=setTimeout(()=>controller.abort(),20000);
    try {
      const response = await fetch(url, {
        ...options,
        signal:controller.signal,
        headers: {
          'Content-Type': 'application/json',
          ...(apiSecret ? { 'x-ss-budget-secret': apiSecret } : {}),
          ...(currentUserId ? { 'x-ss-budget-user-id': currentUserId } : {}),
          ...(authToken ? { 'x-ss-budget-auth-token': authToken } : {}),
          ...(options.headers || {}),
        },
      });
      const data = await response.json().catch(() => null);
      if (!boundary.isCurrent(epoch)) throw stale();
      if (boundary.requestStatus(epoch,session)==='expired') { resetSession(); throw stale(); }
      if (!response.ok) {
        const error = mutationStorage.httpError(response.status,data);
        if (response.status === 401 && data?.code === 'AUTH_REQUIRED') {
          resetSession();
          setSyncMessage('Session expirée');
        }
        throw error;
      }
      if(!data||typeof data!=='object'||Array.isArray(data))throw new Error('Réponse serveur invalide');
      return data;
    } finally {clearTimeout(timer);}
  };

  const applyServerState = (data) => {
    if (!currentSession() || !sessionStorage.isSnapshot(data)) return;
    setDataReady(true);
    setMembers((data.members || []).map((m) => ({ ...m, role: currentMemberRole(m) })));
    setCategories((data.categories || []).map((c) => ({ ...c, locked: Boolean(c.locked), active: c.active !== false })));
    setExpenses(data.expenses || []);
    setContributions(data.contributions || []);
    setActivityLogs(data.activityLogs || []);
    setConnected(true);
    setSyncMessage(`Synchronisé ${new Date().toLocaleTimeString('fr-FR').slice(0, 5)}`);
  };

  const syncFromServer = async (showAlert = true, reconcile = false) => {
    if(!currentSession())return false;
    const kind=mutationRef.current.kind;
    if(kind!=='idle'&&!(reconcile&&(kind==='unknown'||kind==='review'))){
      if(showAlert)Alert.alert('Synchronisation suspendue','Utilise la vérification de l’opération en attente.');
      return false;
    }
    if(reconcile&&kind==='review')setMutation('unknown',mutationRef.current.marker);
    const readId=readFence.start();
    try {
      const data = await request('/api/state');
      if(!currentSession()||!readFence.isCurrent(readId))return false;
      if(!sessionStorage.isSnapshot(data))throw new Error('Instantané serveur invalide');
      applyServerState(data);
      if(reconcile){
        setMutation('review',mutationRef.current.marker);
        Alert.alert('Instantané serveur chargé','Vérifie les opérations et le journal. Si l’écriture est absente ou ambiguë, demande au responsable du serveur de confirmer sa fin. Un instantané seul ne prouve pas un refus.');
      }else if(showAlert)Alert.alert('Synchronisation réussie','Les données du serveur ont été chargées.');
      return true;
    } catch (error) {
      if(staleError(error)||!readFence.isCurrent(readId))return false;
      setConnected(false);
      setSyncMessage('Synchronisation indisponible — dernier état confirmé');
      if(showAlert)Alert.alert('Synchronisation impossible','Aucune donnée locale n’a été modifiée.');
      return false;
    }
  };

  const mutate = async (path, method, body, onConfirmed) => {
    if(!currentSession())return;
    if(mutationRef.current.kind!=='idle'){
      Alert.alert('Action suspendue','Une vérification ou une opération est en cours. Ne renvoie pas cette action.');
      return;
    }
    readFence.invalidate();setMutation('pending');
    const result=await mutationStorage.executeMutation({
      journal,session,id:sessionStorage.newSessionId(),current:currentSession,
      send:()=>request(path,{method,body:JSON.stringify(body||{})}),apply:applyServerState
    });
    if(!currentSession()||result.kind==='stale')return;
    if(result.kind==='confirmed')onConfirmed?.();
    if(result.kind==='storage-error'){
      setMutation('storage-error');setConnected(false);
      Alert.alert('Stockage indisponible','Aucune nouvelle action n’a été envoyée. Vérification du stockage requise.');
      return;
    }
    if(result.marker||result.kind==='unknown'||result.kind==='blocked'){
      setMutation('unknown',result.marker);setConnected(false);
      setSyncMessage('Opération à vérifier — dernier état confirmé');
      Alert.alert('Opération à vérifier','Ne renvoie pas l’action. Ferme le formulaire si nécessaire, puis vérifie l’état du serveur et le journal.');
      return;
    }
    setMutation('idle');
    if(result.kind==='refused')Alert.alert('Action refusée',result.error.message);
  };

  const acknowledgeMutation=()=>{
    if(!currentSession()||mutationRef.current.kind!=='review')return;
    const marker=mutationRef.current.marker;
    Alert.alert('Vérification manuelle','As-tu établi le résultat de l’opération, au besoin avec le responsable du serveur ? Si le résultat reste incertain, ne débloque pas. Les brouillons d’opération seront réinitialisés.',[
      {text:'Annuler',style:'cancel'},
      {text:'Vérification effectuée',onPress:async()=>{
        if(!currentSession()||mutationRef.current.kind!=='review'||mutationRef.current.marker?.id!==marker?.id)return;
        readFence.invalidate();setMutation('pending',marker);
        try{
          if(!marker||!await journal.clear(session,marker.id,currentSession)){if(currentSession())setMutation('unknown',marker);return;}
          if(currentSession()){
            setExpenseDraft(d=>({...d,label:'',amount:''}));setContributionDraft(d=>({...d,amount:''}));
            setEditingExpense(null);setEditingContribution(null);setCategoryModal(false);setEditingCategory(null);setMemberDraft('');
            setMutation('idle');
          }
        }catch{if(currentSession())setMutation('storage-error',marker);}
      }}
    ]);
  };

  const renderMutationNotice=()=>{
    const kind=mutationState.kind;
    if(kind==='idle')return null;
    return <View style={styles.card}>
      <Text accessibilityRole="header" style={styles.cardTitle}>{kind==='pending'?'Opération en cours':kind==='checking'?'Vérification de la session':kind==='storage-error'?'Vérification indisponible':'Opération à vérifier'}</Text>
      <Text accessibilityLiveRegion="polite" style={styles.muted}>{kind==='pending'||kind==='checking'?'Patiente avant toute nouvelle action.':'Les nouvelles opérations sont suspendues. Aucun renvoi automatique. Les soldes affichés proviennent du dernier instantané confirmé.'}</Text>
      {mutationState.marker&&<Text style={styles.muted}>Tentative : {new Date(mutationState.marker.at).toLocaleString('fr-FR')}</Text>}
      {(kind==='unknown'||kind==='review')&&<TouchableOpacity accessibilityRole="button" style={styles.secondaryButton} onPress={()=>syncFromServer(true,true)}><Text style={styles.secondaryButtonText}>Actualiser et vérifier le serveur</Text></TouchableOpacity>}
      {kind==='review'&&<TouchableOpacity accessibilityRole="button" style={styles.secondaryButton} onPress={acknowledgeMutation}><Text style={styles.secondaryButtonText}>J’ai vérifié — débloquer</Text></TouchableOpacity>}
      {kind==='storage-error'&&<TouchableOpacity accessibilityRole="button" style={styles.secondaryButton} onPress={async()=>{if(!currentSession())return;try{const marker=await journal.read(session);if(currentSession())setMutation(marker?'unknown':'idle',marker);}catch{if(currentSession())Alert.alert('Stockage indisponible','Les actions restent suspendues.');}}}><Text style={styles.secondaryButtonText}>Revérifier le stockage</Text></TouchableOpacity>}
    </View>;
  };

  const fetchAuthStatus = async () => {
    setAuthError('');
    setAuthLoading(true);
    try {
      const data = await request('/api/auth/status');
      if (!boundary.isCurrent(epoch)) return;
      setAuthMembers(data.members || []);
    } catch (error) {
      if (staleError(error)) return;
      setAuthMembers([]);
      setAuthError(error.message || 'Impossible de contacter le serveur.');
    } finally {
      if (boundary.isCurrent(epoch)) setAuthLoading(false);
    }
  };

  const openPinStage = (member) => {
    setAuthError('');
    setPinStage({ memberId: member.id, memberName: member.name, mode: member.pinSet ? 'login' : 'create', pin: '', pin2: '' });
  };

  const closePinStage = () => setPinStage(null);

  const applyLoginSuccess = (data) => {
    if (!boundary.isCurrent(epoch)) return;
    const nextSession={...session,user:data?.member?.id,token:data?.authToken,expires:data?.expiresAt,sessionId:sessionStorage.newSessionId()};
    if(!sessionStorage.valid(nextSession))throw new Error('Réponse de connexion invalide');
    resetSession();
    setCurrentUserId(data.member.id);
    setAuthToken(data.authToken);
    setAuthTokenExpiresAt(data.expiresAt);
    setSessionId(nextSession.sessionId);
    setPinStage(null);
    setProfileModal(false);
    setAuthError('');
    Alert.alert('Profil changé', `Connecté en tant que ${data.member.name}.`);
  };

  const submitPinStage = async () => {
    if (!pinStage) return;
    const pin = pinStage.pin.trim();
    if (!isValidPinFormat(pin)) return Alert.alert('PIN invalide', 'Le PIN doit contenir entre 4 et 8 chiffres.');

    if (pinStage.mode === 'create') {
      if (pin !== pinStage.pin2.trim()) return Alert.alert('PIN différent', 'Les deux PIN saisis ne correspondent pas.');
      setAuthLoading(true);
      try {
        await request('/api/auth/set-pin', { method: 'POST', body: JSON.stringify({ memberId: pinStage.memberId, pin }) });
        const loginData = await request('/api/auth/login', { method: 'POST', body: JSON.stringify({ memberId: pinStage.memberId, pin }) });
        Alert.alert('PIN créé', `Le PIN de ${pinStage.memberName} a été créé.`);
        applyLoginSuccess(loginData);
      } catch (error) {
        if (staleError(error)) return;
        Alert.alert('Création impossible', error.message);
      } finally {
        if (boundary.isCurrent(epoch)) setAuthLoading(false);
      }
    } else {
      setAuthLoading(true);
      try {
        const loginData = await request('/api/auth/login', { method: 'POST', body: JSON.stringify({ memberId: pinStage.memberId, pin }) });
        applyLoginSuccess(loginData);
      } catch (error) {
        if (staleError(error)) return;
        Alert.alert('Connexion refusée', error.message);
        setPinStage((stage) => (stage ? { ...stage, pin: '' } : stage));
        fetchAuthStatus();
      } finally {
        if (boundary.isCurrent(epoch)) setAuthLoading(false);
      }
    }
  };

  const openProfileSwitch = () => {
    setProfileModal(true);
    fetchAuthStatus();
  };

  const logout = async () => {
    try { await resetSession(); Alert.alert('Déconnecté', 'Reconnecte-toi avec ton PIN pour continuer.'); }
    catch { Alert.alert('Stockage local', 'Effacement incomplet. Ne partage pas cet appareil avant résolution.'); }
  };

  const submitPinManage = async () => {
    const { currentPin, newPin, newPin2 } = pinManageDraft;
    if (!isValidPinFormat(newPin)) return Alert.alert('PIN invalide', 'Le nouveau PIN doit contenir entre 4 et 8 chiffres.');
    if (newPin !== newPin2) return Alert.alert('PIN différent', 'Les deux PIN saisis ne correspondent pas.');
    try {
      await request('/api/auth/set-pin', { method: 'POST', body: JSON.stringify({ memberId: currentUserId, pin: newPin, currentPin }) });
      setPinManageModal(false);
      setPinManageDraft({ currentPin: '', newPin: '', newPin2: '' });
      Alert.alert('PIN modifié', 'Ton PIN a été mis à jour.');
    } catch (error) {
      if (!staleError(error)) Alert.alert('Modification impossible', error.message);
    }
  };

  const loadLocal = async () => {
    try {
      const [cache,storedApi,storedSecret,storedAuth]=await Promise.all([
        AsyncStorage.getItem(CACHE_KEY),AsyncStorage.getItem(API_KEY),
        AsyncStorage.getItem(SECRET_KEY),AsyncStorage.getItem(AUTH_SESSION_KEY)
      ]);
      if(!boundary.isCurrent(epoch))return;
      if(storedApi)setApiUrl(storedApi);
      if(storedSecret)setApiSecret(storedSecret);
      const restored=sessionStorage.readStoredSession(storedAuth,storedApi||'',storedSecret||'');
      const data=sessionStorage.readCache(cache, restored);
      if(sessionStorage.valid(restored)){
        setCurrentUserId(restored.user);setAuthToken(restored.token);setAuthTokenExpiresAt(restored.expires);setSessionId(restored.sessionId);
        if(data){
          setMembers(data.members.map(m=>({...m,role:currentMemberRole(m)})));
          setCategories(data.categories);setExpenses(data.expenses);setContributions(data.contributions);setActivityLogs(data.activityLogs);setDataReady(true);
          setSyncMessage('Dernier état confirmé — synchronisation à vérifier');
        }else await AsyncStorage.removeItem(CACHE_KEY);
      }else await resetSession();
    }catch(error){resetSession();reportStorageError();}
    finally{setBootLoading(false);}
  };
  const saveLocal=()=>{
    if(bootLoading||!boundary.isCurrent(epoch))return Promise.resolve();
    return boundary.save(epoch,session,dataReady?{members,categories,expenses,contributions,activityLogs,selectedMonth}:null).catch(reportStorageError);
  };

  const monthExpenseRows = useMemo(() => expenses.filter((e) => String(e.date || '').startsWith(selectedMonth)), [expenses, selectedMonth]);
  const monthContributionRows = useMemo(() => contributions.filter((c) => String(c.date || '').startsWith(selectedMonth)), [contributions, selectedMonth]);
  const monthExpenses = useMemo(() => monthExpenseRows.filter((e) => !isPlannedAction(e)), [monthExpenseRows]);
  const monthContributions = useMemo(() => monthContributionRows.filter((c) => !isPlannedAction(c)), [monthContributionRows]);
  const plannedMonthExpenses = useMemo(() => monthExpenseRows.filter(isPlannedAction), [monthExpenseRows]);
  const plannedMonthContributions = useMemo(() => monthContributionRows.filter(isPlannedAction), [monthContributionRows]);

  const previousExpenses = useMemo(() => expenses.filter((e) => !isPlannedAction(e) && isBeforeMonth(e.date, selectedMonth)), [expenses, selectedMonth]);
  const previousContributions = useMemo(() => contributions.filter((c) => !isPlannedAction(c) && isBeforeMonth(c.date, selectedMonth)), [contributions, selectedMonth]);

  const summary = useMemo(() => dashboardModel.summarizeCategories(categories, members.length, monthExpenses, monthContributions, previousExpenses, previousContributions), [categories, members, monthExpenses, monthContributions, previousExpenses, previousContributions]);
  const totals = useMemo(() => dashboardModel.summarizeTotals(summary), [summary]);
  const plannedTotals = useMemo(() => dashboardModel.summarizePlanned(plannedMonthExpenses, plannedMonthContributions), [plannedMonthExpenses, plannedMonthContributions]);
  const hasPlannedActions = plannedTotals.spent > 0 || plannedTotals.paidIn > 0;
  const forecastCashBalance = dashboardModel.forecastBalance(totals, plannedTotals);

  const personState = useMemo(() => members.map((member) => {
    const expected = categories.reduce((sum, c) => sum + Number(c.monthlyPerPerson || 0), 0);
    const paid = monthContributions.filter((c) => c.memberId === member.id).reduce((sum, c) => sum + Number(c.amount || 0), 0);
    const personallyPaidExpenses = monthExpenses.filter((e) => e.paidByMemberId === member.id).reduce((sum, e) => sum + Number(e.amount || 0), 0);
    return { member, expected, paid, missing: expected - paid, personallyPaidExpenses };
  }), [members, categories, monthContributions, monthExpenses]);

  const currentMember = useMemo(() => members.find((m) => m.id === currentUserId) || members[0] || initialState.members[0], [members, currentUserId]);
  const currentRole = currentMemberRole(currentMember);
  const isAdmin = currentRole === 'admin';
  const activityRows = useMemo(() => (activityLogs || []).slice(0, 80), [activityLogs]);
  const unreadActivityCount = useMemo(
    () => (activityLogs || []).filter((log) => isLogUnread(log, currentUserId)).length,
    [activityLogs, currentUserId]
  );

  const updateMonth = (direction) => {
    setSelectedMonth((current) => addMonths(current, direction));
  };

  const applyMonthDraft = () => {
    const normalized = normalizeMonth(monthDraft);
    if (!normalized) return Alert.alert('Mois invalide', 'Utilise le format AAAA-MM, par exemple 2026-07.');
    setSelectedMonth(normalized);
    setMonthPickerOpen(false);
  };

  const confirmFutureDateIfNeeded = (date, actionLabel, onConfirm) => {
    if (!isFutureDate(date)) return onConfirm('done');

    Alert.alert(
      'Action prévue',
      `La date ${date} est dans le futur. Cette ${actionLabel} sera enregistrée comme action prévue et ne comptera pas dans le solde réel tant que la date n’est pas arrivée.`,
      [
        { text: 'Annuler', style: 'cancel' },
        { text: 'Enregistrer comme prévu', onPress: () => onConfirm('planned') },
      ]
    );
  };

  const addExpense = () => {
    const amount = parseAmount(expenseDraft.amount);
    if (!expenseDraft.label.trim()) return Alert.alert('Dépense incomplète', 'Ajoute un libellé.');
    if (!Number.isFinite(amount) || amount <= 0) return Alert.alert('Montant invalide', 'Le montant doit être supérieur à 0.');
    if (!isValidDateForMonth(expenseDraft.date, selectedMonth)) return Alert.alert('Date invalide', `Utilise une vraie date du mois ${selectedMonth}, au format AAAA-MM-JJ.`);

    confirmFutureDateIfNeeded(expenseDraft.date, 'dépense', (status) => {
      const payload = { ...expenseDraft, id: uid('expense'), amount, status, createdByMemberId: currentUserId };
      mutate('/api/expenses','POST',payload,()=>setExpenseDraft(d=>d.label===payload.label&&parseAmount(d.amount)===payload.amount&&d.date===payload.date&&d.categoryId===payload.categoryId&&d.paidByMemberId===payload.paidByMemberId?{...d,label:'',amount:''}:d));
    });
  };

  const addContribution = () => {
    const amount = parseAmount(contributionDraft.amount);
    if (!Number.isFinite(amount) || amount <= 0) return Alert.alert('Montant invalide', 'Le montant doit être supérieur à 0.');
    if (!isValidDateForMonth(contributionDraft.date, selectedMonth)) return Alert.alert('Date invalide', `Utilise une vraie date du mois ${selectedMonth}, au format AAAA-MM-JJ.`);

    confirmFutureDateIfNeeded(contributionDraft.date, 'versement', (status) => {
      const payload = { ...contributionDraft, id: uid('contribution'), amount, status, createdByMemberId: currentUserId };
      mutate('/api/contributions','POST',payload,()=>setContributionDraft(d=>parseAmount(d.amount)===payload.amount&&d.date===payload.date&&d.categoryId===payload.categoryId&&d.memberId===payload.memberId?{...d,amount:''}:d));
    });
  };

  const addAutoContributions = () => {
    if (!isValidDateForMonth(autoDraft.date, selectedMonth)) return Alert.alert('Date invalide', `Utilise une vraie date du mois ${selectedMonth}, au format AAAA-MM-JJ.`);
    const memberIds = autoDraft.mode === 'all' ? members.map((m) => m.id) : [autoDraft.memberId];
    const monthsCount = Math.max(1, parseInt(autoDraft.monthsCount || '1', 10));

    confirmFutureDateIfNeeded(autoDraft.date, 'versement automatique', (status) => {
      mutate('/api/auto-contributions','POST',{memberIds,monthsCount,date:autoDraft.date,status});
    });
  };

  const removeExpense = (expense) => {
    if (!canDeleteRecentAction(expense, currentUserId, currentRole, 'paidByMemberId')) {
      return Alert.alert('Suppression bloquée', `Une dépense ne peut être supprimée que pendant ${DELETE_WINDOW_DAYS} jours. Un membre ne peut supprimer que ses propres actions.`);
    }
    Alert.alert('Supprimer la dépense', `Supprimer « ${expense.label} » ?`, [
      { text: 'Annuler', style: 'cancel' },
      { text: 'Supprimer', style: 'destructive', onPress: () => mutate(`/api/expenses/${expense.id}`,'DELETE',{}) },
    ]);
  };

  const removeContribution = (contribution) => {
    if (!canDeleteRecentAction(contribution, currentUserId, currentRole, 'memberId')) {
      return Alert.alert('Suppression bloquée', `Un versement ne peut être supprimé que pendant ${DELETE_WINDOW_DAYS} jours. Un membre ne peut supprimer que ses propres actions.`);
    }
    Alert.alert('Supprimer le versement', `Supprimer le versement de ${formatEuro(contribution.amount)} ?`, [
      { text: 'Annuler', style: 'cancel' },
      { text: 'Supprimer', style: 'destructive', onPress: () => mutate(`/api/contributions/${contribution.id}`,'DELETE',{}) },
    ]);
  };

  const markActivityRead=logId=>mutate(`/api/activity-logs/${logId}/read`,'POST',{});
  const markAllActivityRead=()=>mutate('/api/activity-logs/read-all','POST',{});

  const startEditExpense = (expense) => {
    if (!canEditRecentAction(expense, currentUserId, currentRole, 'paidByMemberId')) {
      return Alert.alert('Modification bloquée', `Une dépense ne peut être modifiée que pendant ${DELETE_WINDOW_DAYS} jours. Un membre ne peut modifier que ses propres actions.`);
    }
    setEditingExpense({
      ...expense,
      amount: String(expense.amount ?? '').replace('.', ','),
      label: String(expense.label || ''),
      categoryId: expense.categoryId,
      paidByMemberId: expense.paidByMemberId,
      date: expense.date,
    });
  };

  const saveExpenseEdit = () => {
    const amount = parseAmount(editingExpense?.amount);
    if (!editingExpense?.label?.trim()) return Alert.alert('Dépense incomplète', 'Ajoute un libellé.');
    if (!Number.isFinite(amount) || amount <= 0) return Alert.alert('Montant invalide', 'Le montant doit être supérieur à 0.');
    if (!isValidDateForMonth(editingExpense.date, selectedMonth)) return Alert.alert('Date invalide', `Utilise une vraie date du mois ${selectedMonth}, au format AAAA-MM-JJ.`);

    confirmFutureDateIfNeeded(editingExpense.date, 'dépense modifiée', (status) => {
      const payload = { ...editingExpense, amount, status };
      mutate(`/api/expenses/${editingExpense.id}`,'PUT',payload,()=>setEditingExpense(d=>d?.id===payload.id?null:d));
    });
  };

  const startEditContribution = (contribution) => {
    if (!canEditRecentAction(contribution, currentUserId, currentRole, 'memberId')) {
      return Alert.alert('Modification bloquée', `Un versement ne peut être modifié que pendant ${DELETE_WINDOW_DAYS} jours. Un membre ne peut modifier que ses propres actions.`);
    }
    setEditingContribution({
      ...contribution,
      amount: String(contribution.amount ?? '').replace('.', ','),
      categoryId: contribution.categoryId,
      memberId: contribution.memberId,
      date: contribution.date,
    });
  };

  const saveContributionEdit = () => {
    const amount = parseAmount(editingContribution?.amount);
    if (!Number.isFinite(amount) || amount <= 0) return Alert.alert('Montant invalide', 'Le montant doit être supérieur à 0.');
    if (!isValidDateForMonth(editingContribution.date, selectedMonth)) return Alert.alert('Date invalide', `Utilise une vraie date du mois ${selectedMonth}, au format AAAA-MM-JJ.`);

    confirmFutureDateIfNeeded(editingContribution.date, 'versement modifié', (status) => {
      const payload = { ...editingContribution, amount, status };
      mutate(`/api/contributions/${editingContribution.id}`,'PUT',payload,()=>setEditingContribution(d=>d?.id===payload.id?null:d));
    });
  };

  const saveCategory = () => {
    const amount = parseAmount(editingCategory.monthlyPerPerson);
    if (!editingCategory.name.trim()) return Alert.alert('Caisse incomplète', 'Ajoute un nom.');
    if (!Number.isFinite(amount) || amount < 0) return Alert.alert('Budget invalide', 'Le budget doit être positif.');
    const payload = { ...editingCategory, monthlyPerPerson: amount };
    if (editingCategory.isNew) {
      payload.id = uid('category');
      mutate('/api/categories','POST',payload,()=>setCategoryModal(false));
    } else {
      mutate(`/api/categories/${payload.id}`,'PUT',payload,()=>setCategoryModal(false));
    }
  };

  const deleteCategory = (category) => {
    Alert.alert('Supprimer la caisse', `Supprimer ${category.name} ?`, [
      { text: 'Annuler', style: 'cancel' },
      { text: 'Supprimer', style: 'destructive', onPress: () => mutate(`/api/categories/${category.id}`,'DELETE',{}) },
    ]);
  };

  const addMember = () => {
    const name = memberDraft.trim();
    if (!name) return;
    const payload = { id: uid('member'), name };
    mutate('/api/members','POST',payload,()=>setMemberDraft(d=>d.trim()===payload.name?'':d));
  };


  const createServerBackup = async () => {
    if(!currentSession()||mutationRef.current.kind!=='idle')return Alert.alert('Action suspendue','Vérifie d’abord l’opération en attente.');
    if (!isAdmin) return Alert.alert('Accès refusé', 'Cette action est réservée à un administrateur.');
    try {
      const data = await request('/api/backups/create', { method: 'POST', body: JSON.stringify({ reason: 'mobile' }) });
      Alert.alert('Sauvegarde créée', `Fichier : ${data.backup?.file || 'sauvegarde SQLite'}\nDossier serveur : server/backups/`);
      syncFromServer(false);
    } catch (error) { if (!staleError(error)) Alert.alert('Sauvegarde impossible', error.message); }
  };

  const exportServerJson = async () => {
    if(!currentSession()||mutationRef.current.kind!=='idle')return Alert.alert('Action suspendue','Vérifie d’abord l’opération en attente.');
    if (!isAdmin) return Alert.alert('Accès refusé', 'Cette action est réservée à un administrateur.');
    try {
      const data = await request('/api/export/json', { method: 'POST', body: JSON.stringify({}) });
      Alert.alert('Export JSON créé', `Fichier : ${data.export?.file || 'export JSON'}\nDossier serveur : server/backups/`);
      syncFromServer(false);
    } catch (error) { if (!staleError(error)) Alert.alert('Export impossible', error.message); }
  };

  const exportServerCsv = async () => {
    if(!currentSession()||mutationRef.current.kind!=='idle')return Alert.alert('Action suspendue','Vérifie d’abord l’opération en attente.');
    if (!isAdmin) return Alert.alert('Accès refusé', 'Cette action est réservée à un administrateur.');
    try {
      const data = await request('/api/export/csv', { method: 'POST', body: JSON.stringify({}) });
      const files = (data.exports || []).map((item) => item.file).join('\n');
      Alert.alert('Exports CSV créés', `${files || 'exports CSV'}\nDossier serveur : server/backups/`);
      syncFromServer(false);
    } catch (error) { if (!staleError(error)) Alert.alert('Export impossible', error.message); }
  };

  const showRestoreInfo = () => {
    Alert.alert(
      'Restauration',
      'La restauration existe côté serveur via POST /api/backups/restore. Elle est volontairement non exposée en bouton direct pour éviter une restauration accidentelle. Utilise cette route seulement après avoir choisi une sauvegarde dans server/backups/.'
    );
  };

  const showRoleInfo = () => {
    Alert.alert(
      'Rôles et sécurité',
      `Utilisateur actuel : ${currentMember?.name || currentUserId}
Rôle : ${isAdmin ? 'admin' : 'membre'}

La réinitialisation serveur est désactivée dans l’app pour éviter les erreurs.
Les suppressions sont possibles seulement pendant ${DELETE_WINDOW_DAYS} jours.`
    );
  };

  const renderChoice = (items, selectedId, onSelect) => (
    <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.choiceRow}>
      {items.map((item) => (
        <TouchableOpacity key={item.id} style={[styles.choice, selectedId === item.id && styles.choiceActive]} onPress={() => onSelect(item.id)}>
          <Text style={[styles.choiceText, selectedId === item.id && styles.choiceTextActive]}>{item.name}</Text>
        </TouchableOpacity>
      ))}
    </ScrollView>
  );

  const renderPinStageForm = () => (
    <View style={styles.card}>
      <Text style={styles.cardTitle}>{pinStage.mode === 'create' ? `Créer le PIN de ${pinStage.memberName}` : `PIN de ${pinStage.memberName}`}</Text>
      <Text style={styles.muted}>{pinStage.mode === 'create' ? 'Choisis un PIN à 4-8 chiffres, connu de toi seul(e).' : 'Entre ton PIN pour continuer.'}</Text>
      <TextInput
        style={styles.input}
        placeholder="PIN (4 à 8 chiffres)"
        keyboardType="number-pad"
        secureTextEntry
        maxLength={8}
        value={pinStage.pin}
        onChangeText={(pin) => setPinStage((s) => ({ ...s, pin }))}
      />
      {pinStage.mode === 'create' && (
        <TextInput
          style={styles.input}
          placeholder="Confirme le PIN"
          keyboardType="number-pad"
          secureTextEntry
          maxLength={8}
          value={pinStage.pin2}
          onChangeText={(pin2) => setPinStage((s) => ({ ...s, pin2 }))}
        />
      )}
      <TouchableOpacity style={styles.primaryButton} onPress={submitPinStage} disabled={authLoading}>
        <Text style={styles.primaryButtonText}>{pinStage.mode === 'create' ? 'Créer et se connecter' : 'Se connecter'}</Text>
      </TouchableOpacity>
      <TouchableOpacity style={styles.secondaryButton} onPress={closePinStage}>
        <Text style={styles.secondaryButtonText}>Annuler</Text>
      </TouchableOpacity>
    </View>
  );

  const renderAuthMemberList = () => (
    <>
      {authError ? <View style={styles.card}><Text style={styles.muted}>{authError}</Text></View> : null}
      {authLoading && !authMembers.length ? <Text style={styles.muted}>Chargement…</Text> : null}
      {authMembers.map((member) => (
        <View key={member.id} style={styles.card}>
          <View style={[styles.rowBetween, largeText && styles.stacked]}>
            <Text style={styles.cardTitle}>{member.name}</Text>
            <Text style={member.locked ? styles.badgeWarn : (member.pinSet ? styles.badgeOk : styles.badge)}>
              {member.locked ? 'Verrouillé' : member.pinSet ? 'PIN défini' : 'PIN à créer'}
            </Text>
          </View>
          {member.locked ? (
            <Text style={styles.muted}>Réessaie après {formatActivityDate(member.lockedUntil)}.</Text>
          ) : (
            <TouchableOpacity style={styles.primaryButton} onPress={() => openPinStage(member)}>
              <Text style={styles.primaryButtonText}>{member.pinSet ? 'Entrer mon PIN' : 'Créer mon PIN'}</Text>
            </TouchableOpacity>
          )}
        </View>
      ))}
      <TouchableOpacity style={styles.secondaryButton} onPress={fetchAuthStatus}><Text style={styles.secondaryButtonText}>Rafraîchir</Text></TouchableOpacity>
    </>
  );

  const renderAuthGate = () => (
    <SafeAreaView style={styles.safe}>
      <StatusBar style="dark" />
      <View style={[styles.header, largeText && styles.stacked]}>
        <View style={styles.headerCopy}>
          <Text style={styles.title}>Duo Budget</Text>
          <Text style={styles.subtitle}>Connexion sécurisée</Text>
        </View>
        <TouchableOpacity accessibilityRole="button" accessibilityLabel="Retour à l'aperçu" onPress={() => setShowGlance(true)} style={styles.headerButton}>
          <Text style={styles.headerButtonText}>← Aperçu</Text>
        </TouchableOpacity>
      </View>
      <ScrollView style={styles.content} contentContainerStyle={styles.contentInner}>
        {(!apiUrl || editingServer) ? (
          <View style={styles.card}>
            <Text style={styles.cardTitle}>Configurer le serveur</Text>
            <Text style={styles.muted}>Renseigne l’adresse du serveur de confiance (réseau local ou Tailscale).</Text>
            <Text style={styles.label}>URL API maison</Text>
            <TextInput style={styles.input} placeholder="http://100.x.y.z:3001" autoCapitalize="none" value={apiUrl} onChangeText={(value) => changeServer(value)} />
            <Text style={styles.label}>Secret API optionnel</Text>
            <TextInput style={styles.input} placeholder="APP_SECRET" autoCapitalize="none" secureTextEntry value={apiSecret} autoCorrect={false} onChangeText={(value)=>changeServer(value,true)} />
            <TouchableOpacity style={styles.primaryButton} disabled={authLoading || !apiUrl.trim()} onPress={() => { setAuthMembers([]); setPinStage(null); setAuthError(''); setEditingServer(false); }}><Text style={styles.primaryButtonText}>Enregistrer et continuer</Text></TouchableOpacity>
          </View>
        ) : pinStage ? renderPinStageForm() : renderAuthMemberList()}
        {apiUrl && !editingServer ? <TouchableOpacity accessibilityRole="button" disabled={authLoading} style={styles.secondaryButton} onPress={() => { setAuthMembers([]); setPinStage(null); setAuthError(''); setEditingServer(true); }}><Text style={styles.secondaryButtonText}>Modifier la configuration du serveur</Text></TouchableOpacity> : null}
      </ScrollView>
    </SafeAreaView>
  );

  const getMemberName = (id) => members.find((m) => m.id === id)?.name || 'Membre supprimé';
  const getCategoryName = (id) => categories.find((c) => c.id === id)?.name || 'Caisse supprimée';
  const activityDetailLines = (log) => {
    const details = log?.details || {};
    const lines = [];
    const categoryName = details.categoryName || (details.categoryId ? getCategoryName(details.categoryId) : '');
    const memberName = details.memberName || (details.memberId ? getMemberName(details.memberId) : '');
    const paidByMemberName = details.paidByMemberName || (details.paidByMemberId ? getMemberName(details.paidByMemberId) : '');

    if (log.entityType === 'contribution') {
      if (memberName && memberName !== 'Membre supprimé') lines.push(`Pour : ${memberName}`);
      if (categoryName && categoryName !== 'Caisse supprimée') lines.push(`Caisse : ${categoryName}`);
    }

    if (log.entityType === 'expense') {
      if (paidByMemberName && paidByMemberName !== 'Membre supprimé') lines.push(`Payé par : ${paidByMemberName}`);
      if (categoryName && categoryName !== 'Caisse supprimée') lines.push(`Caisse : ${categoryName}`);
    }

    if ((log.action === 'category_deleted' || log.action === 'category_archived') && details.monthlyPerPerson !== undefined) {
      lines.push(`Budget mensuel par personne : ${formatEuro(details.monthlyPerPerson)}`);
    }

    if ((log.action === 'auto_contributions_created' || log.action === 'auto_contributions_planned') && Array.isArray(details.memberNames)) {
      lines.push(`Pour : ${details.memberNames.join(', ')}`);
      if (details.monthsCount) lines.push(`Nombre de mois : ${details.monthsCount}`);
    }

    if (log.action === 'expense_updated' || log.action === 'contribution_updated') {
      if (details.oldAmount !== undefined && details.newAmount !== undefined && Number(details.oldAmount) !== Number(details.newAmount)) {
        lines.push(`Montant : ${formatEuro(details.oldAmount)} → ${formatEuro(details.newAmount)}`);
      }
      if (details.oldDate && details.newDate && details.oldDate !== details.newDate) lines.push(`Date : ${details.oldDate} → ${details.newDate}`);
      if (details.oldCategoryName && details.newCategoryName && details.oldCategoryName !== details.newCategoryName) lines.push(`Caisse : ${details.oldCategoryName} → ${details.newCategoryName}`);
      if (details.oldPaidByMemberName && details.newPaidByMemberName && details.oldPaidByMemberName !== details.newPaidByMemberName) lines.push(`Payé par : ${details.oldPaidByMemberName} → ${details.newPaidByMemberName}`);
      if (details.oldMemberName && details.newMemberName && details.oldMemberName !== details.newMemberName) lines.push(`Pour : ${details.oldMemberName} → ${details.newMemberName}`);
      if (details.oldStatus && details.newStatus && details.oldStatus !== details.newStatus) lines.push(`Statut : ${details.oldStatus === 'planned' ? 'Prévu' : 'Réalisé'} → ${details.newStatus === 'planned' ? 'Prévu' : 'Réalisé'}`);
    }

    return lines;
  };

  const renderMainControls = () => (<>
      <View style={[styles.compactHeader, largeText && styles.stacked]}>
        <View style={styles.brandRow}>
          <Image source={require('./assets/duo-mark-blue.png')} style={styles.brandMark} accessibilityIgnoresInvertColors accessible={false} />
          <Text style={styles.brandName}>Duo Budget</Text>
        </View>
        <TouchableOpacity accessibilityRole="button" accessibilityLabel="Configuration" style={styles.compactConfig} onPress={() => setSettingsModal(true)}><Text style={styles.compactConfigText}>Config</Text></TouchableOpacity>
      </View>
      <View style={[styles.compactMonth, largeText && styles.monthWrap]}>
        <TouchableOpacity style={styles.compactArrow} accessibilityLabel="Mois précédent" accessibilityRole="button" onPress={() => updateMonth(-1)}><Text style={styles.compactArrowText}>‹</Text></TouchableOpacity>
        <TouchableOpacity accessibilityRole="button" accessibilityLabel="Choisir le mois" style={styles.monthCenter} onPress={() => setMonthPickerOpen(v => !v)}><Text style={styles.monthCaption}>{new Intl.DateTimeFormat('fr-FR',{month:'long',year:'numeric',timeZone:'UTC'}).format(new Date(selectedMonth+'-01T00:00:00Z'))} ▾</Text></TouchableOpacity>
        <TouchableOpacity style={styles.compactArrow} accessibilityLabel="Mois suivant" accessibilityRole="button" onPress={() => updateMonth(1)}><Text style={styles.compactArrowText}>›</Text></TouchableOpacity>
      </View>
      {monthPickerOpen && <View style={styles.card}>
        <Text style={styles.label}>Choisir un mois (AAAA-MM)</Text>
        <TextInput style={styles.input} value={monthDraft} onChangeText={setMonthDraft} autoCorrect={false} keyboardType="numbers-and-punctuation" onSubmitEditing={applyMonthDraft} />
        <TouchableOpacity style={styles.secondaryButton} onPress={applyMonthDraft}><Text style={styles.secondaryButtonText}>Appliquer</Text></TouchableOpacity>
      </View>}
      {tab !== 'dashboard' && <NavigationActions route={tab} onNavigate={setTab} />}
  </>);

  if (!appActive || bootLoading) {
    return (
      <SafeAreaProvider>
        <SafeAreaView style={styles.safe}><StatusBar style="dark" /></SafeAreaView>
      </SafeAreaProvider>
    );
  }

  if(storageError)return (
    <SafeAreaProvider><SafeAreaView style={styles.safe}>
      <Text style={styles.title}>Stockage local indisponible</Text>
      <Text style={styles.muted}>Les données ne sont pas affichées. Réessaie l'effacement avant de continuer.</Text>
      <TouchableOpacity style={styles.primaryButton} onPress={async()=>{try{await resetSession();setStorageError(false);}catch{reportStorageError();}}}><Text style={styles.primaryButtonText}>Réessayer</Text></TouchableOpacity>
    </SafeAreaView></SafeAreaProvider>
  );

  if (!isSessionValid()) {
    return (
      <SafeAreaProvider>
        {showGlance ? (
          <DuoGlanceScreen
            onSignIn={() => setShowGlance(false)}
            onCreateAccount={() => setShowGlance(false)}
          />
        ) : renderAuthGate()}
      </SafeAreaProvider>
    );
  }

  if (!dataReady) return (
    <SafeAreaProvider><SafeAreaView style={styles.safe}>
      <ScrollView contentContainerStyle={styles.contentInner}>
        <Text style={styles.title}>Chargement des données</Text>
        <Text style={styles.muted}>Aucune donnée financière disponible tant que la synchronisation initiale n'a pas réussi.</Text>
        {renderMutationNotice()}
        <TouchableOpacity style={styles.primaryButton} onPress={()=>syncFromServer(true)}><Text style={styles.primaryButtonText}>Réessayer</Text></TouchableOpacity>
        <TouchableOpacity style={styles.secondaryButton} onPress={logout}><Text style={styles.secondaryButtonText}>Se déconnecter</Text></TouchableOpacity>
      </ScrollView>
    </SafeAreaView></SafeAreaProvider>
  );
  return (
    <SafeAreaProvider>
    <SafeAreaView style={styles.safe}>
      <StatusBar style="dark" />
      {!largeText && tab !== 'dashboard' && renderMainControls()}

      <ScrollView style={styles.content} contentContainerStyle={styles.contentInner} keyboardShouldPersistTaps="handled">
        {(largeText || tab === 'dashboard') && renderMainControls()}
        {renderMutationNotice()}
        {tab === 'dashboard' && (
          <>
            <DashboardOverview totals={totals} plannedTotals={plannedTotals} forecastCashBalance={forecastCashBalance} connected={connected} syncMessage={syncMessage} selectedMonth={selectedMonth} formatEuro={formatEuro} summary={summary} personState={personState} recent={dashboardModel.recentOperations(monthExpenses, monthContributions, categories, members)} onNavigate={setTab} />
            {hasPlannedActions && (
              <View style={styles.card}>
                <Text style={styles.cardTitle}>À venir ce mois-ci</Text>
                <Text style={styles.muted}>Versements prévus : {formatEuro(plannedTotals.paidIn)}</Text>
                <Text style={styles.muted}>Dépenses prévues : {formatEuro(plannedTotals.spent)}</Text>
                <Text style={styles.muted}>Solde après actions prévues : {formatEuro(forecastCashBalance)}</Text>
              </View>
            )}
            <TouchableOpacity accessibilityRole="button" style={styles.secondaryButton} onPress={() => updateMonth(1)}><Text style={styles.secondaryButtonText}>Mois suivant ›</Text></TouchableOpacity>
            <View style={styles.card}>
              <Text style={styles.cardTitle}>Détail des enveloppes</Text>
              {summary.map((category) => <CategorySummary key={category.id} category={category} />)}
              {!summary.length && <Text style={styles.muted}>Aucune enveloppe configurée.</Text>}
            </View>
          </>
        )}

        {tab === 'expenses' && (
          <>
            <Text style={styles.sectionTitle}>Ajouter une dépense</Text>
            <View style={styles.card}>
              <TextInput style={styles.input} placeholder="Libellé — ex: Courses samedi" value={expenseDraft.label} onChangeText={(label) => setExpenseDraft((d) => ({ ...d, label }))} />
              <TextInput style={styles.input} placeholder="Montant" keyboardType="decimal-pad" value={expenseDraft.amount} onChangeText={(amount) => setExpenseDraft((d) => ({ ...d, amount }))} />
              <Text style={styles.label}>Catégorie</Text>{renderChoice(categories, expenseDraft.categoryId, (categoryId) => setExpenseDraft((d) => ({ ...d, categoryId })))}
              <Text style={styles.label}>Payé par</Text>{renderChoice(members, expenseDraft.paidByMemberId, (paidByMemberId) => setExpenseDraft((d) => ({ ...d, paidByMemberId })))}
              <TextInput style={styles.input} value={expenseDraft.date} onChangeText={(date) => setExpenseDraft((d) => ({ ...d, date }))} />
              <TouchableOpacity style={styles.primaryButton} onPress={addExpense}><Text style={styles.primaryButtonText}>Ajouter la dépense</Text></TouchableOpacity>
            </View>
            <Text style={styles.sectionTitle}>Dépenses du mois</Text>
            {monthExpenseRows.map((expense) => (
              <View key={expense.id} style={styles.card}>
                <View style={[styles.rowBetween, largeText && styles.stacked]}><Text style={styles.cardTitle}>{expense.label}</Text><Text style={styles.amount}>{formatEuro(expense.amount)}</Text></View>
                <View style={[styles.rowBetween, largeText && styles.stacked]}><Text style={styles.muted}>{getCategoryName(expense.categoryId)} · payé par {getMemberName(expense.paidByMemberId)}</Text><Text style={styles[statusStyleName(expense)]}>{statusLabel(expense)}</Text></View>
                <Text style={styles.muted}>{expense.date}</Text>
                {canEditRecentAction(expense, currentUserId, currentRole, 'paidByMemberId') ? (
                  <View style={[styles.rowGap, largeText && styles.stacked]}>
                    <TouchableOpacity style={styles.smallButton} onPress={() => startEditExpense(expense)}><Text style={styles.smallButtonText}>Modifier</Text></TouchableOpacity>
                    <TouchableOpacity style={styles.smallDanger} onPress={() => removeExpense(expense)}><Text style={styles.dangerText}>Supprimer</Text></TouchableOpacity>
                  </View>
                ) : (
                  <Text style={styles.lockedText}>Modification et suppression verrouillées après {DELETE_WINDOW_DAYS} jours ou réservées au membre concerné.</Text>
                )}
              </View>
            ))}
          </>
        )}

        {tab === 'contributions' && (
          <>
            <Text style={styles.sectionTitle}>Versement automatique</Text>
            <View style={styles.card}>
              <Text style={styles.label}>Mode</Text>
              <View style={styles.choiceRow}>
                <TouchableOpacity style={[styles.choice, autoDraft.mode === 'all' && styles.choiceActive]} onPress={() => setAutoDraft((d) => ({ ...d, mode: 'all' }))}><Text style={[styles.choiceText, autoDraft.mode === 'all' && styles.choiceTextActive]}>Tous</Text></TouchableOpacity>
                <TouchableOpacity style={[styles.choice, autoDraft.mode === 'one' && styles.choiceActive]} onPress={() => setAutoDraft((d) => ({ ...d, mode: 'one' }))}><Text style={[styles.choiceText, autoDraft.mode === 'one' && styles.choiceTextActive]}>Un membre</Text></TouchableOpacity>
              </View>
              {autoDraft.mode === 'one' && <>{renderChoice(members, autoDraft.memberId, (memberId) => setAutoDraft((d) => ({ ...d, memberId })))}</>}
              <TextInput style={styles.input} placeholder="Nombre de mois" keyboardType="number-pad" value={autoDraft.monthsCount} onChangeText={(monthsCount) => setAutoDraft((d) => ({ ...d, monthsCount }))} />
              <TextInput style={styles.input} value={autoDraft.date} onChangeText={(date) => setAutoDraft((d) => ({ ...d, date }))} />
              <TouchableOpacity style={styles.primaryButton} onPress={addAutoContributions}><Text style={styles.primaryButtonText}>Verser automatiquement</Text></TouchableOpacity>
            </View>

            <Text style={styles.sectionTitle}>Ajouter un versement manuel</Text>
            <View style={styles.card}>
              <TextInput style={styles.input} placeholder="Montant" keyboardType="decimal-pad" value={contributionDraft.amount} onChangeText={(amount) => setContributionDraft((d) => ({ ...d, amount }))} />
              <Text style={styles.label}>Membre</Text>{renderChoice(members, contributionDraft.memberId, (memberId) => setContributionDraft((d) => ({ ...d, memberId })))}
              <Text style={styles.label}>Catégorie</Text>{renderChoice(categories, contributionDraft.categoryId, (categoryId) => setContributionDraft((d) => ({ ...d, categoryId })))}
              <TextInput style={styles.input} value={contributionDraft.date} onChangeText={(date) => setContributionDraft((d) => ({ ...d, date }))} />
              <TouchableOpacity style={styles.primaryButton} onPress={addContribution}><Text style={styles.primaryButtonText}>Ajouter le versement</Text></TouchableOpacity>
            </View>
            <Text style={styles.sectionTitle}>Versements du mois</Text>
            {monthContributionRows.map((contribution) => (
              <View key={contribution.id} style={styles.card}>
                <View style={[styles.rowBetween, largeText && styles.stacked]}><Text style={styles.cardTitle}>{getMemberName(contribution.memberId)}</Text><Text style={styles.amount}>{formatEuro(contribution.amount)}</Text></View>
                <View style={[styles.rowBetween, largeText && styles.stacked]}><Text style={styles.muted}>{getCategoryName(contribution.categoryId)}</Text><Text style={styles[statusStyleName(contribution)]}>{statusLabel(contribution)}</Text></View><Text style={styles.muted}>{contribution.date}</Text>
                {canEditRecentAction(contribution, currentUserId, currentRole, 'memberId') ? (
                  <View style={[styles.rowGap, largeText && styles.stacked]}>
                    <TouchableOpacity style={styles.smallButton} onPress={() => startEditContribution(contribution)}><Text style={styles.smallButtonText}>Modifier</Text></TouchableOpacity>
                    <TouchableOpacity style={styles.smallDanger} onPress={() => removeContribution(contribution)}><Text style={styles.dangerText}>Supprimer</Text></TouchableOpacity>
                  </View>
                ) : (
                  <Text style={styles.lockedText}>Modification et suppression verrouillées après {DELETE_WINDOW_DAYS} jours ou réservées au membre concerné.</Text>
                )}
              </View>
            ))}
          </>
        )}

        {tab === 'categories' && (
          <>
            {!isAdmin && <View style={styles.card}><Text style={styles.cardTitle}>Lecture seule</Text><Text style={styles.muted}>Les caisses sont visibles par tous, mais leur création, modification ou suppression est réservée à l’administrateur.</Text></View>}
            {isAdmin && <TouchableOpacity style={styles.primaryButton} onPress={() => { setEditingCategory({ isNew: true, name: '', monthlyPerPerson: '', description: '', locked: false }); setCategoryModal(true); }}><Text style={styles.primaryButtonText}>Ajouter une caisse</Text></TouchableOpacity>}
            {summary.map((category) => (
              <View key={category.id} style={styles.card}>
                <View style={[styles.rowBetween, largeText && styles.stacked]}><Text style={styles.cardTitle}>{category.name}</Text><Text style={styles.badge}>{category.locked ? 'Verrouillée' : 'Libre'}</Text></View>
                <Text style={styles.muted}>{category.description}</Text>
                <Text style={styles.muted}>Report précédent : {formatEuro(category.carryOver)}</Text>
                <Text style={styles.muted}>Budget du mois : {formatEuro(category.monthlyBudget)} · Disponible budget : {formatEuro(category.availableBudget)}</Text>
                <Text style={styles.muted}>Versé ce mois : {formatEuro(category.paidIn)} · Dépensé : {formatEuro(category.spent)}</Text>
                <Text style={styles.muted}>Solde caisse réel : {formatEuro(category.cashBalance)}</Text>
                {isAdmin && <View style={[styles.rowGap, largeText && styles.stacked]}>
                  <TouchableOpacity style={styles.smallButton} onPress={() => { setEditingCategory({ ...category, monthlyPerPerson: String(category.monthlyPerPerson) }); setCategoryModal(true); }}><Text style={styles.smallButtonText}>Modifier</Text></TouchableOpacity>
                  <TouchableOpacity style={styles.smallDanger} onPress={() => deleteCategory(category)}><Text style={styles.dangerText}>Supprimer</Text></TouchableOpacity>
                </View>}
              </View>
            ))}
          </>
        )}

        {tab === 'members' && (
          <>
            <Text style={styles.sectionTitle}>Membres</Text>
            {isAdmin && <View style={styles.card}>
              <TextInput style={styles.input} placeholder="Nom du membre" value={memberDraft} onChangeText={setMemberDraft} />
              <TouchableOpacity style={styles.primaryButton} onPress={addMember}><Text style={styles.primaryButtonText}>Ajouter le membre</Text></TouchableOpacity>
            </View>}
            <Text style={styles.label}>Profil de ce téléphone</Text>
            <View style={styles.card}>
              <View style={[styles.rowBetween, largeText && styles.stacked]}>
                <Text style={styles.cardTitle}>{currentMember?.name || currentUserId}</Text>
                <Text style={isAdmin ? styles.badge : styles.badgeOk}>{isAdmin ? 'Admin' : 'Membre'}</Text>
              </View>
              <TouchableOpacity style={styles.smallButton} onPress={openProfileSwitch}><Text style={styles.smallButtonText}>Changer de profil</Text></TouchableOpacity>
            </View>
            <Text style={styles.help}>Le changement de profil demande le PIN du profil cible. Le rôle admin ou membre n’est pas lié au genre : il dépend seulement de votre organisation.</Text>
            {members.map((member) => <View key={member.id} style={styles.card}><View style={[styles.rowBetween, largeText && styles.stacked]}><Text style={styles.cardTitle}>{member.name}</Text><Text style={currentMemberRole(member) === 'admin' ? styles.badge : styles.badgeOk}>{currentMemberRole(member) === 'admin' ? 'Admin' : 'Membre'}</Text></View><Text style={styles.muted}>ID : {member.id}</Text></View>)}
          </>
        )}

        {tab === 'activity' && (
          <>
            <Text style={styles.sectionTitle}>Journal d’activité</Text>
            <View style={styles.card}>
              <Text style={styles.cardTitle}>Dernières actions</Text>
              <Text style={styles.muted}>Historique synchronisé des créations, suppressions, sauvegardes et exports. Les anciennes actions réalisées avant ce patch ne peuvent pas être reconstruites automatiquement.</Text>
              <Text style={styles.muted}>{unreadActivityCount > 0 ? `${unreadActivityCount} activité${unreadActivityCount > 1 ? 's' : ''} non lue${unreadActivityCount > 1 ? 's' : ''} pour vous.` : 'Tout est à jour pour vous.'}</Text>
              {unreadActivityCount > 0 && (
                <View style={[styles.rowGap, largeText && styles.stacked]}>
                  <TouchableOpacity style={styles.smallButton} onPress={markAllActivityRead}><Text style={styles.smallButtonText}>Tout marquer comme lu</Text></TouchableOpacity>
                </View>
              )}
            </View>
            {activityRows.length === 0 && <View style={styles.card}><Text style={styles.muted}>Aucune activité enregistrée pour le moment.</Text></View>}
            {activityRows.map((log) => {
              const mainLabel = readableActivityLabel(log);
              const detailLines = activityDetailLines(log);
              const unread = isLogUnread(log, currentUserId);
              return (
                <View key={log.id} style={styles.card}>
                  <View style={[styles.rowBetween, largeText && styles.stacked]}>
                    <Text style={styles.cardTitle}>{activityLabel(log.action)}</Text>
                    <View style={styles.badgeRow}>
                      {unread && <Text style={styles.badgeWarn}>Nouveau</Text>}
                      <Text style={styles.badge}>{log.actorName || 'Système'}</Text>
                    </View>
                  </View>
                  {!!mainLabel && <Text style={styles.muted}>{mainLabel}</Text>}
                  {detailLines.map((line) => <Text key={line} style={styles.muted}>{line}</Text>)}
                  {!!log.amount && <Text style={styles.muted}>Montant : {formatEuro(log.amount)}</Text>}
                  {!!log.date && <Text style={styles.muted}>Date action : {log.date}</Text>}
                  <Text style={styles.lockedText}>Action réalisée par : {log.actorName || 'Système'} · {formatActivityDate(log.createdAt)}</Text>
                  {unread && (
                    <View style={[styles.rowGap, largeText && styles.stacked]}>
                      <TouchableOpacity style={styles.smallButton} onPress={() => markActivityRead(log.id)}><Text style={styles.smallButtonText}>Marquer comme lu</Text></TouchableOpacity>
                    </View>
                  )}
                </View>
              );
            })}
          </>
        )}
      </ScrollView>
      <BottomNavigation route={tab} onNavigate={setTab} unreadCount={unreadActivityCount} />

      <Modal visible={!!editingExpense} animationType="slide" presentationStyle="pageSheet">
        <SafeAreaView style={styles.modalSafe}>
          <View style={[styles.modalHeader, largeText && styles.stacked]}>
            <TouchableOpacity onPress={() => setEditingExpense(null)}><Text style={styles.modalAction}>Annuler</Text></TouchableOpacity>
            <Text style={styles.modalTitle}>Modifier dépense</Text>
            <TouchableOpacity onPress={saveExpenseEdit}><Text style={styles.modalAction}>Valider</Text></TouchableOpacity>
          </View>
          <ScrollView contentContainerStyle={styles.modalContent}>
            <TextInput style={styles.input} placeholder="Libellé" value={editingExpense?.label || ''} onChangeText={(label) => setEditingExpense((e) => ({ ...e, label }))} />
            <TextInput style={styles.input} placeholder="Montant" keyboardType="decimal-pad" value={String(editingExpense?.amount || '')} onChangeText={(amount) => setEditingExpense((e) => ({ ...e, amount }))} />
            <Text style={styles.label}>Catégorie</Text>{renderChoice(categories, editingExpense?.categoryId, (categoryId) => setEditingExpense((e) => ({ ...e, categoryId })))}
            <Text style={styles.label}>Payé par</Text>{renderChoice(members, editingExpense?.paidByMemberId, (paidByMemberId) => setEditingExpense((e) => ({ ...e, paidByMemberId })))}
            <TextInput style={styles.input} value={editingExpense?.date || ''} onChangeText={(date) => setEditingExpense((e) => ({ ...e, date }))} />
            <Text style={styles.help}>La modification est autorisée uniquement pendant 5 jours. Les changements sont ajoutés au journal d’activité.</Text>
          </ScrollView>
        </SafeAreaView>
      </Modal>

      <Modal visible={!!editingContribution} animationType="slide" presentationStyle="pageSheet">
        <SafeAreaView style={styles.modalSafe}>
          <View style={[styles.modalHeader, largeText && styles.stacked]}>
            <TouchableOpacity onPress={() => setEditingContribution(null)}><Text style={styles.modalAction}>Annuler</Text></TouchableOpacity>
            <Text style={styles.modalTitle}>Modifier versement</Text>
            <TouchableOpacity onPress={saveContributionEdit}><Text style={styles.modalAction}>Valider</Text></TouchableOpacity>
          </View>
          <ScrollView contentContainerStyle={styles.modalContent}>
            <TextInput style={styles.input} placeholder="Montant" keyboardType="decimal-pad" value={String(editingContribution?.amount || '')} onChangeText={(amount) => setEditingContribution((c) => ({ ...c, amount }))} />
            <Text style={styles.label}>Membre</Text>{renderChoice(members, editingContribution?.memberId, (memberId) => setEditingContribution((c) => ({ ...c, memberId })))}
            <Text style={styles.label}>Catégorie</Text>{renderChoice(categories, editingContribution?.categoryId, (categoryId) => setEditingContribution((c) => ({ ...c, categoryId })))}
            <TextInput style={styles.input} value={editingContribution?.date || ''} onChangeText={(date) => setEditingContribution((c) => ({ ...c, date }))} />
            <Text style={styles.help}>La modification est autorisée uniquement pendant 5 jours. Les changements sont ajoutés au journal d’activité.</Text>
          </ScrollView>
        </SafeAreaView>
      </Modal>

      <Modal visible={categoryModal} animationType="slide" presentationStyle="pageSheet">
        <SafeAreaView style={styles.modalSafe}>
          <View style={[styles.modalHeader, largeText && styles.stacked]}><Text style={styles.modalTitle}>{editingCategory?.isNew ? 'Créer une caisse' : 'Modifier la caisse'}</Text><TouchableOpacity onPress={saveCategory}><Text style={styles.modalAction}>Valider</Text></TouchableOpacity></View>
          <ScrollView contentContainerStyle={styles.modalContent}>
            <TextInput style={styles.input} placeholder="Nom" value={editingCategory?.name || ''} onChangeText={(name) => setEditingCategory((c) => ({ ...c, name }))} />
            <TextInput style={styles.input} placeholder="Budget mensuel par membre" keyboardType="decimal-pad" value={String(editingCategory?.monthlyPerPerson || '')} onChangeText={(monthlyPerPerson) => setEditingCategory((c) => ({ ...c, monthlyPerPerson }))} />
            <TextInput style={[styles.input, styles.textarea]} placeholder="Description" multiline value={editingCategory?.description || ''} onChangeText={(description) => setEditingCategory((c) => ({ ...c, description }))} />
            <Text style={styles.label}>Verrouillage optionnel</Text>
            <View style={styles.choiceRow}>
              <TouchableOpacity style={[styles.choice, editingCategory?.locked && styles.choiceActive]} onPress={() => setEditingCategory((c) => ({ ...c, locked: true }))}><Text style={[styles.choiceText, editingCategory?.locked && styles.choiceTextActive]}>Verrouillée</Text></TouchableOpacity>
              <TouchableOpacity style={[styles.choice, !editingCategory?.locked && styles.choiceActive]} onPress={() => setEditingCategory((c) => ({ ...c, locked: false }))}><Text style={[styles.choiceText, !editingCategory?.locked && styles.choiceTextActive]}>Libre</Text></TouchableOpacity>
            </View>
            <TouchableOpacity style={styles.secondaryButton} onPress={() => setCategoryModal(false)}><Text style={styles.secondaryButtonText}>Fermer sans enregistrer</Text></TouchableOpacity>
          </ScrollView>
        </SafeAreaView>
      </Modal>

      <Modal visible={settingsModal} animationType="slide" presentationStyle="pageSheet">
        <SafeAreaView style={styles.modalSafe}>
          <View style={[styles.modalHeader, largeText && styles.stacked]}><Text style={styles.modalTitle}>Configuration serveur</Text><TouchableOpacity onPress={() => { saveLocal(); setSettingsModal(false); syncFromServer(false); }}><Text style={styles.modalAction}>Valider</Text></TouchableOpacity></View>
          <ScrollView contentContainerStyle={styles.modalContent}>
            <Text style={styles.label}>URL API maison</Text>
            <TextInput style={styles.input} placeholder="http://100.x.y.z:3001" autoCapitalize="none" value={apiUrl} onChangeText={(value)=>changeServer(value)} />
            <Text style={styles.label}>Secret API optionnel</Text>
            <TextInput style={styles.input} placeholder="APP_SECRET" autoCapitalize="none" secureTextEntry value={apiSecret} onChangeText={(value)=>changeServer(value,true)} />
            <Text style={styles.label}>Profil de ce téléphone</Text>
            <View style={styles.card}>
              <View style={[styles.rowBetween, largeText && styles.stacked]}>
                <Text style={styles.cardTitle}>{currentMember?.name || currentUserId}</Text>
                <Text style={isAdmin ? styles.badge : styles.badgeOk}>{isAdmin ? 'Admin' : 'Membre'}</Text>
              </View>
              <View style={[styles.rowGap, largeText && styles.stacked]}>
                <TouchableOpacity style={styles.smallButton} onPress={openProfileSwitch}><Text style={styles.smallButtonText}>Changer de profil</Text></TouchableOpacity>
                <TouchableOpacity style={styles.smallButton} onPress={() => setPinManageModal(true)}><Text style={styles.smallButtonText}>Modifier mon PIN</Text></TouchableOpacity>
              </View>
            </View>
            <Text style={styles.help}>Rôle actuel : {isAdmin ? 'admin' : 'membre'}. Le serveur applique les droits à partir de ce profil connecté par PIN.</Text>
            <TouchableOpacity style={styles.primaryButton} onPress={() => syncFromServer(true)}><Text style={styles.primaryButtonText}>Tester et synchroniser</Text></TouchableOpacity>
            <TouchableOpacity style={styles.secondaryButton} onPress={() => Alert.alert('Désactiver la synchronisation ?', 'La session sera fermée et le cache effacé. Une opération à vérifier restera signalée pour ce compte.', [{ text: 'Annuler', style: 'cancel' }, { text: 'Désactiver', style: 'destructive', onPress: () => { resetSession(); setApiUrl(''); setShowGlance(false); } }])}><Text style={styles.secondaryButtonText}>Désactiver la synchronisation</Text></TouchableOpacity>
            <TouchableOpacity style={styles.secondaryButton} onPress={showRoleInfo}><Text style={styles.secondaryButtonText}>Voir sécurité et rôles</Text></TouchableOpacity>
            <TouchableOpacity style={styles.secondaryButton} onPress={() => Alert.alert('Se déconnecter ?', 'Le cache et la session seront effacés. Une opération à vérifier restera signalée pour ce compte. Il faudra ressaisir ton PIN.', [{ text: 'Annuler', style: 'cancel' }, { text: 'Se déconnecter', style: 'destructive', onPress: logout }])}><Text style={styles.secondaryButtonText}>Se déconnecter</Text></TouchableOpacity>
            {isAdmin && <View style={styles.card}>
              <Text style={styles.cardTitle}>Sauvegarde et exports</Text>
              <Text style={styles.muted}>Actions réservées à l’administrateur. Les fichiers sont créés sur le serveur dans server/backups/.</Text>
              <TouchableOpacity style={styles.primaryButton} onPress={createServerBackup}><Text style={styles.primaryButtonText}>Créer une sauvegarde SQLite</Text></TouchableOpacity>
              <TouchableOpacity style={styles.secondaryButton} onPress={exportServerJson}><Text style={styles.secondaryButtonText}>Exporter les données JSON</Text></TouchableOpacity>
              <TouchableOpacity style={styles.secondaryButton} onPress={exportServerCsv}><Text style={styles.secondaryButtonText}>Exporter dépenses / versements CSV</Text></TouchableOpacity>
              <TouchableOpacity style={styles.secondaryButton} onPress={showRestoreInfo}><Text style={styles.secondaryButtonText}>Aide restauration</Text></TouchableOpacity>
            </View>}
            <Text style={styles.help}>Sur vos téléphones, configurez la même URL Tailscale du vieux PC. Exemple : http://100.64.12.34:3001</Text>
          </ScrollView>
        </SafeAreaView>
      </Modal>

      <Modal visible={profileModal} animationType="slide" presentationStyle="pageSheet">
        <SafeAreaView style={styles.modalSafe}>
          <View style={[styles.modalHeader, largeText && styles.stacked]}>
            <TouchableOpacity onPress={() => { setProfileModal(false); setPinStage(null); }}><Text style={styles.modalAction}>Fermer</Text></TouchableOpacity>
            <Text style={styles.modalTitle}>Changer de profil</Text>
            <Text style={styles.modalAction}> </Text>
          </View>
          <ScrollView contentContainerStyle={styles.modalContent}>
            {pinStage ? renderPinStageForm() : renderAuthMemberList()}
          </ScrollView>
        </SafeAreaView>
      </Modal>

      <Modal visible={pinManageModal} animationType="slide" presentationStyle="pageSheet">
        <SafeAreaView style={styles.modalSafe}>
          <View style={[styles.modalHeader, largeText && styles.stacked]}>
            <TouchableOpacity onPress={() => { setPinManageModal(false); setPinManageDraft({ currentPin: '', newPin: '', newPin2: '' }); }}><Text style={styles.modalAction}>Annuler</Text></TouchableOpacity>
            <Text style={styles.modalTitle}>Modifier mon PIN</Text>
            <TouchableOpacity onPress={submitPinManage}><Text style={styles.modalAction}>Valider</Text></TouchableOpacity>
          </View>
          <ScrollView contentContainerStyle={styles.modalContent}>
            <Text style={styles.label}>PIN actuel</Text>
            <TextInput style={styles.input} placeholder="PIN actuel" keyboardType="number-pad" secureTextEntry maxLength={8} value={pinManageDraft.currentPin} onChangeText={(currentPin) => setPinManageDraft((d) => ({ ...d, currentPin }))} />
            <Text style={styles.label}>Nouveau PIN</Text>
            <TextInput style={styles.input} placeholder="Nouveau PIN (4 à 8 chiffres)" keyboardType="number-pad" secureTextEntry maxLength={8} value={pinManageDraft.newPin} onChangeText={(newPin) => setPinManageDraft((d) => ({ ...d, newPin }))} />
            <Text style={styles.label}>Confirme le nouveau PIN</Text>
            <TextInput style={styles.input} placeholder="Confirme le nouveau PIN" keyboardType="number-pad" secureTextEntry maxLength={8} value={pinManageDraft.newPin2} onChangeText={(newPin2) => setPinManageDraft((d) => ({ ...d, newPin2 }))} />
            <Text style={styles.help}>Le PIN n’est jamais stocké en clair : le serveur ne conserve qu’un hash salé.</Text>
          </ScrollView>
        </SafeAreaView>
      </Modal>
    </SafeAreaView>
    </SafeAreaProvider>
  );
}

function Metric({ label, value }) { const {fontScale,width}=useWindowDimensions(); return <View style={[styles.metric, (fontScale >= 1.3 || width < 340) && styles.fullWidth]}><Text style={styles.metricLabel}>{label}</Text><Text style={styles.metricValue}>{value}</Text></View>; }
function PersonCard({ state }) { const {fontScale,width}=useWindowDimensions(); const largeText=fontScale >= 1.3 || width < 340; return <View style={styles.card}><View style={[styles.rowBetween, largeText && styles.stacked]}><Text style={styles.cardTitle}>{state.member.name}</Text><Text style={dashboardModel.presentedAmount(state.missing) <= 0 ? styles.badgeOk : styles.badgeWarn}>{dashboardModel.presentedAmount(state.missing) <= 0 ? 'OK' : `Reste ${formatEuro(state.missing)}`}</Text></View><Text style={styles.muted}>Prévu : {formatEuro(state.expected)}</Text><Text style={styles.muted}>Déjà versé : {formatEuro(state.paid)}</Text><Text style={styles.muted}>Dépenses payées personnellement : {formatEuro(state.personallyPaidExpenses)}</Text></View>; }
function CategorySummary({ category }) {
  const {fontScale,width}=useWindowDimensions(); const largeText=fontScale >= 1.3 || width < 340;
  const pct = category.availableBudget ? Math.min(100, Math.max(0, (category.spent / category.availableBudget) * 100)) : 0;
  // F-01: badge follows the displayed cents (same labels and priority as before).
  const envelopeStatus = dashboardModel.envelopePresentation(category).status;
  const badgeStyle = envelopeStatus ? styles.badgeWarn : styles.badgeOk;
  const badgeText = envelopeStatus || 'OK';
  return <View style={styles.card}>
    <View style={[styles.rowBetween, largeText && styles.stacked]}><Text style={styles.cardTitle}>{category.name}</Text><Text style={badgeStyle}>{badgeText}</Text></View>
    <View style={styles.progress}><View style={[styles.progressFill, { width: `${pct}%` }]} /></View>
    <Text style={styles.muted}>Report précédent : {formatEuro(category.carryOver)}</Text>
    <Text style={styles.muted}>Budget du mois : {formatEuro(category.monthlyBudget)}</Text>
    <Text style={styles.muted}>Disponible budget : {formatEuro(category.availableBudget)} · Dépensé : {formatEuro(category.spent)}</Text>
    <Text style={styles.muted}>Solde caisse réel : {formatEuro(category.cashBalance)}</Text>
  </View>;
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: palette.background },
  compactHeader: { flexDirection:'row', alignItems:'center', justifyContent:'space-between', gap:8, padding:8, backgroundColor:palette.background },
  brandRow: { flexDirection:'row', alignItems:'center', flexShrink:1, gap:8 }, brandMark:{width:32,height:32}, brandName:{fontSize:19,fontWeight:'700',color:palette.midnight,flexShrink:1}, compactConfig:{minHeight:44,justifyContent:'center',paddingHorizontal:12,borderRadius:12,backgroundColor:palette.lightBlue}, compactConfigText:{color:'#304DB2',fontWeight:'600',textAlign:'center'}, compactMonth:{flexDirection:'row',alignItems:'center',justifyContent:'space-between',gap:8,paddingHorizontal:8,paddingBottom:12}, compactArrow:{minWidth:44,minHeight:44,alignItems:'center',justifyContent:'center',backgroundColor:palette.surface,borderRadius:12}, compactArrowText:{fontSize:26,color:palette.midnight},monthWrap:{flexWrap:'wrap'},monthCenter:{flex:1,minWidth:0,flexShrink:1,padding:8,minHeight:44,justifyContent:'center'},monthCaption:{fontSize:16,fontWeight:'600',color:palette.midnight,textAlign:'center'},
  stacked: { flexDirection: 'column', alignItems: 'stretch' },
  fullWidth: { width: '100%', flex: 0 },
  headerCopy: { flexShrink: 1, minWidth: 0 },
  header: { backgroundColor: '#0F172A', paddingHorizontal: 22, paddingTop: 18, paddingBottom: 22, flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  title: { color: 'white', fontSize: 31, fontWeight: '900' }, subtitle: { color: '#CBD5E1', fontSize: 16, marginTop: 2 }, syncText: { fontSize: 12, marginTop: 6, fontWeight: '700' }, online: { color: '#86EFAC' }, offline: { color: '#FCA5A5' },
  headerButton: { backgroundColor: '#334155', paddingHorizontal: 14, paddingVertical: 10, borderRadius: 15 }, headerButtonText: { textAlign: 'center', color: 'white', fontWeight: '900' },
  monthRow: { flexDirection: 'row', alignItems: 'center', gap: 8, paddingHorizontal: 14, paddingTop: 14, paddingBottom: 10, backgroundColor: 'white' }, navButton: { backgroundColor: '#0F172A', minWidth: 48, minHeight: 48, borderRadius: 13, alignItems: 'center', justifyContent: 'center' }, navText: { color: 'white', fontSize: 34, fontWeight: '900' }, monthLabel: { flex: 1, backgroundColor: '#F8FAFC', borderWidth: 1, borderColor: '#E5E7EB', borderRadius: 14, paddingVertical: 14, paddingHorizontal: 8, textAlign: 'center', fontSize: 20, fontWeight: '900' }, monthOkButton: { backgroundColor: '#334155', minHeight: 48, paddingHorizontal: 12, borderRadius: 13, alignItems: 'center', justifyContent: 'center' }, monthOkText: { color: 'white', fontSize: 13, fontWeight: '900' },
  tabsOuter: { backgroundColor: 'white', paddingHorizontal: 14, paddingTop: 4, paddingBottom: 12, borderBottomWidth: 1, borderBottomColor: '#E5E7EB' }, tabsContent: { flexDirection: 'row', gap: 8, padding: 8, backgroundColor: '#FFFFFF', borderRadius: 18, borderWidth: 1, borderColor: '#E5E7EB' }, tab: { paddingVertical: 10, paddingHorizontal: 16, borderRadius: 999, backgroundColor: '#EEF2F7', minWidth: 104, alignItems: 'center', borderWidth: 1, borderColor: '#E5E7EB' }, activeTab: { backgroundColor: '#111827', borderColor: '#111827' }, tabText: { color: '#475467', fontSize: 13, fontWeight: '800' }, activeTabText: { color: 'white' },
  content: { flex: 1 }, contentInner: { padding: 18, paddingBottom: 70 }, hero: { backgroundColor: '#0F172A', borderRadius: 22, padding: 22, marginBottom: 18 }, sectionTitle: { fontSize: 23, fontWeight: '900', color: '#111827', marginTop: 18, marginBottom: 12 }, sectionTitleDark: { color: 'white', fontSize: 22, fontWeight: '900', marginBottom: 16 }, metricGrid: { flexDirection: 'row', flexWrap: 'wrap', gap: 12 }, metric: { width: '47%', backgroundColor: '#1E293B', borderRadius: 16, padding: 15 }, metricLabel: { color: '#CBD5E1', fontSize: 14 }, metricValue: { color: 'white', fontSize: 24, fontWeight: '900', marginTop: 6 },
  card: { backgroundColor: 'white', borderRadius: 18, padding: 18, marginBottom: 14, borderWidth: 1, borderColor: '#E5E7EB' }, rowBetween: { flexDirection: 'row', flexWrap: 'wrap', justifyContent: 'space-between', alignItems: 'center', gap: 10 }, rowGap: { flexDirection: 'row', flexWrap: 'wrap', gap: 10, marginTop: 12 }, cardTitle: { fontSize: 20, fontWeight: '900', color: '#111827', flexShrink: 1 }, muted: { color: '#4B5563', fontSize: 16, marginTop: 6 }, amount: { fontSize: 20, fontWeight: '900', color: '#111827' }, label: { fontSize: 16, fontWeight: '900', color: '#374151', marginTop: 10, marginBottom: 8 }, input: { backgroundColor: '#F8FAFC', borderWidth: 1, borderColor: '#E5E7EB', borderRadius: 14, paddingHorizontal: 16, paddingVertical: 14, fontSize: 17, marginBottom: 10 }, textarea: { minHeight: 100, textAlignVertical: 'top' }, choiceRow: { flexDirection: 'row', gap: 8, paddingBottom: 8 }, choice: { backgroundColor: '#F3F4F6', borderRadius: 999, paddingHorizontal: 16, paddingVertical: 11, borderWidth: 1, borderColor: '#E5E7EB' }, choiceActive: { backgroundColor: '#0F172A', borderColor: '#0F172A' }, choiceText: { color: '#374151', fontWeight: '900', fontSize: 15 }, choiceTextActive: { color: 'white' },
  primaryButton: { backgroundColor: '#0F172A', borderRadius: 16, paddingVertical: 16, alignItems: 'center', marginTop: 8, marginBottom: 10 }, primaryButtonText: { textAlign: 'center', color: 'white', fontWeight: '900', fontSize: 16 }, secondaryButton: { backgroundColor: '#E5E7EB', borderRadius: 16, paddingVertical: 16, alignItems: 'center', marginTop: 10 }, secondaryButtonText: { textAlign: 'center', color: '#111827', fontWeight: '900' }, dangerButton: { backgroundColor: '#FEE2E2', borderRadius: 14, paddingVertical: 13, alignItems: 'center', marginTop: 12 }, smallButton: { backgroundColor: '#0F172A', borderRadius: 12, paddingHorizontal: 15, paddingVertical: 11 }, smallButtonText: { color: 'white', fontWeight: '900' }, smallDanger: { backgroundColor: '#FEE2E2', borderRadius: 12, paddingHorizontal: 15, paddingVertical: 11 }, dangerText: { color: '#991B1B', fontWeight: '900' }, badge: { backgroundColor: '#E0F2FE', color: '#075985', paddingHorizontal: 12, paddingVertical: 7, borderRadius: 999, overflow: 'hidden', fontWeight: '900' }, badgeOk: { backgroundColor: '#DCFCE7', color: '#166534', paddingHorizontal: 12, paddingVertical: 7, borderRadius: 999, overflow: 'hidden', fontWeight: '900' }, badgeWarn: { backgroundColor: '#FEE2E2', color: '#991B1B', paddingHorizontal: 12, paddingVertical: 7, borderRadius: 999, overflow: 'hidden', fontWeight: '900' }, badgePlanned: { backgroundColor: '#FEF3C7', color: '#92400E', paddingHorizontal: 12, paddingVertical: 7, borderRadius: 999, overflow: 'hidden', fontWeight: '900' }, badgeRow: { flexDirection: 'row', flexWrap: 'wrap', alignItems: 'center', gap: 8 }, progress: { height: 10, backgroundColor: '#E5E7EB', borderRadius: 999, marginVertical: 12, overflow: 'hidden' }, progressFill: { height: 10, backgroundColor: '#0F172A' }, lockedText: { color: '#6B7280', fontSize: 13, marginTop: 10, fontWeight: '700' },
  modalSafe: { flex: 1, backgroundColor: '#F3F4F6' }, modalHeader: { flexWrap: 'wrap', gap: 8, backgroundColor: 'white', padding: 18, borderBottomWidth: 1, borderBottomColor: '#E5E7EB', flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' }, modalTitle: { fontSize: 24, fontWeight: '900', color: '#111827' }, modalAction: { color: '#2563EB', fontSize: 17, fontWeight: '900' }, modalContent: { padding: 18 }, help: { color: '#475467', marginTop: 18, fontSize: 15, lineHeight: 22 },
});
