# Fase 8 — Comparador y optimizador

## Primera entrega: cálculo de cesta con referencias verificadas

La vista «Mi cesta» usa los artículos pendientes de la lista y los relaciona con el catálogo familiar mediante catalog_product_id. Solo consulta precios cuando el producto familiar tiene un EAN y existe una observación con ese mismo EAN en el último snapshot de Mercadona/OpenCesta para vlc1.

### Reglas de cálculo

- No se vinculan productos por similitud de nombre.
- No se aplican equivalencias o sustitutos automáticamente.
- Si el EAN no existe, no aparece en el snapshot o devuelve más de una observación, la línea queda sin precio calculable.
- Para cantidades en kg/g y L/ml se usa el precio de referencia únicamente cuando la unidad de referencia coincide; g y ml se convierten a kg y L.
- Para unidades, packs y cajas se usa el precio del envase multiplicado por la cantidad solicitada.
- Las unidades no compatibles quedan fuera del subtotal.
- El subtotal se etiqueta como parcial y muestra cuántas líneas se han podido calcular; nunca se presenta como total de compra si faltan líneas.

### Límites conocidos

- Solo existe una fuente/cadena integrada en esta primera entrega: Mercadona vía OpenCesta.
- vlc1 es la zona del feed, no una garantía de tienda física ni una correspondencia postal certificada.
- No hay todavía comparación entre supermercados.
- Las promociones condicionadas, gastos de desplazamiento y stock no se calculan.
- La vista necesita conexión para consultar el último snapshot.

### Próximos pasos

1. Validar en la PWA con productos del catálogo que tengan EAN conocido y cantidades de distintas unidades.
2. Añadir fuentes de otras cadenas solo tras comprobar licencia, fecha y cobertura geográfica.
3. Incorporar reglas de promociones y coste de desplazamiento después de disponer de datos comparables.
4. Añadir pruebas automatizadas de conversión de unidades y cálculo parcial antes de ampliar el optimizador.
