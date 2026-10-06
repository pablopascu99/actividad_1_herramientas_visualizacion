/**
 * ============================================================================
 *
 * Equipo (COMPLETAR con nombre y apellidos de todos los miembros):
 *   - Nombre Apellido1 Apellido2
 *   - Nombre Apellido1 Apellido2
 *   - Nombre Apellido1 Apellido2
 *   - Miguel España Sanchez
 *
 * Dataset: Online Retail II (hoja 2010-2011), ya tratado con preparar_datos.py
 *          -> datos/transacciones_limpias.csv
 *
 * Preguntas de negocio que respondemos en el dashboard:
 *   1. ¿Cómo evolucionan las ventas mes a mes?            -> gráfico de líneas
 *   2. ¿Qué productos concentran más ventas?              -> barras Top 10 + treemap
 *   3. ¿Cómo se relacionan frecuencia, gasto y recencia?  -> scatter de clientes
 *
 * Interacción:
 *   - Filtros Desde/Hasta: acotan el período de TODAS las gráficas.
 *   - Clic en un punto de la línea: selecciona ese mes; productos y clientes
 *     pasan a calcularse solo con ese mes.
 *   - Clic en una barra o en un bloque del treemap: selecciona ese producto;
 *     la línea muestra solo sus ventas y el scatter resalta a sus compradores.
 *   - Un segundo clic sobre el mismo elemento (o el botón "Limpiar selección")
 *     deshace la selección.
 *   - Tooltip propio en las cuatro gráficas y resaltado enlazado barras <-> treemap.
 *
 * Patrón de código: cada gráfica crea su SVG UNA sola vez (estructura fija) y en
 * cada render solo actualiza los datos con el patrón enter/update/exit de D3
 * (selection.join) y transiciones. Así los elementos se animan desde su posición
 * anterior en lugar de borrarse y redibujarse.
 * ============================================================================
 */

/* ---------------------------------------------------------------------------
 * 1. Constantes y formateadores
 * ------------------------------------------------------------------------- */

const WIDTH = 940;      // ancho lógico de los SVG (se adaptan con viewBox)
const DURATION = 650;   // duración de las transiciones, en milisegundos

// Formato de moneda (libras, sin decimales) y de enteros con separador español.
const money = new Intl.NumberFormat("es-ES", {
  style: "currency", currency: "GBP", maximumFractionDigits: 0
});
const wholeNumber = new Intl.NumberFormat("es-ES");

// Convierte "2011-03" en "mar 11".
const monthName = month => new Intl.DateTimeFormat("es-ES", {
  month: "short", year: "2-digit", timeZone: "UTC"
}).format(new Date(month + "-01T00:00:00Z"));

// Devuelve el formateador adecuado según la métrica elegida en un desplegable.
const formatFor = metric => metric === "revenue"
  ? value => money.format(value)
  : value => wholeNumber.format(value);

/* ---------------------------------------------------------------------------
 * 2. Estado de la selección cruzada
 *    Es la única "memoria" del dashboard además de los controles del HTML.
 * ------------------------------------------------------------------------- */

const state = {
  month: null,   // mes seleccionado en la línea ("AAAA-MM") o null
  stock: null    // referencia de producto seleccionada o null
};

/* ---------------------------------------------------------------------------
 * 3. Tooltip propio (un único <div> reutilizado por todas las gráficas)
 * ------------------------------------------------------------------------- */

const tooltip = d3.select("#tooltip");

/** Muestra el tooltip con un título y una lista de pares [etiqueta, valor]. */
function showTooltip(event, title, rows) {
  tooltip.html("");                                  // vacía el contenido anterior
  tooltip.append("strong").text(title);
  rows.forEach(([label, value]) => {
    const line = tooltip.append("div").attr("class", "tooltip-row");
    line.append("span").text(label);
    line.append("b").text(value);
  });
  tooltip.classed("visible", true);
  moveTooltip(event);
}

