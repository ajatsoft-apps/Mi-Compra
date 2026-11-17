# Contribuir a Mi Compra (importadores de datos)

Gracias por contribuir. Este repositorio contiene scripts y workflows para importar datos (Lidl/Mercadona) hacia Supabase.

## Flujo de trabajo

- Rama principal: **`main`**.
- Crea ramas para tus cambios y valida antes de integrar. Respeta los paths que disparan los workflows de CI/importación.

## Entorno

- **Python 3.12** recomendado (alineado con CI).
- No hay `requirements.txt` único versionado; instala dependencias según el script/workflow que toques (p. ej. `polars`, `requests` para el flujo de OpenCesta en CI).

## Validación

Para cambios en el importador de ofertas Lidl:

```bash
python -m py_compile scripts/import_lidl_weekly_offers.py tests/test_import_lidl_weekly_offers.py
python -m unittest discover -s tests -p 'test_import_lidl_weekly_offers.py' -v
```

Para otros scripts (p. ej. `import_opencesta.py`), al menos:

```bash
python -m py_compile scripts/<script>.py
```

y, si es seguro, una ejecución de validación (`--dry-run` cuando exista) sin publicar datos reales.

## Seguridad y configuración

- **Nunca** commitees `SUPABASE_SERVICE_ROLE_KEY`, `SUPABASE_URL` sensibles, tokens ni credenciales.
- Usa GitHub Secrets/Variables para CI. Ten en cuenta que algunos workflows admiten fallback de variables (p. ej. `VITE_SUPABASE_URL`) según configuración del proyecto.
- No ejecutes importaciones que modifiquen datos de producción sin intención y credenciales adecuadas.

## Convenciones

- Mantén los scripts idempotentes/seguros en la medida de lo posible y con manejo claro de errores.
- Si cambias esquemas de destino, cabeceras, orígenes o parámetros, actualiza los workflows y la documentación.
- Añade/actualiza tests cuando modifiques lógica del importador Lidl o introduzcas comportamiento susceptible de regresión.

## Documentación

- Actualiza `README.md`, `CONTRIBUTING.md` y `AGENTS.md` si cambias comandos, variables de entorno, schedules, ramas de ejecución o alcance de los datos.
