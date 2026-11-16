"""Builds the test fixtures (small .docx / .txt quizzes) used by run_tests.js. Standard library only."""
import zipfile, struct, zlib, os
from xml.sax.saxutils import escape
OUT = os.path.join(os.path.dirname(os.path.abspath(__file__)), "fixtures")
NS = ('xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main" '
      'xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships" '
      'xmlns:m="http://schemas.openxmlformats.org/officeDocument/2006/math" '
      'xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main" '
      'xmlns:wp="http://schemas.openxmlformats.org/drawingml/2006/wordprocessingDrawing"')

def png(w=40, h=30, rgb=(200, 30, 30)):
    raw = b"".join(b"\x00" + bytes(rgb) * w for _ in range(h))
    def chunk(t, d): return struct.pack(">I", len(d)) + t + d + struct.pack(">I", zlib.crc32(t + d) & 0xffffffff)
    return b"\x89PNG\r\n\x1a\n" + chunk(b"IHDR", struct.pack(">IIBBBBB", w, h, 8, 2, 0, 0, 0)) + chunk(b"IDAT", zlib.compress(raw)) + chunk(b"IEND", b"")

def run(t, b=False, hl=False, ul=False):
    pr = ("<w:b/>" if b else "") + ("<w:highlight w:val=\"yellow\"/>" if hl else "") + ("<w:u w:val=\"single\"/>" if ul else "")
    return f'<w:r>{"<w:rPr>"+pr+"</w:rPr>" if pr else ""}<w:t xml:space="preserve">{escape(t)}</w:t></w:r>'

def para(content, num=None):
    ppr = f'<w:pPr><w:numPr><w:ilvl w:val="{num[1]}"/><w:numId w:val="{num[0]}"/></w:numPr></w:pPr>' if num else ""
    return f"<w:p>{ppr}{content}</w:p>"

def image(rid, idn, alt):
    return (f'<w:r><w:drawing><wp:inline><wp:extent cx="100" cy="100"/><wp:docPr id="{idn}" name="Picture {idn}" descr="{escape(alt)}"/>'
            f'<a:graphic><a:graphicData><a:pic><a:blipFill><a:blip r:embed="{rid}"/></a:blipFill></a:pic></a:graphicData></a:graphic></wp:inline></w:drawing></w:r>')

def table(rows):
    body = "".join("<w:tr>" + "".join(f"<w:tc><w:p>{run(c)}</w:p></w:tc>" for c in r) + "</w:tr>" for r in rows)
    return f"<w:tbl>{body}</w:tbl>"

NUMBERING = f'''<?xml version="1.0" encoding="UTF-8"?><w:numbering {NS}>
<w:abstractNum w:abstractNumId="0"><w:lvl w:ilvl="0"><w:start w:val="1"/><w:numFmt w:val="decimal"/><w:lvlText w:val="%1."/></w:lvl>
<w:lvl w:ilvl="1"><w:start w:val="1"/><w:numFmt w:val="lowerLetter"/><w:lvlText w:val="%2)"/></w:lvl></w:abstractNum>
<w:num w:numId="1"><w:abstractNumId w:val="0"/></w:num></w:numbering>'''

def docx(path, body, images=()):
    rels = ['<Relationship Id="rId1" Type="x" Target="numbering.xml"/>'] + [f'<Relationship Id="rIdImg{i}" Type="image" Target="media/{n}"/>' for i, (n, _) in enumerate(images)]
    with zipfile.ZipFile(path, "w", zipfile.ZIP_DEFLATED) as z:
        z.writestr("[Content_Types].xml", '<?xml version="1.0"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"/>')
        z.writestr("word/document.xml", f'<?xml version="1.0" encoding="UTF-8"?><w:document {NS}><w:body>{body}</w:body></w:document>')
        z.writestr("word/numbering.xml", NUMBERING)
        z.writestr("word/_rels/document.xml.rels", '<?xml version="1.0"?><Relationships xmlns="x">' + "".join(rels) + "</Relationships>")
        for n, d in images: z.writestr("word/media/" + n, d)

# ---- A: Word quiz, Word auto-numbering, highlighted/bold answers, Answer: line, key table at the end, 2 figures, shared stimulus ----
opts = lambda t, correct=None, style="hl": "".join(para(run(o, b=(i == correct and style == "b"), hl=(i == correct and style == "hl")), (1, 1)) for i, o in enumerate(t))
b = para(run("Physics Quiz 2 - Gravitation")) + para(run("Name: ______  Date: ______"))
b += para(run("What is the SI unit of force?"), (1, 0)) + opts(["Joule", "Newton", "Watt", "Pascal"], 1)                       # Q1 highlighted B
b += para(run("Which law gives \\(F = G\\frac{m_1 m_2}{r^2}\\) (2 marks)?"), (1, 0)) + opts(["Hooke", "Newton's 3rd", "Newton's law of gravitation", "Kepler's 2nd"], 2, "b")   # Q2 bold C, 2 pts
b += para(run("Use the diagram below to answer Questions 3-4.")) + para(image("rIdImg0", 1, "Orbit diagram"))
b += para(run("Which point is the perihelion?"), (1, 0)) + opts(["P", "Q", "R", "S"]) + para(run("Answer: D"))                   # Q3 Answer line D, shares figure
b += para(run("At which point is the speed greatest?"), (1, 0)) + opts(["P", "Q", "R", "S"]) + para(run("Answer: D"))             # Q4 D
b += para(run("Orbital speed is \\(v = \\sqrt{\\frac{GM}{r}}\\). If r doubles, v:"), (1, 0)) + para(image("rIdImg1", 2, "")) + opts(["doubles", "halves", "falls by √2", "is unchanged"])   # Q5 key table
b += para(run("State Kepler's third law in words."), (1, 0))                                                                      # Q6 essay
b += para(run("Answer key")) + table([["1", "2", "3", "4", "5"], ["B", "C", "D", "D", "C"]]) + para(run("6. Period squared is proportional to the cube of the mean orbital radius."))
docx(os.path.join(OUT, "A_word_quiz.docx"), b, [("fig1.png", png()), ("fig2.png", png(rgb=(30, 30, 200)))])

# ---- B: txt quiz, * marks and inline options, T/F, Answer line ----
open(os.path.join(OUT, "B_text_quiz.txt"), "w", encoding="utf-8").write("""Maths Homework Quiz

1. What is 2 + 2? a) 3 b) 4 c) 5 d) 6
2. Solve for x: \\(x^2 = 9\\). (3 pts)
A. x = 3
B. x = -3
*C. x = 3 or x = -3
D. no solution
3. True or false: the sum of angles in a triangle is 180 degrees.
Answer: True
4. Which is prime?
a) 4
b) 6
c) 7 (correct)
d) 9
Feedback: 7 has exactly two factors.
5. Explain why the sky is blue.
""")

# ---- C: key as a separate Word file (list form) ----
docx(os.path.join(OUT, "C_markscheme.docx"), para(run("Mark scheme")) + para(run("1. c  2. a  3. t  4. b  5. b")))
print("fixtures written to", OUT)
