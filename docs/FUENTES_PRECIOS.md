# Evaluación de fuentes de precios y promociones

## Criterios de integración

Mi Compra no debe presentar como precio actual una cifra antigua, genérica o recogida en otra zona. Cada dato integrado debe conservar:

- Fuente original, URL y licencia/atribución exigida.
- Fecha y hora de observación y de importación.
- Producto exacto o categoría genérica claramente diferenciados.
- Precio de envase y precio por unidad de medida, con unidad y moneda.
- Cadena y establecimiento o ámbito geográfico al que aplica.
- Tipo de precio: normal, promoción o precio condicionado.
- Inicio y fin de vigencia cuando la fuente los proporcione.
- Condiciones: tarjeta de fidelidad, unidades mínimas, segunda unidad, pack, etc.
- Estado de frescura y nivel de confianza.

No se deducirán equivalencias exactas a partir de nombres parecidos. Una cesta estadística de categoría no se mostrará como precio de un EAN concreto.

## Decisión técnica: Mercadona (5 de noviembre de 2026)

**No automatizar por ahora la descarga del catálogo de Mercadona.**

La investigación confirma que existen endpoints de lectura usados por la tienda online (categorías y datos de producto), con los que técnicamente se podría recorrer el catálogo y obtener precios. Sin embargo:

- No es una API pública oficial ni documentada por Mercadona; son endpoints internos observados mediante ingeniería inversa.
- La documentación técnica independiente consultada indica que la ruta de API está excluida para rastreadores en robots.txt.
- Los endpoints y sus formatos pueden cambiar sin aviso y aplicar límites o bloqueos.
- No se ha confirmado una autorización de Mercadona para descargar, almacenar y redistribuir de forma automatizada su catálogo y precios dentro de Mi Compra.
- Que los endpoints respondan sin autenticación no equivale a una licencia de reutilización de los datos.

Por tanto, no se desplegará un scraper, no se contratará un intermediario que se limite a raspar esos mismos endpoints y no se almacenarán credenciales ni tokens de cuentas de Mercadona. La integración automática solo se reconsiderará si Mercadona ofrece una API/acuerdo autorizado o se confirma que la reutilización prevista está permitida.

La tienda online sí permite consultar productos y precios para una zona de entrega. Cualquier precio recogido manualmente por el usuario deberá identificarse como observación propia, con fecha y zona; no se presentará como un catálogo completo.

Referencias técnicas no oficiales:
- https://github.com/datania/mercadona-catalog/blob/main/api.md
- https://github.com/ALArvi019/mercadona-cart-bridge/blob/main/docs/api-mercadona.md

## Fuentes evaluadas

### OpenCesta — fuente principal inicial para Mercadona (ODbL 1.0)

- Publica snapshots diarios en Parquet y un catálogo de Mercadona por zonas. En la release del 4 de noviembre de 2026 declara las zonas `vlc1`, `mad1`, `bcn1` y `alc1`.
- El listado general contiene nombre, categoría, SKU, precio de venta, precio de referencia por kg/litro/unidad, formato y URL del producto. EAN y marca no están disponibles en todas las filas del snapshot general; se enriquecen por separado.
- Mi Compra consumirá el dataset ya publicado por OpenCesta; no ejecutará su propio rastreador de Mercadona ni consultará sus endpoints internos.
- El dataset se distribuye bajo ODbL 1.0. Las tablas importadas se mantienen separadas, con atribución visible y lectura pública; no se mezclan con fuentes de licencia incompatible.
- La zona `vlc1` se usa como primera zona de prueba para Castellón, pero no se afirmará que equivale a cada tienda física ni que el código postal 12006 está confirmado hasta verificar la correspondencia logística.
- El importador valida fecha, zona, número mínimo de filas, SKU únicos y precios antes de publicar. La carga se hace en staging y solo se publica el snapshot completo mediante una transacción.
- Se conserva histórico de 180 días. Los precios se muestran siempre con su fecha de captura y fuente.

Repositorio y datos: https://github.com/ruvelro/opencesta
Licencia: https://opendatacommons.org/licenses/odbl/1-0/

### CholloSúper — candidata CC BY 4.0

- Publica CSV de cesta, índice, frescura y bajadas, además de un RSS de ofertas.
- Declara licencia CC BY 4.0 y permite reutilización citando la fuente y enlazando a su web.
- Su metodología describe una cesta de 202 productos concretos y recogida diaria desde tiendas online públicas.
- En DIA, Consum, Carrefour y Condis los precios varían por tienda; sus páginas usan por defecto la zona de Granollers. No se debe atribuir ese precio al código postal 12006.
- La metodología indica que Lidl y Aldi dejaron de publicar catálogo con precios en junio de 2026; para esas cadenas se conserva el último precio conocido. Esos datos no son válidos para mostrar como precio actual.
- Conclusión: posible fuente auxiliar para referencias y ofertas cuando la fecha y el ámbito territorial estén validados. Antes de usarla para Mercadona en Castellón, hay que comprobar qué zona cubre exactamente su dato.

