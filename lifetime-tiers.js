/* Lifetime price tiers: reads /data/lifetime.json (kept in sync with Stripe) and updates the page.
   Markup hooks: #lt1 / #lt2 cards, [data-lt-price], [data-lt-link], [data-lt-left]. */
(function () {
  var FALLBACK = {tiers: [
    {id: "t1", price: "74.95", limit: 7, sold: 0, active: true, link: "https://buy.stripe.com/8x2cN69MF6Cqc6j40w1Fe03"},
    {id: "t2", price: "97", limit: 50, sold: 0, active: true, link: "https://buy.stripe.com/14AeVe5wp7Gu6LZ7cI1Fe08"}]};
  function left(t) { return Math.max(0, t.limit - t.sold); }
  function open(t) { return t.active && left(t) > 0; }
  function money(p) { return "$" + p; }
  function apply(d) {
    var t1 = d.tiers[0], t2 = d.tiers[1];
    var cur = open(t1) ? t1 : open(t2) ? t2 : null;
    // Cards
    [[t1, document.getElementById("lt1")], [t2, document.getElementById("lt2")]].forEach(function (p) {
      var t = p[0], el = p[1]; if (!el) return;
      var state = open(t) && t === cur ? "open" : (!open(t) ? "soldout" : "locked");
      el.classList.remove("lt-open", "lt-locked", "lt-soldout", "featured");
      el.classList.add("lt-" + state); if (state === "open") el.classList.add("featured");
      var n = left(t), pct = Math.round(100 * n / t.limit);
      var q = function (s) { return el.querySelector(s); };
      var c = q(".lt-count");
      if (c) {
        if (state === "open") c.innerHTML = '<span class="lt-hot">\ud83d\udd25 Only<span class="lt-num">' + n + '</span>left</span>' +
          '<span class="lt-sub">of ' + t.limit + ' spots at ' + money(t.price) + (t === t1 ? ', then the price goes to ' + money(t2.price) : '') + '</span>';
        else c.textContent = state === "soldout" ? "All " + t.limit + " spots claimed" : t.limit + " spots at this price";
      }
      if (q(".seats-fill")) q(".seats-fill").style.width = (state === "locked" ? 100 : pct) + "%";
      var b = q(".lt-btn");
      if (b) {
        if (state === "open") { b.href = t.link; b.removeAttribute("aria-disabled"); b.textContent = "Claim Lifetime, " + money(t.price) + " →"; }
        else { b.removeAttribute("href"); b.setAttribute("aria-disabled", "true"); b.textContent = state === "soldout" ? "Sold out" : "Unlocks after the last " + money(t1.price) + " spot"; }
      }
      if (q(".lt-badge")) q(".lt-badge").textContent = state === "open" ? (t === t1 ? "🔥 Final spots at this price" : "Lifetime · Limited spots") : state === "locked" ? "Next price" : "Sold out";
    });
    // Anywhere else on the page
    document.querySelectorAll("[data-lt-price]").forEach(function (e) { e.textContent = cur ? money(cur.price) : ""; });
    document.querySelectorAll("[data-lt-left]").forEach(function (e) { e.textContent = cur ? "Only " + left(cur) + " left at this price" : "Lifetime spots are sold out"; });
    document.querySelectorAll("a[data-lt-link]").forEach(function (a) {
      if (cur) a.href = cur.link; else { a.href = "#pricing"; a.removeAttribute("target"); }
    });
    if (!cur) document.querySelectorAll("[data-lt-none]").forEach(function (e) {
      e.textContent = e.getAttribute("data-lt-none");
      if (e.hasAttribute("data-lt-none-href")) { e.href = e.getAttribute("data-lt-none-href"); e.target = "_blank"; }
    });
    document.documentElement.classList.toggle("lt-none", !cur);
  }
  apply(FALLBACK);
  fetch("/data/lifetime.json?t=" + Date.now(), {cache: "no-store"}).then(function (r) { return r.json(); }).then(apply).catch(function () {});
})();
