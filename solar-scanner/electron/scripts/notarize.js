/**
 * Script appelé par electron-builder juste après la signature de l'app (.app).
 *
 * Pourquoi un script à part ?
 * La version d'electron-builder utilisée ici (24.13.3) ne lit pas le secret
 * APPLE_TEAM_ID toute seule : elle voudrait le Team ID écrit dans package.json.
 * On refuse de mettre ce numéro dans le code. Donc on désactive la notarisation
 * intégrée ("notarize": false) et on la fait ici, en lisant uniquement les
 * variables d'environnement (les secrets GitHub, en pratique).
 *
 * Si les identifiants Apple sont absents (build sur ton Mac, sans secrets),
 * le script ne fait rien : le .dmg est simplement non signé, et ça reste valable.
 *
 * Aucun mot de passe, certificat ou Team ID n'est écrit dans ce fichier.
 */
const path = require("path");
const { notarize } = require("@electron/notarize");

exports.default = async function notariserApresSignature(context) {
  // On ne notarise que les builds macOS (ce hook peut aussi être appelé ailleurs).
  if (context.electronPlatformName !== "darwin") {
    return;
  }

  const appleId = process.env.APPLE_ID;
  const appleIdPassword = process.env.APPLE_APP_SPECIFIC_PASSWORD;
  const teamId = process.env.APPLE_TEAM_ID;
  const certificat = process.env.CSC_LINK;

  // Build local ou CI sans secrets : on ignore la notarisation, sans faire échouer le build.
  if (!certificat || !appleId || !appleIdPassword || !teamId) {
    console.log(
      "Notarisation ignorée : certificat ou identifiants Apple absents (build non signé / local)."
    );
    return;
  }

  const appName = context.packager.appInfo.productFilename;
  const appPath = path.join(context.appOutDir, `${appName}.app`);

  console.log(`Envoi de ${appPath} à Apple pour notarisation (notarytool)…`);

  // tool: "notarytool" = l'outil actuel d'Apple (altool est abandonné).
  // @electron/notarize 2.5 agrafe aussi le ticket dans l'app (stapler),
  // pour que macOS puisse la vérifier même sans Internet au premier lancement.
  await notarize({
    tool: "notarytool",
    appPath,
    appleId,
    appleIdPassword,
    teamId,
  });

  console.log("Notarisation réussie et ticket agrafé. Le .dmg sera fabriqué à partir de cette app.");
};
