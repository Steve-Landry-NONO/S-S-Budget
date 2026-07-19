import React, { useEffect, useMemo, useState } from 'react';
import {
  Alert,
  Modal,
  SafeAreaView,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  View,
} from 'react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { StatusBar } from 'expo-status-bar';

const CACHE_KEY = 'SS_BUDGET_V2_CACHE';
const API_KEY = 'SS_BUDGET_V2_API_URL';
const SECRET_KEY = 'SS_BUDGET_V2_API_SECRET';
const USER_KEY = 'SS_BUDGET_V2_CURRENT_USER_ID';
const DELETE_WINDOW_DAYS = 5;
const defaultStartMonth = '2026-07';

const todayKey = () => new Date().toISOString().slice(0, 10);
const currentMonthKey = () => todayKey().slice(0, 7);

const uid = (prefix = 'id') => `${prefix}_${Math.random().toString(36).slice(2)}_${Date.now().toString(36)}`;
const formatEuro = (value) => `${Number(value || 0).toFixed(2).replace('.', ',')} €`;
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
  const [apiUrl, setApiUrl] = useState('');
  const [apiSecret, setApiSecret] = useState('');
  const [currentUserId, setCurrentUserId] = useState('steve');
  const [connected, setConnected] = useState(false);
  const [syncMessage, setSyncMessage] = useState('Mode local');
  const [members, setMembers] = useState(initialState.members);
  const [categories, setCategories] = useState(initialState.categories);
  const [expenses, setExpenses] = useState([]);
  const [contributions, setContributions] = useState([]);
  const [selectedMonth, setSelectedMonth] = useState(currentMonthKey());
  const [monthDraft, setMonthDraft] = useState(currentMonthKey());
  const [tab, setTab] = useState('dashboard');
  const [expenseDraft, setExpenseDraft] = useState({ label: '', amount: '', categoryId: 'weekends', paidByMemberId: 'steve', date: monthDefaultDate(currentMonthKey()) });
  const [contributionDraft, setContributionDraft] = useState({ amount: '', categoryId: 'weekends', memberId: 'steve', date: monthDefaultDate(currentMonthKey()) });
  const [autoDraft, setAutoDraft] = useState({ mode: 'all', memberId: 'steve', monthsCount: '1', date: monthDefaultDate(currentMonthKey()) });
  const [categoryModal, setCategoryModal] = useState(false);
  const [editingCategory, setEditingCategory] = useState(null);
  const [settingsModal, setSettingsModal] = useState(false);
  const [memberDraft, setMemberDraft] = useState('');

  useEffect(() => { loadLocal(); }, []);

  useEffect(() => {
    saveLocal();
    if (!firstId(members) || !firstId(categories)) return;
    setExpenseDraft((d) => ({ ...d, paidByMemberId: members.find((m) => m.id === d.paidByMemberId)?.id || firstId(members), categoryId: categories.find((c) => c.id === d.categoryId)?.id || firstId(categories) }));
    setContributionDraft((d) => ({ ...d, memberId: members.find((m) => m.id === d.memberId)?.id || firstId(members), categoryId: categories.find((c) => c.id === d.categoryId)?.id || firstId(categories) }));
    setAutoDraft((d) => ({ ...d, memberId: members.find((m) => m.id === d.memberId)?.id || firstId(members) }));
  }, [members, categories, expenses, contributions, selectedMonth, apiUrl, apiSecret, currentUserId]);

  useEffect(() => {
    setMonthDraft(selectedMonth);
    const date = monthDefaultDate(selectedMonth);
    setExpenseDraft((d) => ({ ...d, date }));
    setContributionDraft((d) => ({ ...d, date }));
    setAutoDraft((d) => ({ ...d, date }));
  }, [selectedMonth]);

  useEffect(() => {
    if (!apiUrl) return;
    syncFromServer(false);
    const timer = setInterval(() => syncFromServer(false), 15000);
    return () => clearInterval(timer);
  }, [apiUrl, apiSecret, currentUserId]);

  const request = async (path, options = {}) => {
    if (!apiUrl.trim()) throw new Error('Aucune URL serveur configurée.');
    const url = `${apiUrl.replace(/\/$/, '')}${path}`;
    const response = await fetch(url, {
      ...options,
      headers: {
        'Content-Type': 'application/json',
        ...(apiSecret ? { 'x-ss-budget-secret': apiSecret } : {}),
        ...(currentUserId ? { 'x-ss-budget-user-id': currentUserId } : {}),
        ...(options.headers || {}),
      },
    });
    const data = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(data.error || `Erreur serveur ${response.status}`);
    return data;
  };

  const applyServerState = (data) => {
    setMembers((data.members || []).map((m) => ({ ...m, role: currentMemberRole(m) })));
    setCategories((data.categories || []).map((c) => ({ ...c, locked: Boolean(c.locked), active: c.active !== false })));
    setExpenses(data.expenses || []);
    setContributions(data.contributions || []);
    setConnected(true);
    setSyncMessage(`Synchronisé ${new Date().toLocaleTimeString('fr-FR').slice(0, 5)}`);
  };

  const syncFromServer = async (showAlert = true) => {
    try {
      const data = await request('/api/state');
      applyServerState(data);
      if (showAlert) Alert.alert('Synchronisation réussie', 'Les données du serveur ont été chargées.');
    } catch (error) {
      setConnected(false);
      setSyncMessage(`Hors ligne : ${error.message}`);
      if (showAlert) Alert.alert('Synchronisation impossible', error.message);
    }
  };

  const mutate = async (path, method, body, fallback) => {
    try {
      const data = await request(path, { method, body: JSON.stringify(body || {}) });
      applyServerState(data);
    } catch (error) {
      setConnected(false);
      setSyncMessage(`Mode local : ${error.message}`);
      fallback?.();
      Alert.alert('Serveur non disponible', `Action appliquée en local uniquement.\n\n${error.message}`);
    }
  };

  const loadLocal = async () => {
    try {
      const [cache, storedApi, storedSecret, storedUserId] = await Promise.all([
        AsyncStorage.getItem(CACHE_KEY),
        AsyncStorage.getItem(API_KEY),
        AsyncStorage.getItem(SECRET_KEY),
        AsyncStorage.getItem(USER_KEY),
      ]);
      if (storedApi) setApiUrl(storedApi);
      if (storedSecret) setApiSecret(storedSecret);
      if (storedUserId) setCurrentUserId(storedUserId);
      if (cache) {
        const data = JSON.parse(cache);
        setMembers((data.members || initialState.members).map((m) => ({ ...m, role: currentMemberRole(m) })));
        setCategories(data.categories || initialState.categories);
        setExpenses(data.expenses || []);
        setContributions(data.contributions || []);
        // Au lancement, l'app revient automatiquement sur le mois courant.
        // L'historique reste accessible avec les flèches ou la saisie AAAA-MM.
        setSelectedMonth(currentMonthKey());
      }
    } catch (error) {
      Alert.alert('Erreur', 'Impossible de charger le cache local.');
    }
  };

  const saveLocal = async () => {
    await AsyncStorage.setItem(CACHE_KEY, JSON.stringify({ members, categories, expenses, contributions, selectedMonth }));
    await AsyncStorage.setItem(API_KEY, apiUrl || '');
    await AsyncStorage.setItem(SECRET_KEY, apiSecret || '');
    await AsyncStorage.setItem(USER_KEY, currentUserId || 'steve');
  };

  const monthExpenseRows = useMemo(() => expenses.filter((e) => String(e.date || '').startsWith(selectedMonth)), [expenses, selectedMonth]);
  const monthContributionRows = useMemo(() => contributions.filter((c) => String(c.date || '').startsWith(selectedMonth)), [contributions, selectedMonth]);
  const monthExpenses = useMemo(() => monthExpenseRows.filter((e) => !isPlannedAction(e)), [monthExpenseRows]);
  const monthContributions = useMemo(() => monthContributionRows.filter((c) => !isPlannedAction(c)), [monthContributionRows]);
  const plannedMonthExpenses = useMemo(() => monthExpenseRows.filter(isPlannedAction), [monthExpenseRows]);
  const plannedMonthContributions = useMemo(() => monthContributionRows.filter(isPlannedAction), [monthContributionRows]);

  const summary = useMemo(() => categories.map((category) => {
    const spent = monthExpenses.filter((e) => e.categoryId === category.id).reduce((sum, e) => sum + Number(e.amount || 0), 0);
    const paidIn = monthContributions.filter((c) => c.categoryId === category.id).reduce((sum, c) => sum + Number(c.amount || 0), 0);
    const monthlyBudget = Number(category.monthlyPerPerson || 0) * members.length;
    return { ...category, spent, paidIn, monthlyBudget, remainingBudget: monthlyBudget - spent, cashBalance: paidIn - spent, overBudget: spent > monthlyBudget };
  }), [categories, members, monthExpenses, monthContributions]);

  const totals = useMemo(() => summary.reduce((acc, c) => ({
    monthlyBudget: acc.monthlyBudget + c.monthlyBudget,
    spent: acc.spent + c.spent,
    paidIn: acc.paidIn + c.paidIn,
    cashBalance: acc.cashBalance + c.cashBalance,
  }), { monthlyBudget: 0, spent: 0, paidIn: 0, cashBalance: 0 }), [summary]);


  const plannedTotals = useMemo(() => ({
    spent: plannedMonthExpenses.reduce((sum, e) => sum + Number(e.amount || 0), 0),
    paidIn: plannedMonthContributions.reduce((sum, c) => sum + Number(c.amount || 0), 0),
  }), [plannedMonthExpenses, plannedMonthContributions]);

  const hasPlannedActions = plannedTotals.spent > 0 || plannedTotals.paidIn > 0;

  const personState = useMemo(() => members.map((member) => {
    const expected = categories.reduce((sum, c) => sum + Number(c.monthlyPerPerson || 0), 0);
    const paid = monthContributions.filter((c) => c.memberId === member.id).reduce((sum, c) => sum + Number(c.amount || 0), 0);
    const personallyPaidExpenses = monthExpenses.filter((e) => e.paidByMemberId === member.id).reduce((sum, e) => sum + Number(e.amount || 0), 0);
    return { member, expected, paid, missing: expected - paid, personallyPaidExpenses };
  }), [members, categories, monthContributions, monthExpenses]);

  const currentMember = useMemo(() => members.find((m) => m.id === currentUserId) || members[0] || initialState.members[0], [members, currentUserId]);
  const currentRole = currentMemberRole(currentMember);
  const isAdmin = currentRole === 'admin';

  const updateMonth = (direction) => {
    setSelectedMonth((current) => addMonths(current, direction));
  };

  const applyMonthDraft = () => {
    const normalized = normalizeMonth(monthDraft);
    if (!normalized) return Alert.alert('Mois invalide', 'Utilise le format AAAA-MM, par exemple 2026-07.');
    setSelectedMonth(normalized);
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
      mutate('/api/expenses', 'POST', payload, () => setExpenses((list) => [payload, ...list]));
      setExpenseDraft((d) => ({ ...d, label: '', amount: '' }));
    });
  };

  const addContribution = () => {
    const amount = parseAmount(contributionDraft.amount);
    if (!Number.isFinite(amount) || amount <= 0) return Alert.alert('Montant invalide', 'Le montant doit être supérieur à 0.');
    if (!isValidDateForMonth(contributionDraft.date, selectedMonth)) return Alert.alert('Date invalide', `Utilise une vraie date du mois ${selectedMonth}, au format AAAA-MM-JJ.`);

    confirmFutureDateIfNeeded(contributionDraft.date, 'versement', (status) => {
      const payload = { ...contributionDraft, id: uid('contribution'), amount, status, createdByMemberId: currentUserId };
      mutate('/api/contributions', 'POST', payload, () => setContributions((list) => [payload, ...list]));
      setContributionDraft((d) => ({ ...d, amount: '' }));
    });
  };

  const addAutoContributions = () => {
    if (!isValidDateForMonth(autoDraft.date, selectedMonth)) return Alert.alert('Date invalide', `Utilise une vraie date du mois ${selectedMonth}, au format AAAA-MM-JJ.`);
    const memberIds = autoDraft.mode === 'all' ? members.map((m) => m.id) : [autoDraft.memberId];
    const monthsCount = Math.max(1, parseInt(autoDraft.monthsCount || '1', 10));

    confirmFutureDateIfNeeded(autoDraft.date, 'versement automatique', (status) => {
      const localRows = memberIds.flatMap((memberId) => categories.map((category) => ({
        id: uid('auto'), memberId, categoryId: category.id, amount: Number(category.monthlyPerPerson || 0) * monthsCount, date: autoDraft.date, status, note: `Versement automatique (${monthsCount} mois)`,
      })).filter((row) => row.amount > 0));
      mutate('/api/auto-contributions', 'POST', { memberIds, monthsCount, date: autoDraft.date, status }, () => setContributions((list) => [...localRows, ...list]));
    });
  };

  const removeExpense = (expense) => {
    if (!canDeleteRecentAction(expense, currentUserId, currentRole, 'paidByMemberId')) {
      return Alert.alert('Suppression bloquée', `Une dépense ne peut être supprimée que pendant ${DELETE_WINDOW_DAYS} jours. Un membre ne peut supprimer que ses propres actions.`);
    }
    Alert.alert('Supprimer la dépense', `Supprimer « ${expense.label} » ?`, [
      { text: 'Annuler', style: 'cancel' },
      { text: 'Supprimer', style: 'destructive', onPress: () => mutate(`/api/expenses/${expense.id}`, 'DELETE', {}, () => setExpenses((list) => list.filter((e) => e.id !== expense.id))) },
    ]);
  };

  const removeContribution = (contribution) => {
    if (!canDeleteRecentAction(contribution, currentUserId, currentRole, 'memberId')) {
      return Alert.alert('Suppression bloquée', `Un versement ne peut être supprimé que pendant ${DELETE_WINDOW_DAYS} jours. Un membre ne peut supprimer que ses propres actions.`);
    }
    Alert.alert('Supprimer le versement', `Supprimer le versement de ${formatEuro(contribution.amount)} ?`, [
      { text: 'Annuler', style: 'cancel' },
      { text: 'Supprimer', style: 'destructive', onPress: () => mutate(`/api/contributions/${contribution.id}`, 'DELETE', {}, () => setContributions((list) => list.filter((c) => c.id !== contribution.id))) },
    ]);
  };

  const saveCategory = () => {
    const amount = parseAmount(editingCategory.monthlyPerPerson);
    if (!editingCategory.name.trim()) return Alert.alert('Caisse incomplète', 'Ajoute un nom.');
    if (!Number.isFinite(amount) || amount < 0) return Alert.alert('Budget invalide', 'Le budget doit être positif.');
    const payload = { ...editingCategory, monthlyPerPerson: amount };
    if (editingCategory.isNew) {
      payload.id = uid('category');
      mutate('/api/categories', 'POST', payload, () => setCategories((list) => [...list, { ...payload, active: true }]));
    } else {
      mutate(`/api/categories/${payload.id}`, 'PUT', payload, () => setCategories((list) => list.map((c) => (c.id === payload.id ? payload : c))));
    }
    setCategoryModal(false);
  };

  const deleteCategory = (category) => {
    Alert.alert('Supprimer la caisse', `Supprimer ${category.name} ?`, [
      { text: 'Annuler', style: 'cancel' },
      { text: 'Supprimer', style: 'destructive', onPress: () => mutate(`/api/categories/${category.id}`, 'DELETE', {}, () => setCategories((list) => list.filter((c) => c.id !== category.id))) },
    ]);
  };

  const addMember = () => {
    const name = memberDraft.trim();
    if (!name) return;
    const payload = { id: uid('member'), name };
    mutate('/api/members', 'POST', payload, () => setMembers((list) => [...list, payload]));
    setMemberDraft('');
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

  const getMemberName = (id) => members.find((m) => m.id === id)?.name || 'Membre supprimé';
  const getCategoryName = (id) => categories.find((c) => c.id === id)?.name || 'Caisse supprimée';

  return (
    <SafeAreaView style={styles.safe}>
      <StatusBar style="light" />
      <View style={styles.header}>
        <View>
          <Text style={styles.title}>S&S Budget</Text>
          <Text style={styles.subtitle}>Gestion de budget de couple</Text>
          <Text style={[styles.syncText, connected ? styles.online : styles.offline]}>{syncMessage}</Text>
        </View>
        <TouchableOpacity style={styles.headerButton} onPress={() => setSettingsModal(true)}><Text style={styles.headerButtonText}>Config</Text></TouchableOpacity>
      </View>

      <View style={styles.monthRow}>
        <TouchableOpacity style={styles.navButton} onPress={() => updateMonth(-1)}><Text style={styles.navText}>‹</Text></TouchableOpacity>
        <TextInput
          style={styles.monthLabel}
          value={monthDraft}
          onChangeText={setMonthDraft}
          onSubmitEditing={applyMonthDraft}
          autoCapitalize="none"
          autoCorrect={false}
          keyboardType="numbers-and-punctuation"
          placeholder="AAAA-MM"
        />
        <TouchableOpacity style={styles.monthOkButton} onPress={applyMonthDraft}><Text style={styles.monthOkText}>OK</Text></TouchableOpacity>
        <TouchableOpacity style={styles.navButton} onPress={() => updateMonth(1)}><Text style={styles.navText}>›</Text></TouchableOpacity>
      </View>

      <View style={styles.tabsOuter}>
        <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.tabsContent}>
          {[
            ['dashboard', 'Synthèse'], ['expenses', 'Dépenses'], ['contributions', 'Versements'], ['categories', 'Caisses'], ['members', 'Membres'],
          ].map(([key, label]) => (
            <TouchableOpacity key={key} style={[styles.tab, tab === key && styles.activeTab]} onPress={() => setTab(key)}>
              <Text style={[styles.tabText, tab === key && styles.activeTabText]}>{label}</Text>
            </TouchableOpacity>
          ))}
        </ScrollView>
      </View>

      <ScrollView style={styles.content} contentContainerStyle={styles.contentInner}>
        {tab === 'dashboard' && (
          <>
            <View style={styles.hero}>
              <Text style={styles.sectionTitleDark}>Vue générale du mois</Text>
              <View style={styles.metricGrid}>
                <Metric label="Budget prévu" value={formatEuro(totals.monthlyBudget)} dark />
                <Metric label="Dépensé" value={formatEuro(totals.spent)} dark />
                <Metric label="Versé" value={formatEuro(totals.paidIn)} dark />
                <Metric label="Solde compte" value={formatEuro(totals.cashBalance)} dark />
              </View>
            </View>
            <TouchableOpacity style={styles.primaryButton} onPress={() => updateMonth(1)}><Text style={styles.primaryButtonText}>Nouveau mois</Text></TouchableOpacity>
            <Text style={styles.sectionTitle}>État par membre</Text>
            {personState.map((state) => <PersonCard key={state.member.id} state={state} />)}
            <Text style={styles.sectionTitle}>Situation des caisses</Text>
            {summary.map((category) => <CategorySummary key={category.id} category={category} />)}
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
                <View style={styles.rowBetween}><Text style={styles.cardTitle}>{expense.label}</Text><Text style={styles.amount}>{formatEuro(expense.amount)}</Text></View>
                <View style={styles.rowBetween}><Text style={styles.muted}>{getCategoryName(expense.categoryId)} · payé par {getMemberName(expense.paidByMemberId)}</Text><Text style={styles[statusStyleName(expense)]}>{statusLabel(expense)}</Text></View>
                <Text style={styles.muted}>{expense.date}</Text>
                {canDeleteRecentAction(expense, currentUserId, currentRole, 'paidByMemberId') ? (
                  <TouchableOpacity style={styles.dangerButton} onPress={() => removeExpense(expense)}><Text style={styles.dangerText}>Supprimer</Text></TouchableOpacity>
                ) : (
                  <Text style={styles.lockedText}>Suppression verrouillée après {DELETE_WINDOW_DAYS} jours ou réservée au membre concerné.</Text>
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
                <View style={styles.rowBetween}><Text style={styles.cardTitle}>{getMemberName(contribution.memberId)}</Text><Text style={styles.amount}>{formatEuro(contribution.amount)}</Text></View>
                <View style={styles.rowBetween}><Text style={styles.muted}>{getCategoryName(contribution.categoryId)}</Text><Text style={styles[statusStyleName(contribution)]}>{statusLabel(contribution)}</Text></View><Text style={styles.muted}>{contribution.date}</Text>
                {canDeleteRecentAction(contribution, currentUserId, currentRole, 'memberId') ? (
                  <TouchableOpacity style={styles.dangerButton} onPress={() => removeContribution(contribution)}><Text style={styles.dangerText}>Supprimer</Text></TouchableOpacity>
                ) : (
                  <Text style={styles.lockedText}>Suppression verrouillée après {DELETE_WINDOW_DAYS} jours ou réservée au membre concerné.</Text>
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
                <View style={styles.rowBetween}><Text style={styles.cardTitle}>{category.name}</Text><Text style={styles.badge}>{category.locked ? 'Verrouillée' : 'Libre'}</Text></View>
                <Text style={styles.muted}>{category.description}</Text>
                <Text style={styles.muted}>Budget : {formatEuro(category.monthlyBudget)} · Dépensé : {formatEuro(category.spent)}</Text>
                <Text style={styles.muted}>Solde caisse : {formatEuro(category.cashBalance)}</Text>
                {isAdmin && <View style={styles.rowGap}>
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
            <Text style={styles.label}>Utilisateur de ce téléphone</Text>
            {renderChoice(members, currentUserId, setCurrentUserId)}
            <Text style={styles.help}>Ce choix permet à l’app et au serveur de savoir qui réalise les actions. Steve est administrateur, Sorelle est membre.</Text>
            {members.map((member) => <View key={member.id} style={styles.card}><View style={styles.rowBetween}><Text style={styles.cardTitle}>{member.name}</Text><Text style={currentMemberRole(member) === 'admin' ? styles.badge : styles.badgeOk}>{currentMemberRole(member) === 'admin' ? 'Admin' : 'Membre'}</Text></View><Text style={styles.muted}>ID : {member.id}</Text></View>)}
          </>
        )}
      </ScrollView>

      <Modal visible={categoryModal} animationType="slide" presentationStyle="pageSheet">
        <SafeAreaView style={styles.modalSafe}>
          <View style={styles.modalHeader}><Text style={styles.modalTitle}>{editingCategory?.isNew ? 'Créer une caisse' : 'Modifier la caisse'}</Text><TouchableOpacity onPress={saveCategory}><Text style={styles.modalAction}>Valider</Text></TouchableOpacity></View>
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
          <View style={styles.modalHeader}><Text style={styles.modalTitle}>Configuration serveur</Text><TouchableOpacity onPress={() => { saveLocal(); setSettingsModal(false); syncFromServer(false); }}><Text style={styles.modalAction}>Valider</Text></TouchableOpacity></View>
          <ScrollView contentContainerStyle={styles.modalContent}>
            <Text style={styles.label}>URL API maison</Text>
            <TextInput style={styles.input} placeholder="http://100.x.y.z:3001" autoCapitalize="none" value={apiUrl} onChangeText={setApiUrl} />
            <Text style={styles.label}>Secret API optionnel</Text>
            <TextInput style={styles.input} placeholder="APP_SECRET" autoCapitalize="none" secureTextEntry value={apiSecret} onChangeText={setApiSecret} />
            <Text style={styles.label}>Utilisateur de ce téléphone</Text>
            {renderChoice(members, currentUserId, setCurrentUserId)}
            <Text style={styles.help}>Rôle actuel : {isAdmin ? 'admin' : 'membre'}. Le serveur applique les droits à partir de cet utilisateur.</Text>
            <TouchableOpacity style={styles.primaryButton} onPress={() => syncFromServer(true)}><Text style={styles.primaryButtonText}>Tester et synchroniser</Text></TouchableOpacity>
            <TouchableOpacity style={styles.secondaryButton} onPress={() => Alert.alert('Désactiver la synchronisation ?', 'Le téléphone utilisera seulement son cache local et ne partagera plus les données avec l’autre téléphone.', [{ text: 'Annuler', style: 'cancel' }, { text: 'Désactiver', style: 'destructive', onPress: () => setApiUrl('') }])}><Text style={styles.secondaryButtonText}>Désactiver la synchronisation</Text></TouchableOpacity>
            <TouchableOpacity style={styles.secondaryButton} onPress={showRoleInfo}><Text style={styles.secondaryButtonText}>Voir sécurité et rôles</Text></TouchableOpacity>
            <Text style={styles.help}>Sur vos téléphones, configurez la même URL Tailscale du vieux PC. Exemple : http://100.64.12.34:3001</Text>
          </ScrollView>
        </SafeAreaView>
      </Modal>
    </SafeAreaView>
  );
}

function Metric({ label, value }) { return <View style={styles.metric}><Text style={styles.metricLabel}>{label}</Text><Text style={styles.metricValue}>{value}</Text></View>; }
function PersonCard({ state }) { return <View style={styles.card}><View style={styles.rowBetween}><Text style={styles.cardTitle}>{state.member.name}</Text><Text style={state.missing <= 0 ? styles.badgeOk : styles.badgeWarn}>{state.missing <= 0 ? 'OK' : `Reste ${formatEuro(state.missing)}`}</Text></View><Text style={styles.muted}>Prévu : {formatEuro(state.expected)}</Text><Text style={styles.muted}>Déjà versé : {formatEuro(state.paid)}</Text><Text style={styles.muted}>Dépenses payées personnellement : {formatEuro(state.personallyPaidExpenses)}</Text></View>; }
function CategorySummary({ category }) { const pct = category.monthlyBudget ? Math.min(100, (category.spent / category.monthlyBudget) * 100) : 0; return <View style={styles.card}><View style={styles.rowBetween}><Text style={styles.cardTitle}>{category.name}</Text><Text style={category.overBudget ? styles.badgeWarn : styles.badgeOk}>{category.overBudget ? 'Dépassement' : 'OK'}</Text></View><View style={styles.progress}><View style={[styles.progressFill, { width: `${pct}%` }]} /></View><Text style={styles.muted}>Budget : {formatEuro(category.monthlyBudget)} · Dépensé : {formatEuro(category.spent)}</Text><Text style={styles.muted}>Restant budget : {formatEuro(category.remainingBudget)}</Text><Text style={styles.muted}>Solde de caisse : {formatEuro(category.cashBalance)}</Text></View>; }

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: '#F3F4F6' },
  header: { backgroundColor: '#0F172A', paddingHorizontal: 22, paddingTop: 18, paddingBottom: 22, flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  title: { color: 'white', fontSize: 31, fontWeight: '900' }, subtitle: { color: '#CBD5E1', fontSize: 16, marginTop: 2 }, syncText: { fontSize: 12, marginTop: 6, fontWeight: '700' }, online: { color: '#86EFAC' }, offline: { color: '#FCA5A5' },
  headerButton: { backgroundColor: '#334155', paddingHorizontal: 14, paddingVertical: 10, borderRadius: 15 }, headerButtonText: { color: 'white', fontWeight: '900' },
  monthRow: { flexDirection: 'row', alignItems: 'center', gap: 8, paddingHorizontal: 14, paddingTop: 14, paddingBottom: 10, backgroundColor: 'white' }, navButton: { backgroundColor: '#0F172A', width: 48, height: 48, borderRadius: 13, alignItems: 'center', justifyContent: 'center' }, navText: { color: 'white', fontSize: 34, fontWeight: '900' }, monthLabel: { flex: 1, backgroundColor: '#F8FAFC', borderWidth: 1, borderColor: '#E5E7EB', borderRadius: 14, paddingVertical: 14, paddingHorizontal: 8, textAlign: 'center', fontSize: 20, fontWeight: '900' }, monthOkButton: { backgroundColor: '#334155', height: 48, paddingHorizontal: 12, borderRadius: 13, alignItems: 'center', justifyContent: 'center' }, monthOkText: { color: 'white', fontSize: 13, fontWeight: '900' },
  tabsOuter: { backgroundColor: 'white', paddingHorizontal: 14, paddingTop: 4, paddingBottom: 12, borderBottomWidth: 1, borderBottomColor: '#E5E7EB' }, tabsContent: { flexDirection: 'row', gap: 8, padding: 8, backgroundColor: '#FFFFFF', borderRadius: 18, borderWidth: 1, borderColor: '#E5E7EB' }, tab: { paddingVertical: 10, paddingHorizontal: 16, borderRadius: 999, backgroundColor: '#EEF2F7', minWidth: 104, alignItems: 'center', borderWidth: 1, borderColor: '#E5E7EB' }, activeTab: { backgroundColor: '#111827', borderColor: '#111827' }, tabText: { color: '#475467', fontSize: 13, fontWeight: '800' }, activeTabText: { color: 'white' },
  content: { flex: 1 }, contentInner: { padding: 18, paddingBottom: 70 }, hero: { backgroundColor: '#0F172A', borderRadius: 22, padding: 22, marginBottom: 18 }, sectionTitle: { fontSize: 23, fontWeight: '900', color: '#111827', marginTop: 18, marginBottom: 12 }, sectionTitleDark: { color: 'white', fontSize: 22, fontWeight: '900', marginBottom: 16 }, metricGrid: { flexDirection: 'row', flexWrap: 'wrap', gap: 12 }, metric: { width: '47%', backgroundColor: '#1E293B', borderRadius: 16, padding: 15 }, metricLabel: { color: '#CBD5E1', fontSize: 14 }, metricValue: { color: 'white', fontSize: 24, fontWeight: '900', marginTop: 6 },
  card: { backgroundColor: 'white', borderRadius: 18, padding: 18, marginBottom: 14, borderWidth: 1, borderColor: '#E5E7EB' }, rowBetween: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', gap: 10 }, rowGap: { flexDirection: 'row', gap: 10, marginTop: 12 }, cardTitle: { fontSize: 20, fontWeight: '900', color: '#111827', flex: 1 }, muted: { color: '#4B5563', fontSize: 16, marginTop: 6 }, amount: { fontSize: 20, fontWeight: '900', color: '#111827' }, label: { fontSize: 16, fontWeight: '900', color: '#374151', marginTop: 10, marginBottom: 8 }, input: { backgroundColor: '#F8FAFC', borderWidth: 1, borderColor: '#E5E7EB', borderRadius: 14, paddingHorizontal: 16, paddingVertical: 14, fontSize: 17, marginBottom: 10 }, textarea: { minHeight: 100, textAlignVertical: 'top' }, choiceRow: { flexDirection: 'row', gap: 8, paddingBottom: 8 }, choice: { backgroundColor: '#F3F4F6', borderRadius: 999, paddingHorizontal: 16, paddingVertical: 11, borderWidth: 1, borderColor: '#E5E7EB' }, choiceActive: { backgroundColor: '#0F172A', borderColor: '#0F172A' }, choiceText: { color: '#374151', fontWeight: '900', fontSize: 15 }, choiceTextActive: { color: 'white' },
  primaryButton: { backgroundColor: '#0F172A', borderRadius: 16, paddingVertical: 16, alignItems: 'center', marginTop: 8, marginBottom: 10 }, primaryButtonText: { color: 'white', fontWeight: '900', fontSize: 16 }, secondaryButton: { backgroundColor: '#E5E7EB', borderRadius: 16, paddingVertical: 16, alignItems: 'center', marginTop: 10 }, secondaryButtonText: { color: '#111827', fontWeight: '900' }, dangerButton: { backgroundColor: '#FEE2E2', borderRadius: 14, paddingVertical: 13, alignItems: 'center', marginTop: 12 }, smallButton: { backgroundColor: '#0F172A', borderRadius: 12, paddingHorizontal: 15, paddingVertical: 11 }, smallButtonText: { color: 'white', fontWeight: '900' }, smallDanger: { backgroundColor: '#FEE2E2', borderRadius: 12, paddingHorizontal: 15, paddingVertical: 11 }, dangerText: { color: '#991B1B', fontWeight: '900' }, badge: { backgroundColor: '#E0F2FE', color: '#075985', paddingHorizontal: 12, paddingVertical: 7, borderRadius: 999, overflow: 'hidden', fontWeight: '900' }, badgeOk: { backgroundColor: '#DCFCE7', color: '#166534', paddingHorizontal: 12, paddingVertical: 7, borderRadius: 999, overflow: 'hidden', fontWeight: '900' }, badgeWarn: { backgroundColor: '#FEE2E2', color: '#991B1B', paddingHorizontal: 12, paddingVertical: 7, borderRadius: 999, overflow: 'hidden', fontWeight: '900' }, badgePlanned: { backgroundColor: '#FEF3C7', color: '#92400E', paddingHorizontal: 12, paddingVertical: 7, borderRadius: 999, overflow: 'hidden', fontWeight: '900' }, progress: { height: 10, backgroundColor: '#E5E7EB', borderRadius: 999, marginVertical: 12, overflow: 'hidden' }, progressFill: { height: 10, backgroundColor: '#0F172A' }, lockedText: { color: '#6B7280', fontSize: 13, marginTop: 10, fontWeight: '700' },
  modalSafe: { flex: 1, backgroundColor: '#F3F4F6' }, modalHeader: { backgroundColor: 'white', padding: 18, borderBottomWidth: 1, borderBottomColor: '#E5E7EB', flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' }, modalTitle: { fontSize: 24, fontWeight: '900', color: '#111827' }, modalAction: { color: '#2563EB', fontSize: 17, fontWeight: '900' }, modalContent: { padding: 18 }, help: { color: '#475467', marginTop: 18, fontSize: 15, lineHeight: 22 },
});
