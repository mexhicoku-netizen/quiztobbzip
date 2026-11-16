// node tests/run_tests.js   (after: python3 tests/make_fixtures.py)
const fs = require("fs"), path = require("path"), assert = require("assert");
const Q = require("../engine.js");
const F = (n) => fs.readFileSync(path.join(__dirname, "fixtures", n));
let pass = 0; const ok = (c, m) => { assert.ok(c, m); pass++; console.log("  ok  " + m); };
const eq = (a, b, m) => { assert.deepStrictEqual(a, b, m + "  got " + JSON.stringify(a)); pass++; console.log("  ok  " + m); };

(async () => {
  console.log("A: Word quiz (auto-numbering, highlight, bold, Answer: line, key table, figures, shared stimulus)");
  const blocksA = await Q.readBlocks("A_word_quiz.docx", F("A_word_quiz.docx"));
  const a = Q.analyse({ fileName: "A_word_quiz.docx", blocks: blocksA, shuffle: false });
  eq(a.rows.map((r) => r.n), [1, 2, 3, 4, 5, 6], "6 questions found");
  eq(a.rows.map((r) => r.ans).join(" "), "B C D D C (hand-marked)", "answers B C D D C + essay");
  ok(a.rows[0].src.startsWith("answer key in the quiz"), "key section wins over highlight (Q1 source: " + a.rows[0].src + ")");
  eq(a.rows.map((r) => r.type).join(), "mc,mc,mc,mc,mc,essay", "types");
  eq(a.rows[1].points, 2, "Q2 '(2 marks)' sets 2 points");
  ok(!/\(2 marks\)/.test(a.rows[1].text), "points text removed from the stem");
  ok(/F = G m₁m₂\/r²/.test(a.rows[1].text), "Q2 LaTeX -> F = G m₁m₂/r²: " + a.rows[1].text);
  ok(/v = √\(GM\/r\)/.test(a.rows[4].text), "Q5 LaTeX -> v = √(GM/r)");
  eq(a.rows[2].figs, ["Q03.png"], "Q3 shares the diagram"); eq(a.rows[3].figs, ["Q04.png"], "Q4 shares the diagram");
  eq(a.rows[4].figs, ["Q05.png"], "Q5 own picture");
  ok(a.rows[5].src.includes("model answer attached"), "essay gets model answer from key");
  eq(a.missing, [], "no missing answers");

  console.log("A without the key section (formatting / Answer: line detection)");
  const bl2 = blocksA.slice(0, blocksA.findIndex((b) => /^Answer key/.test(b.text)));
  const a2 = Q.analyse({ fileName: "A.docx", blocks: bl2, shuffle: false });
  eq(a2.rows.slice(0, 4).map((r) => r.ans).join(" "), "B C D D", "highlight, bold and Answer: line");
  ok(/formatting \(highlight\)/.test(a2.rows[0].src) && /formatting \(bold\)/.test(a2.rows[1].src) && a2.rows[2].src === "Answer: line", "sources: highlight / bold / Answer: line");
  eq(a2.missing, [5, ], "Q5 has no answer -> flagged red");
  ok(/NO ANSWER for: Q5/.test(a2.report), "check report names Q5");

  console.log("A with shuffle + build");
  const a3 = Q.analyse({ fileName: "A_word_quiz.docx", blocks: blocksA, shuffle: true, seed: 1 });
  const out = Q.buildOutputs(a3);
  const z = await Q.unzip(out.combined);
  ok([...z.keys()].includes("A_word_quiz_Blackboard.zip") && z.has("A_word_quiz_Key.txt") && z.has("A_word_quiz_Check.txt") && z.has("A_word_quiz_Schoology.txt"), "combined zip has Blackboard/Key/Check/Schoology");
  ok(z.has("figures/Q03.png") && z.has("figures/Q04.png") && z.has("figures/Q05.png"), "figures/ folder");
  const bb = await Q.unzip(z.get("A_word_quiz_Blackboard.zip"));
  ok(bb.has("imsmanifest.xml") && bb.has("res00001.dat") && bb.has(".bb-package-info"), "Blackboard package files");
  const xidFiles = [...bb.keys()].filter((k) => k.startsWith("csfiles/home_dir/"));
  eq(xidFiles.length, 3, "3 figures packed as csfiles/home_dir/…__xid-…: " + xidFiles[0]);
  const dat = Buffer.from(bb.get("res00001.dat")).toString();
  eq((dat.match(/<item /g) || []).length, 6, "6 <item> elements");
  ok(/@X@EmbeddedFile\.requestUrlStub@X@bbcswebdav\/xid-9003/.test(dat), "figure xid links in the stem");
  const man = Buffer.from(bb.get("imsmanifest.xml")).toString();
  ok(man.includes("csfiles/home_dir/Q03__xid-900300_1.png"), "manifest lists figure files");
  const letters = out.letters.join("");
  eq(letters.length, 5, "5 MCQ letters: " + letters);
  ok(!/(.)\1\1/.test(letters), "never 3 of the same letter in a row");
  const keyTxt = Buffer.from(z.get("A_word_quiz_Key.txt")).toString();
  ok(keyTxt.includes("Q6: essay (1 pts)  model: Period squared"), "Key.txt essay line");
  // every question's correct option text must be the same before and after shuffling
  const orig = Q.analyse({ fileName: "x.docx", blocks: blocksA, shuffle: false }).questions;
  a3.questions.forEach((q, i) => { if (q.type === "mc") assert.strictEqual(q.options[q.correct], orig[i].options[orig[i].correct]); });
  ok(true, "correct option text unchanged by shuffle");

  console.log("B: text quiz (* marks, inline options, (correct), T/F, essay)");
  const bl = await Q.readBlocks("B_text_quiz.txt", F("B_text_quiz.txt"));
  const b = Q.analyse({ fileName: "B_text_quiz.txt", blocks: bl, shuffle: false });
  eq(b.rows.map((r) => r.type).join(), "mc,mc,tf,mc,essay", "types mc,mc,tf,mc,essay");
  eq(b.questions[0].options, ["3", "4", "5", "6"], "inline options split");
  eq(b.rows.map((r) => r.ans).join(" "), "?? C True C (hand-marked)", "answers (Q1 has no key or mark)");
  console.log("     Q1 (no key, no mark):", b.rows[0].ans, "| missing:", b.missing);
  eq(b.rows[1].points, 3, "(3 pts)");
  ok(/^Solve for x: x² = 9\.$/.test(b.rows[1].text), "LaTeX x^2 = 9 -> " + b.rows[1].text);
  ok(b.questions[3].feedback.includes("two factors"), "Feedback: line kept");

  console.log("C: key from a separate mark scheme file / typed key");
  const kb = await Q.readBlocks("C_markscheme.docx", F("C_markscheme.docx"));
  const c = Q.analyse({ fileName: "B.txt", blocks: bl, keyBlocks: kb, shuffle: false });
  eq(c.rows.map((r) => r.ans).join(" "), "C A True B (hand-marked)", "key file: 1 c, 2 a, 3 t, 4 b");
  const c2 = Q.analyse({ fileName: "B.txt", blocks: bl, keyText: "c a true b", shuffle: false });
  eq(c2.rows.map((r) => r.ans).join(" "), "C A True B (hand-marked)", "typed key 'c a true b'");
  const c3 = Q.analyse({ fileName: "B.txt", blocks: bl, keyText: "1B 2C 3F 4D", shuffle: false });
  eq(c3.rows.map((r) => r.ans).join(" "), "B C False D (hand-marked)", "typed key '1B 2C 3F 4D'");
  eq(Q._.readKeyString("c a d b b d a c a d b c d a c b d")[0][17], "d", "17-letter key from the brief parses");

  console.log("Zip round trip + CRC");
  const rt = await Q.unzip(Q.makeZip([{ name: "é.txt", data: "héllo" }, { name: "d/b.bin", data: new Uint8Array([1, 2, 3]) }]));
  eq(Buffer.from(rt.get("é.txt")).toString(), "héllo", "zip store round trip (UTF-8 names)");
  eq(Q.crc32(Buffer.from("123456789")), 0xcbf43926, "CRC32 check value");
  // the zip we write must also be readable by Python's zipfile
  fs.writeFileSync("/tmp/qtz_combined.zip", out.combined); fs.writeFileSync("/tmp/qtz_bb.zip", out.bbZip);
  console.log("\n" + pass + " checks passed");
})().catch((e) => { console.error("FAIL:", e.message); process.exit(1); });
