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

const STORAGE_KEY = 'SS_BUDGET_APP_V11';

const initialMembers = ['Steve', 'Sorelle'];
const defaultStartMonth = '2026-07';

const initialCategories = [
  { id: 'weekends', name: 'Weekends', monthlyPerPerson: 40, description: 'Courses, transports, sorties, etc.', locked: false },
  { id: 'ecole', name: 'Semaines écoles', monthlyPerPerson: 20, description: 'Repas, transports, sorties pendant les semaines école.', locked: false },
  { id: 'vacances', name: 'Vacances', monthlyPerPerson: 50, description: 'Vacances 1 à 3 fois par an.', locked: false },
  { id: 'cadeaux', name: 'Cadeaux proches', monthlyPerPerson: 20, description: 'Cadeaux faits aux proches au nom du couple.', locked: false },
  { id: 'epargne', name: 'Épargne bloquée', monthlyPerPerson: 50, description: 'Réserve mutuelle pour imprévus majeurs.', locked: true },
];

const today = () => new Date().toISOString().slice(0, 10);
const formatEuro = (value) => `${Number(value || 0).toFixed(2).replace('.', ',')} €`;
const uid = () => Math.random().toString(36).slice(2) + Date.now().toString(36);
const parseAmount = (value) => Number(String(value || '').replace(',', '.'));
const monthDefaultDate = (month) => (/^\d{4}-\d{2}$/.test(month) ? `${month}-01` : today());
const safePositiveInt = (value, fallback = 1) => {
  const number = parseInt(String(value || '').replace(',', '.'), 10);
  return Number.isFinite(number) && number > 0 ? number : fallback;
};

const firstMember = (members) => (members && members.length ? members[0] : 'Membre 1');
const firstCategoryId = (categories) => (categories && categories.length ? categories[0].id : 'weekends');

