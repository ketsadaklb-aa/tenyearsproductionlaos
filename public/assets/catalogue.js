/* Ten Years Production — equipment catalogue
   Data comes from /api/catalogue, which the server syncs from the ERP with the
   prices and stock counts already stripped out. Nothing here knows a rate. */
(function () {
  "use strict";

  var SALES_EMAIL = "sales@tenyearsproductionlaos.com";
  var WHATSAPP = "8562055944919";

  var grid = document.getElementById("eqGrid");
  var chipBar = document.getElementById("eqChips");
  var search = document.getElementById("eqSearch");
  var countEl = document.getElementById("eqCount");
  var emptyEl = document.getElementById("eqEmpty");

  var items = [];
  var activeCat = "";
  var query = "";

  // ---- nav: sticky background + mobile menu ----
  var nav = document.getElementById("nav");
  window.addEventListener("scroll", function () {
    nav.classList.toggle("scrolled", window.scrollY > 30 || true);
  }, { passive: true });
  var burger = document.getElementById("burger");
  if (burger) {
    burger.addEventListener("click", function () {
      document.getElementById("navLinks").classList.toggle("open");
    });
  }
  var yr = document.getElementById("yr");
  if (yr) yr.textContent = new Date().getFullYear();

  function esc(s) {
    return String(s == null ? "" : s).replace(/[&<>"]/g, function (c) {
      return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c];
    });
  }

  var NO_IMG =
    '<div class="noimg"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6">' +
    '<rect x="3" y="4" width="18" height="16" rx="2"/><circle cx="9" cy="10" r="1.6"/><path d="M3 17l5-5 4 4 3-3 6 6"/>' +
    "</svg>Photo on request</div>";

  // ---- enquiry links, pre-filled with the item name ----
  function mailLink(name) {
    return (
      "mailto:" + SALES_EMAIL +
      "?subject=" + encodeURIComponent("Price enquiry: " + name) +
      "&body=" + encodeURIComponent(
        "Hello Ten Years Production,\n\nI would like a price for:\n• " + name +
        "\n\nEvent date:\nVenue:\nWhat we need:\n\nThank you."
      )
    );
  }
  function waLink(name) {
    return (
      "https://wa.me/" + WHATSAPP + "?text=" +
      encodeURIComponent("Hello Ten Years Production, I'd like a price for: " + name)
    );
  }

  // ---- filtering ----
  function visible() {
    var q = query.trim().toLowerCase();
    return items.filter(function (it) {
      if (activeCat && it.category !== activeCat) return false;
      if (!q) return true;
      return (
        it.name.toLowerCase().indexOf(q) !== -1 ||
        it.category.toLowerCase().indexOf(q) !== -1 ||
        (it.description || "").toLowerCase().indexOf(q) !== -1
      );
    });
  }

  function render() {
    var list = visible();

    countEl.textContent =
      list.length === items.length
        ? items.length + " items in our inventory"
        : "Showing " + list.length + " of " + items.length + " items";

    emptyEl.hidden = list.length > 0;

    grid.innerHTML = list
      .map(function (it, i) {
        var shot = it.photo
          ? '<img loading="' + (i < 12 ? "eager" : "lazy") + '" decoding="async" src="' +
            esc(it.photo) + '" alt="' + esc(it.name) + '" />'
          : NO_IMG;
        return (
          '<button class="eq-card" type="button" data-i="' + it._i + '">' +
          '<div class="eq-shot">' + shot + "</div>" +
          '<div class="eq-body">' +
          '<span class="eq-cat">' + esc(it.category) + "</span>" +
          "<h3>" + esc(it.name) + "</h3>" +
          '<span class="eq-ask">Ask for a price →</span>' +
          "</div></button>"
        );
      })
      .join("");
  }

  function renderChips(categories) {
    var all =
      '<button class="chip' + (activeCat ? "" : " on") + '" data-cat="">All' +
      '<span class="n">' + items.length + "</span></button>";
    chipBar.innerHTML =
      all +
      categories
        .map(function (c) {
          return (
            '<button class="chip' + (activeCat === c.name ? " on" : "") + '" data-cat="' +
            esc(c.name) + '">' + esc(c.name) + '<span class="n">' + c.count + "</span></button>"
          );
        })
        .join("");
  }

  chipBar.addEventListener("click", function (e) {
    var chip = e.target.closest(".chip");
    if (!chip) return;
    activeCat = chip.getAttribute("data-cat");
    chipBar.querySelectorAll(".chip").forEach(function (c) {
      c.classList.toggle("on", c === chip);
    });
    render();
  });

  var debounce;
  search.addEventListener("input", function () {
    clearTimeout(debounce);
    debounce = setTimeout(function () {
      query = search.value;
      render();
    }, 120);
  });

  // ---- detail modal ----
  var modal = document.getElementById("eqModal");
  var mShot = document.getElementById("eqmShot");
  var mName = document.getElementById("eqmName");
  var mCat = document.getElementById("eqmCat");
  var mDesc = document.getElementById("eqmDesc");
  var mMail = document.getElementById("eqmMail");
  var mWa = document.getElementById("eqmWa");
  var lastFocus = null;

  function openModal(it) {
    lastFocus = document.activeElement;
    mShot.innerHTML = it.photo
      ? '<img src="' + esc(it.photo) + '" alt="' + esc(it.name) + '" />'
      : '<span class="noimg">Photo on request</span>';
    mName.textContent = it.name;
    mCat.textContent = it.category;
    mDesc.textContent = it.description || "";
    mDesc.hidden = !it.description;
    mMail.href = mailLink(it.name);
    mWa.href = waLink(it.name);
    modal.classList.add("open");
    document.body.style.overflow = "hidden";
    document.getElementById("eqClose").focus();
  }
  function closeModal() {
    modal.classList.remove("open");
    document.body.style.overflow = "";
    if (lastFocus) lastFocus.focus();
  }

  grid.addEventListener("click", function (e) {
    var card = e.target.closest(".eq-card");
    if (card) openModal(items[+card.getAttribute("data-i")]);
  });
  document.getElementById("eqClose").addEventListener("click", closeModal);
  modal.addEventListener("click", function (e) {
    if (e.target === modal) closeModal();
  });
  document.addEventListener("keydown", function (e) {
    if (e.key === "Escape" && modal.classList.contains("open")) closeModal();
  });

  // ---- load ----
  fetch("/api/catalogue", { headers: { accept: "application/json" } })
    .then(function (r) {
      if (!r.ok) throw new Error("HTTP " + r.status);
      return r.json();
    })
    .then(function (data) {
      items = (data.items || []).map(function (it, i) {
        it._i = i;
        return it;
      });
      if (!items.length) {
        countEl.textContent = "";
        emptyEl.hidden = false;
        emptyEl.querySelector("b").textContent = "Our catalogue is being updated.";
        return;
      }
      renderChips(data.categories || []);
      render();
    })
    .catch(function () {
      countEl.textContent = "";
      emptyEl.hidden = false;
      emptyEl.querySelector("b").textContent = "We could not load the catalogue right now.";
    });
})();
