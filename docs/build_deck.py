"""
Generates the walkthrough deck for the Enterprise AI Agent Routing & Audit Dashboard.

Every figure in here is measured, not invented: 218 passing tests, the +62/-7
single-file fallback diff, 6 merged PRs, 0 vulnerabilities. See
DESIGN_DECISIONS.md for the reasoning behind each trade-off slide.

Run:  python docs/build_deck.py
"""

from pathlib import Path

from pptx import Presentation
from pptx.dml.color import RGBColor
from pptx.enum.shapes import MSO_SHAPE
from pptx.enum.text import MSO_ANCHOR, PP_ALIGN
from pptx.util import Emu, Inches, Pt

OUT = Path(__file__).resolve().parent / "Agent-Routing-Audit-Dashboard.pptx"

# ---------------------------------------------------------------- palette ---
# Slate-biased dark ground with a teal accent; semantic colours are kept
# separate from the accent so "good/warn/critical" never reads as branding.
INK = RGBColor(0x0B, 0x0E, 0x14)
SURFACE = RGBColor(0x14, 0x1A, 0x22)
SURFACE_2 = RGBColor(0x1B, 0x22, 0x2C)
BORDER = RGBColor(0x2A, 0x34, 0x42)
TEXT_1 = RGBColor(0xE7, 0xEC, 0xF3)
TEXT_2 = RGBColor(0xA3, 0xAF, 0xBF)
TEXT_3 = RGBColor(0x7C, 0x88, 0x99)
ACCENT = RGBColor(0x4F, 0xC3, 0xE0)
GOOD = RGBColor(0x34, 0xD3, 0x99)
WARN = RGBColor(0xE0, 0xA6, 0x4A)
BAD = RGBColor(0xF8, 0x71, 0x71)
FALLBACK = RGBColor(0xC0, 0x84, 0xFC)

MONO = "Consolas"
SANS = "Segoe UI"

W, H = Inches(13.333), Inches(7.5)
MARGIN = Inches(0.72)
CONTENT_W = W - 2 * MARGIN


def new_deck():
    prs = Presentation()
    prs.slide_width, prs.slide_height = W, H
    return prs


def blank(prs):
    slide = prs.slides.add_slide(prs.slide_layouts[6])
    bg = slide.shapes.add_shape(MSO_SHAPE.RECTANGLE, 0, 0, W, H)
    bg.fill.solid()
    bg.fill.fore_color.rgb = INK
    bg.line.fill.background()
    bg.shadow.inherit = False
    return slide


def textbox(slide, x, y, w, h, text, *, size=16, color=TEXT_1, font=SANS,
            bold=False, align=PP_ALIGN.LEFT, spacing=0, line=1.25, anchor=MSO_ANCHOR.TOP):
    box = slide.shapes.add_textbox(x, y, w, h)
    tf = box.text_frame
    tf.word_wrap = True
    tf.vertical_anchor = anchor
    tf.margin_left = tf.margin_right = tf.margin_top = tf.margin_bottom = 0

    lines = text.split("\n")
    for i, content in enumerate(lines):
        para = tf.paragraphs[0] if i == 0 else tf.add_paragraph()
        para.alignment = align
        para.line_spacing = line
        run = para.add_run()
        run.text = content
        run.font.size = Pt(size)
        run.font.bold = bold
        run.font.name = font
        run.font.color.rgb = color
        if spacing:
            # python-pptx has no letter-spacing API; set it on the run's rPr.
            run.font._rPr.set("spc", str(int(spacing * 100)))
    return box


def rect(slide, x, y, w, h, fill=SURFACE, line=BORDER, width=Pt(1), radius=None):
    shape_type = MSO_SHAPE.ROUNDED_RECTANGLE if radius else MSO_SHAPE.RECTANGLE
    shape = slide.shapes.add_shape(shape_type, x, y, w, h)
    if radius:
        shape.adjustments[0] = radius
    if fill is None:
        shape.fill.background()
    else:
        shape.fill.solid()
        shape.fill.fore_color.rgb = fill
    if line is None:
        shape.line.fill.background()
    else:
        shape.line.color.rgb = line
        shape.line.width = width
    shape.shadow.inherit = False
    return shape


