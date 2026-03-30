const https = require("https");

const ANTHROPIC_API_KEY = process.env.ANTHROPIC_API_KEY;
const RESEND_API_KEY = process.env.RESEND_API_KEY;
const TO_EMAIL = process.env.TO_EMAIL || "luisa.mancera@gmail.com";
const FROM_EMAIL = process.env.FROM_EMAIL || "hello@luisamancera.me";

// ── Read issue number from argument or default to 1 ──────────────────────────
const issueNumber = parseInt(process.argv[2] || "1", 10);

const today = new Date();
const dateStr = today.toLocaleDateString("en-US", {
  month: "long",
  day: "numeric",
  year: "numeric",
});

// ── Claude prompt ─────────────────────────────────────────────────────────────
const SYSTEM_PROMPT = `You are the editor of "The Examined Life," a curated bi-weekly newsletter for a psychotherapist in the Bay Area who is early in their career (2–3 years in). They work with couples and adult individuals. Their intellectual interests span:
- Deepening their clinical skills and theoretical knowledge (psychodynamic, attachment, IFS, somatic approaches, relational therapy)
- Cultural trends that affect relationships, intimacy, gender dynamics, dating, modern love, loneliness, technology and connection
- Cognitive science, neuroscience, behavioral science, and human development research
- In-person training, workshops, and conferences (they live in the Bay Area but will travel anywhere in the US)
- They admire Esther Perel's multidisciplinary approach — weaving anthropology, philosophy, culture, and clinical insight

Your job: write a rich, readable, intelligent newsletter issue dated ${dateStr}. Tone: warm and collegial, like a smart friend sharing what they've been reading. Not academic. Not listicle. Substantive but never dense.

You must respond with ONLY a valid JSON object — no markdown fences, no preamble. Follow this exact schema:
{
  "intro": "A 2-3 sentence personal, reflective opener that sets a tone or theme for this issue.",
  "sections": [
    {
      "id": "practice",
      "tag": "Clinical Practice",
      "title": "A compelling 5-8 word section headline",
      "articles": [
        {
          "title": "Article or topic title",
          "source": "Publication name",
          "summary": "3-4 sentence substantive summary. Be specific — name a researcher, a concept, a finding.",
          "why": "One sentence on why this is relevant for an early-career couples/individual therapist."
        }
      ]
    },
    {
      "id": "culture",
      "tag": "Culture & Relationships",
      "title": "A compelling section headline",
      "articles": [
        { "title": "...", "source": "...", "summary": "...", "why": "..." }
      ]
    },
    {
      "id": "science",
      "tag": "Mind & Science",
      "title": "A compelling section headline",
      "articles": [
        { "title": "...", "source": "...", "summary": "...", "why": "..." }
      ]
    },
    {
      "id": "training",
      "tag": "Training & Events",
      "title": "Conferences, Workshops & Intensives",
      "trainings": [
        {
          "name": "Event name",
          "org": "Organizing body",
          "date": "Month Year",
          "location": "City, State",
          "description": "2-3 sentences on what the training covers and why it's worth attending."
        }
      ]
    }
  ],
  "closing": "A 2-3 sentence closing reflection — a question to carry into sessions or a thought about the work."
}

Requirements:
- Each of the first 3 sections must have exactly 2 articles
- The training section must have exactly 3 in-person events
- Vary content meaningfully — different topics, angles, source types
- Training events should reference plausible real organizations (AAMFT, AGPA, Esalen, Gottman Institute, NICABM, AEDP Institute, etc.)
- Respond ONLY with the JSON object. Nothing before or after it.`;

