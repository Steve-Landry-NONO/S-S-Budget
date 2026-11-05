// Keep production identifiers stable; Android preview is independently installable.
// EAS build profile 'preview' sets APP_VARIANT=preview.
// Expo Go / regular CLI remain on the app.json defaults.
const app = require('./app.json').expo;

module.exports = ({ config }) => {
  const isPreview = process.env.APP_VARIANT === 'preview';
  return {
    ...config,
    ...app,
    name: isPreview ? 'Duo Budget Preview' : app.name,
    android: {
      ...app.android,
      package: isPreview ? 'com.ss.budgetcouple.preview' : app.android.package,
    },
    extra: {
      ...(app.extra || {}),
      appVariant: isPreview ? 'preview' : 'standard',
    },
  };
};