def eyebrow(slide, text, color=ACCENT):
    textbox(slide, MARGIN, Inches(0.5), CONTENT_W, Inches(0.3), text,
            size=10.5, color=color, font=MONO, bold=True, spacing=1.6)


def heading(slide, text):
    textbox(slide, MARGIN, Inches(0.85), CONTENT_W, Inches(0.65), text,
            size=30, color=TEXT_1, font=MONO, bold=True, line=1.05)
    rule = slide.shapes.add_shape(MSO_SHAPE.RECTANGLE, MARGIN, Inches(1.62), CONTENT_W, Pt(1))
    rule.fill.solid()
    rule.fill.fore_color.rgb = BORDER
    rule.line.fill.background()
    rule.shadow.inherit = False


def section(prs, kicker, title, body=None):
    slide = blank(prs)
    eyebrow(slide, kicker)
    heading(slide, title)
    if body:
        textbox(slide, MARGIN, Inches(1.95), CONTENT_W, Inches(1.0), body,
                size=16, color=TEXT_2, line=1.45)
    return slide


def bullets(slide, items, top, *, width=None, size=15, gap=Inches(0.62), lead_color=TEXT_1):
    width = width or CONTENT_W
    y = top
    for lead, rest in items:
        dot = slide.shapes.add_shape(MSO_SHAPE.RECTANGLE, MARGIN, y + Inches(0.09), Pt(3), Pt(11))
        dot.fill.solid()
        dot.fill.fore_color.rgb = ACCENT
        dot.line.fill.background()
        dot.shadow.inherit = False

        box = slide.shapes.add_textbox(MARGIN + Inches(0.22), y, width - Inches(0.22), Inches(0.5))
        tf = box.text_frame
        tf.word_wrap = True
        tf.margin_left = tf.margin_right = tf.margin_top = tf.margin_bottom = 0
        para = tf.paragraphs[0]
        para.line_spacing = 1.35

        run = para.add_run()
        run.text = lead
        run.font.size = Pt(size)
        run.font.bold = True
        run.font.name = SANS
        run.font.color.rgb = lead_color

        if rest:
            run2 = para.add_run()
            run2.text = " " + rest
            run2.font.size = Pt(size)
            run2.font.name = SANS
            run2.font.color.rgb = TEXT_2
        y += gap
    return y


def stat_row(slide, stats, top, height=Inches(1.15)):
    n = len(stats)
    gap = Inches(0.16)
    w = int((CONTENT_W - gap * (n - 1)) / n)
    for i, (value, label, color) in enumerate(stats):
        x = MARGIN + i * (w + gap)
        rect(slide, x, top, w, height, fill=SURFACE, line=BORDER, radius=0.08)
        textbox(slide, x + Inches(0.22), top + Inches(0.18), w - Inches(0.44), Inches(0.5),
                value, size=26, color=color, font=MONO, bold=True)
        textbox(slide, x + Inches(0.22), top + Inches(0.72), w - Inches(0.44), Inches(0.3),
                label, size=9.5, color=TEXT_3, font=MONO, spacing=1.2)


def table(slide, headers, rows, top, col_ratios, *, row_h=Inches(0.78), size=12):
    widths = [int(CONTENT_W * r) for r in col_ratios]
    x = MARGIN
    for header, w in zip(headers, widths):
        textbox(slide, x, top, w - Inches(0.2), Inches(0.28), header,
                size=9.5, color=TEXT_3, font=MONO, bold=True, spacing=1.2)
        x += w

    line = slide.shapes.add_shape(MSO_SHAPE.RECTANGLE, MARGIN, top + Inches(0.34), CONTENT_W, Pt(1))
    line.fill.solid()
    line.fill.fore_color.rgb = BORDER
    line.line.fill.background()
    line.shadow.inherit = False

    y = top + Inches(0.5)
    for row in rows:
        x = MARGIN
        for (text, color, font), w in zip(row, widths):
            textbox(slide, x, y, w - Inches(0.22), row_h - Inches(0.1), text,
                    size=size, color=color, font=font, line=1.3)
            x += w
        y += row_h
        sep = slide.shapes.add_shape(MSO_SHAPE.RECTANGLE, MARGIN, y - Inches(0.12), CONTENT_W, Pt(0.75))
        sep.fill.solid()
        sep.fill.fore_color.rgb = SURFACE_2
        sep.line.fill.background()
        sep.shadow.inherit = False
    return y