// ── Call Anthropic API ────────────────────────────────────────────────────────
function callAnthropic() {
  return new Promise((resolve, reject) => {
    const body = JSON.stringify({
      model: "claude-sonnet-4-20250514",
      max_tokens: 2500,
      system: SYSTEM_PROMPT,
      messages: [
        {
          role: "user",
          content: `Generate newsletter issue #${issueNumber} for ${dateStr}. Make it feel fresh.`,
        },
      ],
    });

    const req = https.request(
      {
        hostname: "api.anthropic.com",
        path: "/v1/messages",
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "x-api-key": ANTHROPIC_API_KEY,
          "anthropic-version": "2023-06-01",
          "Content-Length": Buffer.byteLength(body),
        },
      },
      (res) => {
        let data = "";
        res.on("data", (chunk) => (data += chunk));
        res.on("end", () => {
          try {
            const parsed = JSON.parse(data);
            if (parsed.error) return reject(new Error(parsed.error.message));
            const text = parsed.content.map((c) => c.text || "").join("");
            const clean = text.replace(/```json|```/g, "").trim();
            resolve(JSON.parse(clean));
          } catch (e) {
            reject(new Error("Failed to parse Claude response: " + e.message));
          }
        });
      }
    );
    req.on("error", reject);
    req.write(body);
    req.end();
  });
}

// ── Build HTML email ──────────────────────────────────────────────────────────
function buildEmail(issue) {
  const esc = (s) =>
    String(s || "")
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;");

  const tagColors = {
    "Clinical Practice":    { bg: "#f0e4d7", color: "#8b5e3c" },
    "Culture & Relationships": { bg: "#e4edf7", color: "#2d5f8a" },
    "Mind & Science":       { bg: "#dff0e6", color: "#3d6b4f" },
    "Training & Events":    { bg: "#f0eaf7", color: "#6b3fa0" },
  };

  let sectionsHtml = "";

  for (const section of issue.sections) {
    const tc = tagColors[section.tag] || { bg: "#eee", color: "#444" };

    let itemsHtml = "";

    if (section.articles) {
      for (const a of section.articles) {
        itemsHtml += `
          <div style="background:#ffffff;border:1px solid #e8e3db;border-radius:4px;padding:18px 20px;margin-bottom:12px;">
            <div style="font-family:'Georgia',serif;font-size:17px;font-weight:500;color:#1a1714;margin-bottom:4px;line-height:1.4;">${esc(a.title)}</div>
            <div style="font-size:11px;letter-spacing:0.07em;text-transform:uppercase;color:#8a8480;margin-bottom:10px;">${esc(a.source)}</div>
            <div style="font-size:14px;line-height:1.75;color:#4a4540;">${esc(a.summary)}</div>
            <div style="margin-top:10px;padding-top:10px;border-top:1px solid #ede9e2;font-size:13px;color:#8a8480;">
              <span style="color:#8b5e3c;font-weight:500;">Why it matters:</span> ${esc(a.why)}
            </div>
          </div>`;
      }
    }

    if (section.trainings) {
      for (const t of section.trainings) {
        itemsHtml += `
          <div style="background:#faf8f5;border:1px solid #e8e3db;border-radius:4px;padding:18px 20px;margin-bottom:12px;">
            <table width="100%" cellpadding="0" cellspacing="0"><tr>
              <td style="vertical-align:top;">
                <div style="font-family:'Georgia',serif;font-size:16px;font-weight:500;color:#1a1714;line-height:1.4;">${esc(t.name)}</div>
                <div style="font-size:11px;letter-spacing:0.06em;text-transform:uppercase;color:#8a8480;margin-top:3px;">${esc(t.org)}</div>
              </td>
              <td style="vertical-align:top;text-align:right;white-space:nowrap;padding-left:12px;">
                <span style="display:inline-block;background:#f0eaf7;color:#6b3fa0;font-size:12px;font-weight:500;padding:3px 9px;border-radius:3px;">${esc(t.date)}</span>
                <div style="font-size:12px;color:#8a8480;margin-top:5px;">${esc(t.location)}</div>
              </td>
            </tr></table>
            <div style="font-size:14px;line-height:1.75;color:#4a4540;margin-top:12px;">${esc(t.description)}</div>
          </div>`;
      }
    }

    sectionsHtml += `
      <div style="margin-bottom:36px;">
        <div style="display:flex;align-items:center;margin-bottom:16px;padding-bottom:12px;border-bottom:1px solid #e8e3db;">
          <span style="background:${tc.bg};color:${tc.color};font-size:10px;letter-spacing:0.12em;text-transform:uppercase;font-weight:500;padding:4px 10px;border-radius:3px;margin-right:12px;">${esc(section.tag)}</span>
          <span style="font-family:'Georgia',serif;font-size:20px;font-weight:400;color:#1a1714;">${esc(section.title)}</span>
        </div>
        ${itemsHtml}
      </div>`;
  }

  return `<!DOCTYPE html>
<html lang="en">
<head><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1.0">
<title>The Examined Life — Issue #${issueNumber}</title>
</head>
<body style="margin:0;padding:0;background:#f7f4ef;font-family:'Helvetica Neue',Arial,sans-serif;">
<table width="100%" cellpadding="0" cellspacing="0" style="background:#f7f4ef;padding:32px 16px;">
<tr><td align="center">
<table width="100%" cellpadding="0" cellspacing="0" style="max-width:620px;">

  <!-- Masthead -->
  <tr><td style="background:#1a1714;padding:32px 36px 28px;border-radius:4px 4px 0 0;">
    <div style="font-family:'Georgia',serif;font-size:36px;font-weight:400;color:#f7f4ef;letter-spacing:-0.02em;line-height:1;">
      The <em style="color:#c4956a;">Examined</em> Life
    </div>
    <div style="font-size:11px;letter-spacing:0.1em;text-transform:uppercase;color:#8a8480;margin-top:10px;">
      Issue No. ${issueNumber} &nbsp;·&nbsp; ${dateStr} &nbsp;·&nbsp; A Newsletter for the Practicing Therapist
    </div>
  </td></tr>

  <!-- Body -->
  <tr><td style="background:#f7f4ef;padding:32px 36px;">

    <!-- Intro -->
    <div style="margin-bottom:32px;padding:18px 22px;border-left:3px solid #c4956a;background:#fdfbf8;">
      <p style="font-family:'Georgia',serif;font-size:16px;line-height:1.8;color:#4a4540;font-style:italic;margin:0;">${esc(issue.intro)}</p>
    </div>

    <!-- Sections -->
    ${sectionsHtml}

    <!-- Closing -->
    <div style="background:#ede9e2;border-radius:4px;padding:20px 24px;margin-top:8px;">
      <p style="font-family:'Georgia',serif;font-size:15px;line-height:1.8;color:#4a4540;font-style:italic;margin:0;">${esc(issue.closing)}</p>
    </div>

  </td></tr>

  <!-- Footer -->
  <tr><td style="background:#1a1714;padding:20px 36px;border-radius:0 0 4px 4px;text-align:center;">
    <p style="font-size:11px;color:#8a8480;letter-spacing:0.05em;margin:0;">
      The Examined Life &nbsp;·&nbsp; Generated for Luisa Mancera &nbsp;·&nbsp; Bi-weekly
    </p>
  </td></tr>

</table>
</td></tr>
</table>
</body>
</html>`;
}