Fuente de datos: https://chollosuper.com/datos
Metodología: https://chollosuper.com/metodologia

### tuTándem — cesta genérica diaria CC BY 4.0

- Publica CSV diarios bajo licencia CC BY 4.0.
- Cubre una cesta de 26 productos básicos en Mercadona, DIA, Consum, bonÀrea e HiperDino.
- El dato es la mediana del precio por kilo, litro o unidad entre referencias equivalentes de cada cadena; no es un precio de marca, EAN o envase concreto.
- No incluye precios de tiendas concretas ni promociones de tarjeta.
- Conclusión: útil para comparar tendencias o categorías básicas, nunca para afirmar el precio de un producto de catálogo concreto ni para calcular el ahorro exacto de una compra.

Fuente y licencia: https://tutandem.es/datos

### Open Prices / Open Food Facts — observaciones de la comunidad (ODbL)

- API pública de precios y establecimientos; los datos los aportan usuarios y terceros.
- El proyecto solicita pruebas del precio, como foto de etiqueta o ticket, para mejorar la calidad.
- Puede aportar observaciones de un producto concreto en una tienda concreta, pero la cobertura depende de las contribuciones disponibles y debe comprobarse para cada zona.
- La base de datos usa ODbL. Exige atribución y obligaciones de compartir bases derivadas bajo condiciones compatibles.
- Decisión: si se integra, se mantendrá en un conjunto de datos claramente separado, con atribución y cumplimiento ODbL; no se mezclará indiscriminadamente con datos de otras licencias. Antes de habilitarlo se comprobará la cobertura real en España y Castellón.

API: https://prices.openfoodfacts.org/api/docs
Licencia y guía: https://github.com/openfoodfacts/open-prices/blob/main/API.md

### Fuentes oficiales de las cadenas

- Mercadona explica que la disponibilidad del servicio online depende del código postal y que los precios online son los mismos que en el supermercado físico, con particularidades para productos de peso variable.
- Lidl advierte que la disponibilidad y el stock pueden variar por zona.
- No se ha identificado una API pública oficial y documentada para integrar de forma estable los catálogos/precios de Mercadona, Lidl y Carrefour. Esto no demuestra que no existan acuerdos privados o interfaces internas.

Mercadona: https://www.mercadona.es/
FAQ de precios Mercadona: https://ayuda.tienda.mercadona.es/hc/es/articles/360000857491-Products-prices
Lidl: https://www.lidl.es/c/precios-imbatibles/

## Prioridad para el despliegue inicial

1. Mercadona: usar OpenCesta como feed inicial de catálogo y precios en la zona vlc1, manteniendo el conjunto ODbL separado. No automatizar directamente endpoints internos de Mercadona. Confirmar la correspondencia exacta de la zona con el código postal 12006 antes de etiquetar los datos como locales.
2. Lidl: no reutilizar como actual ningún precio que solo tenga una observación antigua; evaluar folletos/promociones vigentes por separado.
3. Carrefour: no usar el precio por defecto de Granollers para una comparación en Castellón; exigir una fuente local o un código postal/tienda compatible.
4. Incorporar otras cadenas solo cuando exista una fuente fiable y con licencia clara.

## Decisiones de arquitectura

- Los adaptadores de fuentes estarán desacoplados para que un proveedor pueda retirarse sin afectar a la lista ni al catálogo familiar.
- Se distinguirán el catálogo familiar privado, los datos de mercado externos y las observaciones aportadas por usuarios.
- Cada observación guardará fuente, fecha, ámbito, precio de envase, precio unitario, evidencia y condiciones.
- Los datos ODbL se mantendrán separados de conjuntos con licencias incompatibles.
- No se almacenarán credenciales de supermercados ni se accederá a carritos, pedidos o cuentas de usuario.
- Los importadores nunca marcarán como completa una carga parcial ni sustituirán una carga válida por un resultado vacío.

## Regla de presentación

La interfaz debe mostrar siempre «consultado el», fuente y zona. Los precios sin fecha, fuera de vigencia o con zona no coincidente se mostrarán como históricos/no disponibles, nunca como ofertas actuales. Las ofertas condicionadas deben mostrar su requisito junto al precio efectivo.


## Integración inicial en Mi Compra

La primera integración está implementada en la rama `fase-7/precios-mercadona`:

- Tablas separadas `market_price_snapshots`, `market_price_observations` y `market_price_staging`.
- RPC transaccional que solo publica cuando el número de filas recibido coincide con el esperado.
- Consulta pública de precios desde la PWA, sin necesidad de iniciar sesión.
- Importador diario desde las releases de OpenCesta, programado a las 16:30 UTC en el repositorio de Mi Compra.
- Activación pendiente de añadir el secreto `SUPABASE_SERVICE_ROLE_KEY` a GitHub y ejecutar la primera importación.

No se importarán datos de Open Prices en estas tablas: su ODbL se mantiene como fuente separada si se incorpora más adelante.
