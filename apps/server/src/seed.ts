/** Loads demo data into an empty database: `npm run seed`. */
import { loadConfig } from './config.ts';
import { openDatabase } from './db/index.ts';
import { createRepos } from './db/repositories/index.ts';
import { seedDemo } from './services/demoData.ts';

const config = loadConfig();
const db = openDatabase(config.dbFile);
const result = seedDemo(createRepos(db));
console.log(result ? `Datos de ejemplo cargados: ${result.products} productos, ${result.screens} pantallas.` : 'La base de datos ya tiene productos; no se cargó nada.');
db.close();