// ── Send via Resend ───────────────────────────────────────────────────────────
function sendEmail(html) {
  return new Promise((resolve, reject) => {
    const body = JSON.stringify({
      from: `The Examined Life <${FROM_EMAIL}>`,
      to: [TO_EMAIL],
      subject: `The Examined Life — Issue #${issueNumber}`,
      html,
    });

    const req = https.request(
      {
        hostname: "api.resend.com",
        path: "/emails",
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${RESEND_API_KEY}`,
          "Content-Length": Buffer.byteLength(body),
        },
      },
      (res) => {
        let data = "";
        res.on("data", (chunk) => (data += chunk));
        res.on("end", () => {
          const parsed = JSON.parse(data);
          if (res.statusCode >= 400)
            return reject(new Error(JSON.stringify(parsed)));
          resolve(parsed);
        });
      }
    );
    req.on("error", reject);
    req.write(body);
    req.end();
  });
}

// ── Main ──────────────────────────────────────────────────────────────────────
(async () => {
  console.log(`Generating issue #${issueNumber} for ${dateStr}…`);
  try {
    const issue = await callAnthropic();
    console.log("✓ Newsletter content generated");
    const html = buildEmail(issue);
    const result = await sendEmail(html);
    console.log("✓ Email sent successfully:", result.id);
  } catch (err) {
    console.error("✗ Error:", err.message);
    process.exit(1);
  }
})();
