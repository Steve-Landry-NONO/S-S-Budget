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

const STORAGE_KEY = 'SS_BUDGET_APP_V1';

const people = ['Steve', 'Sorelle'];

const initialCategories = [
  { id: 'weekends', name: 'Weekends', monthlyPerPerson: 40, description: 'Courses, transports, sorties, etc.' },
  { id: 'ecole', name: 'Semaines écoles', monthlyPerPerson: 20, description: 'Repas, transports, sorties pendant les semaines école.' },
  { id: 'vacances', name: 'Vacances', monthlyPerPerson: 50, description: 'Vacances 1 à 3 fois par an.' },
  { id: 'cadeaux', name: 'Cadeaux proches', monthlyPerPerson: 20, description: 'Cadeaux faits aux proches au nom du couple.' },
  { id: 'epargne', name: 'Épargne bloquée', monthlyPerPerson: 50, description: 'Réserve mutuelle pour imprévus majeurs.' },
];

const todayMonth = () => new Date().toISOString().slice(0, 7);
const initialMonth = '2026-07';

const formatEuro = (value) => `${Number(value || 0).toFixed(2).replace('.', ',')} €`;
const uid = () => Math.random().toString(36).slice(2) + Date.now().toString(36);

const emptyDraftExpense = { label: '', amount: '', paidBy: 'Steve', categoryId: 'weekends', date: new Date().toISOString().slice(0, 10) };
const emptyDraftContribution = { amount: '', person: 'Steve', categoryId: 'weekends', date: new Date().toISOString().slice(0, 10) };

