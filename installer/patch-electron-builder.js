// Idempotently adds a `customComponentsPage` hook to electron-builder's assisted
// NSIS template, between the install-mode ("who should this be installed for")
// page and the installation-directory page.
// Also removes any previously injected DshInstFilesShow define (auto-expand
// details is no longer used).
const fs = require("node:fs");
const path = require("node:path");

const templatePath = path.join(
  path.dirname(require.resolve("app-builder-lib/package.json")),
  "templates",
  "nsis",
  "assistedInstaller.nsh"
);

let content = fs.readFileSync(templatePath, "utf8");
let changed = false;

const detailsDefine =
  "!define MUI_PAGE_CUSTOMFUNCTION_SHOW DshInstFilesShow\r\n  ";
const detailsDefineLf =
  "!define MUI_PAGE_CUSTOMFUNCTION_SHOW DshInstFilesShow\n  ";
if (content.includes(detailsDefine)) {
  content = content.replace(detailsDefine, "");
  changed = true;
} else if (content.includes(detailsDefineLf)) {
  content = content.replace(detailsDefineLf, "");
  changed = true;
}

if (!content.includes("customComponentsPage")) {
  const hook =
    "\n  !ifmacrodef customComponentsPage\n" +
    "    !insertmacro customComponentsPage\n" +
    "  !endif\n";
  const pattern =
    /(!ifndef INSTALL_MODE_PER_ALL_USERS\s+!insertmacro PAGE_INSTALL_MODE\s+!endif)(\s+)(!ifdef allowToChangeInstallationDirectory)/;
  if (!pattern.test(content)) {
    console.error("[patch-electron-builder] install-mode anchor not found.");
    process.exit(1);
  }
  content = content.replace(pattern, `$1${hook}$3`);
  changed = true;
}

if (changed) {
  fs.writeFileSync(templatePath, content, "utf8");
  console.log("[patch-electron-builder] template patched.");
} else {
  console.log("[patch-electron-builder] template already patched, skipping.");
}
