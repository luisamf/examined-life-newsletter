const https = require("https");

const ANTHROPIC_API_KEY = process.env.ANTHROPIC_API_KEY;
const RESEND_API_KEY = process.env.RESEND_API_KEY;
const TO_EMAIL = process.env.TO_EMAIL || "luisa.mancera@gmail.com";
const FROM_EMAIL = process.env.FROM_EMAIL || "hello@luisamancera.me";
const SITE_BASE_URL = (process.env.SITE_BASE_URL || "").replace(/\/$/, "");

const issueNumber = parseInt(process.argv[2] || "1", 10);
const today = new Date();
const dateStr = today.toLocaleDateString("en-US", { month: "long", day: "numeric", year: "numeric" });

// ── Anthropic API call (with retry) ──────────────────────────────────────────
async function callClaude({ system, userMessage, tools, maxTokens = 3000 }, retries = 3) {
  for (let attempt = 1; attempt <= retries; attempt++) {
    try {
      const payload = {
        model: "claude-sonnet-4-20250514",
        max_tokens: maxTokens,
        system,
        messages: [{ role: "user", content: userMessage }],
      };
      if (tools) payload.tools = tools;
      const body = JSON.stringify(payload);

      const result = await new Promise((resolve, reject) => {
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
            res.on("data", (c) => (data += c));
            res.on("end", () => {
              try {
                const parsed = JSON.parse(data);
                if (parsed.error) return reject(new Error(parsed.error.message));
                resolve(parsed);
              } catch (e) {
                reject(new Error("Failed to parse API response: " + e.message));
              }
            });
          }
        );
        req.on("error", reject);
        req.write(body);
        req.end();
      });

      return result;
    } catch (err) {
      const isRetryable = err.message.includes("Overloaded") || err.message.includes("rate limit");
      if (isRetryable && attempt < retries) {
        const wait = attempt * 30000;
        console.log(`  API overloaded, retrying in ${wait / 1000}s (attempt ${attempt}/${retries})...`);
        await new Promise((r) => setTimeout(r, wait));
      } else {
        throw err;
      }
    }
  }
}

function extractText(response) {
  return response.content
    .filter((c) => c.type === "text")
    .map((c) => c.text)
    .join("")
    .replace(/```json|```/g, "")
    .trim();
}

// ── Step 1: Generate newsletter skeleton ─────────────────────────────────────
async function generateNewsletter() {
  console.log("Generating newsletter skeleton...");

  const system = `You are the editor of "The Examined Life," a curated weekly newsletter for a psychotherapist in the Bay Area who is early in their career (2-3 years in). They work with couples and adult individuals. Their intellectual interests span:
- Deepening clinical skills (psychodynamic, attachment, IFS, somatic approaches, relational therapy)
- Cultural trends affecting relationships, intimacy, gender dynamics, dating, modern love, loneliness, technology and connection
- Cognitive science, neuroscience, behavioral science, and human development research
- Developmental psychopathology — how early developmental experiences, attachment disruptions, and environmental factors shape adult psychological patterns
- In-person training and conferences, prioritizing the San Francisco Bay Area
- An Esther Perel-style multidisciplinary approach weaving anthropology, philosophy, culture, and clinical insight

Tone: warm and collegial, like a smart friend sharing what they have been reading. Substantive but never dense or academic. Keep it tight — this should feel like a curated handful of things worth your attention, not a comprehensive digest.

Respond ONLY with a valid JSON object — no markdown fences, no preamble — following this exact schema:
{
  "quote": {
    "text": "A real, verifiable quote from a therapist, philosopher, writer, or scientist resonating with human development, relationships, or the inner life. Must be highly confident it is accurate.",
    "author": "Full name",
    "source": "Book title, interview, or context"
  },
  "articles": [
    {
      "title": "Article topic title",
      "source": "Publication name",
      "tag": "One of: Clinical Practice | Culture & Relationships | Mind & Science | Developmental Psychopathology",
      "tagClass": "One of: tag-practice | tag-culture | tag-science | tag-devpsych",
      "summary": "3-4 sentence substantive summary. Name a researcher, concept, or finding. Be specific.",
      "why": "One sentence on relevance for an early-career couples/individual therapist.",
      "searchQuery": "A specific 6-10 word web search query to find real sources on this topic"
    }
  ],
  "trainings": [
    {
      "name": "Event name",
      "org": "Organizing body",
      "date": "Full date or date range, e.g. June 14-16, 2026",
      "location": "City, State",
      "description": "2-3 sentences on what the training covers and why it is worth attending."
    }
  ],
  "closing": "A 2-3 sentence closing reflection — a question or thought to carry into sessions."
}

Requirements:
- Include EXACTLY 4 articles total. Choose freely from any of the 4 categories — you do not need to include every category every issue. Pick the 4 most interesting and varied topics this week.
- Include EXACTLY 3 trainings with SPECIFIC dates (day and month, not just month), e.g. "May 9-11, 2026" or "June 3, 2026"
- TRAINING PRIORITY: At least 2 Bay Area / Northern California events per issue (SF, Oakland, Berkeley, Marin, Santa Cruz, Big Sur/Esalen). Real organizations: CIIS, Esalen Institute, UCSF CME, Stanford CME, CAMFT, SF Gestalt Institute, Body-Mind Centering. Max 1 out-of-state event.
- Quote must be real and verifiable — if uncertain, choose a different one
- Vary categories and topics meaningfully week to week
- Respond ONLY with the JSON object`;

  const response = await callClaude({
    system,
    userMessage: `Generate newsletter issue #${issueNumber} for ${dateStr}. Make it feel fresh and varied.`,
    maxTokens: 2500,
  });

  const text = extractText(response);
  return JSON.parse(text);
}