export default function App() {
  const [categories, setCategories] = useState(initialCategories);
  const [expenses, setExpenses] = useState([]);
  const [contributions, setContributions] = useState([]);
  const [selectedMonth, setSelectedMonth] = useState(initialMonth);
  const [tab, setTab] = useState('dashboard');
  const [categoryModal, setCategoryModal] = useState(false);
  const [editingCategory, setEditingCategory] = useState(null);
  const [expenseDraft, setExpenseDraft] = useState(emptyDraftExpense);
  const [contributionDraft, setContributionDraft] = useState(emptyDraftContribution);

  useEffect(() => {
    loadData();
  }, []);

  useEffect(() => {
    saveData();
  }, [categories, expenses, contributions, selectedMonth]);

  const loadData = async () => {
    try {
      const raw = await AsyncStorage.getItem(STORAGE_KEY);
      if (!raw) return;
      const data = JSON.parse(raw);
      setCategories(data.categories?.length ? data.categories : initialCategories);
      setExpenses(data.expenses || []);
      setContributions(data.contributions || []);
      setSelectedMonth(data.selectedMonth || initialMonth);
    } catch (error) {
      Alert.alert('Erreur', "Impossible de charger les données locales.");
    }
  };

  const saveData = async () => {
    try {
      await AsyncStorage.setItem(STORAGE_KEY, JSON.stringify({ categories, expenses, contributions, selectedMonth }));
    } catch (error) {
      console.log(error);
    }
  };

  const monthExpenses = useMemo(
    () => expenses.filter((expense) => expense.date?.startsWith(selectedMonth)),
    [expenses, selectedMonth]
  );

  const monthContributions = useMemo(
    () => contributions.filter((contribution) => contribution.date?.startsWith(selectedMonth)),
    [contributions, selectedMonth]
  );

  const summary = useMemo(() => {
    return categories.map((category) => {
      const spent = monthExpenses
        .filter((expense) => expense.categoryId === category.id)
        .reduce((sum, expense) => sum + Number(expense.amount || 0), 0);
      const paidIn = monthContributions
        .filter((contribution) => contribution.categoryId === category.id)
        .reduce((sum, contribution) => sum + Number(contribution.amount || 0), 0);
      const monthlyBudget = Number(category.monthlyPerPerson || 0) * people.length;
      return {
        ...category,
        spent,
        paidIn,
        monthlyBudget,
        remainingBudget: monthlyBudget - spent,
        cashBalance: paidIn - spent,
        overBudget: spent > monthlyBudget,
      };
    });
  }, [categories, monthExpenses, monthContributions]);

  const totals = useMemo(() => {
    return summary.reduce(
      (acc, category) => ({
        monthlyBudget: acc.monthlyBudget + category.monthlyBudget,
        spent: acc.spent + category.spent,
        paidIn: acc.paidIn + category.paidIn,
        cashBalance: acc.cashBalance + category.cashBalance,
      }),
      { monthlyBudget: 0, spent: 0, paidIn: 0, cashBalance: 0 }
    );
  }, [summary]);

  const personState = useMemo(() => {
    return people.map((person) => {
      const expected = categories.reduce((sum, category) => sum + Number(category.monthlyPerPerson || 0), 0);
      const paid = monthContributions
        .filter((contribution) => contribution.person === person)
        .reduce((sum, contribution) => sum + Number(contribution.amount || 0), 0);
      const personallyPaidExpenses = monthExpenses
        .filter((expense) => expense.paidBy === person)
        .reduce((sum, expense) => sum + Number(expense.amount || 0), 0);
      return { person, expected, paid, missing: expected - paid, personallyPaidExpenses };
    });
  }, [categories, monthContributions, monthExpenses]);

  const updateMonth = (direction) => {
    const [year, month] = selectedMonth.split('-').map(Number);
    const date = new Date(year, month - 1 + direction, 1);
    setSelectedMonth(date.toISOString().slice(0, 7));
  };

  const openNewCategory = () => {
    setEditingCategory({ id: null, name: '', monthlyPerPerson: '', description: '' });
    setCategoryModal(true);
  };

  const openEditCategory = (category) => {
    setEditingCategory({ ...category, monthlyPerPerson: String(category.monthlyPerPerson) });
    setCategoryModal(true);
  };

  const saveCategory = () => {
    if (!editingCategory?.name.trim()) return Alert.alert('Catégorie incomplète', 'Ajoute un nom de catégorie.');
    const monthlyPerPerson = Number(String(editingCategory.monthlyPerPerson).replace(',', '.'));
    if (Number.isNaN(monthlyPerPerson) || monthlyPerPerson < 0) return Alert.alert('Budget invalide', 'Le budget doit être un nombre positif.');

    if (editingCategory.id) {
      setCategories((current) =>
        current.map((category) =>
          category.id === editingCategory.id ? { ...editingCategory, monthlyPerPerson } : category
        )
      );
    } else {
      setCategories((current) => [...current, { ...editingCategory, id: uid(), monthlyPerPerson }]);
    }
    setCategoryModal(false);
  };

  const deleteCategory = (categoryId) => {
    const hasExpenses = expenses.some((expense) => expense.categoryId === categoryId);
    if (hasExpenses) {
      Alert.alert('Suppression impossible', 'Cette catégorie contient déjà des dépenses. Renomme-la ou garde-la pour conserver l’historique.');
      return;
    }
    setCategories((current) => current.filter((category) => category.id !== categoryId));
  };

  const addExpense = () => {
    const amount = Number(String(expenseDraft.amount).replace(',', '.'));
    if (!expenseDraft.label.trim()) return Alert.alert('Dépense incomplète', 'Ajoute un libellé.');
    if (Number.isNaN(amount) || amount <= 0) return Alert.alert('Montant invalide', 'Le montant doit être supérieur à 0.');

    const category = summary.find((item) => item.id === expenseDraft.categoryId);
    if (category && amount > category.remainingBudget) {
      Alert.alert(
        'Budget dépassé',
        `Cette dépense dépasse le budget restant de la caisse ${category.name}. Tu peux quand même l’ajouter, mais elle sera marquée en dépassement.`,
        [
          { text: 'Annuler', style: 'cancel' },
          { text: 'Ajouter quand même', onPress: () => commitExpense(amount) },
        ]
      );
      return;
    }
    commitExpense(amount);
  };

  const commitExpense = (amount) => {
    setExpenses((current) => [{ ...expenseDraft, id: uid(), amount }, ...current]);
    setExpenseDraft({ ...emptyDraftExpense, categoryId: categories[0]?.id || 'weekends' });
  };

  const addContribution = () => {
    const amount = Number(String(contributionDraft.amount).replace(',', '.'));
    if (Number.isNaN(amount) || amount <= 0) return Alert.alert('Montant invalide', 'Le montant doit être supérieur à 0.');
    setContributions((current) => [{ ...contributionDraft, id: uid(), amount }, ...current]);
    setContributionDraft({ ...emptyDraftContribution, categoryId: categories[0]?.id || 'weekends' });
  };

  const resetDemo = () => {
    Alert.alert('Réinitialiser', 'Remettre les données de départ ?', [
      { text: 'Annuler', style: 'cancel' },
      {
        text: 'Réinitialiser',
        style: 'destructive',
        onPress: () => {
          setCategories(initialCategories);
          setExpenses([]);
          setContributions([]);
          setSelectedMonth(initialMonth);
        },
      },
    ]);
  };

  return (
    <SafeAreaView style={styles.container}>
      <StatusBar style="light" />
      <View style={styles.header}>
        <View>
          <Text style={styles.appName}>S&S Budget</Text>
          <Text style={styles.subtitle}>Gestion de budget de couple</Text>
        </View>
        <TouchableOpacity style={styles.resetButton} onPress={resetDemo}>
          <Text style={styles.resetButtonText}>Reset</Text>
        </TouchableOpacity>
      </View>

      <View style={styles.monthRow}>
        <TouchableOpacity style={styles.monthButton} onPress={() => updateMonth(-1)}><Text style={styles.monthButtonText}>‹</Text></TouchableOpacity>
        <TextInput value={selectedMonth} onChangeText={setSelectedMonth} style={styles.monthInput} placeholder="YYYY-MM" />
        <TouchableOpacity style={styles.monthButton} onPress={() => updateMonth(1)}><Text style={styles.monthButtonText}>›</Text></TouchableOpacity>
      </View>

      <View style={styles.tabs}>
        {[
          ['dashboard', 'Synthèse'],
          ['expenses', 'Dépenses'],
          ['contributions', 'Versements'],
          ['categories', 'Caisses'],
        ].map(([key, label]) => (
          <TouchableOpacity key={key} style={[styles.tab, tab === key && styles.activeTab]} onPress={() => setTab(key)}>
            <Text style={[styles.tabText, tab === key && styles.activeTabText]}>{label}</Text>
          </TouchableOpacity>
        ))}
      </View>

      <ScrollView contentContainerStyle={styles.content}>
        {tab === 'dashboard' && (
          <>
            <View style={styles.totalCard}>
              <Text style={styles.cardTitle}>Vue générale du mois</Text>
              <View style={styles.grid}>
                <Metric label="Budget couple" value={formatEuro(totals.monthlyBudget)} />
                <Metric label="Dépensé" value={formatEuro(totals.spent)} />
                <Metric label="Versé" value={formatEuro(totals.paidIn)} />
                <Metric label="Solde compte" value={formatEuro(totals.cashBalance)} danger={totals.cashBalance < 0} />
              </View>
            </View>

            <Text style={styles.sectionTitle}>État par personne</Text>
            {personState.map((person) => (
              <View key={person.person} style={styles.card}>
                <View style={styles.rowBetween}>
                  <Text style={styles.cardTitle}>{person.person}</Text>
                  <Text style={[styles.badge, person.missing > 0 && styles.badgeDanger]}>
                    {person.missing > 0 ? `Reste ${formatEuro(person.missing)}` : 'OK'}
                  </Text>
                </View>
                <Text style={styles.line}>À verser : {formatEuro(person.expected)}</Text>
                <Text style={styles.line}>Déjà versé : {formatEuro(person.paid)}</Text>
                <Text style={styles.line}>Dépenses payées personnellement : {formatEuro(person.personallyPaidExpenses)}</Text>
              </View>
            ))}

            <Text style={styles.sectionTitle}>Situation des caisses</Text>
            {summary.map((category) => <CategorySummary key={category.id} category={category} />)}
          </>
        )}

        {tab === 'expenses' && (
          <>
            <Text style={styles.sectionTitle}>Ajouter une dépense</Text>
            <FormCard>
              <TextInput style={styles.input} placeholder="Libellé — ex: Courses samedi" value={expenseDraft.label} onChangeText={(label) => setExpenseDraft({ ...expenseDraft, label })} />
              <TextInput style={styles.input} placeholder="Montant" keyboardType="decimal-pad" value={expenseDraft.amount} onChangeText={(amount) => setExpenseDraft({ ...expenseDraft, amount })} />
              <PickerRow label="Catégorie" items={categories.map((c) => [c.id, c.name])} value={expenseDraft.categoryId} onChange={(categoryId) => setExpenseDraft({ ...expenseDraft, categoryId })} />
              <PickerRow label="Payé par" items={people.map((p) => [p, p])} value={expenseDraft.paidBy} onChange={(paidBy) => setExpenseDraft({ ...expenseDraft, paidBy })} />
              <TextInput style={styles.input} placeholder="Date YYYY-MM-DD" value={expenseDraft.date} onChangeText={(date) => setExpenseDraft({ ...expenseDraft, date })} />
              <PrimaryButton label="Ajouter la dépense" onPress={addExpense} />
            </FormCard>

            <Text style={styles.sectionTitle}>Dépenses du mois</Text>
            {monthExpenses.length === 0 && <EmptyText text="Aucune dépense pour ce mois." />}
            {monthExpenses.map((expense) => (
              <View key={expense.id} style={styles.card}>
                <View style={styles.rowBetween}>
                  <Text style={styles.cardTitle}>{expense.label}</Text>
                  <Text style={styles.amount}>{formatEuro(expense.amount)}</Text>
                </View>
                <Text style={styles.line}>{findCategoryName(categories, expense.categoryId)} · payé par {expense.paidBy}</Text>
                <Text style={styles.muted}>{expense.date}</Text>
                <DangerButton label="Supprimer" onPress={() => setExpenses((current) => current.filter((item) => item.id !== expense.id))} />
              </View>
            ))}
          </>
        )}

        {tab === 'contributions' && (
          <>
            <Text style={styles.sectionTitle}>Ajouter un versement</Text>
            <FormCard>
              <TextInput style={styles.input} placeholder="Montant" keyboardType="decimal-pad" value={contributionDraft.amount} onChangeText={(amount) => setContributionDraft({ ...contributionDraft, amount })} />
              <PickerRow label="Personne" items={people.map((p) => [p, p])} value={contributionDraft.person} onChange={(person) => setContributionDraft({ ...contributionDraft, person })} />
              <PickerRow label="Catégorie" items={categories.map((c) => [c.id, c.name])} value={contributionDraft.categoryId} onChange={(categoryId) => setContributionDraft({ ...contributionDraft, categoryId })} />
              <TextInput style={styles.input} placeholder="Date YYYY-MM-DD" value={contributionDraft.date} onChangeText={(date) => setContributionDraft({ ...contributionDraft, date })} />
              <PrimaryButton label="Ajouter le versement" onPress={addContribution} />
            </FormCard>

            <Text style={styles.sectionTitle}>Versements du mois</Text>
            {monthContributions.length === 0 && <EmptyText text="Aucun versement pour ce mois." />}
            {monthContributions.map((contribution) => (
              <View key={contribution.id} style={styles.card}>
                <View style={styles.rowBetween}>
                  <Text style={styles.cardTitle}>{contribution.person}</Text>
                  <Text style={styles.amount}>{formatEuro(contribution.amount)}</Text>
                </View>
                <Text style={styles.line}>{findCategoryName(categories, contribution.categoryId)}</Text>
                <Text style={styles.muted}>{contribution.date}</Text>
                <DangerButton label="Supprimer" onPress={() => setContributions((current) => current.filter((item) => item.id !== contribution.id))} />
              </View>
            ))}
          </>
        )}

        {tab === 'categories' && (
          <>
            <PrimaryButton label="Créer une catégorie" onPress={openNewCategory} />
            <Text style={styles.sectionTitle}>Caisses / catégories</Text>
            {categories.map((category) => (
              <View key={category.id} style={styles.card}>
                <View style={styles.rowBetween}>
                  <Text style={styles.cardTitle}>{category.name}</Text>
                  <Text style={styles.amount}>{formatEuro(category.monthlyPerPerson)} / pers.</Text>
                </View>
                <Text style={styles.line}>Budget couple : {formatEuro(category.monthlyPerPerson * people.length)} / mois</Text>
                <Text style={styles.muted}>{category.description}</Text>
                <View style={styles.actionsRow}>
                  <SecondaryButton label="Modifier" onPress={() => openEditCategory(category)} />
                  <DangerButton label="Supprimer" onPress={() => deleteCategory(category.id)} />
                </View>
              </View>
            ))}
          </>
        )}
      </ScrollView>

      <Modal visible={categoryModal} animationType="slide" presentationStyle="pageSheet">
        <SafeAreaView style={styles.modalContainer}>
          <View style={styles.modalHeader}>
            <Text style={styles.modalTitle}>{editingCategory?.id ? 'Modifier la catégorie' : 'Nouvelle catégorie'}</Text>
            <TouchableOpacity onPress={() => setCategoryModal(false)}><Text style={styles.closeText}>Fermer</Text></TouchableOpacity>
          </View>
          <View style={styles.content}>
            <TextInput style={styles.input} placeholder="Nom" value={editingCategory?.name || ''} onChangeText={(name) => setEditingCategory({ ...editingCategory, name })} />
            <TextInput style={styles.input} placeholder="Budget mensuel par personne" keyboardType="decimal-pad" value={String(editingCategory?.monthlyPerPerson || '')} onChangeText={(monthlyPerPerson) => setEditingCategory({ ...editingCategory, monthlyPerPerson })} />
            <TextInput style={[styles.input, styles.textArea]} placeholder="Description" multiline value={editingCategory?.description || ''} onChangeText={(description) => setEditingCategory({ ...editingCategory, description })} />
            <PrimaryButton label="Enregistrer" onPress={saveCategory} />
          </View>
        </SafeAreaView>
      </Modal>
    </SafeAreaView>
  );
}