def flow_box(slide, x, y, w, h, title, sub, *, accent=False, color=None):
    edge = color or (ACCENT if accent else BORDER)
    rect(slide, x, y, w, h, fill=SURFACE if not accent else SURFACE_2, line=edge, radius=0.1)
    textbox(slide, x, y + Inches(0.2), w, Inches(0.3), title,
            size=12.5, color=color or (ACCENT if accent else TEXT_1), font=MONO,
            bold=True, align=PP_ALIGN.CENTER)
    if sub:
        textbox(slide, x, y + Inches(0.52), w, Inches(0.28), sub,
                size=10, color=TEXT_3, font=MONO, align=PP_ALIGN.CENTER)


def arrow(slide, x, y, length, color=BORDER):
    shape = slide.shapes.add_shape(MSO_SHAPE.RIGHT_ARROW, x, y, length, Pt(9))
    shape.fill.solid()
    shape.fill.fore_color.rgb = color
    shape.line.fill.background()
    shape.shadow.inherit = False


# =============================================================== slides ===

def slide_title(prs):
    slide = blank(prs)
    bar = slide.shapes.add_shape(MSO_SHAPE.RECTANGLE, MARGIN, Inches(2.35), Inches(1.5), Pt(4))
    bar.fill.solid()
    bar.fill.fore_color.rgb = ACCENT
    bar.line.fill.background()
    bar.shadow.inherit = False

    textbox(slide, MARGIN, Inches(1.85), CONTENT_W, Inches(0.3),
            "LOCAL PROTOTYPE  ·  TAKE-HOME BUILD  ·  2026",
            size=11, color=ACCENT, font=MONO, bold=True, spacing=1.8)
    textbox(slide, MARGIN, Inches(2.75), Inches(10.6), Inches(1.6),
            "Enterprise AI Agent\nRouting & Audit Dashboard",
            size=42, color=TEXT_1, font=MONO, bold=True, line=1.1)
    textbox(slide, MARGIN, Inches(4.65), Inches(9.4), Inches(0.9),
            "A pipeline that hands work to the right specialist agent, survives that agent\n"
            "failing, and shows exactly what happened and what it cost.",
            size=17, color=TEXT_2, line=1.45)

    stat_row(slide, [
        ("218", "TESTS PASSING", GOOD),
        ("+62/-7", "THE CURVEBALL", FALLBACK),
        ("2", "PROD DEPENDENCIES", ACCENT),
        ("0", "VULNERABILITIES", GOOD),
    ], Inches(5.85))
    return slide


def slide_problem(prs):
    slide = section(prs, "01  ·  THE PROBLEM", "Not all work is the same work",
                    "Tasks arrive continuously and need different specialists. Each specialist "
                    "handles only so much at once. Sometimes one fails.")
    bullets(slide, [
        ("Route correctly.", "A tax review, a PII scan and a ledger reconciliation each need a different agent."),
        ("Respect capacity.", "Every agent has a hard concurrency limit that must never be exceeded."),
        ("Survive failure.", "Roughly 1 in 10 executions errors or times out. Losing the task is not an option."),
        ("Keep a record.", "An auditor must be able to see what ran, where, how long it took and what it cost."),
    ], Inches(3.15))

    rect(slide, MARGIN, Inches(5.85), CONTENT_W, Inches(0.95), fill=SURFACE_2, line=FALLBACK, radius=0.06)
    textbox(slide, MARGIN + Inches(0.3), Inches(6.05), Inches(1.6), Inches(0.3),
            "THE REAL TEST", size=9.5, color=FALLBACK, font=MONO, bold=True, spacing=1.4)
    textbox(slide, MARGIN + Inches(0.3), Inches(6.35), CONTENT_W - Inches(0.6), Inches(0.4),
            "The brief warned a requirement would change partway through the build. "
            "How cheaply the codebase absorbed it is the thing actually being measured.",
            size=14, color=TEXT_2)
    return slide