/** Coloca el tooltip junto al cursor sin que se salga de la ventana. */
function moveTooltip(event) {
  const box = tooltip.node().getBoundingClientRect();
  let left = event.clientX + 14;
  let top = event.clientY + 14;
  if (left + box.width > window.innerWidth - 8) left = event.clientX - box.width - 14;
  if (top + box.height > window.innerHeight - 8) top = event.clientY - box.height - 14;
  tooltip.style("left", left + "px").style("top", top + "px");
}

function hideTooltip() {
  tooltip.classed("visible", false);
}

/* ---------------------------------------------------------------------------
 * 4. Carga del CSV. El segundo argumento de d3.csv convierte cada fila:
 *    solo se conservan las columnas que usa el dashboard y se tipan los números.
 * ------------------------------------------------------------------------- */

d3.csv("datos/transacciones_limpias.csv", row => ({
  month: row.date.slice(0, 7),        // "AAAA-MM", clave de agregación mensual
  date: row.date,
  amount: Number(row.amount),         // cantidad × precio
  quantity: Number(row.quantity),
  type: row.transaction_type,         // "sale" o "return"
  invoice: row.invoice,
  stock: row.stock,
  description: row.description,
  customer: row.customer              // vacío si la venta no tiene cliente identificado
})).then(rows => {

  // El dashboard trabaja con ventas brutas: se descartan las devoluciones.
  const sales = rows.filter(row => row.type === "sale");

  const monthInputFrom = document.querySelector("#from-month");
  const monthInputTo = document.querySelector("#to-month");
  const salesMetricInput = document.querySelector("#sales-metric");
  const productMetricInput = document.querySelector("#product-metric");

  // Diccionario referencia -> descripción (para el aviso de selección y los tooltips).
  const descriptions = new Map();
  sales.forEach(row => { if (!descriptions.has(row.stock)) descriptions.set(row.stock, row.description); });

  // Escala de color compartida por barras y treemap: el mismo producto tiene
  // siempre el mismo color, de modo que las barras sirven de leyenda del treemap.
  const productColor = d3.scaleOrdinal(d3.schemeTableau10);

  d3.select("#status").text(wholeNumber.format(sales.length) + " líneas de venta cargadas.");

  /* -------------------------------------------------------------------------
   * 5. Funciones de preparación de datos (agregaciones con d3.rollup)
   * ----------------------------------------------------------------------- */

  /** Lista ordenada de meses "AAAA-MM" entre los filtros Desde y Hasta. */
  function monthsInRange() {
    const start = new Date(monthInputFrom.value + "-01T00:00:00Z");
    const end = new Date(monthInputTo.value + "-01T00:00:00Z");
    return d3.utcMonth.range(start, d3.utcMonth.offset(end, 1)).map(d3.utcFormat("%Y-%m"));
  }

  /** Ventas dentro del rango Desde/Hasta. */
  function salesInRange() {
    return sales.filter(row => row.month >= monthInputFrom.value && row.month <= monthInputTo.value);
  }

  /**
   * Facturación y unidades por mes. Se recorre la lista completa de meses para
   * que un mes sin ventas aparezca como 0 y la línea no "salte" meses.
   */
  function monthlyTotals(periodSales, months) {
    const byMonth = d3.rollup(periodSales,
      monthRows => ({
        revenue: d3.sum(monthRows, row => row.amount),
        units: d3.sum(monthRows, row => row.quantity)
      }),
      row => row.month
    );
    return months.map(month => ({ month, revenue: 0, units: 0, ...byMonth.get(month) }));
  }

  /** Facturación y unidades por producto. */
  function productTotals(periodSales) {
    return Array.from(
      d3.rollup(periodSales,
        productRows => ({
          stock: productRows[0].stock,
          description: descriptions.get(productRows[0].stock) || productRows[0].stock,
          revenue: d3.sum(productRows, row => row.amount),
          units: d3.sum(productRows, row => row.quantity)
        }),
        row => row.stock
      ),
      ([, product]) => product
    );
  }

  /** Pedidos (facturas distintas), gasto y última compra por cliente identificado. */
  function customerTotals(periodSales) {
    return Array.from(
      d3.rollup(periodSales.filter(row => row.customer),
        customerRows => ({
          customer: customerRows[0].customer,
          orders: new Set(customerRows.map(row => row.invoice)).size,
          spend: d3.sum(customerRows, row => row.amount),
          last: d3.max(customerRows, row => row.date)
        }),
        row => row.customer
      ),
      ([, customer]) => customer
    );
  }

  /* -------------------------------------------------------------------------
   * 6. Selección cruzada: funciones que modifican el estado y vuelven a pintar
   * ----------------------------------------------------------------------- */

  /** Selecciona un mes; si ya estaba seleccionado, lo deselecciona. */
  function toggleMonth(month) {
    state.month = state.month === month ? null : month;
    hideTooltip();
    render();
  }

  /** Selecciona un producto; si ya estaba seleccionado, lo deselecciona. */
  function toggleStock(stock) {
    state.stock = state.stock === stock ? null : stock;
    hideTooltip();
    render();
  }

  /** Resaltado enlazado al pasar el cursor: marca barra y bloque del mismo producto. */
  function hoverStock(stock, active) {
    d3.selectAll(".bar, .tile").filter(d => (d.data || d).stock === stock).classed("hovered", active);
  }

  /** Pinta los avisos ("chips") con la selección activa y el botón de limpiar. */
  function drawSelection() {
    const box = d3.select("#selection");
    box.html("");
    if (!state.month && !state.stock) {
      box.append("span").attr("class", "hint")
        .text("Haz clic en un mes de la línea o en un producto para filtrar el resto de gráficas.");
      return;
    }
    box.append("span").text("Selección activa:");
    if (state.month) {
      box.append("button").attr("class", "chip").attr("title", "Quitar el filtro de mes")
        .text("Mes: " + monthName(state.month) + " ✕")
        .on("click", () => toggleMonth(state.month));
    }
    if (state.stock) {
      box.append("button").attr("class", "chip").attr("title", "Quitar el filtro de producto")
        .text("Producto: " + state.stock + " · " + (descriptions.get(state.stock) || "") + " ✕")
        .on("click", () => toggleStock(state.stock));
    }
    box.append("button").attr("class", "clear").text("Limpiar selección")
      .on("click", () => { state.month = null; state.stock = null; render(); });
  }

  /* -------------------------------------------------------------------------
   * 7. Gráfica 1 · Línea de evolución mensual
   * ----------------------------------------------------------------------- */

  const salesView = (() => {
    const height = 420;
    const margins = { top: 24, right: 24, bottom: 62, left: 90 };
    const plotWidth = WIDTH - margins.left - margins.right;
    const plotHeight = height - margins.top - margins.bottom;

    // Estructura fija: se crea una sola vez.
    const svg = d3.select("#sales-chart").append("svg")
      .attr("viewBox", `0 0 ${WIDTH} ${height}`)
      .attr("role", "img").attr("aria-label", "Gráfico de líneas de ventas por mes");
    const plot = svg.append("g").attr("transform", `translate(${margins.left},${margins.top})`);
    const grid = plot.append("g").attr("class", "grid");
    const axisY = plot.append("g").attr("class", "axis");
    const axisX = plot.append("g").attr("class", "axis").attr("transform", `translate(0,${plotHeight})`);
    const path = plot.append("path").attr("class", "line");
    const points = plot.append("g");
    let previousMonths = "";   // para saber si ha cambiado el rango de meses

    function update(monthly) {
      const metric = salesMetricInput.value;
      const format = formatFor(metric);

      // Escalas: scalePoint reparte los meses en el eje X; scaleLinear para el valor.
      const x = d3.scalePoint().domain(monthly.map(row => row.month)).range([0, plotWidth]).padding(0.3);
      const y = d3.scaleLinear()
        .domain([0, (d3.max(monthly, row => row[metric]) || 1) * 1.1]).nice()
        .range([plotHeight, 0]);
      const line = d3.line().x(row => x(row.month)).y(row => y(row[metric]));

      // Ejes y rejilla se animan hacia la nueva escala.
      grid.transition().duration(DURATION).call(d3.axisLeft(y).ticks(5).tickSize(-plotWidth).tickFormat(""));
      axisY.transition().duration(DURATION).call(d3.axisLeft(y).ticks(5).tickFormat(format));
      axisX.transition().duration(DURATION).call(d3.axisBottom(x).tickFormat(monthName));

      // Línea. Dos animaciones distintas:
      //  a) mismos meses (cambia métrica o producto): la curva se deforma hasta la nueva.
      //  b) cambia el rango de meses: la línea se "dibuja" de izquierda a derecha
      //     animando stroke-dashoffset desde su longitud total hasta 0.
      const monthsKey = monthly.map(row => row.month).join();
      path.datum(monthly).classed("filtered", Boolean(state.stock));
      if (monthsKey === previousMonths) {
        path.attr("stroke-dasharray", null).transition().duration(DURATION).attr("d", line);
      } else {
        path.interrupt().attr("d", line);
        const length = path.node().getTotalLength();
        path.attr("stroke-dasharray", length + " " + length).attr("stroke-dashoffset", length)
          .transition().duration(DURATION * 1.5).ease(d3.easeCubicOut)
          .attr("stroke-dashoffset", 0);
      }
      previousMonths = monthsKey;

      // Puntos: join con clave (el mes) para que cada círculo "sea" siempre el mismo mes.
      points.selectAll("circle").data(monthly, row => row.month)
        .join(
          enter => enter.append("circle").attr("class", "point")
            .attr("cx", row => x(row.month)).attr("cy", row => y(row[metric])).attr("r", 0),
          update => update,
          exit => exit.transition().duration(DURATION / 2).attr("r", 0).remove()
        )
        .classed("selected", row => row.month === state.month)
        .on("mouseenter", (event, row) => showTooltip(event, monthName(row.month), [
          ["Facturación", money.format(row.revenue)],
          ["Unidades", wholeNumber.format(row.units)],
          ["", row.month === state.month ? "Clic para quitar el filtro" : "Clic para filtrar por este mes"]
        ]))
        .on("mousemove", moveTooltip)
        .on("mouseleave", hideTooltip)
        .on("click", (event, row) => toggleMonth(row.month))
        .transition().duration(DURATION)
        .attr("cx", row => x(row.month)).attr("cy", row => y(row[metric]))
        .attr("r", row => row.month === state.month ? 9 : 5);

      // Texto de hallazgos, recalculado con los datos visibles.
      const totalRevenue = d3.sum(monthly, row => row.revenue);
      const peak = d3.greatest(monthly, row => row.revenue);
      const low = d3.least(monthly, row => row.revenue);
      const scope = state.stock ? "Producto " + state.stock + " · " : "";
      d3.select("#sales-findings").text(totalRevenue === 0
        ? scope + "Sin ventas en el período seleccionado."
        : scope + "Facturación bruta del período: " + money.format(totalRevenue) + ". Mínimo: " +
          monthName(low.month) + " (" + money.format(low.revenue) + "); máximo: " +
          monthName(peak.month) + " (" + money.format(peak.revenue) + ").");
    }

    return { update };
  })();

  /* -------------------------------------------------------------------------
   * 8. Gráfica 2a · Barras horizontales Top 10 de productos
   * ----------------------------------------------------------------------- */

  const productsView = (() => {
    const height = 410;
    const margins = { top: 15, right: 24, bottom: 45, left: 255 };
    const plotWidth = WIDTH - margins.left - margins.right;
    const plotHeight = height - margins.top - margins.bottom;

    const svg = d3.select("#products-chart").append("svg").attr("viewBox", `0 0 ${WIDTH} ${height}`)
      .attr("role", "img").attr("aria-label", "Barras con los diez productos con más ventas");
    const plot = svg.append("g").attr("transform", `translate(${margins.left},${margins.top})`);
    const grid = plot.append("g").attr("class", "grid").attr("transform", `translate(0,${plotHeight})`);
    const axisX = plot.append("g").attr("class", "axis").attr("transform", `translate(0,${plotHeight})`);
    const axisY = plot.append("g").attr("class", "axis");
    const bars = plot.append("g");

    function update(topProducts) {
      const metric = productMetricInput.value;
      const format = formatFor(metric);
      const x = d3.scaleLinear()
        .domain([0, (d3.max(topProducts, row => row[metric]) || 1) * 1.12]).nice().range([0, plotWidth]);
      // scaleBand reparte una banda por producto; el orden del dominio es el ranking.
      const y = d3.scaleBand().domain(topProducts.map(row => row.stock)).range([0, plotHeight]).padding(0.16);
      const label = stock => stock + " · " + (descriptions.get(stock) || "").slice(0, 27);

      grid.transition().duration(DURATION).call(d3.axisBottom(x).ticks(5).tickSize(-plotHeight).tickFormat(""));
      axisX.transition().duration(DURATION).call(d3.axisBottom(x).ticks(5).tickFormat(format));
      axisY.transition().duration(DURATION).call(d3.axisLeft(y).tickFormat(label));

      // Barras con clave = referencia: al cambiar la métrica, cada barra se desplaza
      // a su nuevo puesto del ranking; las que entran crecen desde 0 y las que salen encogen.
      bars.selectAll("rect").data(topProducts, row => row.stock)
        .join(
          enter => enter.append("rect").attr("class", "bar")
            .attr("x", 0).attr("y", row => y(row.stock)).attr("height", y.bandwidth()).attr("width", 0),
          update => update,
          exit => exit.transition().duration(DURATION / 2).attr("width", 0).remove()
        )
        .attr("fill", row => productColor(row.stock))
        .classed("selected", row => row.stock === state.stock)
        .classed("dimmed", row => state.stock && row.stock !== state.stock)
        .on("mouseenter", (event, row) => {
          hoverStock(row.stock, true);
          showTooltip(event, row.stock + " · " + row.description, [
            ["Facturación", money.format(row.revenue)],
            ["Unidades", wholeNumber.format(row.units)],
            ["", row.stock === state.stock ? "Clic para quitar el filtro" : "Clic para filtrar por este producto"]
          ]);
        })
        .on("mousemove", moveTooltip)
        .on("mouseleave", (event, row) => { hoverStock(row.stock, false); hideTooltip(); })
        .on("click", (event, row) => toggleStock(row.stock))
        .transition().duration(DURATION)
        .attr("y", row => y(row.stock)).attr("height", y.bandwidth())
        .attr("width", row => x(row[metric]));
    }

    return { update };
  })();

  /* -------------------------------------------------------------------------
   * 9. Gráfica 2b · Treemap de los mismos 10 productos (peso relativo)
   * ----------------------------------------------------------------------- */

  const treemapView = (() => {
    const mapHeight = 350;
    const svg = d3.select("#treemap-chart").append("svg").attr("viewBox", `0 0 ${WIDTH} ${mapHeight}`)
      .attr("role", "img").attr("aria-label", "Treemap con el peso de los diez productos principales");

    function update(topProducts) {
      const metric = productMetricInput.value;
      const total = d3.sum(topProducts, row => row[metric]);

      // d3.hierarchy + d3.treemap calculan el rectángulo (x0, y0, x1, y1) de cada producto.
      const root = d3.hierarchy({ children: topProducts }).sum(row => row[metric]).sort((a, b) => b.value - a.value);
      d3.treemap().size([WIDTH, mapHeight]).paddingInner(3)(root);

      // Cada bloque es un <g> con su <rect> y su <text>; clave = referencia.
      const tiles = svg.selectAll("g.tile").data(root.leaves(), tile => tile.data.stock)
        .join(
          enter => {
            const group = enter.append("g").attr("class", "tile")
              .attr("transform", tile => `translate(${tile.x0},${tile.y0})`).style("opacity", 0);
            group.append("rect").attr("width", tile => tile.x1 - tile.x0).attr("height", tile => tile.y1 - tile.y0);
            group.append("text").attr("class", "tile-label").attr("x", 6).attr("y", 18);
            return group;
          },
          update => update,
          exit => exit.transition().duration(DURATION / 2).style("opacity", 0).remove()
        )
        .classed("selected", tile => tile.data.stock === state.stock)
        .classed("dimmed", tile => state.stock && tile.data.stock !== state.stock)
        .on("mouseenter", (event, tile) => {
          hoverStock(tile.data.stock, true);
          showTooltip(event, tile.data.stock + " · " + tile.data.description, [
            ["Facturación", money.format(tile.data.revenue)],
            ["Unidades", wholeNumber.format(tile.data.units)],
            ["Peso en el Top 10", (100 * tile.data[metric] / total).toFixed(1) + " %"]
          ]);
        })
        .on("mousemove", moveTooltip)
        .on("mouseleave", (event, tile) => { hoverStock(tile.data.stock, false); hideTooltip(); })
        .on("click", (event, tile) => toggleStock(tile.data.stock));

      // Los bloques se deslizan y cambian de tamaño hasta su nueva posición.
      tiles.transition().duration(DURATION)
        .attr("transform", tile => `translate(${tile.x0},${tile.y0})`).style("opacity", null);
      tiles.select("rect").attr("fill", tile => productColor(tile.data.stock))
        .transition().duration(DURATION)
        .attr("width", tile => tile.x1 - tile.x0).attr("height", tile => tile.y1 - tile.y0);
      // La etiqueta solo se muestra si cabe en el bloque.
      tiles.select("text")
        .text(tile => (tile.x1 - tile.x0 > 52 && tile.y1 - tile.y0 > 22) ? tile.data.stock : "");
    }

    return { update };
  })();

  /* -------------------------------------------------------------------------
   * 10. Gráfica 3 · Scatter de clientes (pedidos × gasto, color = recencia)
   * ----------------------------------------------------------------------- */

  const customersView = (() => {
    const height = 450;
    const margins = { top: 25, right: 34, bottom: 62, left: 92 };
    const plotWidth = WIDTH - margins.left - margins.right;
    const plotHeight = height - margins.top - margins.bottom;

    const svg = d3.select("#clients-chart").append("svg").attr("viewBox", `0 0 ${WIDTH} ${height}`)
      .attr("role", "img").attr("aria-label", "Clientes por número de pedidos, gasto y recencia");
    const plot = svg.append("g").attr("transform", `translate(${margins.left},${margins.top})`);
    const grid = plot.append("g").attr("class", "grid");
    const axisY = plot.append("g").attr("class", "axis");
    const axisX = plot.append("g").attr("class", "axis").attr("transform", `translate(0,${plotHeight})`);
    plot.append("text").attr("class", "axis-label").attr("x", plotWidth / 2).attr("y", plotHeight + 48)
      .attr("text-anchor", "middle").text("Número de pedidos");
    svg.append("text").attr("class", "axis-label")
      .attr("transform", `translate(14,${height / 2}) rotate(-90)`)
      .attr("text-anchor", "middle").text("Gasto bruto (GBP, escala raíz cuadrada)");
    const dots = plot.append("g");
    const p90Line = plot.append("line").attr("class", "p90-line").attr("x1", 0).attr("x2", plotWidth)
      .attr("y1", plotHeight).attr("y2", plotHeight);
    const p90Label = plot.append("text").attr("class", "p90-label").attr("x", plotWidth - 4)
      .attr("y", plotHeight - 6).attr("text-anchor", "end");

    // Escala de umbrales: 0–30 días verde, 31–90 ámbar, más de 90 rojo.
    const recencyColor = d3.scaleThreshold().domain([31, 91]).range(["#087f68", "#d19a32", "#c35942"]);

    /**
     * @param customers  clientes agregados del período efectivo
     * @param endMonth   último mes del período ("AAAA-MM"), referencia para la recencia
     * @param buyers     Set con los clientes que compraron el producto seleccionado, o null
     */
    function update(customers, endMonth, buyers) {
      const findings = d3.select("#client-findings");
      p90Line.style("display", customers.length ? null : "none");
      p90Label.style("display", customers.length ? null : "none");
      if (!customers.length) {
        dots.selectAll("circle").remove();
        findings.text("No hay compras con cliente identificado en este período.");
        return;
      }

      // Recencia: días entre la última compra y el primer día del mes siguiente al período.
      const [year, month] = endMonth.split("-").map(Number);
      const referenceDate = Date.UTC(year, month, 1);
      customers.forEach(customer => {
        customer.recency = Math.floor((referenceDate - Date.parse(customer.last.replace(" ", "T") + "Z")) / 86400000);
      });

      // Percentil 90 del gasto: umbral de "cliente de alto valor".
      const threshold = d3.quantileSorted(customers.map(customer => customer.spend).sort(d3.ascending), 0.9);
      const highValue = customers.filter(customer => customer.spend >= threshold);
      const recurring = customers.filter(customer => customer.orders >= 2);
      const customerSpend = d3.sum(customers, customer => customer.spend);

      const x = d3.scaleLinear().domain([0, d3.max(customers, customer => customer.orders) * 1.08]).nice().range([0, plotWidth]);
      // Raíz cuadrada en Y: separa la nube de clientes de gasto bajo sin ocultar los extremos.
      const y = d3.scaleSqrt().domain([0, d3.max(customers, customer => customer.spend)]).nice().range([plotHeight, 0]);

      grid.transition().duration(DURATION).call(d3.axisLeft(y).ticks(5).tickSize(-plotWidth).tickFormat(""));
      axisY.transition().duration(DURATION).call(d3.axisLeft(y).ticks(5).tickFormat(value => money.format(value)));
      axisX.transition().duration(DURATION).call(d3.axisBottom(x).ticks(8).tickFormat(wholeNumber.format));

      p90Line.transition().duration(DURATION).attr("y1", y(threshold)).attr("y2", y(threshold));
      p90Label.text("P90 " + money.format(threshold)).transition().duration(DURATION).attr("y", y(threshold) - 6);

      const isDimmed = customer => Boolean(buyers) && !buyers.has(customer.customer);

      const circles = dots.selectAll("circle").data(customers, customer => customer.customer)
        .join(
          enter => enter.append("circle").attr("class", "customer-point")
            .attr("cx", customer => x(customer.orders)).attr("cy", plotHeight).attr("r", 0),
          update => update,
          exit => exit.transition().duration(DURATION / 2).attr("r", 0).remove()
        )
        .classed("dimmed", isDimmed)
        .on("mouseenter", (event, customer) => showTooltip(event, "Cliente " + customer.customer, [
          ["Pedidos", wholeNumber.format(customer.orders)],
          ["Gasto bruto", money.format(customer.spend)],
          ["Última compra", "hace " + customer.recency + " días"]
        ].concat(buyers ? [["Compró " + state.stock, buyers.has(customer.customer) ? "Sí" : "No"]] : [])))
        .on("mousemove", moveTooltip)
        .on("mouseleave", hideTooltip);

      circles.transition().duration(DURATION)
        .attr("cx", customer => x(customer.orders)).attr("cy", customer => y(customer.spend))
        .attr("r", customer => customer.spend >= threshold ? 5 : 3.5)
        .attr("fill", customer => recencyColor(customer.recency));

      // Los compradores del producto seleccionado se llevan al frente para que no queden tapados.
      if (buyers) circles.filter(customer => buyers.has(customer.customer)).raise();

      findings.text(
        wholeNumber.format(customers.length) + " clientes identificados; " + wholeNumber.format(recurring.length) +
        " (" + (100 * recurring.length / customers.length).toFixed(1) + " %) repitieron compra en el período. El umbral P90 es " +
        money.format(threshold) + "; el grupo que lo supera reúne " +
        (100 * d3.sum(highValue, customer => customer.spend) / customerSpend).toFixed(1) +
        " % del gasto identificado. El gasto es bruto, no beneficio ni valor futuro." +
        (buyers ? " Resaltados: " + wholeNumber.format(buyers.size) + " clientes (" +
          (100 * buyers.size / customers.length).toFixed(1) + " %) que compraron la ref. " + state.stock + "." : "")
      );
    }

    return { update };
  })();


  function render() {
    // Si el mes seleccionado queda fuera del rango Desde/Hasta, se descarta.
    if (state.month && (state.month < monthInputFrom.value || state.month > monthInputTo.value)) state.month = null;

    const rangeSales = salesInRange();
    // Período efectivo para productos y clientes: el mes seleccionado o todo el rango.
    const periodSales = state.month ? rangeSales.filter(row => row.month === state.month) : rangeSales;
    // La línea siempre muestra todo el rango; si hay producto seleccionado, solo sus ventas.
    const lineSales = state.stock ? rangeSales.filter(row => row.stock === state.stock) : rangeSales;

    const metric = productMetricInput.value;
    const products = productTotals(periodSales);
    const topProducts = products.slice().sort((a, b) => d3.descending(a[metric], b[metric])).slice(0, 10);

    const buyers = state.stock
      ? new Set(periodSales.filter(row => row.stock === state.stock && row.customer).map(row => row.customer))
      : null;

    salesView.update(monthlyTotals(lineSales, monthsInRange()));
    productsView.update(topProducts);
    treemapView.update(topProducts);
    customersView.update(customerTotals(periodSales), state.month || monthInputTo.value, buyers);
    drawProductFindings(products, periodSales);
    drawSelection();
  }

  function drawProductFindings(products, periodSales) {
    if (!products.length) {
      d3.select("#product-findings").text("Sin ventas en el período seleccionado.");
      return;
    }
    const revenueLeader = d3.greatest(products, row => row.revenue);
    const unitsLeader = d3.greatest(products, row => row.units);
    // Caso atípico documentado en el README: venta y devolución de 74.215 unidades.
    const exceptionalSale = periodSales.some(row =>
      row.stock === "23166" && row.date.startsWith("2011-01-18") && row.quantity === 74215
    );
    d3.select("#product-findings").text(
      (state.month ? monthName(state.month) + " · " : "") +
      "Ventas brutas, sin descontar devoluciones. Mayor facturación: " + revenueLeader.stock + " · " +
      revenueLeader.description + " (" + money.format(revenueLeader.revenue) + "). Más unidades: " +
      unitsLeader.stock + " · " + unitsLeader.description + " (" + wholeNumber.format(unitsLeader.units) + ")." +
      (exceptionalSale ? " La ref. 23166 incluye una venta y devolución coincidentes de 74.215 unidades el 18/01/2011." : "")
    );
  }

  /* -------------------------------------------------------------------------
   * 12. Gestión de eventos de los controles del HTML
   * ----------------------------------------------------------------------- */

  /** Evita rangos invertidos (Desde posterior a Hasta) igualando el otro extremo. */
  function correctPeriod(changedInput) {
    if (monthInputFrom.value > monthInputTo.value) {
      if (changedInput === monthInputFrom) monthInputTo.value = monthInputFrom.value;
      else monthInputFrom.value = monthInputTo.value;
    }
    render();
  }

  monthInputFrom.addEventListener("change", () => correctPeriod(monthInputFrom));
  monthInputTo.addEventListener("change", () => correctPeriod(monthInputTo));
  salesMetricInput.addEventListener("change", render);
  productMetricInput.addEventListener("change", render);

  render();   

}).catch(error => {
  console.error(error);
  d3.select("#status").text("Error al procesar o mostrar los datos: " + error.message);
});
