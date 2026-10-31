-- Hub: who can open which app. One row per person, per app, per grant.
CREATE TABLE IF NOT EXISTS users (
  email TEXT PRIMARY KEY,            -- Google account, lower-case
  name TEXT NOT NULL DEFAULT '',
  is_admin INTEGER NOT NULL DEFAULT 0, -- Hub admin: people, apps, audit log
  active INTEGER NOT NULL DEFAULT 1,   -- 0 = locked out everywhere, immediately
  created_at INTEGER NOT NULL,
  last_login INTEGER
);

CREATE TABLE IF NOT EXISTS sections (
  slug TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  sort INTEGER NOT NULL DEFAULT 0
);

CREATE TABLE IF NOT EXISTS apps (
  slug TEXT PRIMARY KEY,             -- also the path under the Hub: /cellar/
  name TEXT NOT NULL,
  section TEXT NOT NULL REFERENCES sections(slug),
  description TEXT NOT NULL DEFAULT '',
  status TEXT NOT NULL DEFAULT 'soon' CHECK (status IN ('live', 'import', 'soon', 'hub')),
  mode TEXT NOT NULL DEFAULT 'link' CHECK (mode IN ('link', 'proxy', 'internal')),
  url TEXT NOT NULL DEFAULT '',      -- link: the app's own address; internal: a Hub path
  binding TEXT NOT NULL DEFAULT '',  -- proxy: the service binding name in wrangler.jsonc
  public INTEGER NOT NULL DEFAULT 0, -- 1 = its public pages skip sign-in (tours, press kit)
  sort INTEGER NOT NULL DEFAULT 0
);

CREATE TABLE IF NOT EXISTS grants (
  email TEXT NOT NULL REFERENCES users(email) ON DELETE CASCADE,
  slug TEXT NOT NULL REFERENCES apps(slug) ON DELETE CASCADE,
  role TEXT NOT NULL DEFAULT 'editor' CHECK (role IN ('admin', 'editor', 'viewer')),
  granted_by TEXT NOT NULL DEFAULT '',
  created_at INTEGER NOT NULL,
  PRIMARY KEY (email, slug)
);

CREATE TABLE IF NOT EXISTS sessions (
  id TEXT PRIMARY KEY,
  email TEXT NOT NULL,
  created_at INTEGER NOT NULL,
  expires_at INTEGER NOT NULL,
  ua TEXT NOT NULL DEFAULT ''
);
CREATE INDEX IF NOT EXISTS sessions_email ON sessions(email);

CREATE TABLE IF NOT EXISTS audit_log (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  at INTEGER NOT NULL,
  actor TEXT NOT NULL,
  action TEXT NOT NULL,              -- login, logout, user.add, user.update, user.remove, grant.set, grant.remove, app.update
  target TEXT NOT NULL DEFAULT '',
  detail TEXT NOT NULL DEFAULT ''
);
CREATE INDEX IF NOT EXISTS audit_at ON audit_log(at);

INSERT OR IGNORE INTO sections (slug, name, sort) VALUES
  ('bodega', 'Bodega', 10),
  ('huerta', 'Huerta', 20),
  ('hospitalidad', 'Hospitalidad', 30),
  ('ventas', 'Ventas', 40),
  ('marketing', 'Marketing', 50),
  ('equipo', 'Equipo', 60),
  ('admin', 'Administración', 70);

