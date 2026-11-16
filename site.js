/* Shared by every page: ad boxes + cookie-consent banner. Does nothing unless ADS_ENABLED is true in config.js. */
(function () {
  "use strict";
  var C = window.QTZ_CONFIG || {};
  var on = !!C.ADS_ENABLED;
  var slots = document.querySelectorAll(".ad-slot");
  var i;
  for (i = 0; i < slots.length; i++) slots[i].hidden = !on;
  var side = document.querySelectorAll("aside.side");
  for (i = 0; i < side.length; i++) side[i].hidden = !on;
  var wraps = document.querySelectorAll(".wrap.with-side");
  for (i = 0; i < wraps.length; i++) wraps[i].classList.toggle("no-ads", !on);
  var adsOnly = document.querySelectorAll("[data-ads-only]");
  for (i = 0; i < adsOnly.length; i++) adsOnly[i].hidden = !on;
  var mail = document.querySelectorAll("[data-contact]");
  for (i = 0; i < mail.length; i++) {
    if (C.CONTACT_EMAIL) { mail[i].innerHTML = ""; var a = document.createElement("a"); a.href = "mailto:" + C.CONTACT_EMAIL; a.textContent = C.CONTACT_EMAIL; mail[i].appendChild(a); }
  }
  var repo = document.querySelectorAll("[data-repo]");
  for (i = 0; i < repo.length; i++) {
    if (C.REPO_URL) { var r = document.createElement("a"); r.href = C.REPO_URL; r.textContent = "the public repository"; repo[i].innerHTML = ""; repo[i].appendChild(r); }
  }
  if (!on) return;

  var KEY = "qtz_consent";
  function get() { try { return localStorage.getItem(KEY); } catch (e) { return null; } }
  function set(v) { try { localStorage.setItem(KEY, v); } catch (e) { /* storage blocked: banner will show again */ } }

  var loaded = false;
  function loadAds() {
    if (loaded) return; loaded = true;
    var s = document.createElement("script");
    s.async = true; s.crossOrigin = "anonymous";
    s.src = "https://pagead2.googlesyndication.com/pagead/js/adsbygoogle.js?client=" + encodeURIComponent(C.ADSENSE_CLIENT);
    document.head.appendChild(s);
    var s2 = document.querySelectorAll(".ad-slot[data-slot]");
    for (var k = 0; k < s2.length; k++) {
      var id = (C.AD_SLOTS || {})[s2[k].getAttribute("data-slot")];
      if (!id) continue;
      var ins = document.createElement("ins");
      ins.className = "adsbygoogle"; ins.style.display = "block";
      ins.setAttribute("data-ad-client", C.ADSENSE_CLIENT); ins.setAttribute("data-ad-slot", id);
      ins.setAttribute("data-ad-format", "auto"); ins.setAttribute("data-full-width-responsive", "true");
      s2[k].appendChild(ins);
      try { (window.adsbygoogle = window.adsbygoogle || []).push({}); } catch (e) { /* ad blocker */ }
    }
  }

  var banner = document.createElement("div");
  banner.className = "consent"; banner.hidden = true; banner.setAttribute("role", "dialog"); banner.setAttribute("aria-label", "Cookie choices");
  banner.innerHTML = '<div class="inner"><p>This free site is supported by ads. Ad partners may use cookies to show and measure ads. ' +
    'Your quiz files never leave your browser either way. <a href="privacy.html">Privacy details</a></p>' +
    '<div class="actions" style="margin:0"><button type="button" id="qtz-accept">Accept ads</button><button type="button" class="secondary" id="qtz-decline">No thanks</button></div></div>';
  document.body.appendChild(banner);
  document.getElementById("qtz-accept").onclick = function () { set("granted"); banner.hidden = true; loadAds(); };
  document.getElementById("qtz-decline").onclick = function () { set("denied"); banner.hidden = true; };
  var link = document.querySelectorAll("[data-cookie-settings]");
  for (i = 0; i < link.length; i++) { link[i].hidden = false; link[i].addEventListener("click", function (e) { e.preventDefault(); banner.hidden = false; }); }
  var v = get();
  if (v === "granted") loadAds(); else if (v !== "denied") banner.hidden = false;
})();
