// Preview-only Expo config plugin: allows cleartext HTTP in the release manifest.
// Why: Android 9+ blocks http:// in release builds; Expo only enables cleartext in the
// debug manifests. The V2 recette server is reached as http://100.x.y.z:3001 over
// Tailscale (WireGuard-encrypted tunnel). Enabled ONLY when eas.json preview sets
// PREVIEW_ALLOW_CLEARTEXT=1. Preferred long-term alternative: HTTPS through
// `tailscale serve` / `tailscale cert`, then remove this plugin.
const { withAndroidManifest, AndroidConfig } = require('expo/config-plugins');

module.exports = function withPreviewCleartext(config) {
  return withAndroidManifest(config, (cfg) => {
    const application = AndroidConfig.Manifest.getMainApplicationOrThrow(cfg.modResults);
    application.$['android:usesCleartextTraffic'] = 'true';
    return cfg;
  });
};