def slide_agents(prs):
    slide = section(prs, "02  ·  THE AGENTS", "Four agents, loaded from the supplied config",
                    "Each has its own concurrency limit and its own price, which is what makes "
                    "cost reporting meaningful rather than decorative.")
    table(slide,
          ["AGENT", "HANDLES", "AT ONCE", "COST / 1K TOKENS", "ROLE"],
          [
              [("Tax Compliance Agent", TEXT_1, SANS), ("TAX", TEXT_2, MONO),
               ("3", TEXT_1, MONO), ("$0.015", TEXT_2, MONO), ("Specialist", TEXT_3, SANS)],
              [("Audit Risk Scraper", TEXT_1, SANS), ("AUDIT", TEXT_2, MONO),
               ("2", TEXT_1, MONO), ("$0.020", TEXT_2, MONO), ("Specialist · tightest cap", TEXT_3, SANS)],
              [("Security & PII Scanner", TEXT_1, SANS), ("SECURITY", TEXT_2, MONO),
               ("5", TEXT_1, MONO), ("$0.008", TEXT_2, MONO), ("Specialist", TEXT_3, SANS)],
              [("General Fallback Agent", FALLBACK, SANS), ("GENERAL", FALLBACK, MONO),
               ("10", FALLBACK, MONO), ("$0.005", FALLBACK, MONO),
               ("Absorbs failures + unknown types", FALLBACK, SANS)],
          ],
          Inches(3.25), [0.26, 0.14, 0.12, 0.20, 0.28])

    textbox(slide, MARGIN, Inches(6.5), CONTENT_W, Inches(0.5),
            "The generalist is deliberately cheaper and less confident (0.62–0.85 vs 0.82–0.99), "
            "so falling back has a visible quality cost — not just an operational one.",
            size=13, color=TEXT_3)
    return slide


def slide_flow(prs):
    slide = section(prs, "03  ·  ARCHITECTURE", "How a task moves through the system")

    y = Inches(2.35)
    bw, bh = Inches(2.05), Inches(1.0)
    gap = Inches(0.42)
    steps = [
        ("POST /api/tasks", "ingest", False),
        ("validate", "400 on bad input", False),
        ("route", "type -> agent", True),
        ("queue", "priority + capacity", False),
        ("execute", "1-3s, ~10% fail", False),
    ]
    x = MARGIN
    for i, (title, sub, accent) in enumerate(steps):
        flow_box(slide, x, y, bw, bh, title, sub, accent=accent)
        if i < len(steps) - 1:
            arrow(slide, x + bw + Inches(0.08), y + Inches(0.45), gap - Inches(0.16))
        x += bw + gap

    flow_box(slide, x, y - Inches(0.1), Inches(1.75), Inches(0.62), "COMPLETED", None, color=GOOD)

    # failure branch
    textbox(slide, MARGIN + Inches(3.4), Inches(3.62), Inches(6.0), Inches(0.3),
            "ERROR / TIMEOUT  ->  re-route once", size=11.5, color=FALLBACK, font=MONO, bold=True)

    flow_box(slide, MARGIN + Inches(1.4), Inches(4.05), Inches(3.5), Inches(1.0),
             "General Fallback Agent", "fallback_applied: true", color=FALLBACK)
    arrow(slide, MARGIN + Inches(5.05), Inches(4.5), Inches(0.5), FALLBACK)
    flow_box(slide, MARGIN + Inches(5.7), Inches(4.05), Inches(2.6), Inches(1.0),
             "COMPLETED / FAILED", "never a third attempt")
    arrow(slide, MARGIN + Inches(8.45), Inches(4.5), Inches(0.5))
    flow_box(slide, MARGIN + Inches(9.1), Inches(4.05), Inches(2.7), Inches(1.0),
             "metrics + SSE", "-> live dashboard", accent=True)

    rect(slide, MARGIN, Inches(5.75), CONTENT_W, Inches(1.0), fill=SURFACE_2, line=BORDER, radius=0.06)
    textbox(slide, MARGIN + Inches(0.3), Inches(5.95), CONTENT_W - Inches(0.6), Inches(0.7),
            "Routing decides ownership. The queue decides timing. Keeping those two questions "
            "in separate places is the single reason the mid-build requirement change was cheap.",
            size=14, color=TEXT_2, line=1.35)
    return slide


