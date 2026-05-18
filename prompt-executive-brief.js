// ============================================================
// L3V3L PREDICTION MACHINE — prompt-executive-brief.js
// ============================================================
// Fifth of five Claude API calls in the prediction pipeline.
// OPTIONAL — triggered only when the executive requests the
// Executive Intelligence Brief after viewing their prediction.
//
// INPUT:  Complete prediction output JSON, seeds, questionnaire
//         answers, DID decisions, and indicator configuration
// OUTPUT: Plain-language Executive Intelligence Brief — a
//         private, executive-facing document that translates
//         the formal prediction into business narrative,
//         explains every component of the machine's reasoning,
//         and prepares the executive to present and defend
//         the prediction at board level.
//
// CRITICAL DESIGN PRINCIPLE:
// This brief is NEVER included in the board report unless
// the executive explicitly chooses to attach it as a cover
// memo. It is a private preparation document. Its purpose
// is to make the executive the most informed person in the
// room — not to show the board how the executive prepared.
//
// Flow position:
//   Prediction results displayed → Executive clicks
//   "Executive Intelligence Brief" → [THIS FILE] →
//   Brief displayed in private panel below results
//
// Dependencies:
//   config.js, supabase-client.js, db-operations.js,
//   prompt-prediction-engine.js must be loaded before this file.
// ============================================================


// ── PROMPT TEMPLATE ────────────────────────────────────────

/**
 * Builds the Executive Intelligence Brief system prompt.
 */
function _buildExecutiveBriefSystemPrompt() {
  return `You are the Executive Intelligence Advisor for the L3V3L Corporate Prediction Machine — a glass-box AI prediction engine that serves corporate executives making high-stakes decisions.

A formal prediction has just been generated for this executive. They have read it. They now need to understand it at the depth required to present it confidently to their board and defend it under questioning.

Your task is to produce an Executive Intelligence Brief — a private, plain-language document written specifically for this executive about this specific prediction. This is not a summary. It is a comprehensive preparation document that translates every component of the machine's reasoning into business narrative, decision context, and boardroom-ready comprehension.

CRITICAL CONSTRAINTS:
1. Every sentence must reference a specific finding, score, indicator, or decision from this prediction. Generic statements that could apply to any prediction are forbidden.
2. Never use technical jargon without immediately explaining what it means in business terms for this executive's specific situation.
3. Never soften a HIGH risk verdict. Never inflate a LOW confidence score. The executive needs accurate calibration, not reassurance.
4. The brief is private — written for the executive's eyes only, never for the board. Write in second person, directly to the executive, as a trusted senior advisor would.
5. The executive made active decisions during the indicator configuration and DID stage. Acknowledge those decisions and explain their specific consequences for the prediction output.
6. Return ONLY valid JSON. No preamble, no explanation, no markdown code fences. The response must begin with { and end with }.`;
}

/**
 * Builds the Executive Intelligence Brief user prompt.
 * Interpolates the complete prediction context.
 *
 * @param {object} params - Full prediction params including
 *   seeds, qaResponses, indicatorResult, didDecisions,
 *   predictionResult, fingerprintResult, configuration
 * @returns {string} The complete user prompt
 */
