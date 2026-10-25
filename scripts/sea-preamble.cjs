// Prepended to the server bundle inside ChicolvenVitrina.exe (see empaquetar.mjs). Plain CommonJS.

// Replacement for import.meta.url (see `define` in empaquetar.mjs): a valid file URL on any OS,
// e.g. file:///C:/ChicolvenVitrina/ChicolvenVitrina.exe on Windows.
var __chicolvenImportMetaUrl = require('url').pathToFileURL(process.execPath).href;
(function () {
  var path = require('path');
  var fs = require('fs');
  var root = process.env.CHICOLVEN_ROOT || path.dirname(process.execPath);
  process.env.CHICOLVEN_ROOT = root;
  process.env.CHICOLVEN_PACKAGED = '1';

  function stop(message) {
    console.error('\n  ERROR: Chicolven Vitrina no pudo iniciar.\n');
    console.error(message);
    try {
      fs.appendFileSync(path.join(root, 'chicolven-error.log'), '[' + new Date().toISOString() + '] ' + message + '\n\n');
      console.error('\n  Detalle guardado en ' + path.join(root, 'chicolven-error.log'));
    } catch (e) {
      /* read-only folder (e.g. inside a ZIP) */
    }
    console.error('\n  Esta ventana se cerrará en 60 segundos (o presione Enter).');
    process.stdin.once('data', function () { process.exit(1); });
    setTimeout(function () { process.exit(1); }, 60000);
  }

  // Registered first so that also errors thrown while the bundle loads end up on screen.
  process.on('uncaughtException', function (err) {
    if (err && err.chicolvenHandled) return;
    stop((err && err.stack) || String(err));
  });

  var missing = ['node_modules/better-sqlite3', 'web/admin', 'web/player'].filter(function (p) {
    return !fs.existsSync(path.join(root, p));
  });
  if (missing.length) {
    stop(
      '  Faltan archivos junto al programa: ' + missing.join(', ') + '\n' +
      '  Carpeta actual: ' + root + '\n\n' +
      '  Probablemente se abrió desde dentro del ZIP. Haga clic derecho en el ZIP >\n' +
      '  "Extraer todo...", y abra "Iniciar Chicolven.bat" desde la carpeta extraída.'
    );
    // Keep the rest of the bundle from running while the message is shown.
    throw Object.assign(new Error('missing files'), { chicolvenHandled: true });
  }

})();
