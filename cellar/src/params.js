// Every measurement the results form, notes and lab uploads understand. Adding a parameter = adding a line here.
//   k      key stored in the app database (entries/labs records)
//   h      Excellovint column header (matched by text, never by letter). Core ones already exist in every lot tab;
//          the others are appended after the tab's last column the first time they're used.
//   label  what the crew sees · unit  shown next to the box · core  always visible (else under "Laboratorio completo")
//   type   'num' (default) or 'text' · aka  other names a lab report may use (for the PDF reader)
export const PARAMS = [
  { k: 'voli', h: 'VOLI', label: 'Vol inicial', unit: 'L', core: true },
  { k: 'volf', h: 'VOLF', label: 'Vol final', unit: 'L', core: true },
  { k: 'ph', h: 'PH', label: 'pH', unit: '', core: true, aka: ['ph'] },
  { k: 'bx', h: 'BX', label: 'Brix', unit: '°Bx', core: true, aka: ['brix', 'grados brix'] },
  { k: 'tp', h: 'TP', label: 'Temp', unit: '°C', core: true, aka: ['temperatura'] },
  { k: 'at', h: 'AT', label: 'AT', unit: 'g/L', core: true, aka: ['acidez total', 'acidez titulable', 'ta'] },
  { k: 'am', h: 'AM', label: 'Málico', unit: 'g/L', core: true, aka: ['acido malico', 'ácido málico', 'malic'] },
  { k: 'sl', h: 'SL', label: 'SO₂ libre', unit: 'mg/L', core: true, aka: ['so2 libre', 'anhidrido sulfuroso libre', 'free so2'] },
  { k: 'st', h: 'ST', label: 'SO₂ total', unit: 'mg/L', core: true, aka: ['so2 total', 'anhidrido sulfuroso total', 'total so2'] },
  { k: 'aa', h: 'AA', label: 'AV', unit: 'g/L', core: true, aka: ['acidez volatil', 'acidez volátil', 'va', 'volatile acidity'] },
  { k: 'etoh', h: 'ETOH', label: 'Etanol', unit: '% vol', aka: ['etanol', 'alcohol', 'grado alcoholico'] },
  { k: 'azres', h: 'AZ.RES', label: 'Azúcares residuales (glucosa+fructosa)', unit: 'g/L', aka: ['azucares residuales', 'glucosa + fructosa', 'glucosa+fructosa', 'rs', 'gf'] },
  { k: 'lact', h: 'LACT', label: 'Ácido láctico', unit: 'g/L', aka: ['acido lactico', 'lactic'] },
  { k: 'tart', h: 'TART', label: 'Ácido tartárico', unit: 'g/L', aka: ['acido tartarico', 'tartaric'] },
  { k: 'glic', h: 'GLIC', label: 'Glicerol', unit: 'g/L', aka: ['glicerol', 'glycerol'] },
  { k: 'polif', h: 'POLIF', label: 'Polifenoles totales', unit: '', aka: ['polifenoles', 'polifenoles totales', 'ipt'] },
  { k: 'gluc', h: 'GLUC', label: 'Ácido glucónico', unit: 'g/L', aka: ['acido gluconico', 'gluconic'] },
  { k: 'ntu', h: 'NTU', label: 'Proteínas / turbidez', unit: 'NTU', aka: ['proteinas', 'protidos', 'turbidez', 'ntu'] },
  { k: 'dntu', h: 'ΔNTU', label: 'Prueba de calor', unit: 'ΔNTU', aka: ['prueba de calor', 'estabilidad proteica', 'heat test'] },
  { k: 'clini', h: 'CLINI', label: 'Clinitest', unit: '−/+/%', type: 'text', aka: ['clinitest'] },
  { k: 'yan', h: 'YAN', label: 'YAN', unit: 'mg/L', aka: ['yan', 'nitrogeno asimilable', 'nfa'] },
  { k: 'o2', h: 'O2', label: 'Oxígeno disuelto', unit: 'mg/L', aka: ['oxigeno disuelto', 'o2 disuelto', 'dissolved oxygen'] },
];
// Columns the app appends to lot tabs (after the existing ones) for anything without its own Excellovint column.
export const EXTRA_COLS = PARAMS.filter(p => !p.core).map(p => p.h).concat(['LAB', 'PDF']);
export const normHead = (s) => String(s == null ? '' : s).normalize('NFC').trim().toUpperCase().replace(/[.\s:]/g, '');
