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

## Fuentes evaluadas

### CholloSúper — candidata para referencias concretas

- Publica CSV de cesta, índice, frescura y bajadas, además de un RSS de ofertas.
- Declara licencia CC BY 4.0 y permite reutilización comercial citando la fuente y enlazando a su web.
- Su metodología describe una cesta de 202 productos concretos y recogida diaria desde tiendas online públicas.
- Limitación geográfica importante: en DIA, Consum, Carrefour y Condis los precios varían por tienda; sus páginas usan por defecto la zona de Granollers. No se debe atribuir ese precio al código postal 12006.
- La metodología indica que Lidl y Aldi dejaron de publicar catálogo con precios en junio de 2026; para esas cadenas se conserva el último precio conocido (Lidl: 15 de junio; Aldi: 9 de junio). Esos datos no son válidos para mostrar como precio actual.
- Conclusión: posible fuente auxiliar para referencias y ofertas cuando la zona y fecha estén validadas. Excluir cualquier dato caducado y no usar la zona de Granollers como sustituto de Castellón.

Fuente de datos: https://chollosuper.com/datos
Metodología: https://chollosuper.com/metodologia

### tuTándem — candidata para cesta genérica diaria

- Publica CSV diarios bajo licencia CC BY 4.0.
- Cubre una cesta de 26 productos básicos en Mercadona, DIA, Consum, bonÀrea e HiperDino.
- El dato es la mediana del precio por kilo, litro o unidad entre referencias equivalentes de cada cadena; no es un precio de marca, EAN o envase concreto.
- No incluye precios de tiendas concretas ni promociones de tarjeta.
- Conclusión: útil para una comparación orientativa de categorías básicas y tendencias, nunca para afirmar el precio de un producto de catálogo concreto ni para calcular el ahorro exacto de una compra.

Fuente y licencia: https://tutandem.es/datos

### Open Prices / Open Food Facts — candidata para precios por establecimiento aportados por comunidad

- API pública de precios y establecimientos; los datos los aportan usuarios y terceros.
- El proyecto solicita una prueba del precio, como foto de etiqueta o ticket, para mejorar la calidad.
- Puede aportar observaciones de un producto concreto en una tienda concreta, pero la cobertura depende de las contribuciones disponibles y debe comprobarse para cada zona.
- La licencia de la base de datos es ODbL. Exige atribución y obligaciones de compartir bases derivadas bajo condiciones compatibles. No se incorporará al almacén principal hasta revisar que esas obligaciones son compatibles con la distribución y el modelo de datos de Mi Compra.
- Conclusión: fuente potencial para observaciones locales verificadas, pero separada y pendiente de decisión de licencia/cobertura.

API: https://prices.openfoodfacts.org/api/docs
Licencia y guía de API: https://github.com/openfoodfacts/open-prices/blob/main/API.md

### Fuentes oficiales de las cadenas

- Mercadona explica que la disponibilidad del servicio online depende del código postal. También indica que los precios de su tienda online son los mismos que los del supermercado físico, con particularidades para productos de peso variable.
- Lidl advierte que la disponibilidad y el stock de artículos en tienda pueden variar por zona.
- No se ha identificado en esta revisión una API pública oficial y documentada que permita integrar de forma estable los catálogos/precios de Mercadona, Lidl y Carrefour. Esto no demuestra que no existan acuerdos privados o interfaces internas; no se dependerá de endpoints privados sin una evaluación técnica y legal.

Mercadona: https://www.mercadona.es/
FAQ de precios Mercadona: https://ayuda.tienda.mercadona.es/hc/es/articles/360000857491-Products-prices
Lidl: https://www.lidl.es/c/precios-imbatibles/

## Prioridad para el despliegue inicial

1. Mercadona: priorizar observaciones recientes, dejando clara la cobertura territorial del dato.
2. Lidl: no reutilizar como actual ningún precio de catálogo que solo tenga una observación de junio de 2026; evaluar folletos/promociones vigentes por separado.
3. Carrefour: no usar el precio por defecto de Granollers para una comparación en Castellón; exigir una fuente local o un código postal/tienda compatible.
4. Mantener la posibilidad de añadir otras cadenas cuando exista una fuente fiable y con licencia clara.

## Decisiones pendientes antes del primer conector

- Confirmar qué cadenas quiere comparar realmente el hogar y en qué orden.
- Validar si el código postal 12006 sigue siendo el ámbito de referencia.
- Decidir si se acepta incorporar datos ODbL de Open Prices o si se limita la primera versión a fuentes CC BY 4.0 y oficiales.
- Verificar cobertura real por producto y tienda antes de habilitar una comparación como «precio actual».

## Regla de presentación

La interfaz debe mostrar siempre «consultado el», fuente y zona. Los precios sin fecha, fuera de vigencia o con zona no coincidente se mostrarán como históricos/no disponibles, nunca como ofertas actuales. Las ofertas condicionadas deben mostrar su requisito junto al precio efectivo.