// ── Step 2: Generate a full article + web-searched sources ───────────────────
async function generateArticle(articleData, issueNum) {
  console.log(`  Writing full article: "${articleData.title}"...`);

  const webSearchTool = {
    type: "web_search_20250305",
    name: "web_search",
  };

  const system = `You are a writer for "The Examined Life," a newsletter for an early-career psychotherapist. Write a full article (550-700 words) expanding on a newsletter summary.

Tone: warm, intelligent, collegial — like a smart colleague who has done a lot of reading and wants to share what they found. Not academic. Not a listicle. Flowing prose with a clear throughline.

After writing the article, use web search to find 2-3 real, credible sources. These must be real URLs that actually exist.

Respond ONLY with a valid JSON object — no markdown fences:
{
  "title": "Full article title",
  "body": "Full article text as a single string. Use \\n\\n for paragraph breaks. No markdown.",
  "sources": [
    {
      "title": "Source title",
      "publication": "Publication or journal name",
      "url": "Real URL"
    }
  ]
}`;

  const userMessage = `Write a full article for the "${articleData.tag}" section of issue #${issueNum}.

Summary to expand on: ${articleData.summary}
Original title: ${articleData.title}
Source context: ${articleData.source}
Why it matters: ${articleData.why}
Search query: ${articleData.searchQuery}

Write the full article, then search for real sources.`;

  const response = await callClaude({
    system,
    userMessage,
    tools: [webSearchTool],
    maxTokens: 2000,
  });

  const text = extractText(response);
  try {
    return JSON.parse(text);
  } catch (e) {
    return { title: articleData.title, body: articleData.summary, sources: [] };
  }
}

