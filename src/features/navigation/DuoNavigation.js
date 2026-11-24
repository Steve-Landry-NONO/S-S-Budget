import React from 'react';
import { StyleSheet, Text, TouchableOpacity, View, useWindowDimensions } from 'react-native';
import { palette, spacing, radius } from '../../theme/tokens';
import routes from './routes.cjs';

// Small monochrome line icons using native Views: no font or native module dependency.
function NavigationIcon({ route, color }) {
  const stroke = { borderColor: color };
  const ink = { backgroundColor: color };
  return (
    <View style={styles.icon} accessible={false} accessibilityElementsHidden importantForAccessibility="no-hide-descendants">
      {route === 'dashboard' && <>
        <View style={[styles.roof, stroke]} />
        <View style={[styles.house, stroke]} />
        <View style={[styles.door, stroke]} />
      </>}
      {route === 'categories' && <>
        <View style={[styles.wallet, stroke]} />
        <View style={[styles.walletClasp, stroke]} />
        <View style={[styles.walletDot, ink]} />
      </>}
      {route === 'activity' && [4, 11, 18].map(top => (
        <React.Fragment key={top}>
          <View style={[styles.listDot, {top}, ink]} />
          <View style={[styles.listLine, {top}, ink]} />
        </React.Fragment>
      ))}
      {route === 'members' && <>
        <View style={[styles.personHead, stroke, {left: 3}]} />
        <View style={[styles.personHead, stroke, {left: 14}]} />
        <View style={[styles.personBody, stroke, {left: 1}]} />
        <View style={[styles.personBody, stroke, {left: 12}]} />
      </>}
    </View>
  );
}

export function BottomNavigation({ route, onNavigate, unreadCount = 0, previewWidth }) {
  const { fontScale, width } = useWindowDimensions();
  const selected = routes.parentRoute(route);
  const large = fontScale >= 1.3 || (previewWidth || width) < 340;
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
            <NavigationIcon route={key} color={active ? palette.midnight : palette.muted} />
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
  tab: { flex: 1, minWidth: 0, minHeight: 64, alignItems: 'center', justifyContent: 'center', paddingVertical: spacing.xs, paddingHorizontal: 2, borderRadius: radius.md },
  largeTab: { flexBasis: '50%', flexGrow: 0 },
  active: { backgroundColor: palette.lightBlue },
  icon: { width: 24, height: 24, position: 'relative', marginBottom: 3 },
  roof: { position: 'absolute', width: 13, height: 13, left: 5.5, top: 2, transform: [{rotate: '45deg'}], borderTopWidth: 1.8, borderLeftWidth: 1.8 },
  house: { position: 'absolute', left: 4, right: 4, top: 10, bottom: 2, borderWidth: 1.8, borderTopWidth: 0, borderBottomLeftRadius: 2, borderBottomRightRadius: 2 },
  door: { position: 'absolute', left: 10, width: 4, top: 14, bottom: 2, borderWidth: 1.5, borderBottomWidth: 0 },
  wallet: { position: 'absolute', left: 2, right: 2, top: 4, bottom: 3, borderWidth: 1.8, borderRadius: 3 },
  walletClasp: { position: 'absolute', right: 1, top: 10, width: 9, height: 7, borderWidth: 1.5, borderRadius: 2 },
  walletDot: { position: 'absolute', right: 5, top: 12.5, width: 2, height: 2, borderRadius: 1 },
  listDot: { position: 'absolute', left: 3, width: 3, height: 3, borderRadius: 1.5 },
  listLine: { position: 'absolute', left: 9, right: 2, height: 2, borderRadius: 1 },
  personHead: { position: 'absolute', top: 3, width: 7, height: 7, borderWidth: 1.5, borderRadius: 4 },
  personBody: { position: 'absolute', top: 12, width: 11, height: 9, borderWidth: 1.5, borderTopLeftRadius: 6, borderTopRightRadius: 6, borderBottomLeftRadius: 2, borderBottomRightRadius: 2 },
  indicator: { height: 3, width: 18, borderRadius: 2, backgroundColor: 'transparent', marginBottom: spacing.xxs },
  activeIndicator: { backgroundColor: palette.signature },
  label: { color: palette.muted, fontSize: 12, fontWeight: '600', textAlign: 'center' },
  activeLabel: { color: palette.midnight, fontWeight: '700' },
  actions: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.xs, paddingHorizontal: spacing.md, paddingVertical: spacing.xs, backgroundColor: palette.surface },
  action: { flexGrow: 1, flexBasis: 120, minHeight: 48, alignItems: 'center', justifyContent: 'center', borderRadius: radius.md, backgroundColor: palette.midnight, padding: spacing.xs },
  actionLabel: { color: palette.surface, fontSize: 14, fontWeight: '600', textAlign: 'center' },
});
