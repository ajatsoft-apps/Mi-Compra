# Mi Compra — importadores y automatización de datos

Repositorio de soporte de datos para **Mi Compra** (asistente de compra familiar). Actualmente contiene **scripts de importación** y **workflows de GitHub Actions** para poblar/actualizar el catálogo y precios en el backend (Supabase), además de pruebas del importador de Lidl.

> Nota: el README original describía el stack previsto de la aplicación (PWA React/TypeScript, Supabase, etc.). En este repositorio, por ahora, lo implementado y versionado son los procesos de ingesta/automatización de datos; la app cliente puede vivir en otro repositorio o fase posterior.

## Qué incluye

- **Lidl (ofertas semanales, España):** `scripts/import_lidl_weekly_offers.py`
  - Obtiene tiendas y ofertas desde endpoints públicos de Lidl Plus/Offers y publica en Supabase (tabla de ofertas, p. ej. `lidl_offers`) mediante API REST con `SUPABASE_SERVICE_ROLE_KEY`.
- **Mercadona (catálogo/precios, OpenCesta):** `scripts/import_opencesta.py`
  - Descarga/valida snapshot publicado y, si hay credenciales, importa a Supabase (zona por defecto `vlc1`). Soporta `--dry-run`.
- **Lidl catálogo online (workflow dedicado):** `.github/workflows/import-lidl-catalog.yml` ejecuta `scripts/import_lidl_catalog.py` desde la rama configurada (p. ej. `fase-5/backend-supabase`) cuando ese script está disponible en dicha rama.
- **Pruebas:** `tests/test_import_lidl_weekly_offers.py` (unittest).

## Estructura

- `scripts/` — importadores y utilidades de ingesta.
- `tests/` — tests de importadores.
- `.github/workflows/` — CI y ejecuciones programadas/manuales:
  - `ci-lidl-importer.yml` — valida sintaxis y tests del importador de ofertas Lidl en PRs relevantes.
  - `import-lidl-offers.yml` — importa ofertas semanales (schedule/dispatch).
  - `import-opencesta.yml` — valida/descarga snapshot y publica catálogo Mercadona si hay credenciales (schedule/dispatch/PR de validación).
  - `import-lidl-catalog.yml` — importación de catálogo/tienda Lidl desde rama indicada.

## Requisitos

- Python 3.12 (según workflows).
- Dependencias según script: los importadores usan principalmente librería estándar/`urllib`; `import-opencesta.yml` instala `polars` y `requests` en CI para la ruta de ejecución del workflow. Para desarrollo local, instala lo necesario según el script que vayas a ejecutar/probar.

## Uso local (ejemplos)

Validar sintaxis/tests del importador Lidl:

```bash
python -m py_compile scripts/import_lidl_weekly_offers.py tests/test_import_lidl_weekly_offers.py
python -m unittest discover -s tests -p 'test_import_lidl_weekly_offers.py' -v
```

Mercadona (validación sin publicar):

```bash
MERCADONA_ZONE=vlc1 python scripts/import_opencesta.py --dry-run
```

Ejecuciones que publican en Supabase requieren variables de entorno (configuradas como secrets/vars en GitHub Actions, **nunca** en el repo):

- `SUPABASE_URL` (o `VITE_SUPABASE_URL` en workflows)
- `SUPABASE_SERVICE_ROLE_KEY`
- `LIDL_STORE_KEYS` / parámetros de workflow según corresponda

## Principios de datos

- Los datos importados deben trazarse con fuente y fecha/contexto cuando el esquema lo permita.
- La lógica de cálculo económico debe ser determinista en la capa de aplicación; los importadores se limitan a ingestar/normalizar datos de origen.
- No incluir secretos ni credenciales en el cliente o en el repositorio.

## Estado

Automatizaciones de importación operativas/ajustables vía workflows; el alcance funcional depende de las ramas/scripts desplegados y de la configuración de Supabase. Revisa los workflows antes de ejecutarlos manualmente.