// ── Step 3: Build articles HTML page ─────────────────────────────────────────
function buildArticlesPage(issue, fullArticles, issueNum, datStr) {
  const esc = (s) =>
    String(s || "").replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");

  const tagColors = {
    "Clinical Practice":             { bg: "#f0e4d7", color: "#8b5e3c" },
    "Culture & Relationships":       { bg: "#e4edf7", color: "#2d5f8a" },
    "Mind & Science":                { bg: "#dff0e6", color: "#3d6b4f" },
    "Developmental Psychopathology": { bg: "#fef3e2", color: "#92610a" },
  };

  let articlesHtml = "";
  for (const fa of fullArticles) {
    const tc = tagColors[fa.tag] || { bg: "#eee", color: "#444" };
    const paragraphs = fa.body
      .split(/\n\n+/)
      .map((p) => `<p style="font-size:16px;line-height:1.85;color:#4a4540;margin:0 0 1.1em;">${esc(p)}</p>`)
      .join("");

    const sourcesHtml = fa.sources && fa.sources.length
      ? `<div style="margin-top:2rem;padding-top:1.5rem;border-top:1px solid #e8e3db;">
          <p style="font-size:11px;letter-spacing:0.1em;text-transform:uppercase;color:#8a8480;margin:0 0 0.75rem;font-weight:500;">Further reading</p>
          ${fa.sources.map((s) => `
            <div style="margin-bottom:0.6rem;">
              <a href="${esc(s.url)}" style="font-size:14px;color:#2d5f8a;text-decoration:none;" target="_blank">${esc(s.title)}</a>
              <span style="font-size:12px;color:#8a8480;"> — ${esc(s.publication)}</span>
            </div>`).join("")}
        </div>`
      : "";

    articlesHtml += `
      <div id="${esc(fa.slug)}" style="max-width:680px;margin:0 auto 4rem;padding-bottom:4rem;border-bottom:1px solid #e8e3db;">
        <span style="display:inline-block;background:${tc.bg};color:${tc.color};font-size:10px;letter-spacing:0.11em;text-transform:uppercase;font-weight:500;padding:3px 9px;border-radius:3px;margin-bottom:1rem;">${esc(fa.tag)}</span>
        <h2 style="font-family:'Georgia',serif;font-size:28px;font-weight:400;color:#1a1714;line-height:1.3;margin:0 0 0.4rem;">${esc(fa.title)}</h2>
        <p style="font-size:12px;color:#8a8480;letter-spacing:0.04em;margin:0 0 1.75rem;">The Examined Life · Issue #${issueNum} · ${esc(datStr)}</p>
        ${paragraphs}
        ${sourcesHtml}
      </div>`;
  }

  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1.0">
<title>The Examined Life — Issue #${issueNum} Articles</title>
<style>* { box-sizing:border-box; margin:0; padding:0; } body { background:#f7f4ef; font-family:'Helvetica Neue',Arial,sans-serif; padding:0 1rem; } a { color:#2d5f8a; }</style>
</head>
<body>
<div style="background:#1a1714;padding:24px 36px;margin-bottom:3rem;">
  <div style="max-width:680px;margin:0 auto;">
    <div style="font-family:'Georgia',serif;font-size:28px;color:#f7f4ef;font-weight:400;">The <em style="color:#c4956a;">Examined</em> Life</div>
    <div style="font-size:11px;letter-spacing:0.09em;text-transform:uppercase;color:#6a6460;margin-top:8px;">Issue #${issueNum} · ${esc(datStr)} · Full Articles</div>
  </div>
</div>
<div style="padding:0 1rem 4rem;">${articlesHtml}</div>
<div style="background:#1a1714;padding:20px 36px;text-align:center;">
  <p style="font-size:11px;color:#6a6460;letter-spacing:0.05em;">The Examined Life · For Luisa Mancera · Weekly</p>
</div>
</body>
</html>`;
}

// ── Step 4: Build email ───────────────────────────────────────────────────────
function buildEmail(issue, fullArticles, issueNum, datStr) {
  const esc = (s) =>
    String(s || "").replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");

  const tagColors = {
    "Clinical Practice":             { bg: "#f0e4d7", color: "#8b5e3c" },
    "Culture & Relationships":       { bg: "#e4edf7", color: "#2d5f8a" },
    "Mind & Science":                { bg: "#dff0e6", color: "#3d6b4f" },
    "Developmental Psychopathology": { bg: "#fef3e2", color: "#92610a" },
  };

  // Build articles HTML
  let articlesHtml = "";
  for (let i = 0; i < issue.articles.length; i++) {
    const a = issue.articles[i];
    const fa = fullArticles[i];
    const tc = tagColors[a.tag] || { bg: "#eee", color: "#444" };
    const articleUrl = fa && SITE_BASE_URL ? `${SITE_BASE_URL}/issue-${issueNum}.html#${fa.slug}` : null;

    articlesHtml += `
      <div style="background:#ffffff;border:1px solid #e8e3db;border-radius:4px;padding:18px 20px;margin-bottom:12px;">
        <span style="display:inline-block;background:${tc.bg};color:${tc.color};font-size:10px;letter-spacing:0.11em;text-transform:uppercase;font-weight:500;padding:3px 9px;border-radius:3px;margin-bottom:10px;">${esc(a.tag)}</span>
        <div style="font-family:'Georgia',serif;font-size:17px;font-weight:500;color:#1a1714;margin-bottom:4px;line-height:1.4;">${esc(a.title)}</div>
        <div style="font-size:11px;letter-spacing:0.07em;text-transform:uppercase;color:#8a8480;margin-bottom:10px;">${esc(a.source)}</div>
        <div style="font-size:14px;line-height:1.75;color:#4a4540;">${esc(a.summary)}</div>
        <div style="margin-top:10px;padding-top:10px;border-top:1px solid #ede9e2;font-size:13px;color:#8a8480;">
          <span style="color:#8b5e3c;font-weight:500;">Why it matters:</span> ${esc(a.why)}
        </div>
        ${articleUrl ? `<div style="margin-top:12px;"><a href="${esc(articleUrl)}" style="font-size:13px;color:#2d5f8a;text-decoration:none;font-weight:500;">Read full article &rarr;</a></div>` : ""}
      </div>`;
  }

  // Build trainings HTML
  let trainingsHtml = "";
  for (const t of issue.trainings) {
    trainingsHtml += `
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

  return `<!DOCTYPE html>
<html lang="en">
<head><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1.0">
<title>The Examined Life — Issue #${issueNum}</title></head>
<body style="margin:0;padding:0;background:#f7f4ef;font-family:'Helvetica Neue',Arial,sans-serif;">
<table width="100%" cellpadding="0" cellspacing="0" style="background:#f7f4ef;padding:32px 16px;">
<tr><td align="center">
<table width="100%" cellpadding="0" cellspacing="0" style="max-width:620px;">
  <tr><td style="background:#1a1714;padding:32px 36px 28px;border-radius:4px 4px 0 0;">
    <div style="font-family:'Georgia',serif;font-size:36px;font-weight:400;color:#f7f4ef;letter-spacing:-0.02em;line-height:1;">The <em style="color:#c4956a;">Examined</em> Life</div>
    <div style="font-size:11px;letter-spacing:0.1em;text-transform:uppercase;color:#8a8480;margin-top:10px;">Issue No. ${issueNum} &nbsp;·&nbsp; ${datStr} &nbsp;·&nbsp; A Newsletter for the Practicing Therapist</div>
  </td></tr>
  <tr><td style="background:#f7f4ef;padding:32px 36px;">

    <div style="margin-bottom:32px;padding:20px 24px;border-left:3px solid #c4956a;background:#fdfbf8;">
      <p style="font-family:'Georgia',serif;font-size:17px;line-height:1.8;color:#1a1714;font-style:italic;margin:0 0 10px;">&ldquo;${esc(issue.quote.text)}&rdquo;</p>
      <p style="font-size:12px;color:#8a8480;margin:0;letter-spacing:0.03em;">&mdash; ${esc(issue.quote.author)}, <em>${esc(issue.quote.source)}</em></p>
    </div>

    ${articlesHtml}

    <div style="margin-top:28px;margin-bottom:12px;padding-bottom:12px;border-bottom:1px solid #e8e3db;">
      <span style="background:#f0eaf7;color:#6b3fa0;font-size:10px;letter-spacing:0.12em;text-transform:uppercase;font-weight:500;padding:4px 10px;border-radius:3px;">Training &amp; Events</span>
    </div>
    ${trainingsHtml}

    <div style="background:#ede9e2;border-radius:4px;padding:20px 24px;margin-top:24px;">
      <p style="font-family:'Georgia',serif;font-size:15px;line-height:1.8;color:#4a4540;font-style:italic;margin:0;">${esc(issue.closing)}</p>
    </div>

  </td></tr>
  <tr><td style="background:#1a1714;padding:20px 36px;border-radius:0 0 4px 4px;text-align:center;">
    <p style="font-size:11px;color:#8a8480;letter-spacing:0.05em;margin:0;">The Examined Life &nbsp;·&nbsp; For Luisa Mancera &nbsp;·&nbsp; Weekly</p>
  </td></tr>
</table>
</td></tr>
</table>
</body>
</html>`;
}

// ── Step 5: Save articles page to GitHub ─────────────────────────────────────
async function saveArticlesPage(html, issueNum) {
  const GITHUB_TOKEN = process.env.GITHUB_TOKEN;
  const GITHUB_REPO = process.env.GITHUB_REPOSITORY;
  if (!GITHUB_TOKEN || !GITHUB_REPO) {
    console.warn("No GITHUB_TOKEN or GITHUB_REPOSITORY — skipping page save.");
    return;
  }

  const path = `issue-${issueNum}.html`;
  const content = Buffer.from(html).toString("base64");

  let sha;
  try {
    const existing = await new Promise((resolve, reject) => {
      const req = https.request(
        {
          hostname: "api.github.com",
          path: `/repos/${GITHUB_REPO}/contents/${path}`,
          method: "GET",
          headers: {
            Authorization: `Bearer ${GITHUB_TOKEN}`,
            "User-Agent": "examined-life-newsletter",
            Accept: "application/vnd.github+json",
          },
        },
        (res) => {
          let d = "";
          res.on("data", (c) => (d += c));
          res.on("end", () => resolve(JSON.parse(d)));
        }
      );
      req.on("error", reject);
      req.end();
    });
    sha = existing.sha;
  } catch (_) {}

  const body = JSON.stringify({
    message: `Add issue #${issueNum} articles page`,
    content,
    ...(sha ? { sha } : {}),
  });

  await new Promise((resolve, reject) => {
    const req = https.request(
      {
        hostname: "api.github.com",
        path: `/repos/${GITHUB_REPO}/contents/${path}`,
        method: "PUT",
        headers: {
          Authorization: `Bearer ${GITHUB_TOKEN}`,
          "User-Agent": "examined-life-newsletter",
          Accept: "application/vnd.github+json",
          "Content-Type": "application/json",
          "Content-Length": Buffer.byteLength(body),
        },
      },
      (res) => {
        let d = "";
        res.on("data", (c) => (d += c));
        res.on("end", () => {
          const r = JSON.parse(d);
          if (r.content) {
            console.log(`✓ Articles page saved: ${SITE_BASE_URL}/issue-${issueNum}.html`);
            resolve(r);
          } else {
            reject(new Error(JSON.stringify(r)));
          }
        });
      }
    );
    req.on("error", reject);
    req.write(body);
    req.end();
  });
}