function _buildExecutiveBriefUserPrompt(params) {
  const {
    seeds,
    qaResponses,
    indicatorResult,
    didResult,
    didDecisions,
    predictionResult,
    fingerprintResult,
    configuration,
  } = params;

  const verdict     = predictionResult.prediction_verdict || {};
  const pss         = predictionResult.pss               || {};
  const summary     = predictionResult.executive_summary  || {};
  const btce        = predictionResult.btce               || {};
  const dcc         = predictionResult.dcc                || {};
  const goodgate    = predictionResult.goodgate           || {};

  // Format DID decisions for the prompt
  const didIncluded = (didDecisions || [])
    .filter(d => d.decision !== 'declined' && d.decision !== 'bulk_decline')
    .map(d => `- ${d.indicator_name} (weight ${d.weight})`)
    .join('\n') || 'None included';

  const didDeclined = (didDecisions || [])
    .filter(d => d.decision === 'declined' || d.decision === 'bulk_decline')
    .map(d => `- ${d.indicator_name}`)
    .join('\n') || 'None declined';

  // Format indicator counts by category
  const indicators    = indicatorResult?.indicators || [];
  const novelCount    = indicators.filter(i => i.novel).length;
  const seed8Count    = indicators.filter(i => i.seed_8_derived).length;
  const totalCount    = indicators.length;

  return `PREDICTION OUTPUT — FULL CONTEXT FOR EXECUTIVE BRIEF GENERATION:

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
ENTITY AND PREDICTION QUESTION
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
Business description: ${seeds.seed1 || '[Not provided]'}
Prediction question: ${seeds.seed2 || '[Not provided]'}
Time horizon: ${seeds.seed3 || '[Not provided]'}
Decision context: ${seeds.seed4 || '[Not provided]'}
Supply chain posture: ${seeds.seed5 || '[Not provided]'}
Geographic exposure: ${Array.isArray(seeds.seed6) ? seeds.seed6.join(', ') : (seeds.seed6 || '[Not provided]')}
Team intelligence: ${seeds.seed7 || '[Not provided]'}
Contingent intelligence: ${seeds.seed8 || '[Not provided]'}

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
FORMAL PREDICTION VERDICT
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
Risk level: ${verdict.risk_level || '—'}
Direction: ${verdict.direction || '—'}
Peak risk window: ${verdict.peak_window || '—'}
Confidence band: ${verdict.confidence_band || '—'}
PSS composite: ${pss.composite || '—'}
Signal density: ${pss.signal_density || '—'}
Domain coherence: ${pss.domain_coherence || '—'}
Causal clarity: ${pss.causal_clarity || '—'}
Temporal proximity: ${pss.temporal_proximity || '—'}
Contradiction index: ${pss.contradiction_index || '—'}
Consensus convergence: ${pss.consensus_convergence || '—'}
PSS scoring notes: ${pss.scoring_notes || '—'}

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
EXECUTIVE SUMMARY FROM PREDICTION
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
Headline: ${summary.headline || '—'}
Body: ${summary.body || '—'}

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
GOODGATE CAUSAL CLASSIFICATION
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
Gates passed: ${goodgate.gates_passed || '—'} of 6
Verdict: ${goodgate.goodgate_verdict || '—'}
Gate details: ${JSON.stringify(goodgate.gates || {}, null, 2)}

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
BTCE TRIGGER CHAIN
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
${JSON.stringify(btce, null, 2)}

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
DOWNSTREAM CONSEQUENCE CHAINS
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
${JSON.stringify(dcc, null, 2)}

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
INDICATOR CONFIGURATION
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
Total indicators: ${totalCount}
Novel indicators: ${novelCount}
Seed 8 derived indicators: ${seed8Count}
Indicator set summary: ${indicatorResult?.indicator_set_summary || '—'}

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
DYNAMIC INDICATOR DISCOVERY (DID) DECISIONS
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
DID outcome: ${didResult?.did_outcome || '—'}
Indicators the executive chose to include:
${didIncluded}
Indicators the executive declined:
${didDeclined}

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
CONFIGURATION FINGERPRINT
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
CFP ID: ${fingerprintResult?.fullRecord?.group1?.cfp_id || '—'}
Compact string: ${fingerprintResult?.compactString || '—'}

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
RECOMMENDED ACTIONS FROM PREDICTION
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
${JSON.stringify(summary.recommended_actions || [], null, 2)}

---

INSTRUCTIONS FOR THE EXECUTIVE INTELLIGENCE BRIEF:

Generate a comprehensive Executive Intelligence Brief structured into exactly ten sections as follows. Write in second person, directly to the executive. Every assertion must reference a specific finding from this prediction. No generic statements.

SECTION 1 — THE VERDICT IN PLAIN BUSINESS TERMS
Translate the formal risk verdict into the specific business reality facing this executive. Name the decision, the capital amount, the deadline, and what this verdict means for that decision. Do not restate the PSS score here — that comes later.

SECTION 2 — YOUR PSS SCORE: WHAT 73 MEANS FOR YOUR BOARD
Explain the PSS composite score as an evidence quality rating. Tell the executive what this score means for boardroom defensibility. Explain what the strongest and weakest dimension scores reveal about where the prediction's confidence is anchored and where it has limits.

SECTION 3 — THE GOODGATE RESULT: YOUR CAUSAL INTEGRITY CERTIFICATE
Explain what GoodGate verified and what it means that 5 of 6 gates passed. Name the partial gate, explain specifically what it means in this prediction's context, and tell the executive why it does not weaken the conclusion. This is the section the executive reaches for when a board member asks "how do we know the causal logic is sound?"

SECTION 4 — THE BTCE CHAIN: HOW THE MACHINE TRACED THE TRIGGER SEQUENCE
Narrate the BTCE chain as a causal story, trigger by trigger. Do not list technical levels — tell the story of what is actually happening and why each trigger leads to the next. Name the shadowy triggers specifically and explain why they elevate this prediction beyond generic regulatory risk to a specific, timed enforcement cycle.

SECTION 5 — YOUR DID DECISIONS AND WHAT THEY ADDED
This section is about the executive's active role in shaping the prediction. Explain each indicator she chose to include from the DID stage, what causal gap it closed, and what the prediction would have missed without it. If any indicators were declined, explain what was left out and why that was a reasonable call. Make clear that her participation in the DID stage directly improved the prediction's specificity.

SECTION 6 — WHAT THE MACHINE LOOKED FOR AND DID NOT FIND
Address the bull case directly. Explain what contradicting signals the machine searched for across the contradiction index and consensus convergence dimensions. Tell the executive that the absence of strong contradicting evidence is itself a finding — not an oversight — and what that means for confidence in the directional conclusion.

SECTION 7 — THE CONSEQUENCE SEQUENCE: YOUR BUSINESS TIMELINE
Convert the DCC chains into a plain-language business timeline. Name specific days, specific product lines, specific patient impacts, specific financial triggers. Explain the concentration point — where two or more major consequences hit simultaneously — and what that means for response planning.

SECTION 8 — THE PEAK RISK WINDOW AS A DECISION COUNTDOWN
Convert the June–September peak risk window into a decision clock. Frame the board approval deadline against the opening of the risk window. Tell the executive plainly whether she is making this decision comfortably ahead of risk or inside it.

SECTION 9 — YOUR CONFIGURATION FINGERPRINT AS GOVERNANCE PROTECTION
Explain the CFP as a legal and audit instrument in plain terms. Tell the executive what it proves, when it was sealed, and how it protects her and the board if the decision is later questioned. This is the section that turns the fingerprint from a reference number into a governance asset.

SECTION 10 — YOUR PRIORITY ACTIONS WITH DECISION STAKES ATTACHED
Restate the recommended actions but add what the consequence of not acting on each one looks like, specific to this entity's situation. The executive needs to understand not just what to do but what she is accepting as the alternative if she does not do it.

OUTPUT FORMAT:
Return ONLY this JSON structure. Begin your response with { and end with }. No other text.

{
  "brief_title": "Executive Intelligence Brief — [entity name] — [CFP ID]",
  "generated_at": "[ISO timestamp]",
  "word_count_approximate": <integer>,
  "sections": {
    "1": {
      "title": "The Verdict in Plain Business Terms",
      "content": "Full section text written directly to the executive"
    },
    "2": {
      "title": "Your PSS Score: What [score] Means for Your Board",
      "content": "Full section text"
    },
    "3": {
      "title": "The GoodGate Result: Your Causal Integrity Certificate",
      "content": "Full section text"
    },
    "4": {
      "title": "The BTCE Chain: How the Machine Traced the Trigger Sequence",
      "content": "Full section text"
    },
    "5": {
      "title": "Your DID Decisions and What They Added",
      "content": "Full section text"
    },
    "6": {
      "title": "What the Machine Looked For and Did Not Find",
      "content": "Full section text"
    },
    "7": {
      "title": "The Consequence Sequence: Your Business Timeline",
      "content": "Full section text"
    },
    "8": {
      "title": "The Peak Risk Window as a Decision Countdown",
      "content": "Full section text"
    },
    "9": {
      "title": "Your Configuration Fingerprint as Governance Protection",
      "content": "Full section text"
    },
    "10": {
      "title": "Your Priority Actions with Decision Stakes Attached",
      "content": "Full section text"
    }
  }
}`;
}