function findCategoryName(categories, categoryId) {
  return categories.find((category) => category.id === categoryId)?.name || 'Catégorie supprimée';
}

function Metric({ label, value, danger }) {
  return (
    <View style={styles.metric}>
      <Text style={styles.metricLabel}>{label}</Text>
      <Text style={[styles.metricValue, danger && styles.dangerText]}>{value}</Text>
    </View>
  );
}

function CategorySummary({ category }) {
  const percent = category.monthlyBudget > 0 ? Math.min(100, (category.spent / category.monthlyBudget) * 100) : 0;
  return (
    <View style={styles.card}>
      <View style={styles.rowBetween}>
        <Text style={styles.cardTitle}>{category.name}</Text>
        <Text style={[styles.badge, category.overBudget && styles.badgeDanger]}>{category.overBudget ? 'Dépassement' : 'OK'}</Text>
      </View>
      <View style={styles.progressBar}><View style={[styles.progressFill, { width: `${percent}%` }, category.overBudget && styles.progressDanger]} /></View>
      <Text style={styles.line}>Budget : {formatEuro(category.monthlyBudget)} · Dépensé : {formatEuro(category.spent)}</Text>
      <Text style={styles.line}>Restant budget : {formatEuro(category.remainingBudget)}</Text>
      <Text style={styles.line}>Solde de caisse : {formatEuro(category.cashBalance)}</Text>
    </View>
  );
}