-- The registry. Live apps open at their own address until each one is wrapped by the Hub (then mode = proxy).
INSERT OR IGNORE INTO apps (slug, name, section, description, status, mode, url, binding, public, sort) VALUES
  ('cellar',        'Calendario de bodega',     'bodega',       'Vinos, labs, mezclas y órdenes de trabajo de Excellovint',           'live',   'link',     'https://cellar.dos-buhos.workers.dev',                  'CELLAR',        0, 10),
  ('barricas',      'Sala de barricas',         'bodega',       'Registro de cada barrica, mapa de la sala y etiquetas QR',            'soon',   'link',     '', '', 0, 20),
  ('vendimia',      'Bitácora de vendimia',     'bodega',       'Lotes, cortes, rendimientos y la carpeta para OTCO',                   'soon',   'link',     '', '', 0, 30),
  ('huerto',        'Huerto',                   'huerta',       'Plan de siembra, semillero, cosechas y experiencias',                  'live',   'link',     'https://huerto-dos-buhos.dos-buhos.workers.dev',        'HUERTO',        0, 10),
  ('mantenimiento', 'Mantenimiento',            'huerta',       'Tareas por área, equipos y proveedores',                               'live',   'link',     'https://dosbuhos-mantenimiento.dos-buhos.workers.dev',  'MANTENIMIENTO', 0, 20),
  ('reservaciones', 'Reservaciones',            'hospitalidad', 'OpenTable, tours, catas y eventos en una sola vista',                  'soon',   'link',     '', '', 0, 10),
  ('barra',         'Inventario de barra',      'hospitalidad', 'Existencias y movimientos de la barra',                                'import', 'link',     '', '', 0, 20),
  ('corte',         'Corte de caja',            'hospitalidad', 'Conciliación del punto de venta al cierre del día',                    'import', 'link',     '', '', 0, 30),
  ('reporte-diario','Reporte diario',           'hospitalidad', 'Envío automático del reporte de Parrot',                               'import', 'link',     '', '', 0, 40),
  ('cierre-vinos',  'Cierre semanal de vinos',  'hospitalidad', 'Conteo de barra contra POS y Zoho',                                    'soon',   'link',     '', '', 0, 50),
  ('reservas-tours','Reservas de tours y catas','hospitalidad', 'Reserva en línea con cupos, horarios y prepago',                       'soon',   'link',     '', '', 1, 60),
  ('ventas',        'Tablero de ventas',        'ventas',       'Botellas vendidas por semana, por vino y por canal, desde Zoho',       'soon',   'link',     '', '', 0, 10),
  ('spark',         'Spark CRM',                'ventas',       'Contactos y seguimiento con compradores de restaurantes',              'live',   'link',     'https://spark.dos-buhos.workers.dev',                   'SPARK',         0, 20),
  ('muestras',      'Muestras',                 'ventas',       'Botellas de muestra y eventos por vendedor',                           'live',   'link',     'https://dosbuhos-ops.dos-buhos.workers.dev',            'OPS',           0, 30),
  ('wineclub',      'Club de vinos',            'ventas',       'Envíos del Círculo, socios y beneficios',                              'live',   'link',     'https://wineclub.dos-buhos.workers.dev',                'WINECLUB',      0, 40),
  ('cotizador',     'Cotizador de eventos',     'ventas',       'Bodas y eventos: paquetes, menús y propuesta',                         'soon',   'link',     '', '', 0, 50),
  ('ads',           'Anuncios',                 'marketing',    'Google y Meta: gasto, reservas y retorno',                             'soon',   'link',     '', '', 0, 10),
  ('marca',         'Marca y prensa',           'marketing',    'Logotipos, etiquetas, fichas técnicas y fotos',                        'soon',   'link',     '', '', 1, 20),
  ('lealtad',       'Club de lealtad',          'marketing',    'Niveles, socios y beneficios del programa',                            'soon',   'link',     '', '', 0, 30),
  ('somma',         'Somma Academy',            'equipo',       'Capacitación e inducción del equipo',                                  'import', 'link',     'https://somma.academy',                                 '',              0, 10),
  ('equipo',        'Equipo',                   'equipo',       'Horarios, turnos y recursos humanos',                                  'import', 'link',     '', '', 0, 20),
  ('personas',      'Personas y accesos',       'admin',        'Quién entra y a qué',                                                  'hub',    'internal', '/admin/#people', '', 0, 10),
  ('secretos',      'Secretos',                 'admin',        'Llaves y accesos de las integraciones',                                'soon',   'internal', '/admin/#secrets', '', 0, 20),
  ('salud',         'Salud de las apps',        'admin',        'Estado, despliegues, errores y uso',                                   'soon',   'internal', '/admin/#health', '', 0, 30),
  ('kpis',          'Tablero de KPIs',          'admin',        'Ventas, restaurante, bodega y anuncios en una pantalla',               'soon',   'internal', '', '', 0, 40),
  ('bitacora',      'Bitácora',                 'admin',        'Quién hizo qué en el Hub',                                             'hub',    'internal', '/admin/#audit', '', 0, 50);