export default function App() {
  const [members, setMembers] = useState(initialMembers);
  const [categories, setCategories] = useState(initialCategories);
  const [expenses, setExpenses] = useState([]);
  const [contributions, setContributions] = useState([]);
  const [startMonth, setStartMonth] = useState(defaultStartMonth);
  const [selectedMonth, setSelectedMonth] = useState(defaultStartMonth);
  const [tab, setTab] = useState('dashboard');
  const [categoryModal, setCategoryModal] = useState(false);
  const [editingCategory, setEditingCategory] = useState(null);
  const [memberDraft, setMemberDraft] = useState('');
  const [editingMember, setEditingMember] = useState(null);
  const [memberNameDraft, setMemberNameDraft] = useState('');
  const [expenseDraft, setExpenseDraft] = useState({ label: '', amount: '', paidBy: 'Steve', categoryId: 'weekends', date: today() });
  const [contributionDraft, setContributionDraft] = useState({ amount: '', person: 'Steve', categoryId: 'weekends', date: today() });
  const [autoPerson, setAutoPerson] = useState('Steve');
  const [autoDate, setAutoDate] = useState(monthDefaultDate(defaultStartMonth));
  const [autoMonths, setAutoMonths] = useState('1');

  useEffect(() => {
    loadData();
  }, []);

  useEffect(() => {
    saveData();
  }, [members, categories, expenses, contributions, startMonth, selectedMonth]);

  useEffect(() => {
    if (members.indexOf(expenseDraft.paidBy) === -1) {
      setExpenseDraft((draft) => ({ ...draft, paidBy: firstMember(members) }));
    }
    if (members.indexOf(contributionDraft.person) === -1) {
      setContributionDraft((draft) => ({ ...draft, person: firstMember(members) }));
    }
    if (members.indexOf(autoPerson) === -1) {
      setAutoPerson(firstMember(members));
    }
  }, [members]);

  useEffect(() => {
    if (!categories.find((category) => category.id === expenseDraft.categoryId)) {
      setExpenseDraft((draft) => ({ ...draft, categoryId: firstCategoryId(categories) }));
    }
    if (!categories.find((category) => category.id === contributionDraft.categoryId)) {
      setContributionDraft((draft) => ({ ...draft, categoryId: firstCategoryId(categories) }));
    }
  }, [categories]);

  const loadData = async () => {
    try {
      const raw = await AsyncStorage.getItem(STORAGE_KEY);
      if (!raw) return;
      const data = JSON.parse(raw);
      const loadedMembers = data.members && data.members.length ? data.members : initialMembers;
      const loadedCategories = data.categories && data.categories.length ? data.categories : initialCategories;
      setMembers(loadedMembers);
      setCategories(loadedCategories.map((category) => ({ locked: false, ...category })));
      setExpenses(data.expenses || []);
      setContributions(data.contributions || []);
      setStartMonth(data.startMonth || defaultStartMonth);
      setSelectedMonth(data.selectedMonth || data.startMonth || defaultStartMonth);
      setExpenseDraft((draft) => ({ ...draft, paidBy: firstMember(loadedMembers), categoryId: firstCategoryId(loadedCategories) }));
      setContributionDraft((draft) => ({ ...draft, person: firstMember(loadedMembers), categoryId: firstCategoryId(loadedCategories) }));
      setAutoPerson(firstMember(loadedMembers));
    } catch (error) {
      Alert.alert('Erreur', 'Impossible de charger les données locales.');
    }
  };

  const saveData = async () => {
    try {
      await AsyncStorage.setItem(
        STORAGE_KEY,
        JSON.stringify({ members, categories, expenses, contributions, startMonth, selectedMonth })
      );
    } catch (error) {
      console.log(error);
    }
  };


  useEffect(() => {
    const defaultDate = monthDefaultDate(selectedMonth);
    setExpenseDraft((draft) => ({
      ...draft,
      date: String(draft.date || '').startsWith(selectedMonth) ? draft.date : defaultDate,
    }));
    setContributionDraft((draft) => ({
      ...draft,
      date: String(draft.date || '').startsWith(selectedMonth) ? draft.date : defaultDate,
    }));
    setAutoDate((date) => (String(date || '').startsWith(selectedMonth) ? date : defaultDate));
  }, [selectedMonth]);

  const monthExpenses = useMemo(
    () => expenses.filter((expense) => String(expense.date || '').startsWith(selectedMonth)),
    [expenses, selectedMonth]
  );

  const monthContributions = useMemo(
    () => contributions.filter((contribution) => String(contribution.date || '').startsWith(selectedMonth)),
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
      const monthlyBudget = Number(category.monthlyPerPerson || 0) * members.length;
      return {
        ...category,
        spent,
        paidIn,
        monthlyBudget,
        remainingBudget: monthlyBudget - spent,
        cashBalance: paidIn - spent,
        overBudget: spent > monthlyBudget,
        underFunded: paidIn < spent,
      };
    });
  }, [categories, monthExpenses, monthContributions, members]);

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
    return members.map((person) => {
      const expected = categories.reduce((sum, category) => sum + Number(category.monthlyPerPerson || 0), 0);
      const paid = monthContributions
        .filter((contribution) => contribution.person === person)
        .reduce((sum, contribution) => sum + Number(contribution.amount || 0), 0);
      const personallyPaidExpenses = monthExpenses
        .filter((expense) => expense.paidBy === person)
        .reduce((sum, expense) => sum + Number(expense.amount || 0), 0);
      return { person, expected, paid, missing: expected - paid, personallyPaidExpenses };
    });
  }, [members, categories, monthContributions, monthExpenses]);

  const updateMonth = (direction) => {
    const parts = selectedMonth.split('-').map(Number);
    if (parts.length < 2 || Number.isNaN(parts[0]) || Number.isNaN(parts[1])) return;
    const date = new Date(parts[0], parts[1] - 1 + direction, 1);
    setSelectedMonth(date.toISOString().slice(0, 7));
  };

  const goToNewMonth = () => {
    updateMonth(1);
    setTab('dashboard');
  };

  const applyStartMonth = () => {
    if (!/^\d{4}-\d{2}$/.test(startMonth)) {
      Alert.alert('Mois invalide', 'Utilise le format YYYY-MM, par exemple 2026-07.');
      return;
    }
    setSelectedMonth(startMonth);
    Alert.alert('Mois de départ défini', `Le mois actif est maintenant ${startMonth}.`);
  };

  const openNewCategory = () => {
    setEditingCategory({ id: null, name: '', monthlyPerPerson: '', description: '', locked: false });
    setCategoryModal(true);
  };

  const openEditCategory = (category) => {
    setEditingCategory({ ...category, monthlyPerPerson: String(category.monthlyPerPerson || '') });
    setCategoryModal(true);
  };

  const saveCategory = () => {
    if (!editingCategory || !editingCategory.name.trim()) return Alert.alert('Catégorie incomplète', 'Ajoute un nom de catégorie.');
    const monthlyPerPerson = parseAmount(editingCategory.monthlyPerPerson);
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
    const hasHistory = expenses.some((expense) => expense.categoryId === categoryId) || contributions.some((item) => item.categoryId === categoryId);
    if (hasHistory) {
      Alert.alert('Suppression impossible', 'Cette catégorie contient déjà un historique. Renomme-la ou garde-la pour conserver les données.');
      return;
    }
    setCategories((current) => current.filter((category) => category.id !== categoryId));
  };

  const addExpense = () => {
    const amount = parseAmount(expenseDraft.amount);
    if (!expenseDraft.label.trim()) return Alert.alert('Dépense incomplète', 'Ajoute un libellé.');
    if (Number.isNaN(amount) || amount <= 0) return Alert.alert('Montant invalide', 'Le montant doit être supérieur à 0.');
    if (!String(expenseDraft.date || '').startsWith(selectedMonth)) return Alert.alert('Date hors mois actif', `La date doit commencer par ${selectedMonth} pour apparaître dans ce mois.`);

    const category = summary.find((item) => item.id === expenseDraft.categoryId);
    if (category && category.locked) {
      Alert.alert(
        'Caisse verrouillée',
        `La caisse ${category.name} est verrouillée. Tu peux quand même ajouter la dépense si vous êtes tous les deux d’accord.`,
        [
          { text: 'Annuler', style: 'cancel' },
          { text: 'Ajouter quand même', onPress: () => commitExpense(amount) },
        ]
      );
      return;
    }
    if (category && amount > category.remainingBudget) {
      Alert.alert(
        'Budget dépassé',
        `Cette dépense dépasse le budget restant de la caisse ${category.name}. Elle sera marquée en dépassement.`,
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
    setExpenseDraft({ label: '', amount: '', paidBy: firstMember(members), categoryId: firstCategoryId(categories), date: monthDefaultDate(selectedMonth) });
  };

  const addContribution = () => {
    const amount = parseAmount(contributionDraft.amount);
    if (Number.isNaN(amount) || amount <= 0) return Alert.alert('Montant invalide', 'Le montant doit être supérieur à 0.');
    if (!String(contributionDraft.date || '').startsWith(selectedMonth)) return Alert.alert('Date hors mois actif', `La date doit commencer par ${selectedMonth} pour apparaître dans ce mois.`);
    setContributions((current) => [{ ...contributionDraft, id: uid(), amount }, ...current]);
    setContributionDraft({ amount: '', person: firstMember(members), categoryId: firstCategoryId(categories), date: monthDefaultDate(selectedMonth) });
  };

  const addAutoContributions = (mode) => {
    const targetMembers = mode === 'all' ? members : [autoPerson];
    const activeCategories = categories.filter((category) => Number(category.monthlyPerPerson || 0) > 0);
    const monthsCount = safePositiveInt(autoMonths, 1);
    const date = autoDate || monthDefaultDate(selectedMonth);
    if (!String(date).startsWith(selectedMonth)) {
      return Alert.alert('Date hors mois actif', `La date du versement doit commencer par ${selectedMonth} pour être comptée dans ce mois.`);
    }
    if (!targetMembers.length || !activeCategories.length) return Alert.alert('Rien à verser', 'Ajoute au moins un membre et une catégorie avec budget.');
    const items = [];
    targetMembers.forEach((person) => {
      activeCategories.forEach((category) => {
        items.push({
          id: uid(),
          person,
          categoryId: category.id,
          amount: Number(category.monthlyPerPerson || 0) * monthsCount,
          date,
          automatic: true,
          monthsCount,
        });
      });
    });
    const total = items.reduce((sum, item) => sum + Number(item.amount || 0), 0);
    setContributions((current) => [...items, ...current]);
    Alert.alert('Versement automatique ajouté', `${items.length} lignes ajoutées. Total : ${formatEuro(total)} (${monthsCount} mois).`);
  };

  const addMember = () => {
    const name = memberDraft.trim();
    if (!name) return Alert.alert('Nom manquant', 'Entre le nom du membre.');
    if (members.includes(name)) return Alert.alert('Déjà présent', 'Ce membre existe déjà.');
    setMembers((current) => [...current, name]);
    setMemberDraft('');
  };

  const saveMemberName = () => {
    const nextName = memberNameDraft.trim();
    if (!editingMember || !nextName) return;
    if (members.includes(nextName) && nextName !== editingMember) return Alert.alert('Nom déjà utilisé', 'Choisis un autre nom.');
    setMembers((current) => current.map((name) => (name === editingMember ? nextName : name)));
    setExpenses((current) => current.map((expense) => expense.paidBy === editingMember ? { ...expense, paidBy: nextName } : expense));
    setContributions((current) => current.map((contribution) => contribution.person === editingMember ? { ...contribution, person: nextName } : contribution));
    if (expenseDraft.paidBy === editingMember) setExpenseDraft((draft) => ({ ...draft, paidBy: nextName }));
    if (contributionDraft.person === editingMember) setContributionDraft((draft) => ({ ...draft, person: nextName }));
    if (autoPerson === editingMember) setAutoPerson(nextName);
    setEditingMember(null);
    setMemberNameDraft('');
  };

  const removeMember = (name) => {
    const hasHistory = expenses.some((expense) => expense.paidBy === name) || contributions.some((contribution) => contribution.person === name);
    if (members.length <= 1) return Alert.alert('Impossible', 'Il faut garder au moins un membre.');
    if (hasHistory) return Alert.alert('Suppression impossible', 'Ce membre a déjà un historique. Renomme-le plutôt pour conserver les données.');
    setMembers((current) => current.filter((item) => item !== name));
  };

  const resetDemo = () => {
    Alert.alert('Réinitialiser', 'Remettre les données de départ ?', [
      { text: 'Annuler', style: 'cancel' },
      {
        text: 'Réinitialiser',
        style: 'destructive',
        onPress: () => {
          setMembers(initialMembers);
          setCategories(initialCategories);
          setExpenses([]);
          setContributions([]);
          setStartMonth(defaultStartMonth);
          setSelectedMonth(defaultStartMonth);
          setExpenseDraft({ label: '', amount: '', paidBy: 'Steve', categoryId: 'weekends', date: monthDefaultDate(defaultStartMonth) });
          setContributionDraft({ amount: '', person: 'Steve', categoryId: 'weekends', date: monthDefaultDate(defaultStartMonth) });
          setAutoDate(monthDefaultDate(defaultStartMonth));
          setAutoMonths('1');
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

      <View style={styles.tabsOuter}>
        <ScrollView
          horizontal
          showsHorizontalScrollIndicator={false}
          style={styles.tabsScroll}
          contentContainerStyle={styles.tabsContent}
        >
          {[
            ['dashboard', 'Synthèse'],
            ['expenses', 'Dépenses'],
            ['contributions', 'Versements'],
            ['categories', 'Caisses'],
            ['settings', 'Réglages'],
          ].map(([key, label]) => (
            <TouchableOpacity key={key} style={[styles.tab, tab === key && styles.activeTab]} onPress={() => setTab(key)}>
              <Text style={[styles.tabText, tab === key && styles.activeTabText]}>{label}</Text>
            </TouchableOpacity>
          ))}
        </ScrollView>
      </View>

      <ScrollView contentContainerStyle={styles.content}>
        {tab === 'dashboard' && (
          <>
            <View style={styles.totalCard}>
              <Text style={styles.cardTitleLight}>Vue générale du mois</Text>
              <View style={styles.grid}>
                <Metric label="Budget prévu" value={formatEuro(totals.monthlyBudget)} />
                <Metric label="Dépensé" value={formatEuro(totals.spent)} />
                <Metric label="Versé" value={formatEuro(totals.paidIn)} />
                <Metric label="Solde compte" value={formatEuro(totals.cashBalance)} danger={totals.cashBalance < 0} />
              </View>
            </View>
            <View style={styles.actionsRowTop}>
              <PrimaryButton label="Nouveau mois" onPress={goToNewMonth} />
            </View>

            <Text style={styles.sectionTitle}>État par membre</Text>
            {personState.map((person) => (
              <View key={person.person} style={styles.card}>
                <View style={styles.rowBetween}>
                  <Text style={styles.cardTitle}>{person.person}</Text>
                  <Text style={[styles.badge, person.missing > 0 && styles.badgeDanger]}>
                    {person.missing > 0 ? `Reste ${formatEuro(person.missing)}` : person.missing < 0 ? `Avance ${formatEuro(Math.abs(person.missing))}` : 'OK'}
                  </Text>
                </View>
                <Text style={styles.line}>Prévu : {formatEuro(person.expected)}</Text>
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
              <PickerRow label="Payé par" items={members.map((p) => [p, p])} value={expenseDraft.paidBy} onChange={(paidBy) => setExpenseDraft({ ...expenseDraft, paidBy })} />
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
            <Text style={styles.sectionTitle}>Versement automatique</Text>
            <FormCard>
              <Text style={styles.helpText}>L’app lit le budget mensuel défini dans chaque caisse et répartit automatiquement le bon montant par membre. Exemple : Weekends 40 €, Vacances 50 €, etc. Mets 2 ou 3 mois pour prendre de l’avance.</Text>
              <PickerRow label="Membre" items={members.map((p) => [p, p])} value={autoPerson} onChange={setAutoPerson} />
              <TextInput style={styles.input} placeholder="Nombre de mois à verser — ex: 1" keyboardType="number-pad" value={autoMonths} onChangeText={setAutoMonths} />
              <TextInput style={styles.input} placeholder="Date YYYY-MM-DD" value={autoDate} onChangeText={setAutoDate} />
              <PrimaryButton label={`Valider auto pour ${autoPerson}`} onPress={() => addAutoContributions('one')} />
              <SecondaryButton label="Valider auto pour tous les membres" onPress={() => addAutoContributions('all')} />
            </FormCard>

            <Text style={styles.sectionTitle}>Ajouter un versement manuel</Text>
            <FormCard>
              <TextInput style={styles.input} placeholder="Montant" keyboardType="decimal-pad" value={contributionDraft.amount} onChangeText={(amount) => setContributionDraft({ ...contributionDraft, amount })} />
              <PickerRow label="Personne" items={members.map((p) => [p, p])} value={contributionDraft.person} onChange={(person) => setContributionDraft({ ...contributionDraft, person })} />
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
                <Text style={styles.line}>{findCategoryName(categories, contribution.categoryId)}{contribution.automatic ? ' · automatique' : ''}</Text>
                <Text style={styles.muted}>{contribution.date}</Text>
                <DangerButton label="Supprimer" onPress={() => setContributions((current) => current.filter((item) => item.id !== contribution.id))} />
              </View>
            ))}
          </>
        )}

        {tab === 'categories' && (
          <>
            <PrimaryButton label="Créer une caisse" onPress={openNewCategory} />
            <Text style={styles.sectionTitle}>Caisses / catégories</Text>
            {categories.map((category) => (
              <View key={category.id} style={styles.card}>
                <View style={styles.rowBetween}>
                  <Text style={styles.cardTitle}>{category.name}</Text>
                  <Text style={styles.amount}>{formatEuro(category.monthlyPerPerson)} / membre</Text>
                </View>
                <Text style={styles.line}>Budget total : {formatEuro(category.monthlyPerPerson * members.length)} / mois</Text>
                <Text style={styles.line}>Statut : {category.locked ? 'Verrouillée avec confirmation avant dépense' : 'Libre'}</Text>
                <Text style={styles.muted}>{category.description}</Text>
                <View style={styles.actionsRow}>
                  <SecondaryButton label="Modifier" onPress={() => openEditCategory(category)} />
                  <DangerButton label="Supprimer" onPress={() => deleteCategory(category.id)} />
                </View>
              </View>
            ))}
          </>
        )}

        {tab === 'settings' && (
          <>
            <Text style={styles.sectionTitle}>Mois de départ</Text>
            <FormCard>
              <TextInput style={styles.input} placeholder="YYYY-MM" value={startMonth} onChangeText={setStartMonth} />
              <PrimaryButton label="Utiliser ce mois" onPress={applyStartMonth} />
            </FormCard>

            <Text style={styles.sectionTitle}>Membres</Text>
            <FormCard>
              <TextInput style={styles.input} placeholder="Ajouter un membre" value={memberDraft} onChangeText={setMemberDraft} />
              <PrimaryButton label="Ajouter le membre" onPress={addMember} />
            </FormCard>
            {members.map((member) => (
              <View key={member} style={styles.card}>
                {editingMember === member ? (
                  <>
                    <TextInput style={styles.input} value={memberNameDraft} onChangeText={setMemberNameDraft} />
                    <View style={styles.actionsRow}>
                      <SecondaryButton label="Annuler" onPress={() => setEditingMember(null)} />
                      <PrimaryButton label="Enregistrer" onPress={saveMemberName} />
                    </View>
                  </>
                ) : (
                  <>
                    <View style={styles.rowBetween}>
                      <Text style={styles.cardTitle}>{member}</Text>
                    </View>
                    <View style={styles.actionsRow}>
                      <SecondaryButton label="Renommer" onPress={() => { setEditingMember(member); setMemberNameDraft(member); }} />
                      <DangerButton label="Supprimer" onPress={() => removeMember(member)} />
                    </View>
                  </>
                )}
              </View>
            ))}
          </>
        )}
      </ScrollView>

      <Modal visible={categoryModal} animationType="slide" presentationStyle="pageSheet">
        <SafeAreaView style={styles.modalContainer}>
          <View style={styles.modalHeader}>
            <TouchableOpacity onPress={() => setCategoryModal(false)} style={styles.modalHeaderButton}><Text style={styles.closeText}>Fermer</Text></TouchableOpacity>
            <Text style={styles.modalTitle}>{editingCategory && editingCategory.id ? 'Modifier la caisse' : 'Nouvelle caisse'}</Text>
            <TouchableOpacity onPress={saveCategory} style={styles.modalValidateButton}><Text style={styles.modalValidateText}>Valider</Text></TouchableOpacity>
          </View>
          <View style={styles.content}>
            <TextInput style={styles.input} placeholder="Nom" value={(editingCategory && editingCategory.name) || ''} onChangeText={(name) => setEditingCategory({ ...editingCategory, name })} />
            <TextInput style={styles.input} placeholder="Budget mensuel par membre" keyboardType="decimal-pad" value={String((editingCategory && editingCategory.monthlyPerPerson) || '')} onChangeText={(monthlyPerPerson) => setEditingCategory({ ...editingCategory, monthlyPerPerson })} />
            <TextInput style={[styles.input, styles.textArea]} placeholder="Description" multiline value={(editingCategory && editingCategory.description) || ''} onChangeText={(description) => setEditingCategory({ ...editingCategory, description })} />
            <PickerRow label="Verrouillage optionnel" items={[[true, 'Verrouillée'], [false, 'Libre']]} value={editingCategory && editingCategory.locked} onChange={(locked) => setEditingCategory({ ...editingCategory, locked })} />
            <Text style={styles.helpText}>Appuie sur Valider en haut à droite pour enregistrer cette caisse.</Text>
          </View>
        </SafeAreaView>
      </Modal>
    </SafeAreaView>
  );
}

function findCategoryName(categories, categoryId) {
  const found = categories.find((category) => category.id === categoryId);
  return found ? found.name : 'Catégorie supprimée';
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
  let status = 'OK';
  let statusStyle = styles.badge;
  if (category.overBudget) {
    status = 'Dépassement';
    statusStyle = [styles.badge, styles.badgeDanger];
  } else if (category.underFunded) {
    status = 'À alimenter';
    statusStyle = [styles.badge, styles.badgeWarning];
  } else if (category.cashBalance > category.monthlyBudget) {
    status = 'Avance';
    statusStyle = [styles.badge, styles.badgeInfo];
  }
  return (
    <View style={styles.card}>
      <View style={styles.rowBetween}>
        <Text style={styles.cardTitle}>{category.name}</Text>
        <Text style={statusStyle}>{status}</Text>
      </View>
      <View style={styles.progressBar}><View style={[styles.progressFill, { width: `${percent}%` }, category.overBudget && styles.progressDanger]} /></View>
      <Text style={styles.line}>Budget : {formatEuro(category.monthlyBudget)} · Dépensé : {formatEuro(category.spent)}</Text>
      <Text style={styles.line}>Restant budget : {formatEuro(category.remainingBudget)}</Text>
      <Text style={styles.line}>Solde de caisse : {formatEuro(category.cashBalance)}</Text>
      {category.locked && <Text style={styles.muted}>Caisse verrouillée : confirmation demandée avant une dépense.</Text>}
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
          <TouchableOpacity key={String(key)} style={[styles.chip, value === key && styles.activeChip]} onPress={() => onChange(key)}>
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
  monthRow: { flexDirection: 'row', alignItems: 'center', gap: 10, paddingHorizontal: 14, paddingTop: 14, paddingBottom: 10, backgroundColor: 'white' },
  monthButton: { backgroundColor: '#111827', borderRadius: 12, width: 42, height: 42, alignItems: 'center', justifyContent: 'center' },
  monthButtonText: { color: 'white', fontSize: 28, lineHeight: 30 },
  monthInput: { flex: 1, backgroundColor: '#F9FAFB', borderWidth: 1, borderColor: '#E5E7EB', borderRadius: 12, padding: 12, textAlign: 'center', fontWeight: '700' },
  tabsOuter: {
    backgroundColor: 'white',
    paddingHorizontal: 14,
    paddingTop: 4,
    paddingBottom: 12,
    borderBottomWidth: 1,
    borderBottomColor: '#E5E7EB',
    shadowColor: '#000',
    shadowOpacity: 0.05,
    shadowRadius: 8,
    shadowOffset: { width: 0, height: 3 },
    elevation: 2,
  },
  tabsScroll: {
    backgroundColor: '#FFFFFF',
    borderRadius: 18,
    borderWidth: 1,
    borderColor: '#E5E7EB',
  },
  tabsContent: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 8,
    paddingVertical: 8,
    gap: 8,
  },
  tab: {
    paddingVertical: 10,
    paddingHorizontal: 16,
    borderRadius: 999,
    backgroundColor: '#EEF2F7',
    alignItems: 'center',
    justifyContent: 'center',
    minWidth: 104,
    borderWidth: 1,
    borderColor: '#E5E7EB',
  },
  activeTab: { backgroundColor: '#111827', borderColor: '#111827' },
  tabText: { color: '#475467', fontSize: 13, fontWeight: '800' },
  activeTabText: { color: 'white' },
  content: { padding: 16, paddingBottom: 40 },
  sectionTitle: { fontSize: 18, fontWeight: '800', marginTop: 18, marginBottom: 10, color: '#111827' },
  totalCard: { backgroundColor: '#111827', borderRadius: 22, padding: 18, marginBottom: 8 },
  card: { backgroundColor: 'white', borderRadius: 18, padding: 16, marginBottom: 12, borderWidth: 1, borderColor: '#E5E7EB' },
  cardTitle: { fontSize: 17, fontWeight: '800', color: '#111827' },
  cardTitleLight: { fontSize: 17, fontWeight: '800', color: 'white' },
  grid: { flexDirection: 'row', flexWrap: 'wrap', gap: 10, marginTop: 14 },
  metric: { backgroundColor: '#1F2937', width: '48%', padding: 12, borderRadius: 16 },
  metricLabel: { color: '#D1D5DB', fontSize: 12 },
  metricValue: { color: 'white', fontSize: 18, fontWeight: '800', marginTop: 6 },
  rowBetween: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', gap: 12 },
  line: { color: '#374151', marginTop: 8 },
  muted: { color: '#6B7280', marginTop: 8, fontSize: 13 },
  helpText: { color: '#4B5563', lineHeight: 20, marginBottom: 12 },
  amount: { color: '#111827', fontWeight: '800', fontSize: 16 },
  badge: { overflow: 'hidden', backgroundColor: '#DCFCE7', color: '#166534', paddingVertical: 4, paddingHorizontal: 10, borderRadius: 999, fontWeight: '800', fontSize: 12 },
  badgeDanger: { backgroundColor: '#FEE2E2', color: '#991B1B' },
  badgeWarning: { backgroundColor: '#FEF3C7', color: '#92400E' },
  badgeInfo: { backgroundColor: '#DBEAFE', color: '#1D4ED8' },
  dangerText: { color: '#FCA5A5' },
  progressBar: { height: 10, borderRadius: 999, backgroundColor: '#E5E7EB', overflow: 'hidden', marginTop: 12 },
  progressFill: { height: '100%', backgroundColor: '#111827' },
  progressDanger: { backgroundColor: '#DC2626' },
  input: { backgroundColor: '#F9FAFB', borderWidth: 1, borderColor: '#E5E7EB', borderRadius: 14, padding: 13, marginBottom: 10, fontSize: 15 },
  textArea: { minHeight: 90, textAlignVertical: 'top' },
  primaryButton: { backgroundColor: '#111827', padding: 14, borderRadius: 14, alignItems: 'center', marginTop: 4, flex: 1 },
  primaryButtonText: { color: 'white', fontWeight: '800' },
  secondaryButton: { backgroundColor: '#E5E7EB', padding: 12, borderRadius: 12, alignItems: 'center', flex: 1, marginTop: 8 },
  secondaryButtonText: { color: '#111827', fontWeight: '800' },
  dangerButton: { backgroundColor: '#FEE2E2', padding: 12, borderRadius: 12, alignItems: 'center', marginTop: 12, flex: 1 },
  dangerButtonText: { color: '#991B1B', fontWeight: '800' },
  actionsRow: { flexDirection: 'row', gap: 10, marginTop: 12 },
  actionsRowTop: { marginBottom: 8 },
  empty: { color: '#6B7280', textAlign: 'center', padding: 18 },
  pickerBox: { marginBottom: 10 },
  pickerLabel: { fontWeight: '800', color: '#374151', marginBottom: 8 },
  chip: { backgroundColor: '#F3F4F6', paddingVertical: 8, paddingHorizontal: 12, borderRadius: 999, marginRight: 8, borderWidth: 1, borderColor: '#E5E7EB' },
  activeChip: { backgroundColor: '#111827', borderColor: '#111827' },
  chipText: { color: '#374151', fontWeight: '700' },
  activeChipText: { color: 'white' },
  modalContainer: { flex: 1, backgroundColor: '#F3F4F6' },
  modalHeader: { backgroundColor: 'white', padding: 16, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', borderBottomWidth: 1, borderColor: '#E5E7EB', gap: 8 },
  modalHeaderButton: { minWidth: 72, alignItems: 'flex-start' },
  modalTitle: { flex: 1, textAlign: 'center', fontSize: 18, fontWeight: '800', color: '#111827' },
  closeText: { color: '#2563EB', fontWeight: '800' },
  modalValidateButton: { minWidth: 76, backgroundColor: '#111827', paddingVertical: 8, paddingHorizontal: 12, borderRadius: 12, alignItems: 'center' },
  modalValidateText: { color: 'white', fontWeight: '800' },
});
