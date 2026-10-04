const width = 940;
const salesHeight = 420;
const money = new Intl.NumberFormat("es-ES", {
  style: "currency", currency: "GBP", maximumFractionDigits: 0
});
const wholeNumber = new Intl.NumberFormat("es-ES");
const monthName = month => new Intl.DateTimeFormat("es-ES", {
  month: "short", year: "2-digit", timeZone: "UTC"
}).format(new Date(month + "-01T00:00:00Z"));

d3.csv("datos/transacciones_limpias.csv", row => ({
  month: row.date.slice(0, 7),
  date: row.date,
  amount: Number(row.amount),
  quantity: Number(row.quantity),
  type: row.transaction_type,
  invoice: row.invoice,
  stock: row.stock,
  description: row.description,
  customer: row.customer
})).then(rows => {
  const sales = rows.filter(row => row.type === "sale");
  const monthInputFrom = document.querySelector("#from-month");
  const monthInputTo = document.querySelector("#to-month");
  const allMonths = Array.from(new Set(sales.map(row => row.month))).sort();
  const salesChart = d3.select("#sales-chart");
  const productChart = d3.select("#products-chart");
  const treemapChart = d3.select("#treemap-chart");
  const customerChart = d3.select("#clients-chart");

  d3.select("#status").text(wholeNumber.format(sales.length) + " líneas de venta cargadas.");

  function selectedSales() {
    return sales.filter(row => row.month >= monthInputFrom.value && row.month <= monthInputTo.value);
  }

  function monthlyTotals(periodSales) {
    return Array.from(
      d3.rollup(periodSales,
        monthRows => ({
          revenue: d3.sum(monthRows, row => row.amount),
          units: d3.sum(monthRows, row => row.quantity)
        }),
        row => row.month
      ),
      ([month, totals]) => ({ month, ...totals })
    ).sort((a, b) => d3.ascending(a.month, b.month));
  }

  function productsInPeriod(periodSales) {
    return Array.from(
      d3.rollup(periodSales,
        productRows => ({
          stock: productRows[0].stock,
          description: d3.mode(productRows, row => row.description) || productRows[0].stock,
          revenue: d3.sum(productRows, row => row.amount),
          units: d3.sum(productRows, row => row.quantity)
        }),
        row => row.stock
      ),
      ([, product]) => product
    );
  }

  function drawSales(monthly) {
    const metric = document.querySelector("#sales-metric").value;
    const margins = { top: 24, right: 24, bottom: 62, left: 90 };
    const plotWidth = width - margins.left - margins.right;
    const plotHeight = salesHeight - margins.top - margins.bottom;
    salesChart.selectAll("*").remove();

    const svg = salesChart.append("svg")
      .attr("viewBox", `0 0 ${width} ${salesHeight}`)
      .attr("role", "img")
      .attr("aria-label", "Gráfico de líneas de ventas por mes");
    const plot = svg.append("g").attr("transform", `translate(${margins.left},${margins.top})`);
    const x = d3.scalePoint().domain(monthly.map(row => row.month)).range([0, plotWidth]);
    const y = d3.scaleLinear().domain([0, d3.max(monthly, row => row[metric]) * 1.1]).nice().range([plotHeight, 0]);
    const format = metric === "revenue" ? value => money.format(value) : value => wholeNumber.format(value);

    plot.append("g").attr("class", "grid").call(d3.axisLeft(y).ticks(5).tickSize(-plotWidth).tickFormat(""));
    plot.append("g").attr("class", "axis").call(d3.axisLeft(y).ticks(5).tickFormat(format));
    plot.append("g").attr("class", "axis").attr("transform", `translate(0,${plotHeight})`)
      .call(d3.axisBottom(x).tickFormat(monthName));
    plot.append("path").datum(monthly).attr("class", "line").attr("d", d3.line()
      .x(row => x(row.month)).y(row => y(row[metric])));
    plot.selectAll("circle").data(monthly).join("circle")
      .attr("class", "point").attr("cx", row => x(row.month)).attr("cy", row => y(row[metric])).attr("r", 5)
      .append("title").text(row => monthName(row.month) + ": " + format(row[metric]));

    const totalRevenue = d3.sum(monthly, row => row.revenue);
    const peak = d3.greatest(monthly, row => row.revenue);
    const low = d3.least(monthly, row => row.revenue);
    d3.select("#sales-findings").text(
      "Facturación bruta del período: " + money.format(totalRevenue) + ". Mínimo: " +
      monthName(low.month) + " (" + money.format(low.revenue) + "); máximo: " +
      monthName(peak.month) + " (" + money.format(peak.revenue) + ")."
    );
  }

  function drawProducts(products, periodSales) {
    const metric = document.querySelector("#product-metric").value;
    const topProducts = products.slice().sort((a, b) => d3.descending(a[metric], b[metric])).slice(0, 10);
    const height = 410;
    const margins = { top: 15, right: 24, bottom: 45, left: 255 };
    const plotWidth = width - margins.left - margins.right;
    const plotHeight = height - margins.top - margins.bottom;
    productChart.selectAll("*").remove();

    const svg = productChart.append("svg").attr("viewBox", `0 0 ${width} ${height}`);
    const plot = svg.append("g").attr("transform", `translate(${margins.left},${margins.top})`);
    const x = d3.scaleLinear().domain([0, d3.max(topProducts, row => row[metric]) * 1.12]).nice().range([0, plotWidth]);
    const y = d3.scaleBand().domain(topProducts.map(row => row.stock)).range([0, plotHeight]).padding(0.16);
    const format = metric === "revenue" ? value => money.format(value) : value => wholeNumber.format(value);

    plot.append("g").attr("class", "grid").attr("transform", `translate(0,${plotHeight})`)
      .call(d3.axisBottom(x).ticks(5).tickSize(-plotHeight).tickFormat(""));
    plot.append("g").attr("class", "axis").attr("transform", `translate(0,${plotHeight})`)
      .call(d3.axisBottom(x).ticks(5).tickFormat(format));
    plot.append("g").attr("class", "axis").call(d3.axisLeft(y).tickFormat(stock => {
      const product = topProducts.find(row => row.stock === stock);
      return stock + " · " + product.description.slice(0, 27);
    }));
    plot.selectAll("rect").data(topProducts).join("rect")
      .attr("class", "bar").attr("x", 0).attr("y", row => y(row.stock))
      .attr("width", row => x(row[metric])).attr("height", y.bandwidth())
      .append("title").text(row => row.stock + " · " + row.description + ": " + format(row[metric]));

    const revenueLeader = d3.greatest(products, row => row.revenue);
    const unitsLeader = d3.greatest(products, row => row.units);
    const exceptionalSale = periodSales.some(row =>
      row.stock === "23166" && row.date.startsWith("2011-01-18") && row.quantity === 74215
    );
    d3.select("#product-findings").text(
      "Ventas brutas, sin descontar devoluciones. Mayor facturación: " + revenueLeader.stock + " · " + revenueLeader.description + " (" + money.format(revenueLeader.revenue) +
      "). Más unidades: " + unitsLeader.stock + " · " + unitsLeader.description + " (" + wholeNumber.format(unitsLeader.units) + ")." +
      (exceptionalSale ? " La ref. 23166 incluye una venta y devolución coincidentes de 74.215 unidades el 18/01/2011." : "")
    );
  }

  function drawTreemap(products) {
    const metric = document.querySelector("#product-metric").value;
    const mapWidth = width;
    const mapHeight = 350;
    const topProducts = products.slice().sort((a, b) => d3.descending(a[metric], b[metric])).slice(0, 10);
    treemapChart.selectAll("*").remove();

    const root = d3.hierarchy({ children: topProducts }).sum(row => row[metric]).sort((a, b) => b.value - a.value);
    d3.treemap().size([mapWidth, mapHeight]).paddingInner(3)(root);
    const color = d3.scaleOrdinal(d3.schemeTableau10);
    const svg = treemapChart.append("svg").attr("viewBox", `0 0 ${mapWidth} ${mapHeight}`);
    const tiles = svg.selectAll("g").data(root.leaves()).join("g")
      .attr("transform", tile => `translate(${tile.x0},${tile.y0})`);
    tiles.append("rect").attr("width", tile => tile.x1 - tile.x0).attr("height", tile => tile.y1 - tile.y0)
      .attr("fill", tile => color(tile.data.stock));
    tiles.filter(tile => tile.x1 - tile.x0 > 52 && tile.y1 - tile.y0 > 22)
      .append("text").attr("class", "tile-label").attr("x", 6).attr("y", 18).text(tile => tile.data.stock);
    tiles.append("title").text(tile => tile.data.stock + " · " + tile.data.description + ": " +
      (metric === "revenue" ? money.format(tile.data.revenue) : wholeNumber.format(tile.data.units)));
  }

  function drawCustomers(periodSales) {
    const customers = Array.from(
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
    if (!customers.length) {
      customerChart.selectAll("*").remove();
      d3.select("#client-findings").text("No hay compras con cliente identificado en este período.");
      return;
    }

    const periodEnd = monthInputTo.value.split("-").map(Number);
    const referenceDate = Date.UTC(periodEnd[0], periodEnd[1], 1);
    customers.forEach(customer => {
      customer.recency = Math.floor((referenceDate - Date.parse(customer.last.replace(" ", "T") + "Z")) / 86400000);
    });
    const spends = customers.map(customer => customer.spend).sort(d3.ascending);
    const threshold = d3.quantileSorted(spends, 0.9);
    const highValue = customers.filter(customer => customer.spend >= threshold);
    const recurring = customers.filter(customer => customer.orders >= 2);
    const customerSpend = d3.sum(customers, customer => customer.spend);
    const highValueSpend = d3.sum(highValue, customer => customer.spend);

    const height = 450;
    const margins = { top: 25, right: 34, bottom: 62, left: 92 };
    const plotWidth = width - margins.left - margins.right;
    const plotHeight = height - margins.top - margins.bottom;
    customerChart.selectAll("*").remove();
    const svg = customerChart.append("svg").attr("viewBox", `0 0 ${width} ${height}`)
      .attr("role", "img").attr("aria-label", "Clientes por número de pedidos, gasto y recencia");
    const plot = svg.append("g").attr("transform", `translate(${margins.left},${margins.top})`);
    const x = d3.scaleLinear().domain([0, d3.max(customers, customer => customer.orders) * 1.08]).nice().range([0, plotWidth]);
    const y = d3.scaleSqrt().domain([0, d3.max(customers, customer => customer.spend)]).nice().range([plotHeight, 0]);
    const recencyColor = d3.scaleThreshold().domain([31, 91]).range(["#087f68", "#d19a32", "#c35942"]);

    plot.append("g").attr("class", "grid").call(d3.axisLeft(y).ticks(5).tickSize(-plotWidth).tickFormat(""));
    plot.append("g").attr("class", "axis").call(d3.axisLeft(y).ticks(5).tickFormat(value => money.format(value)));
    plot.append("g").attr("class", "axis").attr("transform", `translate(0,${plotHeight})`)
      .call(d3.axisBottom(x).ticks(8).tickFormat(wholeNumber));
    plot.append("text").attr("class", "axis-label").attr("x", plotWidth / 2).attr("y", plotHeight + 48)
      .attr("text-anchor", "middle").text("Número de pedidos");
    svg.append("text").attr("class", "axis-label")
      .attr("transform", `translate(22,${height / 2}) rotate(-90)`)
      .attr("text-anchor", "middle").text("Gasto bruto (GBP, escala raíz cuadrada)");
    plot.append("line").attr("class", "p90-line").attr("x1", 0).attr("x2", plotWidth)
      .attr("y1", y(threshold)).attr("y2", y(threshold));
    plot.append("text").attr("class", "p90-label").attr("x", plotWidth - 4).attr("y", y(threshold) - 6)
      .attr("text-anchor", "end").text("P90 " + money.format(threshold));
    plot.selectAll("circle").data(customers).join("circle")
      .attr("class", "customer-point").attr("cx", customer => x(customer.orders))
      .attr("cy", customer => y(customer.spend)).attr("r", customer => customer.spend >= threshold ? 5 : 3.5)
      .attr("fill", customer => recencyColor(customer.recency))
      .append("title").text(customer => "Cliente " + customer.customer + " · " + wholeNumber.format(customer.orders) +
        " pedidos · " + money.format(customer.spend) + " · última compra hace " + customer.recency + " días");

    d3.select("#client-findings").text(
      wholeNumber.format(customers.length) + " clientes identificados; " + wholeNumber.format(recurring.length) +
      " (" + (100 * recurring.length / customers.length).toFixed(1) + " %) repitieron compra en el período. El umbral P90 es " +
      money.format(threshold) + "; el grupo que lo supera reúne " + (100 * highValueSpend / customerSpend).toFixed(1) +
      " % del gasto identificado. El gasto es bruto, no beneficio ni valor futuro."
    );
  }

  function render() {
    const periodSales = selectedSales();
    const monthly = monthlyTotals(periodSales);
    const products = productsInPeriod(periodSales);
    drawSales(monthly);
    drawProducts(products, periodSales);
    drawTreemap(products);
    drawCustomers(periodSales);
  }

  function correctPeriod(changedInput) {
    if (monthInputFrom.value > monthInputTo.value) {
      if (changedInput === monthInputFrom) monthInputTo.value = monthInputFrom.value;
      else monthInputFrom.value = monthInputTo.value;
    }
    render();
  }

  monthInputFrom.addEventListener("change", () => correctPeriod(monthInputFrom));
  monthInputTo.addEventListener("change", () => correctPeriod(monthInputTo));
  document.querySelector("#sales-metric").addEventListener("change", render);
  document.querySelector("#product-metric").addEventListener("change", render);
  render();
}).catch(error => {
  console.error(error);
  d3.select("#status").text("Error al procesar o mostrar los datos: " + error.message);
});
