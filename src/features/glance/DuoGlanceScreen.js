import React, { useEffect, useRef, useState } from 'react';
import {
  AccessibilityInfo,
  Animated,
  PanResponder,
  Pressable,
  StyleSheet,
  Text,
  useWindowDimensions,
  View,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { palette } from '../../theme/tokens';

const DEMO = Object.freeze([
  { id: 'balance', title: 'Solde partagé', amount: '1 248,60 €', caption: 'Disponible réel', color: palette.signature },
  { id: 'rollover', title: 'Report', amount: '+ 320 €', color: '#DCF7E9' },
  { id: 'planned', title: 'À venir', amount: '− 180 €', color: '#FFF0DA' },
  { id: 'forecast', title: 'Prévisionnel', amount: '1 068,60 €', color: '#DCE8FF' },
]);

const clamp = (v) => Math.max(0, Math.min(1, v));

/**
 * First implementation slice for Figma's Duo Glance V2.1.
 *
 * Public pre-auth screen: values are intentionally hardcoded DEMO values,
 * never passed in from a cache or API. No real balance can leak here.
 * A future real-balance shortcut requires a separate security review.
 */
export default function DuoGlanceScreen({ onSignIn, onCreateAccount }) {
  const { width, height } = useWindowDimensions();
  const fieldWidth = Math.max(280, Math.min(width - 32, 390));
  const compact = height < 740;
  const progress = useRef(new Animated.Value(0)).current;
  const float = useRef(new Animated.Value(0)).current;
  const progressRef = useRef(0);
  const dragStartRef = useRef(0);
  const [expanded, setExpanded] = useState(false);
  const [reduceMotion, setReduceMotion] = useState(false);

  useEffect(() => {
    const subscription = progress.addListener(({ value }) => { progressRef.current = value; });
    return () => progress.removeListener(subscription);
  }, [progress]);

  useEffect(() => {
    let active = true;
    AccessibilityInfo.isReduceMotionEnabled().then((value) => {
      if (active) setReduceMotion(Boolean(value));
    }).catch(() => {});
    const sub = AccessibilityInfo.addEventListener?.('reduceMotionChanged', setReduceMotion);
    return () => { active = false; sub?.remove?.(); };
  }, []);

  useEffect(() => {
    float.stopAnimation();
    float.setValue(0);
    if (reduceMotion) return undefined;
    const loop = Animated.loop(Animated.sequence([
      Animated.timing(float, { toValue: 1, duration: 2900, useNativeDriver: true }),
      Animated.timing(float, { toValue: 0, duration: 2900, useNativeDriver: true }),
    ]));
    loop.start();
    return () => loop.stop();
  }, [float, reduceMotion]);

  const animateTo = (next) => {
    progress.stopAnimation();
    setExpanded(next === 1);
    Animated.timing(progress, {
      toValue: next,
      duration: reduceMotion ? 0 : 440,
      useNativeDriver: false, // progress is also updated directly by PanResponder.
    }).start();
  };

  const animateToRef = useRef(animateTo);
  animateToRef.current = animateTo;

  const panResponder = useRef(PanResponder.create({
    onMoveShouldSetPanResponder: (_, gesture) => Math.abs(gesture.dy) > 9 && Math.abs(gesture.dy) > Math.abs(gesture.dx),
    onPanResponderGrant: () => {
      progress.stopAnimation();
      dragStartRef.current = progressRef.current;
    },
    onPanResponderMove: (_, gesture) => {
      progress.setValue(clamp(dragStartRef.current + gesture.dy / 175));
    },
    onPanResponderRelease: (_, gesture) => {
      const next = gesture.dy > 45 ? 1 : gesture.dy < -45 ? 0 : progressRef.current >= 0.5 ? 1 : 0;
      animateToRef.current(next);
    },
    onPanResponderTerminate: () => animateToRef.current(progressRef.current >= 0.5 ? 1 : 0),
  })).current;

  // The same four circles morph between resting and revealed states.
  const center = fieldWidth / 2;
  const definitions = [
    { x0: center, y0: 165, x1: center - 3, y1: 175, size: 178, initialScale: 0.46, floatFactor: 1 },
    { x0: center - 85, y0: 110, x1: center - 105, y1: 95, size: 104, initialScale: 0.24, floatFactor: -0.7 },
    { x0: center + 95, y0: 113, x1: center + 105, y1: 105, size: 103, initialScale: 0.22, floatFactor: 0.8 },
    { x0: center + 91, y0: 240, x1: center + 100, y1: 292, size: 109, initialScale: 0.19, floatFactor: -0.5 },
  ];

  const hidden = progress.interpolate({ inputRange: [0, 0.35, 0.63, 1], outputRange: [1, 1, 0, 0] });
  const shown = progress.interpolate({ inputRange: [0, 0.37, 0.7, 1], outputRange: [0, 0, 1, 1] });
  const hover = float.interpolate({ inputRange: [0, 1], outputRange: [-4, 5] });

  return (
    <SafeAreaView style={styles.root} edges={['top', 'bottom']}>
      <View style={styles.header}>
        <View style={styles.brandRow}>
          <View style={styles.brandIcon}><Text style={styles.brandHeart}>♡</Text></View>
          <Text style={styles.brandText}>Duo Budget</Text>
        </View>
        <View style={styles.demoPill}><Text style={styles.demoPillText}>DÉMO</Text></View>
      </View>

      <View style={styles.content}>
        <Text style={styles.title}>Votre duo, en un coup d'œil</Text>
        <Text style={styles.subtitle}>Votre budget devient plus clair, en un geste.</Text>

        <View style={[styles.field, { width: fieldWidth, height: compact ? 355 : 390 }]} {...panResponder.panHandlers}>
          <View style={[styles.aura, { left: center - 129 }]} />
          {definitions.map((d, index) => {
            const item = DEMO[index];
            const tx = progress.interpolate({ inputRange: [0, 1], outputRange: [d.x0 - d.x1, 0] });
            const ty = progress.interpolate({ inputRange: [0, 1], outputRange: [d.y0 - d.y1, 0] });
            const scale = progress.interpolate({ inputRange: [0, 1], outputRange: [d.initialScale, 1] });
            const textColor = index === 0 ? '#FFFFFF' : index === 1 ? '#13765F' : index === 2 ? '#925314' : '#304DB2';
            return (
              <Animated.View
                key={item.id}
                pointerEvents="none"
                style={[
                  styles.bubble,
                  {
                    width: d.size,
                    height: d.size,
                    left: d.x1 - d.size / 2,
                    top: d.y1 - d.size / 2,
                    zIndex: index === 0 ? 3 : 2,
                    backgroundColor: item.color,
                    transform: [{ translateX: tx }, { translateY: ty }, { scale }, { translateY: Animated.multiply(hover, d.floatFactor) }],
                  },
                ]}
              >
                <Animated.Text style={[styles.glyph, { color: textColor, opacity: hidden, fontSize: index === 0 ? 72 : 36 }]}>
                  {['♡', '↓', '◷', '↗'][index]}
                </Animated.Text>
                <Animated.View style={[styles.bubbleInfo, { opacity: shown }]}>
                  <Text numberOfLines={1} style={[styles.bubbleLabel, { color: textColor }]}>{item.title}</Text>
                  <Text numberOfLines={1} adjustsFontSizeToFit minimumFontScale={0.8} style={[styles.bubbleAmount, index === 0 && styles.heroAmount, { color: textColor }]}>{item.amount}</Text>
                  {!!item.caption && <Text style={[styles.bubbleCaption, { color: textColor }]}>{item.caption}</Text>}
                </Animated.View>
              </Animated.View>
            );
          })}
          {[0, 1, 2, 3, 4, 5].map((i) => (
            <Animated.View key={i} pointerEvents="none" style={[styles.particle, {
              backgroundColor: [palette.signature, palette.positive, palette.amber][i % 3],
              left: center + [-142, 131, -122, 112, -63, 87][i],
              top: [70, 89, 252, 286, 314, 60][i],
              width: i % 2 ? 5 : 8, height: i % 2 ? 5 : 8,
              transform: [{ translateY: Animated.multiply(hover, i % 2 ? -1 : 1) }],
            }]} />
          ))}
          <Pressable
            accessibilityRole="button"
            accessibilityLabel={expanded ? 'Masquer la démonstration de budget' : 'Révéler la démonstration de budget'}
            accessibilityHint="Active ou masque les bulles affichant des montants fictifs"
            onPress={() => animateTo(expanded ? 0 : 1)}
            style={[styles.gestureTarget, { left: center - 100 }]}
          />
        </View>

        <Pressable onPress={() => animateTo(expanded ? 0 : 1)} accessibilityRole="button" style={styles.gestureHint}>
          <Text style={styles.gestureHintText}>{expanded ? '↑ Glissez vers le haut pour masquer' : '↓ Glissez vers le bas pour découvrir'}</Text>
          <Text style={styles.demoCaption}>Consultation de démonstration · Montants fictifs</Text>
        </Pressable>
      </View>

      <View style={styles.footer}>
        <Pressable style={({ pressed }) => [styles.primaryButton, pressed && styles.pressed]} onPress={onSignIn} accessibilityRole="button" accessibilityLabel="Se connecter à son espace">
          <Text style={styles.primaryButtonText}>Se connecter</Text>
        </Pressable>
        <Pressable style={({ pressed }) => [styles.secondaryButton, pressed && styles.pressed]} onPress={onCreateAccount || onSignIn} accessibilityRole="button" accessibilityLabel="Découvrir la configuration de Duo Budget">
          <Text style={styles.secondaryButtonText}>Découvrir la configuration</Text>
        </Pressable>
        <Text style={styles.privacyNote}>Aucun solde personnel n'est accessible avant authentification.</Text>
      </View>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: '#F7F9FF' },
  header: { paddingHorizontal: 22, paddingTop: 15, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  brandRow: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  brandIcon: { width: 34, height: 34, borderRadius: 17, backgroundColor: palette.signature, justifyContent: 'center', alignItems: 'center' },
  brandHeart: { color: '#FFFFFF', fontSize: 27, fontWeight: '600' },
  brandText: { color: palette.midnight, fontSize: 18, fontWeight: '800' },
  demoPill: { paddingHorizontal: 14, paddingVertical: 8, borderRadius: 18, backgroundColor: '#FFFFFF' },
  demoPillText: { color: '#596A81', fontSize: 11, fontWeight: '700', letterSpacing: 0.5 },
  content: { flex: 1, alignItems: 'center', paddingTop: 22, justifyContent: 'flex-start' },
  title: { color: palette.midnight, textAlign: 'center', fontWeight: '800', fontSize: 21, lineHeight: 28, paddingHorizontal: 18 },
  subtitle: { color: '#596A81', marginTop: 8, fontSize: 12, textAlign: 'center', paddingHorizontal: 14 },
  field: { position: 'relative', marginTop: 20, overflow: 'visible' },
  aura: { position: 'absolute', top: 52, width: 258, height: 258, borderRadius: 129, backgroundColor: '#E7EEFF' },
  bubble: { position: 'absolute', borderRadius: 999, alignItems: 'center', justifyContent: 'center', shadowColor: '#1F3D81', shadowOpacity: 0.14, shadowRadius: 13, shadowOffset: { width: 0, height: 8 }, elevation: 4 },
  glyph: { position: 'absolute', textAlign: 'center', fontWeight: '600' },
  bubbleInfo: { alignItems: 'center', justifyContent: 'center', paddingHorizontal: 6, width: '100%' },
  bubbleLabel: { fontSize: 10, fontWeight: '600' },
  bubbleAmount: { fontSize: 16, fontWeight: '800', marginTop: 5 },
  heroAmount: { fontSize: 25, letterSpacing: -0.5 },
  bubbleCaption: { fontSize: 10, marginTop: 6 },
  particle: { position: 'absolute', borderRadius: 6, opacity: 0.55 },
  gestureTarget: { position: 'absolute', top: 92, width: 200, height: 185, borderRadius: 100 },
  gestureHint: { alignItems: 'center', paddingVertical: 10, minHeight: 54 },
  gestureHintText: { color: '#304DB2', fontSize: 13, fontWeight: '700' },
  demoCaption: { color: '#596A81', fontSize: 11, marginTop: 6 },
  footer: { paddingHorizontal: 20, paddingBottom: 9, paddingTop: 14, borderTopWidth: 1, borderTopColor: '#DFE6F2', backgroundColor: '#FFFFFF', gap: 10 },
  primaryButton: { minHeight: 50, borderRadius: 13, backgroundColor: palette.signature, alignItems: 'center', justifyContent: 'center' },
  primaryButtonText: { fontSize: 15, fontWeight: '700', color: '#FFFFFF' },
  secondaryButton: { minHeight: 48, borderRadius: 13, backgroundColor: '#EEF2FF', alignItems: 'center', justifyContent: 'center' },
  secondaryButtonText: { fontSize: 14, color: '#304DB2', fontWeight: '700' },
  privacyNote: { textAlign: 'center', color: '#596A81', fontSize: 10, marginTop: 1 },
  pressed: { opacity: 0.78 },
});
