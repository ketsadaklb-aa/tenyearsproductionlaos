/* Intercept the contact form and send it to our own backend (/api/contact),
 * which stores it in Postgres. Replaces the dead WordPress handler.
 * Uses capture phase + stopImmediatePropagation to beat WPForms' own JS. */
(function () {
  function val(form, selector) {
    var el = form.querySelector(selector);
    return el ? el.value : "";
  }

  function showMessage(form, text, ok) {
    var box = document.createElement("div");
    box.textContent = text;
    box.style.cssText =
      "margin:1rem 0;padding:1rem 1.25rem;border-radius:8px;font-weight:600;" +
      (ok
        ? "background:#1e3a1e;color:#bff0bf;border:1px solid #2f6b2f;"
        : "background:#3a1e1e;color:#f0bfbf;border:1px solid #6b2f2f;");
    form.parentNode.insertBefore(box, form);
  }

  document.addEventListener(
    "submit",
    function (e) {
      var form = e.target;
      if (!form || form.id !== "wpforms-form-4") return; // only the contact form

      e.preventDefault();
      e.stopImmediatePropagation();

      var data = {
        name: val(form, '[name="wpforms[fields][0]"]'),
        email: val(form, '[name="wpforms[fields][1]"]'),
        subject: val(form, '[name="wpforms[fields][3]"]'),
        message: val(form, '[name="wpforms[fields][2]"]'),
        website: val(form, '[name="wpforms[hp]"]'), // honeypot
        source: "contact",
      };

      var btn = form.querySelector('button[type="submit"], input[type="submit"]');
      if (btn) {
        btn.disabled = true;
        btn.dataset.orig = btn.textContent;
        btn.textContent = "Sending…";
      }

      fetch("/api/contact", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(data),
      })
        .then(function (r) {
          return r.json().catch(function () {
            return { ok: r.ok };
          });
        })
        .then(function (res) {
          if (res && res.ok) {
            form.reset();
            showMessage(
              form,
              "Thank you! Your message has been received. We'll get back to you soon.",
              true
            );
            form.style.display = "none";
          } else {
            showMessage(
              form,
              "Sorry, something went wrong. Please email hello@tenyearsproductionlaos.com.",
              false
            );
          }
        })
        .catch(function () {
          showMessage(
            form,
            "Sorry, something went wrong. Please email hello@tenyearsproductionlaos.com.",
            false
          );
        })
        .finally(function () {
          if (btn) {
            btn.disabled = false;
            btn.textContent = btn.dataset.orig || "Submit";
          }
        });
    },
    true // capture phase
  );
})();
