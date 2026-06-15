/* Ten Years Production — modern interactions */
(function () {
  "use strict";

  // ---- sticky nav background ----
  var nav = document.getElementById("nav");
  function onScroll() {
    if (window.scrollY > 30) nav.classList.add("scrolled");
    else nav.classList.remove("scrolled");
  }
  window.addEventListener("scroll", onScroll, { passive: true });
  onScroll();

  // ---- mobile menu ----
  var burger = document.getElementById("burger");
  var navLinks = document.getElementById("navLinks");
  if (burger) {
    burger.addEventListener("click", function () {
      navLinks.classList.toggle("open");
    });
    navLinks.querySelectorAll("a").forEach(function (a) {
      a.addEventListener("click", function () {
        navLinks.classList.remove("open");
      });
    });
  }

  // ---- scroll reveal ----
  var io = new IntersectionObserver(
    function (entries) {
      entries.forEach(function (e) {
        if (e.isIntersecting) {
          e.target.classList.add("in");
          io.unobserve(e.target);
        }
      });
    },
    { threshold: 0.12, rootMargin: "0px 0px -8% 0px" }
  );
  document.querySelectorAll(".reveal").forEach(function (el) {
    if (!el.classList.contains("in")) io.observe(el);
  });

  // ---- animated counters ----
  function runCounter(el) {
    var target = parseInt(el.getAttribute("data-count"), 10) || 0;
    var dur = 1400, start = null;
    function step(ts) {
      if (!start) start = ts;
      var p = Math.min((ts - start) / dur, 1);
      var eased = 1 - Math.pow(1 - p, 3);
      el.textContent = Math.round(eased * target);
      if (p < 1) requestAnimationFrame(step);
    }
    requestAnimationFrame(step);
  }
  var counters = document.querySelectorAll("[data-count]");
  var cio = new IntersectionObserver(
    function (entries) {
      entries.forEach(function (e) {
        if (e.isIntersecting) {
          runCounter(e.target);
          cio.unobserve(e.target);
        }
      });
    },
    { threshold: 0.6 }
  );
  counters.forEach(function (c) { cio.observe(c); });

  // ---- hero glow follows cursor ----
  var glow = document.getElementById("heroGlow");
  var hero = document.querySelector(".hero");
  if (glow && hero && window.matchMedia("(pointer:fine)").matches) {
    hero.addEventListener("mousemove", function (e) {
      var r = hero.getBoundingClientRect();
      glow.style.transform =
        "translate(" + (e.clientX - r.left - 300) + "px," + (e.clientY - r.top - 300) + "px)";
    });
  }

  // ---- clients marquee: duplicate for seamless loop ----
  var track = document.getElementById("marquee");
  if (track) {
    track.innerHTML += track.innerHTML;
  }

  // ---- gallery lightbox ----
  var lb = document.getElementById("lightbox");
  var lbImg = document.getElementById("lbImg");
  document.querySelectorAll(".gallery img").forEach(function (img) {
    img.addEventListener("click", function () {
      lbImg.src = img.src;
      lbImg.alt = img.alt;
      lb.classList.add("open");
    });
  });
  if (lb) {
    lb.addEventListener("click", function () { lb.classList.remove("open"); });
    document.addEventListener("keydown", function (e) {
      if (e.key === "Escape") lb.classList.remove("open");
    });
  }

  // ---- contact form -> /api/contact (Postgres) ----
  var form = document.getElementById("contactForm");
  if (form) {
    var msg = document.getElementById("formMsg");
    var btn = document.getElementById("cfBtn");
    form.addEventListener("submit", function (e) {
      e.preventDefault();
      msg.className = "form-msg";
      var data = {
        name: form.name.value.trim(),
        email: form.email.value.trim(),
        subject: form.subject.value.trim(),
        message: form.message.value.trim(),
        website: form.website.value, // honeypot
        source: "home",
      };
      btn.disabled = true;
      var orig = btn.textContent;
      btn.textContent = "Sending…";
      fetch("/api/contact", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(data),
      })
        .then(function (r) { return r.json().catch(function () { return { ok: r.ok }; }); })
        .then(function (res) {
          if (res && res.ok) {
            form.reset();
            msg.className = "form-msg ok";
            msg.textContent = "Thank you! Your message has been received — we'll be in touch soon.";
          } else {
            throw new Error();
          }
        })
        .catch(function () {
          msg.className = "form-msg err";
          msg.textContent = "Sorry, something went wrong. Please call us at +856 20 5978 9979.";
        })
        .finally(function () {
          btn.disabled = false;
          btn.textContent = orig;
          msg.scrollIntoView({ behavior: "smooth", block: "center" });
        });
    });
  }

  // ---- footer year ----
  var yr = document.getElementById("yr");
  if (yr) yr.textContent = new Date().getFullYear();
})();
