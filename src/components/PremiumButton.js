import React from 'react';
import { ActivityIndicator, Pressable, StyleSheet, Text } from 'react-native';
import { palette, radius, spacing } from '../theme/tokens';

export default function PremiumButton({ label, onPress, variant = 'primary', disabled = false, loading = false, accessibilityLabel, style }) {
  const secondary = variant === 'secondary';
  const danger = variant === 'danger';
  const backgroundColor = secondary ? '#EEF2FF' : danger ? palette.danger : palette.signature;
  const foreground = secondary ? palette.midnight : '#FFFFFF';
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={accessibilityLabel || label}
      accessibilityState={{ disabled: disabled || loading, busy: loading }}
      disabled={disabled || loading}
      onPress={onPress}
      style={({ pressed }) => [styles.button, { backgroundColor, opacity: disabled ? 0.48 : pressed ? 0.86 : 1 }, style]}
    >
      {loading ? <ActivityIndicator color={foreground} /> : <Text style={[styles.text, { color: foreground }]}>{label}</Text>}
    </Pressable>
  );
}
const styles = StyleSheet.create({
  button: { minHeight: 48, justifyContent: 'center', alignItems: 'center', paddingHorizontal: spacing.md, paddingVertical: spacing.sm, borderRadius: radius.lg },
  text: { color: '#FFFFFF', fontSize: 15, fontWeight: '700', lineHeight: 20 },
});