def slide_curveball(prs):
    slide = section(prs, "04  ·  THE CURVEBALL", "The requirement that changed",
                    "\"On ERROR or timeout, automatically re-route the task to a General Secondary "
                    "Agent and flag the record fallback_applied: true.\"")

    rect(slide, MARGIN, Inches(2.95), CONTENT_W, Inches(1.2), fill=SURFACE_2, line=FALLBACK, radius=0.06)
    textbox(slide, MARGIN + Inches(0.35), Inches(3.15), Inches(4.2), Inches(0.75),
            "+62 / -7", size=36, color=FALLBACK, font=MONO, bold=True)
    textbox(slide, MARGIN + Inches(3.3), Inches(3.22), Inches(8.4), Inches(0.8),
            "lines changed, in ONE file. No new modules. No signature changed anywhere else.\n"
            "It shipped as its own pull request, so the diff is the evidence.",
            size=14.5, color=TEXT_2, line=1.4)

    textbox(slide, MARGIN, Inches(4.45), CONTENT_W, Inches(0.3),
            "THAT WAS NOT LUCK — TWO EARLIER DECISIONS BOUGHT IT",
            size=10, color=ACCENT, font=MONO, bold=True, spacing=1.4)

    bullets(slide, [
        ("A task holds a list of attempts, not one result.",
         "Recording each execution as an appended entry means a task can have been tried twice. "
         "Had result been a single overwritten field, adding a second attempt would have reshaped "
         "every record and every reader of them."),
        ("Routing never knew about capacity.",
         "The function picking an agent answers only \"who owns this work?\" — so falling back is the "
         "same function called again with the failed agent excluded, not a second routing path that "
         "can drift out of step."),
    ], Inches(4.9), gap=Inches(1.15))
    return slide


def slide_guards(prs):
    slide = section(prs, "05  ·  SAFETY", "Two independent stop conditions",
                    "An automatic retry that can retry itself is how you build an infinite billing "
                    "loop. So there are two guards, not one.")

    half = int((CONTENT_W - Inches(0.3)) / 2)
    for i, (title, body, color) in enumerate([
        ("GUARD 1  ·  THE FLAG",
         "fallback_applied bounds any task to one fallback, ever. A second failure terminates it.", FALLBACK),
        ("GUARD 2  ·  THE ROUTER",
         "The router refuses to send a General agent to itself. A task that STARTED on General fails "
         "after a single attempt.", ACCENT),
    ]):
        x = MARGIN + i * (half + Inches(0.3))
        rect(slide, x, Inches(3.3), half, Inches(1.5), fill=SURFACE, line=color, radius=0.06)
        textbox(slide, x + Inches(0.3), Inches(3.52), half - Inches(0.6), Inches(0.3),
                title, size=10, color=color, font=MONO, bold=True, spacing=1.3)
        textbox(slide, x + Inches(0.3), Inches(3.88), half - Inches(0.6), Inches(0.8),
                body, size=13.5, color=TEXT_2, line=1.4)

    textbox(slide, MARGIN, Inches(5.15), CONTENT_W, Inches(0.3),
            "STRESS TESTED  ·  60 TASKS AT A 100% FORCED FAILURE RATE",
            size=10, color=GOOD, font=MONO, bold=True, spacing=1.4)
    stat_row(slide, [
        ("60 / 60", "TERMINATED", GOOD),
        ("2", "ATTEMPTS EACH — NEVER 3", GOOD),
        ("0", "LEAKED CAPACITY SLOTS", GOOD),
        ("0", "INFINITE LOOPS", GOOD),
    ], Inches(5.55), height=Inches(1.05))
    return slide