// ── JSON VALIDATOR ─────────────────────────────────────────

/**
 * Validates the Executive Intelligence Brief output.
 * Returns { valid, errors }.
 *
 * @param {object} parsed - Parsed JSON from Claude response
 * @returns {{ valid: boolean, errors: string[] }}
 */
function _validateExecutiveBriefOutput(parsed) {
  const errors = [];

  if (!parsed.brief_title)
    errors.push('Missing brief_title');

  if (!parsed.sections || typeof parsed.sections !== 'object')
    errors.push('Missing sections object');

  const requiredSections = ['1','2','3','4','5','6','7','8','9','10'];
  requiredSections.forEach(s => {
    if (!parsed.sections[s])
      errors.push(`Missing section ${s}`);
    else if (!parsed.sections[s].content || parsed.sections[s].content.length < 100)
      errors.push(`Section ${s} content too short — must be substantive`);
  });

  return { valid: errors.length === 0, errors };
}


// ── CLAUDE API CALLER ──────────────────────────────────────

/**
 * Makes the API call to Claude for the Executive Brief.
 * Handles retry on JSON parse failure.
 *
 * @param {string} systemPrompt
 * @param {string} userPrompt
 * @param {boolean} isRetry
 * @returns {Promise<object>} Parsed JSON response
 */