// ── Step 6: Send email via Resend ─────────────────────────────────────────────
function sendEmail(html, issueNum) {
  return new Promise((resolve, reject) => {
    const body = JSON.stringify({
      from: `The Examined Life <${FROM_EMAIL}>`,
      to: [TO_EMAIL],
      subject: `The Examined Life — Issue #${issueNum}`,
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
        res.on("data", (c) => (data += c));
        res.on("end", () => {
          const parsed = JSON.parse(data);
          if (res.statusCode >= 400) return reject(new Error(JSON.stringify(parsed)));
          resolve(parsed);
        });
      }
    );
    req.on("error", reject);
    req.write(body);
    req.end();
  });
}

// ── Slug helper ───────────────────────────────────────────────────────────────
function slugify(str) {
  return String(str)
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "")
    .slice(0, 60);
}

// ── Main ──────────────────────────────────────────────────────────────────────
(async () => {
  console.log(`\nThe Examined Life — Issue #${issueNumber} — ${dateStr}\n`);
  try {
    const issue = await generateNewsletter();
    console.log("✓ Newsletter skeleton generated");
    console.log(`  Quote: "${issue.quote.text.slice(0, 60)}..." — ${issue.quote.author}`);

    const fullArticles = [];
    for (const article of issue.articles) {
      const fa = await generateArticle(article, issueNumber);
      fa.slug = slugify(fa.title || article.title);
      fa.tag = article.tag;
      fullArticles.push(fa);
      await new Promise((r) => setTimeout(r, 12000));
    }
    console.log(`✓ ${fullArticles.length} full articles generated`);

    const articlesHtml = buildArticlesPage(issue, fullArticles, issueNumber, dateStr);
    await saveArticlesPage(articlesHtml, issueNumber);

    const emailHtml = buildEmail(issue, fullArticles, issueNumber, dateStr);
    const result = await sendEmail(emailHtml, issueNumber);
    console.log("✓ Email sent:", result.id);
    console.log("\nDone!\n");
  } catch (err) {
    console.error("✗ Error:", err.message);
    process.exit(1);
  }
})();