def slide_hol(prs):
    slide = section(prs, "06  ·  THE QUEUE", "Skipping beats waiting",
                    "The dispatcher walks pending tasks in priority order and SKIPS a saturated "
                    "agent rather than stopping at it.")

    rect(slide, MARGIN, Inches(3.0), CONTENT_W, Inches(1.35), fill=SURFACE, line=BAD, radius=0.06)
    textbox(slide, MARGIN + Inches(0.3), Inches(3.2), Inches(3.0), Inches(0.3),
            "WITHOUT SKIPPING", size=10, color=BAD, font=MONO, bold=True, spacing=1.3)
    textbox(slide, MARGIN + Inches(0.3), Inches(3.55), CONTENT_W - Inches(0.6), Inches(0.7),
            "One HIGH TAX task waiting on a full Tax agent stalls every MEDIUM SECURITY task "
            "behind it — while the Security agent sits completely idle. Throughput collapses to "
            "the slowest agent.", size=14, color=TEXT_2, line=1.35)

    rect(slide, MARGIN, Inches(4.55), CONTENT_W, Inches(1.35), fill=SURFACE, line=GOOD, radius=0.06)
    textbox(slide, MARGIN + Inches(0.3), Inches(4.75), Inches(3.0), Inches(0.3),
            "WITH SKIPPING", size=10, color=GOOD, font=MONO, bold=True, spacing=1.3)
    textbox(slide, MARGIN + Inches(0.3), Inches(5.1), CONTENT_W - Inches(0.6), Inches(0.7),
            "Every agent stays busy. Priority is still honoured wherever there is a genuine "
            "choice, and starvation stays bounded because ordering within a tier is FIFO — a "
            "skipped task goes first the moment its slot frees.", size=14, color=TEXT_2, line=1.35)

    rect(slide, MARGIN, Inches(6.1), CONTENT_W, Inches(0.75), fill=SURFACE_2, line=WARN, radius=0.06)
    textbox(slide, MARGIN + Inches(0.3), Inches(6.27), CONTENT_W - Inches(0.6), Inches(0.45),
            "THE COST, STATED HONESTLY:  priority becomes best-effort PER AGENT, not a global "
            "guarantee. A LOW task on a free agent genuinely can start before a HIGH task on a busy one.",
            size=12.5, color=WARN, line=1.3)
    return slide


def slide_tradeoffs(prs):
    slide = section(prs, "07  ·  TRADE-OFFS", "What each decision cost")
    table(slide,
          ["DECISION", "WHAT IT BOUGHT", "WHAT IT COST"],
          [
              [("Integer micro-dollars for cost", TEXT_1, SANS),
               ("Exact arithmetic; per-agent costs sum to the total. It is billing data.", TEXT_2, SANS),
               ("An internal field to strip, and readers must remember the unit.", TEXT_3, SANS)],
              [("Agent status derived, never stored", TEXT_1, SANS),
               ("Status cannot desync; no agent stuck 'processing' after a crash.", TEXT_2, SANS),
               ("Recomputed on every read. Would need caching at scale.", TEXT_3, SANS)],
              [("Unknown types accepted, bad priorities rejected", TEXT_1, SANS),
               ("A new document category from upstream is absorbed, not bounced.", TEXT_2, SANS),
               ("A typo like \"TAXX\" is quietly generalised. The note makes it visible.", TEXT_3, SANS)],
              [("Failed attempts are still billed", TEXT_1, SANS),
               ("True cost visibility. Fallback rate becomes a financial metric.", TEXT_2, SANS),
               ("Totals exceed a naive 'cost per successful task' reading.", TEXT_3, SANS)],
              [("SSE instead of WebSockets", TEXT_1, SANS),
               ("Live updates, zero extra dependencies, automatic reconnection.", TEXT_2, SANS),
               ("No channel back from browser to server. Not needed — but foreclosed.", TEXT_3, SANS)],
              [("Everything held in memory", TEXT_1, SANS),
               ("No database to stand up. Runs with two commands.", TEXT_2, SANS),
               ("A restart loses all history. First thing to fix for anything real.", TEXT_3, SANS)],
          ],
          Inches(2.2), [0.26, 0.38, 0.36], row_h=Inches(0.73), size=11.5)
    return slide


