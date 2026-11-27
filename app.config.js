// Keep production identifiers stable; Android preview is independently installable.
// EAS build profile 'preview' sets APP_VARIANT=preview.
// Expo Go / regular CLI remain on the app.json defaults.
const app = require('./app.json').expo;

// Permissions added by default templates that Duo Budget never uses.
const PREVIEW_BLOCKED_PERMISSIONS = [
  'android.permission.SYSTEM_ALERT_WINDOW',
  'android.permission.READ_EXTERNAL_STORAGE',
  'android.permission.WRITE_EXTERNAL_STORAGE',
];

module.exports = ({ config }) => {
  const isPreview = process.env.APP_VARIANT === 'preview';
  const allowCleartext = isPreview && process.env.PREVIEW_ALLOW_CLEARTEXT === '1';
  return {
    ...config,
    ...app,
    name: isPreview ? 'Duo Budget Preview' : app.name,
    android: {
      ...app.android,
      package: isPreview ? 'com.ss.budgetcouple.preview' : app.android.package,
      // Preview hardening: AsyncStorage holds the session token, API secret and
      // financial cache; keep them out of Android cloud/device-transfer backups.
      ...(isPreview ? { allowBackup: false, blockedPermissions: PREVIEW_BLOCKED_PERMISSIONS } : {}),
    },
    plugins: allowCleartext ? [...(app.plugins || []), './plugins/withPreviewCleartext'] : app.plugins,
    extra: {
      ...(app.extra || {}),
      appVariant: isPreview ? 'preview' : 'standard',
    },
  };
};
