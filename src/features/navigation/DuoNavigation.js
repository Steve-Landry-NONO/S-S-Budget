import React from 'react';
import { StyleSheet, Text, TouchableOpacity, View, useWindowDimensions } from 'react-native';
import { palette, spacing, radius } from '../../theme/tokens';
import routes from './routes.cjs';

export function BottomNavigation({ route, onNavigate, unreadCount = 0 }) {
  const { fontScale } = useWindowDimensions();
  const selected = routes.parentRoute(route);
  const large = fontScale >= 1.3;
  return (
    <View style={[styles.bar, large && styles.wrap]} accessibilityRole="tablist">
      {routes.TABS.map(({ key, label }) => {
        const active = selected === key;
        const unread = key === 'activity' && unreadCount > 0;
        return (
          <TouchableOpacity key={key} testID={'nav-' + key} accessibilityRole="tab"
            accessibilityState={{ selected: active }}
            accessibilityLabel={unread ? label + ', ' + unreadCount + ' activités non lues' : label}
            onPress={() => onNavigate(key)} style={[styles.tab, large && styles.largeTab, active && styles.active]}>
            <View style={[styles.indicator, active && styles.activeIndicator]} />
            <Text style={[styles.label, active && styles.activeLabel]}>{label}{unread ? ' •' : ''}</Text>
          </TouchableOpacity>
        );
      })}
    </View>
  );
}

export function NavigationActions({ route, onNavigate }) {
  const actions = routes.actionsFor(route);
  if (!actions.length) return null;
  return (
    <View style={styles.actions}>
      {actions.map(({key,label}) => (
        <TouchableOpacity key={key} testID={'action-' + key} accessibilityRole="button"
          onPress={() => onNavigate(key)} style={styles.action}>
          <Text style={styles.actionLabel}>{label}</Text>
        </TouchableOpacity>
      ))}
    </View>
  );
}

const styles = StyleSheet.create({
  bar: { flexDirection: 'row', backgroundColor: palette.surface, borderTopWidth: 1, borderColor: palette.border, paddingHorizontal: spacing.xxs, paddingVertical: spacing.xxs },
  wrap: { flexWrap: 'wrap' },
  tab: { flex: 1, minWidth: 0, minHeight: 48, alignItems: 'center', justifyContent: 'center', paddingVertical: spacing.xs, paddingHorizontal: 2, borderRadius: radius.md },
  largeTab: { flexBasis: '50%', flexGrow: 0 },
  active: { backgroundColor: palette.lightBlue },
  indicator: { height: 3, width: 18, borderRadius: 2, backgroundColor: 'transparent', marginBottom: spacing.xxs },
  activeIndicator: { backgroundColor: palette.signature },
  label: { color: palette.muted, fontSize: 12, fontWeight: '600', textAlign: 'center' },
  activeLabel: { color: palette.midnight, fontWeight: '700' },
  actions: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.xs, paddingHorizontal: spacing.md, paddingVertical: spacing.xs, backgroundColor: palette.surface },
  action: { flexGrow: 1, flexBasis: 120, minHeight: 48, alignItems: 'center', justifyContent: 'center', borderRadius: radius.md, backgroundColor: palette.midnight, padding: spacing.xs },
  actionLabel: { color: palette.surface, fontSize: 14, fontWeight: '600', textAlign: 'center' },
});