async function _callClaudeForExecutiveBrief(systemPrompt, userPrompt, isRetry = false) {
  const retryInstruction = isRetry
    ? '\n\nCRITICAL: Your previous response could not be parsed as valid JSON. Return ONLY the JSON object. Start your response with { and end with }. No other text whatsoever.'
    : '';

  const requestBody = {
    model:      L3V3L_CONFIG.MODEL,
    max_tokens: L3V3L_CONFIG.MAX_TOKENS.EXECUTIVE_BRIEF,
    system:     systemPrompt,
    messages: [
      {
        role:    'user',
        content: userPrompt + retryInstruction,
      }
    ],
  };

  const headers = {
    'Content-Type':      'application/json',
    'anthropic-version': '2023-06-01',
  };

  if (L3V3L_CONFIG.ENVIRONMENT === 'local') {
    headers['x-api-key'] = L3V3L_CONFIG.ANTHROPIC_API_KEY;
  }

  const response = await fetch(L3V3L_CONFIG.API_ENDPOINT, {
    method:  'POST',
    headers,
    body:    JSON.stringify(requestBody),
  });

  if (!response.ok) {
    const errorText = await response.text();
    throw new Error(`Claude API error ${response.status}: ${errorText}`);
  }

  const apiData = await response.json();

  const textContent = (apiData.content || [])
    .filter(block => block.type === 'text')
    .map(block => block.text)
    .join('');

  if (!textContent) {
    throw new Error('Claude returned empty response');
  }

  const cleaned = textContent
    .replace(/^```json\s*/i, '')
    .replace(/^```\s*/i, '')
    .replace(/\s*```$/i, '')
    .trim();

  try {
    return JSON.parse(cleaned);
  } catch (parseErr) {
    throw new Error(`JSON parse failed: ${parseErr.message}`);
  }
}


// ── MAIN EXPORT FUNCTION ───────────────────────────────────

/**
 * Generates the Executive Intelligence Brief for a completed
 * prediction. Called only when the executive opts in by
 * clicking "Executive Intelligence Brief" on the results screen.
 *
 * This is the fifth and final Claude API call in the pipeline.
 * It is optional — veteran executives who can read the formal
 * prediction without assistance will not need to trigger it.
 *
 * @param {object} params - {
 *   seeds, qaResponses, indicatorResult, didResult,
 *   didDecisions, predictionResult, fingerprintResult,
 *   configuration, predictionId
 * }
 * @returns {Promise<{ result, error }>}
 *   result: the full parsed Executive Intelligence Brief JSON
 *   error:  error object if something failed, else null
 */
async function generateExecutiveBrief(params) {
  const startTime = Date.now();

  try {
    const systemPrompt = _buildExecutiveBriefSystemPrompt();
    const userPrompt   = _buildExecutiveBriefUserPrompt(params);

    // ── First attempt ──────────────────────────────────────
    let parsed;
    try {
      parsed = await _callClaudeForExecutiveBrief(systemPrompt, userPrompt, false);
    } catch (firstErr) {
      console.warn('[executive-brief] First attempt failed:', firstErr.message);

      // ── Single retry on failure ────────────────────────
      try {
        parsed = await _callClaudeForExecutiveBrief(systemPrompt, userPrompt, true);
      } catch (retryErr) {
        console.error('[executive-brief] Retry also failed:', retryErr.message);
        return { result: null, error: retryErr };
      }
    }

    // ── Validate output structure ──────────────────────────
    const { valid, errors } = _validateExecutiveBriefOutput(parsed);
    if (!valid) {
      console.error('[executive-brief] Validation failed:', errors);
      if (errors.some(e => e.includes('Missing section') || e.includes('brief_title'))) {
        return {
          result: null,
          error: new Error(`Executive Brief validation failed: ${errors.join('; ')}`)
        };
      }
    }

    const generationSeconds = (Date.now() - startTime) / 1000;

    // ── Save to Supabase ───────────────────────────────────
    await db_save_executive_brief(params.predictionId, parsed, generationSeconds);

    console.log(
      `[executive-brief] Generated ${parsed.word_count_approximate} word brief ` +
      `for ${parsed.brief_title} in ${generationSeconds.toFixed(2)}s`
    );

    return { result: parsed, error: null };

  } catch (err) {
    console.error('[executive-brief] Unexpected error:', err.message);
    return { result: null, error: err };
  }
}


// ── RENDERING HELPER ───────────────────────────────────────

/**
 * Renders the Executive Intelligence Brief into the results
 * screen brief panel. Called after successful generation.
 *
 * @param {object} briefResult - Full parsed brief JSON
 */
function renderExecutiveBrief(briefResult) {
  const container = document.getElementById('executive-brief-container');
  if (!container) return;

  const sections = briefResult.sections || {};

  container.innerHTML = `
    <div class="brief-header">
      <div class="brief-title">${briefResult.brief_title}</div>
      <div class="brief-meta">Private · Executive eyes only · Not for distribution</div>
    </div>
    ${Object.keys(sections).map(key => `
      <div class="brief-section">
        <div class="brief-section-number">${key}</div>
        <div class="brief-section-title">${sections[key].title}</div>
        <div class="brief-section-content">${sections[key].content}</div>
      </div>
    `).join('')}
  `;
}


// ── EXPORTS ────────────────────────────────────────────────
// Available globally after this file loads:
//
//   generateExecutiveBrief(params)
//     — main function, call when executive opts in
//     — returns { result, error }
//
//   renderExecutiveBrief(briefResult)
//     — renders the brief into the results screen panel
