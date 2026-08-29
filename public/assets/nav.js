/* Ten Years Production — header and mobile menu.
   One copy shared by every page. It used to be duplicated in modern.js and
   catalogue.js, which is how the equipment page ended up with a different
   (broken) version. */
(function () {
  "use strict";

  var nav = document.getElementById("nav");
  var burger = document.getElementById("burger");
  var panel = document.getElementById("navLinks");
  if (!nav) return;

  // ---- sticky bar background ----
  function onScroll() {
    nav.classList.toggle("scrolled", window.scrollY > 30);
  }
  window.addEventListener("scroll", onScroll, { passive: true });
  onScroll();

  if (!burger || !panel) return;

  // ---- mobile menu ----
  function setOpen(open) {
    panel.classList.toggle("open", open);
    burger.setAttribute("aria-expanded", open ? "true" : "false");
    // Stop the page scrolling underneath the open panel — on a phone the
    // content behind was sliding away while the menu sat still on top.
    document.body.classList.toggle("menu-open", open);
  }
  var isOpen = function () { return panel.classList.contains("open"); };

  burger.setAttribute("aria-expanded", "false");
  burger.setAttribute("aria-controls", "navLinks");

  burger.addEventListener("click", function (e) {
    e.stopPropagation();
    setOpen(!isOpen());
  });

  // Tapping a link navigates and closes; without this the panel stayed over
  // the page you had just jumped to.
  panel.addEventListener("click", function (e) {
    if (e.target.closest("a")) setOpen(false);
  });

  // Tapping the page outside the panel closes it, which is what people try
  // first before hunting for the burger again.
  document.addEventListener("click", function (e) {
    if (isOpen() && !panel.contains(e.target) && !burger.contains(e.target)) setOpen(false);
  });

  document.addEventListener("keydown", function (e) {
    if (e.key === "Escape" && isOpen()) setOpen(false);
  });

  // Back on a wide screen the panel is part of the bar again, so any leftover
  // open state (and the body lock) has to go.
  window.addEventListener("resize", function () {
    if (window.innerWidth > 900 && isOpen()) setOpen(false);
  });

  var yr = document.getElementById("yr");
  if (yr) yr.textContent = new Date().getFullYear();
})();
