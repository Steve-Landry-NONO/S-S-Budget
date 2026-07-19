require('dotenv').config();
const { openDb, absoluteDbPath } = require('./db');

openDb()
  .then(async (db) => {
    const members = await db.all('SELECT * FROM members ORDER BY created_at ASC');
    const categories = await db.all('SELECT * FROM categories ORDER BY created_at ASC');
    console.log(`Base initialisée : ${absoluteDbPath}`);
    console.log(`${members.length} membres, ${categories.length} caisses.`);
    await db.close();
  })
  .catch((error) => {
    console.error('Erreur initialisation DB', error);
    process.exit(1);
  });
