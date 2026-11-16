/* QuizToBBZip page logic. Everything runs in this browser tab; nothing is uploaded. */
(function () {
  "use strict";
  var Q = window.QTZ;
  var $ = function (id) { return document.getElementById(id); };
  var MAX_BYTES = 40 * 1024 * 1024;
  var state = { quiz: null, key: null, quizBlocks: null, keyBlocks: null, result: null, timer: null, seq: 0 };

  var SAMPLE = [
    "Sample Quiz - Forces",
    "",
    "1. What is the SI unit of force?",
    "a) Joule",
    "b) Newton",
    "c) Watt",
    "d) Pascal",
    "Answer: B",
    "",
    "2. Which law gives \\(F = G \\frac{m_1 m_2}{r^2}\\)? (2 marks)",
    "A. Hooke's law",
    "B. Newton's third law",
    "*C. Newton's law of gravitation",
    "D. Kepler's second law",
    "Feedback: The force between two masses falls with the square of their distance.",
    "",
    "3. True or false: a satellite in a circular orbit has constant speed.",
    "Answer: True",
    "",
    "4. Orbital speed is \\(v = \\sqrt{\\frac{GM}{r}}\\). If r increases, v: a) increases b) decreases c) stays the same d) becomes zero",
    "Answer: b",
    "",
    "5. Explain why astronauts seem weightless in orbit. (3 marks)",
    ""
  ].join("\n");

  function el(tag, props, text) {
    var e = document.createElement(tag);
    if (props) for (var k in props) { if (k === "class") e.className = props[k]; else e.setAttribute(k, props[k]); }
    if (text != null) e.textContent = text;
    return e;
  }

  function readFile(file) {
    return new Promise(function (resolve, reject) {
      if (file.size > MAX_BYTES) return reject(new Error("That file is larger than 40 MB. Please shrink the pictures and try again."));
      var r = new FileReader();
      r.onload = function () { resolve(new Uint8Array(r.result)); };
      r.onerror = function () { reject(new Error("Could not read that file.")); };
      r.readAsArrayBuffer(file);
    });
  }

  function showError(msg) {
    var box = $("error");
    box.textContent = msg; box.hidden = !msg;
  }

  function wireDrop(zone, input, onFile) {
    ["dragenter", "dragover"].forEach(function (ev) { zone.addEventListener(ev, function (e) { e.preventDefault(); zone.classList.add("over"); }); });
    ["dragleave", "drop"].forEach(function (ev) { zone.addEventListener(ev, function (e) { e.preventDefault(); zone.classList.remove("over"); }); });
    zone.addEventListener("drop", function (e) { var f = e.dataTransfer && e.dataTransfer.files && e.dataTransfer.files[0]; if (f) onFile(f); });
    input.addEventListener("change", function () { if (input.files && input.files[0]) onFile(input.files[0]); input.value = ""; });
  }

  async function loadQuiz(name, bytes) {
    var seq = ++state.seq;
    showError("");
    state.quiz = { name: name, bytes: bytes };
    $("quizChip").textContent = name;
    try {
      state.quizBlocks = await Q.readBlocks(name, bytes);
    } catch (e) {
      if (seq !== state.seq) return;
      state.quizBlocks = null; state.result = null; showError(e.message || String(e)); render(); return;
    }
    if (seq !== state.seq) return;
    run();
  }

  async function loadKey(name, bytes) {
    showError("");
    try { state.keyBlocks = await Q.readBlocks(name, bytes); state.key = { name: name }; $("keyChip").textContent = name; $("clearKey").hidden = false; }
    catch (e) { state.keyBlocks = null; state.key = null; showError("Key file: " + (e.message || String(e))); }
    run();
  }

  function opts() {
    var pts = parseFloat($("points").value), seed = parseInt($("seed").value, 10);
    return {
      fileName: state.quiz ? state.quiz.name : "quiz",
      blocks: state.quizBlocks,
      keyBlocks: state.keyBlocks,
      keyText: $("keyText").value,
      title: $("title").value,
      points: isNaN(pts) || pts <= 0 ? 1 : pts,
      keepLatex: $("keepLatex").checked,
      shuffle: $("shuffle").checked,
      seed: isNaN(seed) ? 1 : seed
    };
  }

  function run() {
    if (!state.quizBlocks) { state.result = null; render(); return; }
    try {
      state.result = Q.analyse(opts());
      $("title").placeholder = state.result.title;
      showError("");
    } catch (e) {
      state.result = null; showError(e.message || String(e));
    }
    render();
  }
  function runSoon() { clearTimeout(state.timer); state.timer = setTimeout(run, 250); }

  function render() {
    var res = state.result;
    $("results").hidden = !res;
    if (!res) return;
    var total = 0, nfig = 0, mc = 0, tf = 0, es = 0;
    res.rows.forEach(function (r) { total += Number(r.points) || 0; nfig += r.figs.length; if (r.type === "mc") mc++; else if (r.type === "tf") tf++; else es++; });
    var sum = $("summary"); sum.textContent = "";
    sum.appendChild(el("span", null, res.questions.length + " questions"));
    sum.appendChild(el("span", null, (Math.round(total * 100) / 100) + " points"));
    sum.appendChild(el("span", null, mc + " multiple choice" + (tf ? ", " + tf + " true/false" : "") + (es ? ", " + es + " written" : "")));
    sum.appendChild(el("span", null, nfig + " figure" + (nfig === 1 ? "" : "s")));

    var warn = $("warnings"); warn.textContent = ""; warn.hidden = !res.notes.length;
    if (res.notes.length) {
      warn.appendChild(el("strong", null, res.notes.length === 1 ? "Check this before you import:" : "Check these before you import:"));
      var ul = el("ul"); res.notes.forEach(function (n) { ul.appendChild(el("li", null, n)); }); warn.appendChild(ul);
    }
    $("missingBox").hidden = !res.missing.length;
    $("missingCount").textContent = res.missing.length;

    var letters = res.rows.filter(function (r) { return r.type === "mc"; }).map(function (r) { return r.zipAns; }).join(" ");
    $("keyline").textContent = letters || "(no multiple-choice questions)";
    $("shuffleNote").hidden = !res.shuffled;

    var tb = $("tbody"); tb.textContent = "";
    res.rows.forEach(function (r) {
      var miss = r.src === "NO ANSWER FOUND";
      var tr = el("tr", miss ? { "class": "missing" } : null);
      tr.appendChild(el("td", { "class": "q" }, "Q" + r.n));
      tr.appendChild(el("td", { "class": "txt" }, r.text.length > 90 ? r.text.slice(0, 90) + "…" : r.text));
      var t = el("td"); t.appendChild(el("span", { "class": "tag" }, r.type === "mc" ? "MCQ" : r.type === "tf" ? "T/F" : "Written")); tr.appendChild(t);
      var a = el("td", { "class": "ans" });
      if (r.type === "essay") a.textContent = "by hand";
      else if (miss) a.textContent = "⚠ missing";
      else if (res.shuffled && r.zipAns && r.zipAns !== r.ans) { a.appendChild(document.createTextNode(r.ans + " ")); a.appendChild(el("span", { "class": "arrow" }, "→ " + r.zipAns)); }
      else a.textContent = r.ans;
      tr.appendChild(a);
      tr.appendChild(el("td", null, miss ? "Add it to the key box, or write “Answer: B” under the question" : r.src));
      tr.appendChild(el("td", null, r.figs.join(", ")));
      tb.appendChild(tr);
    });
    updateButtons();
  }

  function updateButtons() {
    var res = state.result;
    var okToBuild = !!res && (!res.missing.length || $("allowMissing").checked);
    $("dlAll").disabled = !okToBuild; $("dlBB").disabled = !okToBuild;
  }

  function download(name, bytes) {
    var blob = new Blob([bytes], { type: "application/zip" });
    var url = URL.createObjectURL(blob);
    var a = el("a", { href: url, download: name });
    document.body.appendChild(a); a.click(); a.remove();
    setTimeout(function () { URL.revokeObjectURL(url); }, 10000);
  }

  function build(which) {
    try {
      var o = Q.buildOutputs(state.result, {
        instructions: $("instructions").value,
        packFigures: $("packFigures").checked
      });
      if (which === "bb") download(o.bbName, o.bbZip); else download(o.combinedName, o.combined);
      var s = $("done"); s.hidden = false;
      s.textContent = which === "bb"
        ? "Downloaded " + o.bbName + ". Import this file as it is (do not unzip it)."
        : "Downloaded " + o.combinedName + ". Unzip this one; the file ending _Blackboard.zip inside it is what you import (do not unzip that one).";
    } catch (e) { showError("Could not build the package: " + (e.message || String(e))); }
  }

  function init() {
    if (!Q || !window.Blob) { showError("This browser is too old for this page. Please use a current Chrome, Edge, Firefox or Safari."); return; }
    wireDrop($("quizDrop"), $("quizInput"), function (f) { readFile(f).then(function (b) { loadQuiz(f.name, b); }).catch(function (e) { showError(e.message); }); });
    wireDrop($("keyDrop"), $("keyInput"), function (f) { readFile(f).then(function (b) { loadKey(f.name, b); }).catch(function (e) { showError(e.message); }); });
    $("clearKey").addEventListener("click", function () { state.key = null; state.keyBlocks = null; $("keyChip").textContent = ""; $("clearKey").hidden = true; run(); });
    ["title", "keyText", "points", "seed"].forEach(function (id) { $(id).addEventListener("input", runSoon); });
    ["shuffle", "keepLatex"].forEach(function (id) { $(id).addEventListener("change", run); });
    $("allowMissing").addEventListener("change", updateButtons);
    $("dlAll").addEventListener("click", function () { build("all"); });
    $("dlBB").addEventListener("click", function () { build("bb"); });
    $("trySample").addEventListener("click", function () { loadQuiz("Sample_Quiz.txt", new TextEncoder().encode(SAMPLE)); });
    window.addEventListener("dragover", function (e) { e.preventDefault(); });
    window.addEventListener("drop", function (e) { e.preventDefault(); });
  }
  init();
})();
