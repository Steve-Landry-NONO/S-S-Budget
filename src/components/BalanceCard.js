import React from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { palette, radius, spacing, typography } from '../theme/tokens';

const formatMoney = (amount, currency = 'EUR') => {
  const n = Number(amount);
  const safe = Number.isFinite(n) ? n : 0;
  return new Intl.NumberFormat('fr-FR', {
    style: 'currency',
    currency,
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  }).format(safe);
};

/**
 * Presentational component only.
 * Supply already-calculated real and forecast balances from existing business selectors.
 * Never derive balances from target budgets.
 */
export default function BalanceCard({ realBalance, forecastBalance, plannedNet = 0, currency = 'EUR' }) {
  return (
    <View style={styles.container} accessibilityRole="summary">
      <Text style={styles.eyebrow}>SOLDE RÉEL ENREGISTRÉ</Text>
      <Text style={styles.real} accessibilityLabel={`Solde réel : ${formatMoney(realBalance, currency)}`}>
        {formatMoney(realBalance, currency)}
      </Text>
      <View style={styles.divider} />
      <Text style={styles.secondaryLabel}>Solde prévisionnel</Text>
      <Text style={styles.forecast}>{formatMoney(forecastBalance, currency)}</Text>
      <Text style={styles.planned}>Solde des opérations prévues : {formatMoney(plannedNet, currency)}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { backgroundColor: palette.midnight, borderRadius: radius.xl, padding: spacing.lg },
  eyebrow: { color: '#BDCEE1', fontSize: 12, fontWeight: '600', letterSpacing: 0.5 },
  real: { ...typography.hero, color: '#FFFFFF', marginTop: spacing.md },
  divider: { height: 1, backgroundColor: '#3B4F68', marginVertical: spacing.lg },
  secondaryLabel: { ...typography.body, color: '#D0DAE7' },
  forecast: { ...typography.section, color: '#FFFFFF', marginTop: spacing.xs },
  planned: { fontSize: 12, lineHeight: 17, color: '#F1BC6C', marginTop: spacing.sm },
});