def slide_bugs(prs):
    slide = section(prs, "08  ·  WHAT WE FOUND", "Three defects, one of them in the brief")

    rect(slide, MARGIN, Inches(2.3), CONTENT_W, Inches(1.45), fill=SURFACE_2, line=WARN, radius=0.06)
    textbox(slide, MARGIN + Inches(0.3), Inches(2.5), Inches(5.0), Inches(0.3),
            "IN THE SUPPLIED FILES", size=10, color=WARN, font=MONO, bold=True, spacing=1.3)
    textbox(slide, MARGIN + Inches(0.3), Inches(2.85), CONTENT_W - Inches(0.6), Inches(0.8),
            "Both agents_config.json and sample_tasks.json open with a  // filename  comment line, "
            "so NEITHER IS VALID JSON — the standard parser throws on them as delivered. Fixed in "
            "the loader rather than by editing the supplied files, using a character scanner: a naive "
            "regex would turn \"https://x.com\" inside a payload into \"https:\".",
            size=13.5, color=TEXT_2, line=1.4)

    textbox(slide, MARGIN, Inches(4.05), CONTENT_W, Inches(0.3),
            "FOUND DURING THE BUILD  ·  BOTH NOW HAVE REGRESSION TESTS",
            size=10, color=ACCENT, font=MONO, bold=True, spacing=1.4)

    bullets(slide, [
        ("The server would not shut down.",
         "An open event stream is a connection that never finishes on its own, so shutdown waited "
         "for it forever. This would have hung on any real deployment restart — not a test artifact."),
        ("The background worker ran while switched off.",
         "A flag defaulted the wrong way, so a worker that had never been started still picked up "
         "and executed tasks, silently ignoring the setting meant to prevent it."),
    ], Inches(4.5), gap=Inches(1.15))
    return slide


def slide_results(prs):
    slide = section(prs, "09  ·  RESULTS", "Where it ended up")

    stat_row(slide, [
        ("218", "TESTS PASSING", GOOD),
        ("55", "TEST SUITES", TEXT_1),
        ("2", "PROD DEPENDENCIES", ACCENT),
        ("6", "MERGED PRS", TEXT_1),
        ("0", "VULNERABILITIES", GOOD),
    ], Inches(2.25))

    textbox(slide, MARGIN, Inches(3.75), CONTENT_W, Inches(0.3),
            "VERIFIED IN A REAL BROWSER, NOT ONLY IN TESTS",
            size=10, color=FALLBACK, font=MONO, bold=True, spacing=1.4)

    rect(slide, MARGIN, Inches(4.15), CONTENT_W, Inches(1.35), fill=SURFACE, line=FALLBACK, radius=0.06)
    textbox(slide, MARGIN + Inches(0.35), Inches(4.35), CONTENT_W - Inches(0.7), Inches(1.0),
            "AUDIT      fallback=true   attempts=2   Audit:ERROR     -> General:TIMEOUT\n"
            "SECURITY   fallback=true   attempts=2   Security:TIMEOUT -> General:TIMEOUT\n"
            "TAX        fallback=true   attempts=2   Tax:ERROR       -> General:TIMEOUT",
            size=12, color=TEXT_2, font=MONO, line=1.65)

    textbox(slide, MARGIN, Inches(5.7), CONTENT_W, Inches(0.9),
            "With failures switched off, the same three tasks completed automatically — 100% success, "
            "HEALTHY, 324 ms average, $0.0073 total, zero fallbacks. No manual trigger: the queue "
            "drained them on its own. Every pull request carries its own evidence log, and the test "
            "suite uses Node's built-in runner, so there is no test framework in the dependency tree at all.",
            size=13.5, color=TEXT_3, line=1.45)
    return slide


def slide_next(prs):
    slide = section(prs, "10  ·  NEXT", "What I would do with more than 90 minutes")
    bullets(slide, [
        ("Persistence.", "Everything is in memory; a restart loses the record. For an audit pipeline that is the first real gap."),
        ("Authentication.", "There is none. Fine locally, unacceptable for anything holding client tax data."),
        ("Ingestion backpressure.", "The queue is unbounded — a large enough burst exhausts memory before capacity limits ever bind."),
        ("Configurable retry budgets.", "Exactly one fallback is right for this requirement; real pipelines want per-type policies and backoff."),
        ("Structured logging with correlation ids.", "console.error is not an audit log."),
        ("Frontend component tests.", "The deliberate casualty of the time budget; the API contract beneath it is thoroughly covered."),
    ], Inches(2.5), gap=Inches(0.72))
    return slide


def main():
    prs = new_deck()
    slide_title(prs)
    slide_problem(prs)
    slide_agents(prs)
    slide_flow(prs)
    slide_curveball(prs)
    slide_guards(prs)
    slide_hol(prs)
    slide_tradeoffs(prs)
    slide_bugs(prs)
    slide_results(prs)
    slide_next(prs)

    OUT.parent.mkdir(parents=True, exist_ok=True)
    prs.save(OUT)
    print(f"Wrote {OUT}  ({len(prs.slides.__iter__.__self__._sldIdLst)} slides)")


if __name__ == "__main__":
    main()