function FormCard({ children }) {
  return <View style={styles.card}>{children}</View>;
}

function PrimaryButton({ label, onPress }) {
  return <TouchableOpacity style={styles.primaryButton} onPress={onPress}><Text style={styles.primaryButtonText}>{label}</Text></TouchableOpacity>;
}

function SecondaryButton({ label, onPress }) {
  return <TouchableOpacity style={styles.secondaryButton} onPress={onPress}><Text style={styles.secondaryButtonText}>{label}</Text></TouchableOpacity>;
}

function DangerButton({ label, onPress }) {
  return <TouchableOpacity style={styles.dangerButton} onPress={onPress}><Text style={styles.dangerButtonText}>{label}</Text></TouchableOpacity>;
}

function EmptyText({ text }) {
  return <Text style={styles.empty}>{text}</Text>;
}

function PickerRow({ label, items, value, onChange }) {
  return (
    <View style={styles.pickerBox}>
      <Text style={styles.pickerLabel}>{label}</Text>
      <ScrollView horizontal showsHorizontalScrollIndicator={false}>
        {items.map(([key, itemLabel]) => (
          <TouchableOpacity key={key} style={[styles.chip, value === key && styles.activeChip]} onPress={() => onChange(key)}>
            <Text style={[styles.chipText, value === key && styles.activeChipText]}>{itemLabel}</Text>
          </TouchableOpacity>
        ))}
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#F3F4F6' },
  header: { backgroundColor: '#111827', padding: 20, paddingTop: 16, flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  appName: { color: 'white', fontSize: 28, fontWeight: '800' },
  subtitle: { color: '#D1D5DB', marginTop: 4 },
  resetButton: { backgroundColor: '#374151', paddingVertical: 8, paddingHorizontal: 12, borderRadius: 12 },
  resetButtonText: { color: 'white', fontWeight: '700' },
  monthRow: { flexDirection: 'row', alignItems: 'center', gap: 10, padding: 14, backgroundColor: 'white' },
  monthButton: { backgroundColor: '#111827', borderRadius: 12, width: 42, height: 42, alignItems: 'center', justifyContent: 'center' },
  monthButtonText: { color: 'white', fontSize: 28, lineHeight: 30 },
  monthInput: { flex: 1, backgroundColor: '#F9FAFB', borderWidth: 1, borderColor: '#E5E7EB', borderRadius: 12, padding: 12, textAlign: 'center', fontWeight: '700' },
  tabs: { flexDirection: 'row', backgroundColor: 'white', paddingHorizontal: 8, paddingBottom: 10, gap: 6 },
  tab: { flex: 1, paddingVertical: 9, borderRadius: 999, backgroundColor: '#F3F4F6', alignItems: 'center' },
  activeTab: { backgroundColor: '#111827' },
  tabText: { color: '#4B5563', fontSize: 12, fontWeight: '700' },
  activeTabText: { color: 'white' },
  content: { padding: 16, paddingBottom: 40 },
  sectionTitle: { fontSize: 18, fontWeight: '800', marginTop: 18, marginBottom: 10, color: '#111827' },
  totalCard: { backgroundColor: '#111827', borderRadius: 22, padding: 18, marginBottom: 8 },
  card: { backgroundColor: 'white', borderRadius: 18, padding: 16, marginBottom: 12, borderWidth: 1, borderColor: '#E5E7EB' },
  cardTitle: { fontSize: 17, fontWeight: '800', color: '#111827' },
  grid: { flexDirection: 'row', flexWrap: 'wrap', gap: 10, marginTop: 14 },
  metric: { backgroundColor: '#1F2937', width: '48%', padding: 12, borderRadius: 16 },
  metricLabel: { color: '#D1D5DB', fontSize: 12 },
  metricValue: { color: 'white', fontSize: 18, fontWeight: '800', marginTop: 6 },
  rowBetween: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', gap: 12 },
  line: { color: '#374151', marginTop: 8 },
  muted: { color: '#6B7280', marginTop: 8, fontSize: 13 },
  amount: { color: '#111827', fontWeight: '800', fontSize: 16 },
  badge: { overflow: 'hidden', backgroundColor: '#DCFCE7', color: '#166534', paddingVertical: 4, paddingHorizontal: 10, borderRadius: 999, fontWeight: '800', fontSize: 12 },
  badgeDanger: { backgroundColor: '#FEE2E2', color: '#991B1B' },
  dangerText: { color: '#FCA5A5' },
  progressBar: { height: 10, borderRadius: 999, backgroundColor: '#E5E7EB', overflow: 'hidden', marginTop: 12 },
  progressFill: { height: '100%', backgroundColor: '#111827' },
  progressDanger: { backgroundColor: '#DC2626' },
  input: { backgroundColor: '#F9FAFB', borderWidth: 1, borderColor: '#E5E7EB', borderRadius: 14, padding: 13, marginBottom: 10, fontSize: 15 },
  textArea: { minHeight: 90, textAlignVertical: 'top' },
  primaryButton: { backgroundColor: '#111827', padding: 14, borderRadius: 14, alignItems: 'center', marginTop: 4 },
  primaryButtonText: { color: 'white', fontWeight: '800' },
  secondaryButton: { backgroundColor: '#E5E7EB', padding: 12, borderRadius: 12, alignItems: 'center', flex: 1 },
  secondaryButtonText: { color: '#111827', fontWeight: '800' },
  dangerButton: { backgroundColor: '#FEE2E2', padding: 12, borderRadius: 12, alignItems: 'center', marginTop: 12, flex: 1 },
  dangerButtonText: { color: '#991B1B', fontWeight: '800' },
  actionsRow: { flexDirection: 'row', gap: 10, marginTop: 12 },
  empty: { color: '#6B7280', textAlign: 'center', padding: 18 },
  pickerBox: { marginBottom: 10 },
  pickerLabel: { fontWeight: '800', color: '#374151', marginBottom: 8 },
  chip: { backgroundColor: '#F3F4F6', paddingVertical: 8, paddingHorizontal: 12, borderRadius: 999, marginRight: 8, borderWidth: 1, borderColor: '#E5E7EB' },
  activeChip: { backgroundColor: '#111827', borderColor: '#111827' },
  chipText: { color: '#374151', fontWeight: '700' },
  activeChipText: { color: 'white' },
  modalContainer: { flex: 1, backgroundColor: '#F3F4F6' },
  modalHeader: { backgroundColor: 'white', padding: 16, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', borderBottomWidth: 1, borderColor: '#E5E7EB' },
  modalTitle: { fontSize: 20, fontWeight: '800', color: '#111827' },
  closeText: { color: '#2563EB', fontWeight: '800' },
});
