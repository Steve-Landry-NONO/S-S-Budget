const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
test('preview is opt-in web only, separate from authenticated app',()=>{
 const app=fs.readFileSync('App.js','utf8');
 assert.match(app,/Platform\.OS === 'web' && process\.env\.EXPO_PUBLIC_DUO_PREVIEW === '1'/);
 assert.match(app,/return <AuthenticatedApp \/>/);
 assert.match(app,/if \(!isSessionValid\(\)\)/);
});
test('preview does not access storage, network or auth tokens',()=>{
 const src=fs.readFileSync('src/features/preview/WebPreview.js','utf8');
 assert.doesNotMatch(src,/AsyncStorage|fetch\(|\/api\/|authToken|apiSecret|AuthenticatedApp/);
 assert.match(src,/DONNÉES FICTIVES/);
 assert.match(src,/aucune écriture/);
 assert.match(src,/BottomNavigation/);
});
