# Instrucciones para agentes (Mi Compra)

Guía para agentes de código (p. ej. OpenCode). Este repo contiene importadores de datos y workflows (rama `main`), no la app cliente completa.

## Contexto

- **Scripts:** `scripts/import_lidl_weekly_offers.py`, `scripts/import_opencesta.py` (y en workflows se referencia `import_lidl_catalog.py` en otra rama para catálogo Lidl).
- **Destino:** Supabase (vía REST/API con service role en CI). **Tests:** `tests/test_import_lidl_weekly_offers.py` (unittest).
- **CI/workflows:** `.github/workflows/` (CI del importador Lidl, imports programados/manuales para Lidl/Mercadona).

## Comandos útiles

```bash
python -m py_compile scripts/import_lidl_weekly_offers.py tests/test_import_lidl_weekly_offers.py
python -m unittest discover -s tests -p 'test_import_lidl_weekly_offers.py' -v
python -m py_compile scripts/import_opencesta.py
MERCADONA_ZONE=vlc1 python scripts/import_opencesta.py --dry-run  # si hay dependencias/red disponibles
```

## Reglas

- **No** commitees secretos (`SUPABASE_SERVICE_ROLE_KEY`, tokens, etc.). No ejecutes escrituras a producción sin indicación explícita.
- Respeta la trazabilidad de datos (fuente/fecha/zona) y los parámetros usados por workflows (`LIDL_STORE_KEYS`, `MERCADONA_ZONE`, refs de rama en dispatch).
- Cambios en lógica de importación → actualiza tests/workflows/docs según corresponda.
- Sé preciso sobre el alcance real del repo (ingesta/automatización) frente al producto previsto descrito históricamente.
