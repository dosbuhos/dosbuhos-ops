// Every measurement the results form, notes and lab uploads understand. Adding a parameter = adding a line here.
//   k      key stored in the app database (entries/labs records)
//   h      Excellovint column header (matched by text, never by letter). Core ones already exist in every lot tab;
//          the others are appended after the tab's last column the first time they're used.
//   label  what the crew sees · unit  shown next to the box · core  always visible (else under "Laboratorio completo")
//   type   'num' (default) or 'text' · aka  other names a lab report may use (for the PDF reader)
//   note   true = no Excellovint column: in the sheet the value is written into the row's note (keeps the tabs narrow);
//          the app still stores it as a value (Labs table, lot panels)
export const PARAMS = [
  { k: 'voli', h: 'VOLI', label: 'Vol inicial', unit: 'L', core: true },
  { k: 'volf', h: 'VOLF', label: 'Vol final', unit: 'L', core: true },
  { k: 'ph', h: 'PH', label: 'pH', unit: '', core: true, aka: ['ph'] },
  { k: 'bx', h: 'BX', label: 'Brix', unit: '°Bx', core: true, aka: ['brix', 'grados brix'] },
  { k: 'tp', h: 'TP', label: 'Temp', unit: '°C', core: true, aka: ['temperatura'] },
  { k: 'at', h: 'AT', label: 'AT', unit: 'g/L', core: true, aka: ['acidez total', 'acidez titulable', 'ta', 'titratable acidity', 'total acidity'] },
  { k: 'am', h: 'AM', label: 'Málico', unit: 'g/L', core: true, aka: ['acido malico', 'ac malico', 'acido l malico', 'l malico', 'malico', 'malic', 'malic acid'] },
  { k: 'sl', h: 'SL', label: 'SO₂ libre', unit: 'mg/L', core: true, aka: ['so2 libre', 'anhidrido sulfuroso libre', 'sulfuroso libre', 'free so2'] },
  { k: 'st', h: 'ST', label: 'SO₂ total', unit: 'mg/L', core: true, aka: ['so2 total', 'anhidrido sulfuroso total', 'sulfuroso total', 'total so2'] },
  { k: 'aa', h: 'AA', label: 'AV', unit: 'g/L', core: true, aka: ['acidez volatil', 'acido volatil', 'acidos volatiles', 'ac volatil', 'acido acetico', 'va', 'av', 'volatile acidity'] },
  { k: 'etoh', h: 'ETOH', label: 'Etanol', unit: '% vol', aka: ['etanol', 'alcohol', 'grado alcoholico', 'alcohol adquirido', 'ethanol'] },
  { k: 'etohp', note: true, h: 'ETOH.P', label: 'Alcohol probable', unit: '% vol', aka: ['alcohol probable', 'grado alcoholico probable', 'alcohol potencial', 'potential alcohol'] },
  { k: 'azres', h: 'AZ.RES', label: 'Azúcares residuales (glucosa+fructosa)', unit: 'g/L', aka: ['azucares residuales', 'azucares reductores', 'glucosa + fructosa', 'glucosa+fructosa', 'rs', 'gf', 'residual sugar'] },
  { k: 'glu', note: true, h: 'GLU', label: 'Glucosa', unit: 'g/L', aka: ['glucosa', 'glucose'] },
  { k: 'fru', note: true, h: 'FRU', label: 'Fructosa', unit: 'g/L', aka: ['fructosa', 'fructose'] },
  { k: 'sac', note: true, h: 'SAC', label: 'Sacarosa', unit: 'g/L', aka: ['sacarosa', 'sucrose'] },
  { k: 'aztot', note: true, h: 'AZ.TOT', label: 'Azúcares totales', unit: 'g/L', aka: ['azucares totales', 'total sugars'] },
  { k: 'att', note: true, h: 'AT.82', label: 'AT titulable (pH 8.2)', unit: 'g/L', aka: ['acidez titulable ph 8 2', 'acidez titulable a ph 8 2', 'acidez total ph 8 2'] },
  { k: 'lact', h: 'LACT', label: 'Ácido láctico', unit: 'g/L', aka: ['acido lactico', 'ac lactico', 'acido l lactico', 'lactico', 'lactic'] },
  { k: 'tart', h: 'TART', label: 'Ácido tartárico', unit: 'g/L', aka: ['acido tartarico', 'ac tartarico', 'tartarico', 'tartaric'] },
  { k: 'citr', note: true, h: 'CITR', label: 'Ácido cítrico', unit: 'g/L', aka: ['acido citrico', 'ac citrico', 'citrico', 'citric'] },
  { k: 'gluc', h: 'GLUC', label: 'Ácido glucónico', unit: 'g/L', aka: ['acido gluconico', 'ac gluconico', 'gluconico', 'gluconic'] },
  { k: 'sorb', note: true, h: 'SORB', label: 'Ácido sórbico', unit: 'mg/L', aka: ['acido sorbico', 'ac sorbico', 'sorbico', 'sorbic'] },
  { k: 'glic', h: 'GLIC', label: 'Glicerol', unit: 'g/L', aka: ['glicerol', 'glicerina', 'glycerol'] },
  { k: 'dens', note: true, h: 'DENS', label: 'Densidad', unit: 'g/mL', aka: ['densidad', 'densidad relativa', 'masa volumica', 'density'] },
  { k: 'extr', note: true, h: 'EXTR', label: 'Extracto seco', unit: 'g/L', aka: ['extracto', 'extracto seco', 'extracto seco total', 'dry extract'] },
  { k: 'polif', h: 'POLIF', label: 'Polifenoles totales', unit: '', aka: ['polifenoles', 'polifenoles totales', 'indice de polifenoles totales', 'fenoles totales', 'ipt', 'total phenolics'] },
  { k: 'antoc', note: true, h: 'ANTOC', label: 'Antocianos', unit: 'mg/L', aka: ['antocianos', 'antocianinas', 'anthocyanins'] },
  { k: 'tan', note: true, h: 'TAN', label: 'Taninos', unit: 'g/L', aka: ['taninos', 'tannins'] },
  { k: 'ic', note: true, h: 'INT.COLOR', label: 'Intensidad colorante', unit: '', aka: ['intensidad colorante', 'intensidad de color', 'ic', 'color intensity'] },
  { k: 'tono', note: true, h: 'TONO', label: 'Tonalidad', unit: '', aka: ['tonalidad', 'tono', 'matiz', 'hue'] },
  { k: 'ntu', h: 'NTU', label: 'Proteínas / turbidez', unit: 'NTU', aka: ['proteinas', 'protidos', 'turbidez', 'ntu', 'turbidity'] },
  { k: 'dntu', h: 'ΔNTU', label: 'Prueba de calor', unit: 'ΔNTU', aka: ['prueba de calor', 'estabilidad proteica', 'heat test'] },
  { k: 'clini', h: 'CLINI', label: 'Clinitest', unit: '−/+/%', type: 'text', aka: ['clinitest'] },
  { k: 'yan', h: 'YAN', label: 'YAN', unit: 'mg/L', aka: ['yan', 'nitrogeno asimilable', 'nitrogeno facilmente asimilable', 'nfa'] },
  { k: 'nh4', note: true, h: 'NH4', label: 'Nitrógeno amoniacal', unit: 'mg/L', aka: ['nitrogeno amoniacal', 'amonio', 'nh4', 'ammonia'] },
  { k: 'nopa', note: true, h: 'NOPA', label: 'Nitrógeno alfa-amino', unit: 'mg/L', aka: ['nitrogeno alfa amino', 'nitrogeno amino', 'alfa amino', 'nopa', 'fan'] },
  { k: 'co2', note: true, h: 'CO2', label: 'CO₂ disuelto', unit: 'g/L', aka: ['co2 disuelto', 'co2', 'dioxido de carbono', 'dioxido de carbono disuelto', 'anhidrido carbonico', 'gas carbonico', 'dissolved co2', 'carbon dioxide'] },
  { k: 'o2', h: 'O2', label: 'Oxígeno disuelto', unit: 'mg/L', aka: ['oxigeno disuelto', 'oxigeno', 'o2 disuelto', 'o2', 'dissolved oxygen'] },
  { k: 'so2m', note: true, h: 'SO2.M', label: 'SO₂ molecular', unit: 'mg/L', aka: ['so2 molecular', 'anhidrido sulfuroso molecular', 'molecular so2'] },
  { k: 'acetal', note: true, h: 'ACETAL', label: 'Acetaldehído', unit: 'mg/L', aka: ['acetaldehido', 'etanal', 'acetaldehyde'] },
  { k: 'acetet', note: true, h: 'ACET.ET', label: 'Acetato de etilo', unit: 'mg/L', aka: ['acetato de etilo', 'ethyl acetate'] },
  { k: 'metoh', note: true, h: 'METOH', label: 'Metanol', unit: 'mg/L', aka: ['metanol', 'methanol'] },
  { k: 'ep4', note: true, h: '4EP', label: '4-etilfenol', unit: 'µg/L', aka: ['4 etilfenol', '4 etil fenol', '4 ep', '4 ethylphenol'] },
  { k: 'eg4', note: true, h: '4EG', label: '4-etilguayacol', unit: 'µg/L', aka: ['4 etilguayacol', '4 etil guayacol', '4 eg', '4 ethylguaiacol'] },
  { k: 'k', note: true, h: 'POTASIO', label: 'Potasio', unit: 'mg/L', aka: ['potasio', 'potassium'] },
  { k: 'ca', note: true, h: 'CALCIO', label: 'Calcio', unit: 'mg/L', aka: ['calcio', 'calcium'] },
  { k: 'fe', note: true, h: 'HIERRO', label: 'Hierro', unit: 'mg/L', aka: ['hierro', 'iron'] },
  { k: 'cu', note: true, h: 'COBRE', label: 'Cobre', unit: 'mg/L', aka: ['cobre', 'copper'] },
];
// Columns the app appends to lot tabs (after the existing ones) for anything without its own Excellovint column.
export const EXTRA_COLS = PARAMS.filter(p => !p.core && !p.note).map(p => p.h).concat(['LAB', 'PDF']);
export const normHead = (s) => String(s == null ? '' : s).normalize('NFC').trim().toUpperCase().replace(/[.\s:]/g, '');
