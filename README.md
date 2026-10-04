# Tratamiento de datos

El proyecto limpia el dataset **Online Retail II** y presenta tres preguntas con gráficas D3 básicas: evolución de ventas, productos con más ventas y comportamiento de clientes.

## Regenerar el CSV

Desde esta carpeta, instala dependencias y ejecuta:

```powershell
python -m pip install -r requirements.txt
python preparar_datos.py
```

El script lee la hoja `Year 2010-2011` de `online_retail_II.xlsx` y crea `datos/transacciones_limpias.csv`. La ventana incluida va del 1 de diciembre de 2010 al 30 de noviembre de 2011. Ejecutarlo de nuevo reemplaza ese CSV.

## Ver la gráfica

Desde esta carpeta, inicia un servidor local:

```powershell
python -m http.server 8000 --bind 127.0.0.1
```

Abre <http://127.0.0.1:8000/>. La página carga el CSV existente. Incluye una línea mensual, barras Top 10, treemap y scatter de clientes. Los filtros Desde/Hasta actualizan las vistas; la métrica de producto permite alternar entre facturación y unidades. D3 se carga desde una CDN, por lo que hace falta conexión a Internet. Detén el servidor con Ctrl+C.

Las gráficas de ventas y productos consideran filas `sale`: suman `amount` (cantidad × precio) y `quantity`. No descuentan devoluciones. El producto 23166 incluye una venta y devolución coincidentes de 74.215 unidades; el ranking bruto por unidades debe interpretarse con cautela.

El scatter cuenta facturas distintas por cliente, muestra su gasto bruto y colorea por recencia (días desde la última compra del período). Recurrente significa dos o más pedidos dentro del rango seleccionado. P90 es el percentil 90 del gasto de los clientes identificados; el eje vertical del scatter usa escala de raíz cuadrada para hacer más visibles los valores pequeños.

## Limpieza aplicada

- Elimina filas exactamente duplicadas.
- Conserva referencias de producto cuyo `StockCode` comienza por un dígito y operaciones dentro del período seleccionado.
- Conserva ventas con cantidad positiva y factura no cancelada, y devoluciones con cantidad negativa.
- Excluye precios nulos o no positivos, cantidades nulas o iguales a cero y fechas inválidas o fuera del período.
- Conserva las transacciones sin `Customer ID`; el campo `customer` queda vacío para esas filas.
- Calcula `amount` como `quantity × price`: los importes de devoluciones quedan negativos.

La regla de códigos numéricos es una decisión práctica, no una clasificación oficial del catálogo. Las devoluciones no se enlazan con su compra original.

## Columnas del CSV

`date`, `invoice`, `stock`, `description`, `quantity`, `price`, `amount`, `customer`, `country` y `transaction_type` (`sale` o `return`). Se exporta en UTF-8 con BOM para facilitar su apertura en Excel.

El Excel original se conserva como fuente. Para esta etapa basta con el CSV transaccional: los JSON y los demás CSV eran datos derivados del dashboard y no son necesarios para reutilizar la tabla limpia.